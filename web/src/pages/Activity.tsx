// 活动页 — 实时事件流(两段式加载: 池内 15/页 + 历史分页) + SSE 实时新事件置顶 + LKG stale 标注
// 语义基准: v5_template.html L1751-1813 (actEventRow / renderActivity / actMore 两级加载), ACT_PAGE=15
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { PrismCard } from "../components/PrismCard";
import { EmptyState, SectionTitle } from "../components/glass";
import { api, type BoardData } from "../lib/api";
import { fmtTs } from "../lib/board";
import { useLiveEvents, getActEvents, type EventMessage } from "../lib/live";

const ACT_PAGE = 15;

// 页面本地归一化(与 live.ts rawToEvent 同形): 历史分页返回的是 raw 事件, 需映射为 EventMessage
function toEventMessage(r: Record<string, unknown>): EventMessage {
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

// kind 中文映射: 沿用 Overview 的 EVENT_KIND 表, 补齐旧版(ACT_KIND_CN)有的 kind;
// 缺失 kind 显示原始 key, 不丢弃(§3.1)
const EVENT_KIND: Record<string, string> = {
  created: "创建", started: "开始", completed: "完成", archived: "归档",
  blocked: "阻塞", comment: "备注", status: "状态变更", error: "异常",
  claimed: "认领", spawned: "启动执行", promoted: "晋升",
  unblocked: "解除阻塞", crashed: "崩溃", timed_out: "超时",
  gave_up: "放弃", dependency_wait: "等待依赖", commented: "评论", attached: "添加附件",
};

interface Props {
  data: BoardData;
  sourcesFailed?: Partial<Record<"automations" | "profiles" | "events", boolean>>;
}

export function Activity({ data, sourcesFailed }: Props) {
  // 实时事件池(live.ts 顶层 ACT_EVENTS: 启动 catchup 换新引用 / SSE prepend 原地改)
  const pool = useLiveEvents();
  // 渲染列表(倒序): 只增不重排, 新事件插顶部, 已浏览历史条目不跳动(§3.4)
  const [shown, setShown] = useState<EventMessage[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyDone, setHistoryDone] = useState(false);

  // 池变化同步: 首屏取最新一页; SSE 到达时把比当前最新 id 更大的新事件置顶。
  // 依赖 data 与 pool: SSE prepend 为原地修改(ref 不变), 依赖 App 侧 data 变化触发重渲染。
  useEffect(() => {
    const poolNow = getActEvents();
    if (poolNow.length === 0) return;
    setShown((prev) => {
      if (prev.length === 0) return poolNow.slice(0, ACT_PAGE);
      const top = prev[0].id ?? Number.POSITIVE_INFINITY;
      const liveNew = poolNow
        .filter((e) => e.id != null && e.id > top)
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      if (liveNew.length === 0) return prev;
      const seen = new Set(prev.map((e) => e.id));
      const fresh = liveNew.filter((e) => e.id != null && !seen.has(e.id));
      return fresh.length ? [...fresh, ...prev] : prev;
    });
  }, [data, pool]);

  // 级1 本地剩余: 池内尚未显示条数(§3.3)
  const seenIds = new Set(shown.map((e) => e.id));
  const localRemain = pool.filter((e) => e.id != null && !seenIds.has(e.id)).length;

  const loadLocal = useCallback(() => {
    const poolNow = getActEvents();
    const seen = new Set(shown.map((e) => e.id));
    const next = poolNow.filter((e) => e.id != null && !seen.has(e.id)).slice(0, ACT_PAGE);
    if (next.length) setShown((prev) => [...prev, ...next]);
  }, [shown]);

  // 级2 历史: 每次携带当前最旧 id 作为 before(§3.3); 非空 → 只追加 min(新数,15) 条
  const loadHistory = useCallback(async () => {
    if (historyBusy || historyDone) return;
    const oldest = shown.length ? (shown[shown.length - 1].id ?? 0) : 0;
    setHistoryBusy(true);
    try {
      const res = await api.get<{ events?: Array<Record<string, unknown>>; has_more?: boolean }>(
        `/api/v1/events?order=desc&before=${oldest}`
      );
      const evs = (res.events || [])
        .map(toEventMessage)
        .filter((e) => e.id != null)
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      if (evs.length === 0) { setHistoryDone(true); return; }
      setShown((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const fresh = evs.filter((e) => e.id != null && !seen.has(e.id));
        const toAdd = fresh.slice(0, ACT_PAGE);
        return toAdd.length ? [...prev, ...toAdd] : prev;
      });
      if (res.has_more === false) setHistoryDone(true);
    } catch {
      // 历史加载失败: 保留现有列表, 允许重试, 不白屏
    } finally {
      setHistoryBusy(false);
    }
  }, [shown, historyBusy, historyDone]);

  const stale = !!(sourcesFailed?.events && pool.length > 0);
  const empty = pool.length === 0 && shown.length === 0;

  return (
    <div className="max-w-[980px]">
      <PrismCard>
        <div className="px-4 pt-3.5 pb-1">
          <SectionTitle
            extra={stale ? (
              <span className="pill" title="子数据源刷新失败，展示上次成功缓存">缓存 · 刷新失败</span>
            ) : undefined}
          >
            实时动态
          </SectionTitle>
        </div>

        {empty ? (
          <div className="px-4 pb-4"><EmptyState>事件数据不可达(API 离线)</EmptyState></div>
        ) : (
          <div className="px-4 pb-2">
            <div className="relative" style={{ paddingLeft: 18 }}>
              <div
                aria-hidden
                className="absolute left-[4px] top-2 bottom-2 w-px"
                style={{ background: "linear-gradient(var(--border-mid), var(--border-soft))" }}
              />
              {shown.map((ev, i) => (
                <motion.div
                  key={ev.id ?? i}
                  data-eid={ev.id ?? ""}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                  className="relative flex items-center gap-2.5 min-h-[44px] py-2"
                >
                  <span
                    className={`absolute rounded-full ${i === 0 ? "event-node-fresh" : ""}`}
                    style={{
                      left: -18, top: "calc(50% - 4px)", width: 9, height: 9,
                      background: i === 0 ? "var(--accent-cyan)" : "var(--border-mid)",
                      border: "2px solid var(--surface-solid-2)",
                    }}
                  />
                  <span className="text-[10px] tabular-nums shrink-0 font-mono" style={{ color: "var(--text-3)" }}>
                    <span title={ev.ts || ""}>{fmtTs(ev.ts ? Math.floor(new Date(ev.ts).getTime() / 1000) : null)}</span>
                  </span>
                  <span className="shrink-0 text-[11.5px]" style={{ color: "var(--accent-cyan)" }}>
                    {EVENT_KIND[ev.kind || ""] || ev.kind || "事件"}
                  </span>
                  <span className="truncate text-[12.5px]" style={{ color: "var(--text-2)" }}>
                    {ev.task_title || ev.detail || ""}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* 两段式加载: 级1 池内剩余 → 级2 更早历史 */}
        <div className="px-4 pb-4">
          {localRemain > 0 ? (
            <button
              type="button"
              onClick={loadLocal}
              className="w-full min-h-[44px] rounded-[var(--radius-card)] text-[12.5px]"
              style={{ color: "var(--text-2)", border: "1px solid var(--border-soft)" }}
            >
              加载更多({localRemain} 条)
            </button>
          ) : !historyDone ? (
            <button
              type="button"
              onClick={loadHistory}
              disabled={historyBusy}
              className="w-full min-h-[44px] rounded-[var(--radius-card)] text-[12.5px]"
              style={{ color: "var(--text-2)", border: "1px solid var(--border-soft)", opacity: historyBusy ? 0.6 : 1 }}
            >
              {historyBusy ? "加载中…" : "加载更早的历史…"}
            </button>
          ) : null}
        </div>
      </PrismCard>
    </div>
  );
}
