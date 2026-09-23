// 项目概览 — Phase C B12: 按项目聚合的 quick-view 过滤卡片
// §2 (v5_template.html L1690-1749 语义):
//   - projects_ok=false → 错误态「项目数据源不可用」, 不得伪装成空/正常
//   - 空项目 → 空态「暂无项目」
//   - 项目无任务 → 「暂无任务」, 不渲染进度条/徽章
//   - done>0 且 done===未归档 && 未归档>0 → 「关联任务已全部完成 · 历史归档 N 项」, 页面不得出现「100%」
//   - mixed → 徽章计数与 mock 一致, 进度公式 title = 完成 N / 未归档 M
//   - blocked>0 → 独立「阻塞 N」徽章; 点「查看本项目任务」→ #tasks?project=<pid> 且任务页过滤生效
//   - 最近活动行: 事件池按 task→project 归属过滤, 无可用事件显示「—」, 不得报错
import { useMemo } from "react";
import { motion } from "motion/react";
import { PrismCard, Capsule } from "../components/PrismCard";
import { EmptyState } from "../components/glass";
import { useLiveEvents } from "../lib/live";
import { projStats, fmtTs, type ProjectStats } from "../lib/board";
import { statusMeta, type BoardData, type Task } from "../lib/api";
import { Boxes, ArrowRight } from "lucide-react";

const EVENT_KIND: Record<string, string> = {
  created: "创建", started: "开始", completed: "完成", archived: "归档",
  blocked: "阻塞", comment: "备注", status: "状态变更", error: "异常",
};

// 徽章顺序与配色 (v5_template L1690-1749): 待办/就绪/进行中/阻塞/完成/归档
const BADGE_ORDER = ["todo", "ready", "running", "blocked", "done", "archived"];
const BADGE_COLOR: Record<string, string> = {
  todo: "var(--text-3)",
  ready: "var(--accent-cyan)",
  running: "var(--accent-blue)",
  blocked: "var(--status-red)",
  done: "var(--status-green)",
  archived: "var(--text-3)",
};

interface Props {
  data: BoardData;
  onGotoProjectTasks: (projectId: string) => void;
}

type LiveEv = {
  id?: number;
  kind?: string;
  task_id?: string;
  task_title?: string;
  ts?: string;
};

