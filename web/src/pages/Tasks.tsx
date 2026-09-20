// Tasks — 任务页 (board/list 双模式 + 组合筛选 + 快速视图 + URL 深链)
// §3 语义: 看板主列不含 archived; "当前工作"=非终态; "近期完成"=done; "归档"=archived
// 模式记忆 localStorage kb-taskmode; 筛选/搜索由 URL query 初始化
import { useEffect, useMemo, useState } from "react";
import { statusMeta, ALL_STATUSES, type BoardData, type Task } from "../lib/api";
import { Capsule } from "../components/PrismCard";
import { EmptyState } from "../components/glass";
import { fmtDay, fmtTs, statusCounts } from "../lib/board";
import { Search, X, LayoutGrid, List, Columns3, CheckCheck, Archive, Layers } from "lucide-react";

export type TaskQuick = "active" | "done" | "archived" | "all";
export type TaskMode = "board" | "list";

interface FilterState {
  q: string;
  assignee: string;
  status: string;
  project: string;       // "" 全部, "__none__" 独立, else 项目id
  quick: TaskQuick;
}

const DONE_VISIBLE = 5;
const LIST_PAGE = 20;

interface Props {
  data: BoardData;
  onOpenTask: (id: string) => void;
  initialProject?: string | null;   // URL #tasks?project=<id>
  initialTask?: string | null;      // URL #tasks?task=<id> (由 App 处理深链)
  initialSearch?: string;
}

// ---- 旧版 parity: 非终态判定 (不写死清单, 未知状态视为当前工作) ----
function isNonTerminal(t: Task) { return t.status !== "done" && t.status !== "archived"; }

function initFilter(initialProject?: string | null, initialSearch?: string): FilterState {
  return {
    q: initialSearch || "",
    assignee: "",
    status: "",
    project: initialProject || "",
    quick: "active",
  };
}

