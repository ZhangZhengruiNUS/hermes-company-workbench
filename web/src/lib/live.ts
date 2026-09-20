// live — SSE 单例 transport + 轮询降级(§2.4)
// 语义与旧版 kanban.html line-by-line 一致:
//   - 模块级单例 EventSource (不是每次 mount 重建)
//   - 游标追齐: fetchEventsCatchup(STATE.evCursor) 多页补取, cursor 不前进立即报错
//   - ACT_EVENTS 顶层去重 (prependActivities sort by id desc)
//   - state machine: live/poll/reconnect/offline (chip 沿袭旧版)
//   - visibility: 回前台立即拉
//   - 通知到达: catchup → prepend → refreshBoard
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const LIVE = "live" as const;
const POLLING = "polling" as const;
const RECONNECTING = "reconnecting" as const;
const OFFLINE = "offline" as const;
export type LiveState = "live" | "polling" | "reconnecting" | "offline";

interface EventMessage {
  id?: number;
  ts?: string;
  kind?: string;
  task_id?: string;
  task_title?: string;
  actor?: string;
  detail?: string;
}
interface RawEvent {
  id?: number;
  created_at?: number | string;
  kind?: string;
  task_id?: string;
  title?: string;
  actor?: string;
  detail?: string;
  payload?: Record<string, unknown>;
}
interface EventsResponse {
  events?: RawEvent[];
  has_more?: boolean;
  next_cursor?: number;
  cursor?: number;   // some endpoints return `cursor` instead of `next_cursor`
}

// ---- 内部状态 (模块级单例) ----
let esSingleton: EventSource | null = null;
let esReady = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let visibility = true;

const KANBAN_STATE = {
  mode: OFFLINE as LiveState,
  lastOk: 0 as number,       // last fetchBoard success unix seconds
  cursor: 0 as number,       // database latest watermark (from board)
  evCursor: 0 as number,     // frontend consumed position
};

// ACT_EVENTS — 顶层事件池(去重+倒序)
let ACT_EVENTS: EventMessage[] = [];

// ---- React 订阅 ----
const listeners = new Set<()=>void>();
function notify() { listeners.forEach((fn) => fn()); }
function subscribe(cb: ()=>void) { listeners.add(cb); return () => listeners.delete(cb); }
function getSnapshot() { return ACT_EVENTS; }

// 外部传入的 board refresh 回调; 运行时由 mount 注册
let onBoardRefresh: (() => void) | null = null;

// ---- fetchJSON 内联 helper ----
async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<{ json?: { ok: boolean; data?: T }; err?: string }> {
  try {
    const r = await fetch(url, opts);
    const j = await r.json();
    return { json: j };
  } catch (e) {
    return { err: String(e) };
  }
}

// ---- 旧版 parity: fetchEventsCatchup ----
async function fetchEventsCatchup(after: number): Promise<{ events: RawEvent[]; cursor: number }> {
  function step(cur: number, acc: RawEvent[]): Promise<{ events: RawEvent[]; cursor: number }> {
    return fetchJSON<EventsResponse>("/api/v1/events?after=" + cur).then((r) => {
      if (!(r.json && r.json.ok)) throw new Error("events api error");
      const d = r.json.data!;
      if (d.events && d.events.length) acc = acc.concat(d.events);
      const nc = d.next_cursor ?? d.cursor ?? cur;
      if (nc <= cur) {
        if (d.has_more) throw new Error("events cursor stalled at " + cur);
        return { events: acc, cursor: cur };
      }
      if (d.has_more) return step(nc, acc);
      return { events: acc, cursor: nc };
    });
  }
  return step(after, []);
}