function ProjectCard({
  p, tasks, events, onGoto,
}: {
  p: { id: string; name: string; description?: string };
  tasks: Task[];
  events: LiveEv[];
  onGoto: (id: string) => void;
}) {
  const s: ProjectStats = projStats(tasks, p.id);

  // 各状态计数
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    if (t.project_id !== p.id) continue;
    counts[t.status] = (counts[t.status] || 0) + 1;
  }
  const blocked = counts.blocked || 0;
  const activeTotal = s.total - s.archived;
  const pct = s.rate ?? 0;
  const allDone = s.done > 0 && s.done === activeTotal && activeTotal > 0;
  const noTasks = s.total === 0;

  // §2.4 进度文案公式
  let progText: string;
  if (noTasks) progText = "暂无任务";
  else if (allDone) progText = `关联任务已全部完成${s.archived ? ` · 历史归档 ${s.archived} 项` : ""}`;
  else progText = `当前任务: ${s.done}/${activeTotal} 已完成${s.archived ? `\n历史归档: ${s.archived} 项` : ""}`;
  const formulaTitle = `公式: 完成 ${s.done} / 未归档 ${activeTotal}`;

  // §2.6 最近活动: 按 task→project 归属过滤
  const projectEvents = useMemo(() => {
    const pidSet = new Set(tasks.filter((t) => t.project_id === p.id).map((t) => t.id));
    return events
      .filter((e) => e.task_id && pidSet.has(e.task_id))
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  }, [tasks, p.id, events]);
  const latest = projectEvents[0];
  const recent = latest
    ? `${EVENT_KIND[latest.kind || ""] || latest.kind || "事件"} · ${latest.task_title || ""} ${latest.ts ? fmtTs(Math.floor(new Date(latest.ts).getTime() / 1000)) : ""}`
    : "—";

  const currentLine = s.activeTasks[0]
    ? `当前: ${s.activeTasks[0].title}`
    : "无进行中任务";

  return (
    <PrismCard className="p-4 flex flex-col gap-2.5 min-w-0">
      {/* header: 名称 + 共N + 阻塞N */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <b className="text-[14.5px] truncate" style={{ color: "var(--text-1)" }}>{p.name}</b>
        {!noTasks && (
          <span className="flex items-center gap-1.5 shrink-0">
            <Capsule color="var(--text-3)">{`共 ${s.total} 个任务`}</Capsule>
            {blocked > 0 && <Capsule color="var(--status-red)">{`阻塞 ${blocked}`}</Capsule>}
          </span>
        )}
      </div>

      {p.description && (
        <p className="text-[12px] m-0 line-clamp-1" style={{ color: "var(--text-3)" }}>{p.description}</p>
      )}

      {/* 进度行: 无任务项目只显「暂无任务」文本, 不渲染进度条/百分比 */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[11px] whitespace-pre-line min-w-0 truncate"
          style={{ color: "var(--text-3)" }}
        >
          {progText}
        </span>
        {!noTasks && (
          <Capsule
            color={allDone ? "var(--status-green)" : "var(--accent-blue)"}
            title={formulaTitle}
          >
            {activeTotal > 0 ? `${s.done}/${activeTotal}` : "—"}
          </Capsule>
        )}
      </div>
      {!noTasks && (
        <div className="h-[3px] rounded-full overflow-hidden" style={{ background: "var(--border-soft)" }}>
          <motion.div
            className="h-full rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            style={{
              background: allDone
                ? "var(--status-green)"
                : "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))",
              boxShadow: "0 0 8px rgba(148,124,255,0.35)",
            }}
          />
        </div>
      )}

      {/* 状态徽章行 */}
      {!noTasks && (
        <div className="flex flex-wrap items-center gap-1.5">
          {BADGE_ORDER.filter((k) => (counts[k] || 0) > 0).map((k) => (
            <Capsule key={k} color={BADGE_COLOR[k]}>{`${statusMeta(k).label} ${counts[k]}`}</Capsule>
          ))}
        </div>
      )}

      {/* meta: 当前推进 + 最近活动 */}
      <div className="text-[11px] leading-relaxed min-w-0" style={{ color: "var(--text-3)" }}>
        <div className="truncate" title={currentLine}>{currentLine}</div>
        <div className="truncate" title={recent}>最近活动: {recent}</div>
      </div>

      {/* filter 跳转按钮 */}
      <button
        type="button"
        onClick={() => onGoto(p.id)}
        className="mt-auto w-full flex items-center justify-center gap-1.5 min-h-[44px] text-[12.5px] cursor-pointer transition-colors duration-150 hover:opacity-90"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border-soft)",
          color: "var(--text-2)",
          borderRadius: "var(--radius-ctl)",
        }}
      >
        查看本项目任务
        <ArrowRight size={14} aria-hidden />
      </button>
    </PrismCard>
  );
}

export default function Projects({ data, onGotoProjectTasks }: Props) {
  const events = useLiveEvents();
  const projects = data.projects || [];
  const tasks = data.tasks || [];
  const projOk = data.meta?.projects_ok !== false;
  const projErr = data.meta?.projects_error || "";

  const blockedTotal = useMemo(() => {
    let n = 0;
    for (const t of tasks) if (t.project_id && t.status === "blocked") n++;
    return n;
  }, [tasks]);

  // §2 错误态: projects_ok=false → 显式错误, 不得伪装成空/正常
  if (!projOk) {
    return (
      <div className="quiet-surface relative px-4 py-3 text-[13px]" style={{ color: "var(--status-red)" }}>
        ⚠ 项目数据源不可用{projErr ? ` · ${projErr}` : ""}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-3 px-1 relative" data-pointer-light="glass">
        <Boxes size={13} style={{ color: "var(--accent-violet)" }} aria-hidden />
        <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>项目库</h2>
        <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
          {projects.length} 个项目{blockedTotal > 0 ? ` · ${blockedTotal} 个阻塞` : ""}
        </span>
      </div>

      {projects.length === 0 ? (
        <div className="quiet-surface relative">
          <EmptyState>暂无项目</EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} tasks={tasks} events={events} onGoto={onGotoProjectTasks} />
          ))}
        </div>
      )}
    </div>
  );
}
