// 总览页 — Executive Metrics + 双栏 (当前推进/重点项目/最近动态 | 需要关注/自动化/团队概览)
import { motion } from "motion/react";
import { Card, Pill, SectionTitle, EmptyState } from "../components/glass";
import { statusMeta, ALL_STATUSES, type BoardData, type Task } from "../lib/api";
import { currentProgress, currentWork, statusCounts, attentionItems } from "../lib/board";
import { AlertTriangle, Zap } from "lucide-react";

const EVENT_KIND: Record<string, string> = {
  created: "创建", started: "开始", completed: "完成", archived: "归档",
  blocked: "阻塞", comment: "备注", status: "状态变更", error: "异常",
};

interface Props {
  data: BoardData;
  error: string | null;
  onOpenTask: (id: string) => void;
  onGotoProjectTasks: (projectId: string) => void;
}

function TaskRow({ t, onOpen }: { t: Task; onOpen: (id: string) => void }) {
  const m = statusMeta(t.status);
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={() => onOpen(t.id)}
      className="w-full text-left px-3 py-2.5 rounded-[var(--radius-ctl)] flex items-center gap-2.5 min-h-[44px] transition-colors"
      style={{ background: "transparent", border: "1px solid transparent", cursor: "pointer" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-soft)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: m.color }} />
      <span className="text-[13px] flex-1 truncate" style={{ color: "var(--text-1)" }}>{t.title}</span>
      <span className="text-[11px] shrink-0 hidden sm:inline" style={{ color: "var(--text-3)" }}>{m.label}</span>
    </motion.button>
  );
}