// ---- 旧版 parity: prependActivities (去重+倒序) ----
function rawToEvent(r: RawEvent): EventMessage {
  return {
    id: typeof r.id === "number" ? r.id : undefined,
    ts: r.created_at != null ? new Date(Number(r.created_at) * 1000).toISOString() : undefined,
    kind: r.kind ? String(r.kind) : undefined,
    task_id: r.task_id ? String(r.task_id) : undefined,
    task_title: r.title ? String(r.title) : undefined,
    actor: r.actor ? String(r.actor) : undefined,
    detail: r.detail ? String(r.detail) : (r.payload ? JSON.stringify(r.payload).slice(0, 80) : undefined),
  };
}
function prependActivities(raw: RawEvent[]) {
  const seen = new Set<number>();
  ACT_EVENTS.forEach((e) => { if (e.id != null) seen.add(e.id); });
  let added = 0;
  raw.forEach((r) => {
    const id = typeof r.id === "number" ? r.id : undefined;
    if (id != null && seen.has(id)) return;
    if (id != null) seen.add(id);
    ACT_EVENTS.push(rawToEvent(r));
    added++;
  });
  ACT_EVENTS.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  if (added > 0) notify();
}

// ---- 旧版 parity: fetchBoard ----
async function fetchBoard(): Promise<boolean> {
  const r = await fetchJSON<{ tasks?: unknown[]; events_cursor?: number; fetched_at?: number; projects?: unknown[] }>(
    "/api/v1/board"
  );
  if (r.json && r.json.ok) {
    const d = r.json.data!;
    KANBAN_STATE.cursor = d.events_cursor || KANBAN_STATE.cursor;
    KANBAN_STATE.lastOk = d.fetched_at || Math.floor(Date.now() / 1000);
    if (onBoardRefresh) onBoardRefresh();
    return true;
  }
  return false;
}

// ---- 旧版 parity: onNotify ----
// evCursor 只能单调递增: 乱序完成的 catchup 不得让游标回退 (§B.1.4)
function advanceEvCursor(c: number) {
  // 单调保护: 乱序完成的 catchup 不得让游标回退 (§B.1.4)
  if (c > KANBAN_STATE.evCursor) {
    console.log("[B8-REG] advanceEvCursor(" + KANBAN_STATE.evCursor + " -> " + c + ")");
    KANBAN_STATE.evCursor = c;
    return true;
  }
  return false;
}

async function onNotify(msg: Record<string, unknown>) {
  if (msg.type === "profiles_changed") {
    await fetchBoard();
    return;
  }
  if (msg.type === "source_error") {
    KANBAN_STATE.mode = RECONNECTING;
    notify();
    return;
  }
  if (msg.type === "resync") {
    try {
      const ed = await fetchEventsCatchup(KANBAN_STATE.evCursor);
      if (ed.events.length) {
        advanceEvCursor(ed.cursor);
        prependActivities(ed.events);
      }
    } catch (_) { /* silent */ }
    await fetchBoard();
    return;
  }
  try {
    const ed = await fetchEventsCatchup(KANBAN_STATE.evCursor);
    if (ed.events.length) {
      advanceEvCursor(ed.cursor);
      prependActivities(ed.events);
    }
  } catch (_) { /* silent */ }
  await fetchBoard();
  KANBAN_STATE.mode = LIVE;
  notify();
}

// ---- 旧版 parity: startSSE ----
function startSSE() {
  if (esSingleton && (esSingleton.readyState === EventSource.OPEN || esSingleton.readyState === EventSource.CONNECTING)) {
    return;
  }
  try {
    const es = new EventSource("/api/v1/stream");
    esSingleton = es;
    esReady = false;

    es.onopen = async () => {
      esReady = true;
      try {
        const ed = await fetchEventsCatchup(KANBAN_STATE.evCursor);
        if (ed.events.length) {
          advanceEvCursor(ed.cursor);
          prependActivities(ed.events);
        }
      } catch (_) { /* silent */ }
      await fetchBoard();
      KANBAN_STATE.mode = LIVE;
      notify();
    };

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "hello") {
          const wc = msg.cursor || 0;
          if (wc > KANBAN_STATE.evCursor) {
            fetchEventsCatchup(KANBAN_STATE.evCursor).then((ed) => {
              if (ed.events.length) {
                advanceEvCursor(ed.cursor);
                prependActivities(ed.events);
              }
            }).catch(() => {});
          }
          return;
        }
        onNotify(msg);
      } catch (_) { /* silent */ }
    };

    es.onerror = () => {
      es.close();
      esSingleton = null;
      esReady = false;
      KANBAN_STATE.mode = RECONNECTING;
      notify();
      setTimeout(() => startSSE(), 3000);
      startPolling();
    };
  } catch (_) {
    startPolling();
  }
}