export function Tasks({ data, onOpenTask, initialProject, initialSearch }: Props) {
  const tasks = data.tasks || [];
  const projects = data.projects || [];

  const [f, setF] = useState<FilterState>(() => initFilter(initialProject, initialSearch));
  const [mode, setMode] = useState<TaskMode>(() => {
    try { return localStorage.getItem("kb-taskmode") === "list" ? "list" : "board"; } catch { return "board"; }
  });
  const [listShown, setListShown] = useState(LIST_PAGE);

  // URL 参数变化同步 (点击项目卡跳转 #tasks?project=)
  useEffect(() => {
    setF((prev) => ({ ...prev, project: initialProject || "" }));
  }, [initialProject]);
  useEffect(() => {
    setF((prev) => ({ ...prev, q: initialSearch || "" }));
  }, [initialSearch]);

  // 负责人候选: 由 assignee 分布驱动 (旧版 rebuildAssigneeOptions)
  const assigneeOpts = useMemo(() => {
    const by = new Map<string, number>();
    tasks.forEach((t) => { if (t.assignee) by.set(t.assignee, (by.get(t.assignee) || 0) + 1); });
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tasks]);

  const projName = useMemo(() => {
    const m = new Map<string, string>();
    projects.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [projects]);

  // 状态选项 (旧版 parity: 每状态计数)
  const statusOpts = useMemo(() => {
    const counts = statusCounts(tasks);
    return ALL_STATUSES.map((s) => ({ key: s, count: counts[s] || 0 }));
  }, [tasks]);

  // ---- 组合筛选 (旧版 filtered()) ----
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (f.assignee && t.assignee !== f.assignee) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.project && f.project !== "__none__" && t.project_id !== f.project) return false;
      if (f.project === "__none__" && t.project_id) return false;
      if (f.quick === "active" && !isNonTerminal(t)) return false;
      if (f.quick === "done" && t.status !== "done") return false;
      if (f.quick === "archived" && t.status !== "archived") return false;
      if (f.q) {
        const q = f.q.toLowerCase();
        if (t.title.toLowerCase().indexOf(q) < 0 && t.id.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
  }, [tasks, f]);

  const anyFilter = !!(f.q || f.assignee || f.status || f.project || f.quick !== "all");

  // 快速视图切换 (§3: "近期完成" 与状态筛选不冲突时优先快捷)
  const setQuick = (q: TaskQuick) => {
    setF((prev) => ({ ...prev, quick: q, ...(q === "done" ? { status: "" } : {}) }));
  };

  // board 列: 9 已知状态 + 数据中存在的未知状态(§4.1 未知在看板可见, 不静默消失)
  // 主视图不含 archived; "归档"快捷仅归档列; "全部"含 archived
  const boardCols = useMemo(() => {
    if (f.quick === "archived") return ["archived"];
    const base = f.quick === "all"
      ? ALL_STATUSES.slice()
      : ALL_STATUSES.filter((s) => s !== "archived");
    const present = [...new Set(filtered.map((t) => t.status))];
    const extra = present.filter((s) => !ALL_STATUSES.includes(s));
    return [...base, ...extra];
  }, [f.quick, filtered]);

  // list 排序 (旧版 parity)
  const sorted = useMemo(() => {
    const list = filtered.slice();
    if (f.quick === "active") list.sort((a, b) => (Number(b.created_at || 0)) - (Number(a.created_at || 0)));
    else list.sort((a, b) => (Number(b.completed_at || b.created_at || 0)) - (Number(a.completed_at || a.created_at || 0)));
    return list;
  }, [filtered, f.quick]);

  const toggleMode = (m: TaskMode) => {
    setMode(m);
    setListShown(LIST_PAGE);
    try { localStorage.setItem("kb-taskmode", m); } catch { /* noop */ }
  };

  const clearAll = () => {
    setF((prev) => ({ q: "", assignee: "", status: "", project: "", quick: prev.quick }));
    setListShown(LIST_PAGE);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* toolbar — 快速视图 tabs + 模式切换 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* quick tabs */}
        <div className="flex rounded-[var(--radius-ctl)] overflow-hidden cmd-glass" role="tablist" aria-label="任务视图">
          {([
            { k: "active" as TaskQuick, label: "当前工作", ico: <Layers size={13} /> },
            { k: "done" as TaskQuick, label: "近期完成", ico: <CheckCheck size={13} /> },
            { k: "all" as TaskQuick, label: "全部", ico: <Columns3 size={13} /> },
            { k: "archived" as TaskQuick, label: "归档", ico: <Archive size={13} /> },
          ]).map((q) => (
            <button
              key={q.k}
              role="tab"
              aria-selected={f.quick === q.k}
              onClick={() => setQuick(q.k)}
              className="flex items-center gap-1.5 px-3.5 py-2 text-[12.5px] transition-colors border-0"
              style={{
                background: f.quick === q.k ? "var(--accent-blue)" : "transparent",
                color: f.quick === q.k ? "#fff" : "var(--text-2)",
                cursor: "pointer",
              }}
            >
              {q.ico}{q.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* mode toggle — board/list */}
        <div className="flex rounded-[var(--radius-ctl)] overflow-hidden cmd-glass" role="group" aria-label="视图模式">
          <button
            onClick={() => toggleMode("board")}
            aria-pressed={mode === "board"}
            className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] border-0 transition-colors"
            style={{ background: mode === "board" ? "var(--surface-2)" : "transparent", color: "var(--text-1)", cursor: "pointer" }}
          >
            <LayoutGrid size={13} />看板
          </button>
          <button
            onClick={() => toggleMode("list")}
            aria-pressed={mode === "list"}
            className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] border-0 transition-colors"
            style={{ background: mode === "list" ? "var(--surface-2)" : "transparent", color: "var(--text-1)", cursor: "pointer" }}
          >
            <List size={13} />列表
          </button>
        </div>
      </div>

      {/* filter bar — 组合筛选 */}
      <div className="cmd-glass rounded-[var(--radius-ctl)] px-3 py-2 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
          <input
            value={f.q}
            onChange={(e) => setF((prev) => ({ ...prev, q: e.target.value }))}
            placeholder="搜索标题 / ID"
            aria-label="搜索任务"
            className="rounded-[var(--radius-ctl)] pl-8 pr-7 py-1.5 text-[12.5px] w-[200px] outline-none"
            style={{ background: "rgba(0,0,0,0.18)", border: "1px solid var(--border-soft)", color: "var(--text-1)" }}
          />
          {f.q && (
            <button onClick={() => setF((prev) => ({ ...prev, q: "" }))} className="absolute right-2 top-1/2 -translate-y-1/2 border-0 p-0" aria-label="清除搜索" style={{ background: "none", color: "var(--text-3)", cursor: "pointer" }}>
              <X size={12} />
            </button>
          )}
        </div>

        {/* assignee */}
        <select
          value={f.assignee}
          onChange={(e) => setF((prev) => ({ ...prev, assignee: e.target.value }))}
          aria-label="按负责人筛选"
          className="rounded-[var(--radius-ctl)] px-2.5 py-1.5 text-[12.5px] outline-none"
          style={{ background: "rgba(0,0,0,0.18)", border: "1px solid var(--border-soft)", color: "var(--text-1)" }}
        >
          <option value="">全部负责人</option>
          {assigneeOpts.map(([a, n]) => (
            <option key={a} value={a}>{a} ({n})</option>
          ))}
        </select>

        {/* status */}
        <select
          value={f.status}
          onChange={(e) => setF((prev) => ({ ...prev, status: e.target.value }))}
          aria-label="按状态筛选"
          className="rounded-[var(--radius-ctl)] px-2.5 py-1.5 text-[12.5px] outline-none"
          style={{ background: "rgba(0,0,0,0.18)", border: "1px solid var(--border-soft)", color: "var(--text-1)" }}
        >
          <option value="">全部状态</option>
          {statusOpts.map((s) => (
            <option key={s.key} value={s.key}>{statusMeta(s.key).label} ({s.count})</option>
          ))}
        </select>

        {/* project */}
        <select
          value={f.project}
          onChange={(e) => setF((prev) => ({ ...prev, project: e.target.value }))}
          aria-label="按项目筛选"
          className="rounded-[var(--radius-ctl)] px-2.5 py-1.5 text-[12.5px] outline-none"
          style={{ background: "rgba(0,0,0,0.18)", border: "1px solid var(--border-soft)", color: "var(--text-1)" }}
        >
          <option value="">全部任务</option>
          <option value="__none__">独立任务(无项目)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {anyFilter && (
          <button onClick={clearAll} className="text-[12px] border-0 cursor-pointer transition-colors px-2 py-1.5" style={{ background: "none", color: "var(--accent-blue)" }}>
            ✕ 清除筛选
          </button>
        )}

        {anyFilter && (
          <span className="text-[11px] tabular-nums ml-auto" style={{ color: "var(--text-3)" }}>
            筛选结果 {filtered.length} / {tasks.length}
          </span>
        )}
      </div>

      {/* content */}
      {filtered.length === 0 ? (
        <div className="quiet-surface">
          <EmptyState>
            {f.quick === "active" && tasks.length > 0
              ? "当前工作没有匹配的任务"
              : "没有匹配的任务"}
          </EmptyState>
        </div>
      ) : mode === "board" ? (
        <BoardView cols={boardCols} filtered={filtered} projName={projName} onOpenTask={onOpenTask} onShowList={() => { toggleMode("list"); setF((prev) => ({ ...prev, status: "done" })); }} />
      ) : (
        <ListView sorted={sorted} shown={listShown} projName={projName} onMore={() => setListShown((s) => s + LIST_PAGE)} onOpenTask={onOpenTask} />
      )}
    </div>
  );
}