export function Overview({ data, error, onOpenTask, onGotoProjectTasks }: Props) {
  const tasks = data.tasks || [];
  const projects = data.projects || [];
  const automations = data.automations || [];
  const profiles = data.profiles || [];
  const events = data.events || [];

  const counts = statusCounts(tasks);
  const work = currentWork(tasks);
  const progress = currentProgress(tasks);
  const attention = attentionItems(tasks, automations);
  const doneCount = (counts.done || 0) + (counts.archived || 0);

  const bigMetrics = [
    { label: "当前工作", value: work.length, color: "var(--accent-blue)" },
    { label: "进行中", value: counts.running || 0, color: "var(--accent-blue)" },
    { label: "阻塞", value: counts.blocked || 0, color: "counts.blocked ? var(--status-red) : var(--text-3)" },
    { label: "完成", value: doneCount, color: "var(--status-green)" },
    { label: "项目", value: projects.length, color: "var(--accent-violet)" },
  ];

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Card variant="read" className="px-4 py-3 text-[13px]" style={{ color: "var(--status-red)" }}>
          数据读取失败: {error} — 将自动重试
        </Card>
      )}

      {/* 大指标行 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {bigMetrics.map((m) => (
          <Card key={m.label} className="px-4 py-3.5">
            <div className="text-[26px] font-semibold leading-none tabular-nums" style={{ color: m.color.startsWith("counts") ? "var(--text-3)" : m.color }}>
              {m.value}
            </div>
            <div className="text-[12px] mt-1.5" style={{ color: "var(--text-3)" }}>{m.label}</div>
          </Card>
        ))}
      </div>

      {/* 紧凑状态 chips (9 状态全可见) */}
      <div className="flex flex-wrap gap-1.5 px-1">
        {ALL_STATUSES.map((s) => {
          const m = statusMeta(s);
          return (
            <span key={s} className="pill" style={{ color: m.color }}>
              <span className="dot" style={{ background: m.color }} />
              {m.label} {counts[s] || 0}
            </span>
          );
        })}
      </div>

      {/* 双栏 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3 items-start">
        {/* 左栏 65% */}
        <div className="flex flex-col gap-3">
          {/* 当前推进 */}
          <section>
            <SectionTitle>当前推进</SectionTitle>
            <Card className="p-2">
              {progress.length === 0
                ? <EmptyState>当前没有正在推进的 Kanban 任务</EmptyState>
                : progress.map((t) => <TaskRow key={t.id} t={t} onOpen={onOpenTask} />)}
            </Card>
          </section>

          {/* 重点项目 */}
          <section>
            <SectionTitle>重点项目</SectionTitle>
            <div className="flex flex-col gap-2.5">
              {projects.length === 0 && (
                <Card className="p-2"><EmptyState>暂无项目</EmptyState></Card>
              )}
              {projects.slice(0, 4).map((p) => {
                const pt = tasks.filter((t) => t.project_id === p.id);
                const pdone = pt.filter((t) => t.status === "done" || t.status === "archived").length;
                const pct = pt.length ? Math.round((pdone / pt.length) * 100) : 0;
                return (
                  <Card key={p.id} hover className="p-4" onClick={() => onGotoProjectTasks(p.id)} role="button" tabIndex={0} ariaLabel={`查看项目 ${p.name} 的任务`}
                    onKeyDown={(e) => { if (e.key === "Enter") onGotoProjectTasks(p.id); }}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <b className="text-[14px]" style={{ color: "var(--text-1)" }}>{p.name}</b>
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-3)" }}>{pdone}/{pt.length}</span>
                    </div>
                    {p.description && (
                      <p className="text-[12px] m-0 mb-2.5 line-clamp-1" style={{ color: "var(--text-3)" }}>{p.description}</p>
                    )}
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--border-soft)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* 最近动态 */}
          <section>
            <SectionTitle>最近动态</SectionTitle>
            <Card className="p-2">
              {events.length === 0
                ? <EmptyState>暂无动态</EmptyState>
                : events.slice(0, 8).map((ev, i) => (
                    <motion.div
                      key={ev.id ?? i}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.1) }}
                      className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]"
                    >
                      <span className="text-[10px] tabular-nums shrink-0" style={{ color: "var(--text-3)" }}>
                        {(ev.time || ev.ts || "").slice(5, 16)}
                      </span>
                      <span className="shrink-0" style={{ color: "var(--accent-cyan)" }}>
                        {EVENT_KIND[ev.kind || ""] || ev.kind || "事件"}
                      </span>
                      <span className="truncate" style={{ color: "var(--text-2)" }}>
                        {ev.task_title || ev.detail || ""}
                      </span>
                    </motion.div>
                  ))}
            </Card>
          </section>
        </div>

        {/* 右栏 35% */}
        <div className="flex flex-col gap-3">
          {/* 需要关注 */}
          <section>
            <SectionTitle>需要关注</SectionTitle>
            <Card className="p-2">
              {attention.length === 0
                ? <EmptyState>当前没有需要你处理的事项</EmptyState>
                : attention.slice(0, 6).map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: "var(--status-orange)" }} />
                      <div className="min-w-0">
                        <div className="text-[12.5px] truncate" style={{ color: "var(--text-1)" }}>{a.title}</div>
                        <div className="text-[11px]" style={{ color: "var(--text-3)" }}>{a.detail}</div>
                      </div>
                    </div>
                  ))}
            </Card>
          </section>

          {/* 自动化 */}
          <section>
            <SectionTitle>自动化</SectionTitle>
            <Card className="p-2">
              {automations.length === 0
                ? <EmptyState>暂无自动化任务</EmptyState>
                : automations.slice(0, 6).map((a) => {
                    const bad = a.state === "error" || a.last_status === "error" || a.last_delivery_error;
                    return (
                      <div key={a.name} className="flex items-center gap-2.5 px-3 py-2">
                        <Zap size={13} className="shrink-0" style={{ color: bad ? "var(--status-orange)" : "var(--accent-cyan)" }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] truncate" style={{ color: "var(--text-1)" }}>{a.name}</div>
                          <div className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>
                            {a.schedule || ""} {a.next_run ? `· 下次 ${a.next_run}` : ""}
                          </div>
                        </div>
                        <Pill color={bad ? "var(--status-orange)" : a.state === "paused" ? "var(--text-3)" : "var(--status-green)"}>
                          {bad ? "异常" : a.state === "paused" ? "已暂停" : a.state === "completed" ? "已完成" : "正常"}
                        </Pill>
                      </div>
                    );
                  })}
            </Card>
          </section>

          {/* 团队任务概览 */}
          <section>
            <SectionTitle>团队任务概览</SectionTitle>
            <Card className="p-2">
              {profiles.length === 0
                ? <EmptyState>暂无成员数据</EmptyState>
                : profiles.slice(0, 8).map((p) => {
                    const mine = tasks.filter((t) => t.assignee === p.name);
                    const running = mine.filter((t) => t.status === "running").length;
                    const done = mine.filter((t) => t.status === "done").length;
                    return (
                      <div key={p.name} className="flex items-center gap-2.5 px-3 py-2">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                          style={{ background: "linear-gradient(135deg, var(--accent-blue), var(--accent-violet))", color: "#fff" }}
                        >
                          {(p.display_name || p.name).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] truncate" style={{ color: "var(--text-1)" }}>
                            {p.display_name || p.name}
                            {p.role && <span className="ml-1.5 text-[11px]" style={{ color: "var(--text-3)" }}>{p.role}</span>}
                          </div>
                        </div>
                        <span className="text-[11px] tabular-nums shrink-0" style={{ color: "var(--text-3)" }}>
                          {running > 0 && <span style={{ color: "var(--accent-blue)" }}>{running} 运行</span>}
                          {running > 0 && done > 0 && " · "}
                          {done > 0 && <span>{done} 完成</span>}
                          {running === 0 && done === 0 && "—"}
                        </span>
                      </div>
                    );
                  })}
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
