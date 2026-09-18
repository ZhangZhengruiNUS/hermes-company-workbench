// 板数据 hooks — 并行拉取 board + automations + profiles + events, 合并为前端视图模型
import { useCallback, useEffect, useState } from "react";
import { api, type BoardData, type Task, type Profile, type Automation, type EventItem, isCurrentWork, ACTIVE_STATUSES, TERMINAL_STATUSES } from "./api";

const BOARD_PATH = "/api/v1/board";

// 后端各端点原始结构 → 统一视图模型
interface RawBoard {
  tasks: Task[];
  projects?: unknown[];
  projects_ok?: unknown[];
  projects_error?: unknown[];
  counts?: Record<string, number>;
  events_cursor?: number;
  fetched_at?: string;
}
interface RawAutomations { automations?: Record<string, unknown>[]; }
interface RawProfiles { [k: string]: unknown } // 数组或 {name: {...}} 均兼容
interface RawEvents { events?: Record<string, unknown>[]; has_more?: boolean; next_cursor?: number }

function normProjects(raw: RawBoard, d: BoardData): void {
  // projects 是数组; projects_ok 只是 bool 标志, projects_error 是字符串
  const src = Array.isArray(raw.projects) ? raw.projects : Array.isArray(raw.projects_ok) ? raw.projects_ok : [];
  d.projects = (src as Record<string, unknown>[]).map((p) => ({
    id: String(p.id ?? p.project_id ?? ""),
    name: String(p.name ?? p.title ?? p.id ?? ""),
    description: p.description ? String(p.description) : undefined,
    status: p.status ? String(p.status) : undefined,
    created_at: p.created_at ? String(p.created_at) : undefined,
  }));
}

function normAutomations(raw: RawAutomations): Automation[] {
  return (raw.automations || []).map((a) => ({
    name: String(a.name ?? a.id ?? ""),
    schedule: a.schedule_display ? String(a.schedule_display) : a.schedule ? String(a.schedule) : undefined,
    state: a.state ? String(a.state) : undefined,
    last_status: a.last_status != null ? String(a.last_status) : null,
    last_delivery_error: a.last_delivery_error ? String(a.last_delivery_error) : (a.last_error ? String(a.last_error) : null),
    next_run: a.next_run_at ? String(a.next_run_at) : a.next_run ? String(a.next_run) : undefined,
    last_success: a.last_success_at ? String(a.last_success_at) : undefined,
    ticker_heartbeat: a.ticker_heartbeat ? String(a.ticker_heartbeat) : undefined,
    ticker_success: a.ticker_success ? String(a.ticker_success) : undefined,
  }));
}

function normProfiles(raw: unknown): Profile[] {
  let list: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) list = raw as Record<string, unknown>[];
  else if (raw && typeof raw === "object") {
    // {name: {...}} 或 {profiles: [...]}
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.profiles)) list = obj.profiles as Record<string, unknown>[];
    else list = Object.entries(obj).map(([name, v]) => ({ name, ...(typeof v === "object" && v ? v as object : {}) }));
  }
  return list.map((p) => ({
    name: String(p.name ?? ""),
    display_name: p.cn ? String(p.cn) : p.display_name ? String(p.display_name) : undefined,
    role: p.role ? String(p.role) : p.line ? String(p.line) : undefined,
    department: p.department ? String(p.department) : undefined,
    model: p.model ? String(p.model) : undefined,
  })).filter((p) => p.name);
}

function normEvents(raw: RawEvents): EventItem[] {
  return (raw.events || []).map((e) => ({
    id: typeof e.id === "number" ? e.id : undefined,
    ts: e.created_at != null ? new Date(Number(e.created_at) * 1000).toISOString() : e.created_at ? String(e.created_at) : undefined,
    kind: e.kind ? String(e.kind) : undefined,
    task_id: e.task_id ? String(e.task_id) : undefined,
    task_title: e.title ? String(e.title) : undefined,
    actor: e.actor ? String(e.actor) : undefined,
    detail: e.detail ? String(e.detail) : (e.payload ? JSON.stringify(e.payload).slice(0, 80) : undefined),
  }));
}

export function useBoard() {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await api.get<RawBoard>(BOARD_PATH);
      const d: BoardData = { tasks: raw.tasks || [], projects: [], profiles: [], automations: [], events: [] };
      normProjects(raw, d);

      // 并行拉取其余三个端点; 单个失败不阻塞整页 (对应区块显示空态)
      const [autoR, profR, evR] = await Promise.allSettled([
        api.get<RawAutomations | { data: RawAutomations }>("/api/v1/automations"),
        api.get<RawProfiles | { data: RawProfiles }>("/api/v1/profiles"),
        api.get<RawEvents | { data: RawEvents }>("/api/v1/events?limit=20"),
      ]);
      const unwrap = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === "fulfilled" ? r.value : fallback;
      const auto = unwrap(autoR, {}) as RawAutomations | { data?: RawAutomations };
      const prof = unwrap(profR, {}) as RawProfiles | { data?: RawProfiles };
      const ev = unwrap(evR, {}) as RawEvents | { data?: RawEvents };

      d.automations = normAutomations((auto as { data?: RawAutomations }).data ?? (auto as RawAutomations));
      d.profiles = normProfiles((prof as { data?: RawProfiles }).data ?? prof);
      d.events = normEvents((ev as { data?: RawEvents }).data ?? (ev as RawEvents));

      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, error, refresh };
}

// 当前推进: ready/running/blocked/review (语义与旧版一致)
export function currentProgress(tasks: Task[]) {
  return tasks.filter((t) => ACTIVE_STATUSES.includes(t.status));
}

// 当前工作: 非终态
export function currentWork(tasks: Task[]) {
  return tasks.filter(isCurrentWork);
}

export function statusCounts(tasks: Task[]) {
  const m: Record<string, number> = {};
  for (const t of tasks) m[t.status] = (m[t.status] || 0) + 1;
  return m;
}

// 需要关注: blocked / ready无负责人 / automation 异常
export interface Attention {
  kind: "blocked" | "unassigned" | "automation";
  title: string;
  detail: string;
}
export function attentionItems(tasks: Task[], automations: BoardData["automations"]): Attention[] {
  const out: Attention[] = [];
  for (const t of tasks) {
    if (t.status === "blocked") {
      out.push({ kind: "blocked", title: t.title, detail: "任务被阻塞" });
    } else if (t.status === "ready" && !t.assignee) {
      out.push({ kind: "unassigned", title: t.title, detail: "就绪但未指派负责人" });
    }
  }
  for (const a of automations || []) {
    // 未知 last_status 一律中性显示, 不报异常
    if (a.state === "error" || a.last_status === "error" || a.last_delivery_error) {
      out.push({ kind: "automation", title: a.name, detail: a.last_delivery_error || "自动化异常" });
    }
  }
  return out;
}

export { TERMINAL_STATUSES };
export type { Profile };