// ---- 旧版 parity: startPolling (10s, skip when SSE healthy, visibility-gated) ----
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!visibility) return;
    if (esSingleton && esReady && esSingleton.readyState === EventSource.OPEN) return;
    const ok = await fetchBoard();
    if (ok) {
      KANBAN_STATE.mode = esReady ? LIVE : POLLING;
      notify();
    }
  }, 10000);
  KANBAN_STATE.mode = esReady ? KANBAN_STATE.mode : POLLING;
  notify();
}

// ---- visibility change ----
function onVisibility() {
  visibility = !document.hidden;
  if (visibility && !esSingleton && KANBAN_STATE.mode !== OFFLINE) {
    fetchBoard().then((ok) => {
      if (ok) {
        KANBAN_STATE.mode = POLLING;
        notify();
      }
    });
  }
}

// ---- 启动（首次调用 start） ----
let started = false;
function ensureStarted(onRefresh: () => void) {
  if (started) return;
  started = true;
  onBoardRefresh = onRefresh;

  KANBAN_STATE.mode = RECONNECTING;
  notify();

  Promise.all([
    fetchJSON<{ tasks?: unknown[]; events_cursor?: number; fetched_at?: number }>("/api/v1/board"),
    fetchJSON<{ events?: RawEvent[] }>("/api/v1/events?after=0&order=desc"),
  ]).then(([boardRes, evRes]) => {
    let okB = false;
    if (boardRes.json && boardRes.json.ok) {
      const d = boardRes.json.data!;
      KANBAN_STATE.cursor = d.events_cursor || 0;
      KANBAN_STATE.lastOk = d.fetched_at || Math.floor(Date.now() / 1000);
      okB = true;
    }
    if (evRes.json && evRes.json.ok && evRes.json.data?.events) {
      const evs = evRes.json.data.events.slice().sort((a: RawEvent, b: RawEvent) => (b.id ?? 0) - (a.id ?? 0));
      ACT_EVENTS = evs.map(rawToEvent);
      advanceEvCursor(evs.length ? (evs[0].id ?? 0) : 0);
      notify();
    }
    if (okB) {
      if (onBoardRefresh) onBoardRefresh();
      KANBAN_STATE.mode = LIVE;
      notify();
      startSSE();
    } else {
      KANBAN_STATE.mode = OFFLINE;
      notify();
      const retryTimer = setInterval(async () => {
        const ok = await fetchBoard();
        if (ok) {
          clearInterval(retryTimer);
          KANBAN_STATE.mode = POLLING;
          notify();
          startSSE();
        }
      }, 10000);
    }
  }).catch(() => {
    KANBAN_STATE.mode = OFFLINE;
    notify();
  });
}

// ---- React hooks ----

export function useLiveFeed(onRefresh: () => void) {
  const [lastSnap, setLastSnap] = useState<Date | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // 首次 mount 启动单例
  useEffect(() => {
    if (!started) {
      ensureStarted(() => onRefreshRef.current());
    } else if (!onBoardRefresh) {
      onBoardRefresh = () => onRefreshRef.current();
    }
    setLastSnap(new Date());
  }, []);

  // 保持 onBoardRefresh 始终指向最新版本
  useEffect(() => {
    const wrapped = () => {
      setLastSnap(new Date());
      onRefreshRef.current();
    };
    onBoardRefresh = wrapped;
    return () => {
      if (onBoardRefresh === wrapped) onBoardRefresh = null;
    };
  }, []);

  // visibility
  useEffect(() => {
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return { liveState: KANBAN_STATE.mode as LiveState, lastSnap };
}

export function useLiveEvents(): EventMessage[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---- 外部辅助 ----
export function getLiveState() { return KANBAN_STATE.mode as LiveState; }
export function getEvCursor() { return KANBAN_STATE.evCursor; }
export function getActEvents() { return ACT_EVENTS.slice(); }

export type { EventMessage };