/* ---------- Board View ---------- */
function BoardView({ cols, filtered, projName, onOpenTask, onShowList }: {
  cols: string[];
  filtered: Task[];
  projName: Map<string, string>;
  onOpenTask: (id: string) => void;
  onShowList: () => void;
}) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(210px, 1fr))`, overflowX: "auto" }}>
      {cols.map((st) => {
        const m = statusMeta(st);
        const items = filtered.filter((t) => t.status === st);
        // done 列按完成时间倒序; 其余保持原序 (board 语义)
        if (st === "done") items.sort((a, b) => (Number(b.completed_at || b.created_at || 0)) - (Number(a.completed_at || a.created_at || 0)));
        return (
          <div key={st} className="min-w-[210px]">
            {/* col header */}
            <div className="flex items-center gap-1.5 px-2 pb-2">
              <span className="w-2 h-2 rounded-full" style={{ background: m.color }} />
              <span className="text-[12px] font-semibold" style={{ color: "var(--text-2)" }}>{m.label}</span>
              <span className="text-[11px] tabular-nums ml-auto" style={{ color: "var(--text-3)" }}>{items.length}</span>
            </div>
            <div className="quiet-surface flex flex-col gap-1.5 p-1.5">
              {items.length === 0 ? (
                <div className="text-center text-[11.5px] py-3" style={{ color: "var(--text-3)" }}>暂无任务</div>
              ) : (
                (() => {
                  const shown = st === "done" ? items.slice(0, DONE_VISIBLE) : items;
                  const extra = items.length - shown.length;
                  return (
                    <>
                      {shown.map((t) => <TaskCard key={t.id} t={t} projName={projName} onOpenTask={onOpenTask} />)}
                      {extra > 0 && (
                        <button onClick={onShowList} className="text-[11px] py-2 border-0 cursor-pointer text-center rounded" style={{ background: "none", color: "var(--accent-blue)" }}>
                          其余 {extra} 条见列表 / 活动视图
                        </button>
                      )}
                    </>
                  );
                })()
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({ t, projName, onOpenTask }: { t: Task; projName: Map<string, string>; onOpenTask: (id: string) => void }) {
  const m = statusMeta(t.status);
  const when = t.completed_at ? fmtTs(t.completed_at) : fmtTs(t.created_at);
  const proj = t.project_id ? projName.get(t.project_id) : null;
  const tag = stageTag(t.title);
  return (
    <button
      onClick={() => onOpenTask(t.id)}
      className="w-full text-left px-2.5 py-2 rounded-[10px] border-0 cursor-pointer transition-colors hover:translate-y-[-1px]"
      style={{ background: "var(--surface-solid)", border: "1px solid var(--border-soft)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" }}
    >
      <div className="text-[12.5px] font-medium leading-snug mb-1.5 line-clamp-2" style={{ color: "var(--text-1)" }}>{t.title}</div>
      <div className="flex items-center gap-1.5 text-[10.5px]">
        {t.assignee && <span className="shrink-0" style={{ color: "var(--text-3)" }}>{t.assignee}</span>}
        {proj && <span className="shrink-0 px-1 py-0.5 rounded" style={{ background: "var(--surface-1)", color: "var(--text-3)" }}>{proj}</span>}
        {tag && <span className="shrink-0 px-1 py-0.5 rounded" style={{ background: "var(--surface-1)", color: "var(--text-3)" }}>{tag}</span>}
        <span className="ml-auto shrink-0 tabular-nums" style={{ color: "var(--text-3)" }}>{when}</span>
      </div>
      <div className="mt-1"><Capsule color={m.color}>{m.label}</Capsule></div>
    </button>
  );
}

function stageTag(title: string): string | null {
  const m = title.match(/^(执行|审查|验收|返工|Bugfix|迭代|调研)[:：]/);
  return m ? m[1] : null;
}

/* ---------- List View ---------- */
function ListView({ sorted, shown, projName, onMore, onOpenTask }: {
  sorted: Task[];
  shown: number;
  projName: Map<string, string>;
  onMore: () => void;
  onOpenTask: (id: string) => void;
}) {
  const page = sorted.slice(0, shown);
  return (
    <div className="quiet-surface overflow-hidden">
      {/* header row */}
      <div className="grid grid-cols-[1fr_90px_110px_110px_90px] gap-2 px-3 py-2 text-[11px] font-semibold" style={{ borderBottom: "1px solid var(--border-soft)", color: "var(--text-3)" }}>
        <span>任务</span>
        <span>状态</span>
        <span>负责人</span>
        <span>项目</span>
        <span className="text-right">更新</span>
      </div>
      {page.map((t) => {
        const p = t.project_id ? projName.get(t.project_id) : null;
        return (
          <button
            key={t.id}
            onClick={() => onOpenTask(t.id)}
            className="w-full grid grid-cols-[1fr_90px_110px_110px_90px] gap-2 px-3 py-2.5 text-left border-0 cursor-pointer transition-colors"
            style={{ background: "transparent", borderBottom: "1px solid var(--border-soft)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(110,168,255,0.05)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span className="text-[12.5px] truncate" style={{ color: "var(--text-1)" }}>{t.title}</span>
            <span><Capsule color={statusMeta(t.status).color}>{statusMeta(t.status).label}</Capsule></span>
            <span className="text-[12px] truncate" style={{ color: "var(--text-2)" }}>{t.assignee || "—"}</span>
            <span className="text-[12px] truncate" style={{ color: "var(--text-3)" }}>{p || "—"}</span>
            <span className="text-[12px] tabular-nums text-right" style={{ color: "var(--text-3)" }}>{fmtDay(t.completed_at || t.created_at)}</span>
          </button>
        );
      })}
      {shown < sorted.length && (
        <button onClick={onMore} className="w-full py-2.5 text-[12px] border-0 cursor-pointer text-center" style={{ background: "transparent", color: "var(--accent-blue)" }}>
          加载更多({sorted.length - shown} 条)
        </button>
      )}
    </div>
  );
}