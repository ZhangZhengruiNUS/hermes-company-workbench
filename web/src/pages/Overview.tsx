// 总览 v2 — Executive Strip + Live Mission Surface + Mission Cards + Control Stack + 数据流 timeline
import { motion } from "motion/react";
import { PrismCard, Capsule } from "../components/PrismCard";
import { EmptyState } from "../components/glass";
import { statusMeta, ALL_STATUSES, type BoardData, type Task } from "../lib/api";
import { currentProgress, currentWork, statusCounts, attentionItems } from "../lib/board";
import { AlertTriangle, Zap, Radio, CircleDashed } from "lucide-react";

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

/* ---------- Executive Strip: 一块大玻璃基座, 5 指标 + vertical divider ---------- */
function ExecutiveStrip({ counts, workN, projN }: { counts: Record<string, number>; workN: number; projN: number }) {
  const doneN = (counts.done || 0) + (counts.archived || 0);
  const cells = [
    { label: "当前工作", value: workN, color: "var(--accent-blue)" },
    { label: "进行中", value: counts.running || 0, color: "var(--accent-blue)" },
    { label: "阻塞", value: counts.blocked || 0, color: counts.blocked ? "var(--status-red)" : "var(--text-3)" },
    { label: "完成", value: doneN, color: "var(--status-green)" },
    { label: "项目", value: projN, color: "var(--accent-violet)" },
  ];
  return (
    <div className="cmd-glass rounded-[var(--radius-lg)] relative overflow-hidden">
      {/* hero 背景微光晕 */}
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 40% 90% at 15% 0%, rgba(110,168,255,0.14), transparent 60%), radial-gradient(ellipse 35% 80% at 85% 100%, rgba(148,124,255,0.12), transparent 60%)",
      }} />
      <div className="relative flex divide-x">
        {cells.map((c) => (
          <div
            key={c.label}
            className="flex-1 px-6 py-5 transition-colors duration-200 hover:bg-[rgba(110,168,255,0.06)]"
            style={{ borderColor: "var(--border-soft)" }}
          >
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}88` }} />
              <span className="text-[11.5px] tracking-wide" style={{ color: "var(--text-3)" }}>{c.label}</span>
            </div>
            <div className="relative">
              <div aria-hidden className="absolute inset-0 pointer-events-none" style={{
                background: `radial-gradient(closest-side, ${c.color}1f, transparent)`,
              }} />
              <div
                className="relative text-[34px] font-semibold leading-tight tabular-nums mt-0.5"
                style={{ color: c.color, textShadow: `0 0 28px ${c.color}66, 0 0 60px ${c.color}33` }}
              >
                {c.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Live Mission Surface: 当前推进 ---------- */
function LiveMission({ progress, onOpen }: { progress: Task[]; onOpen: (id: string) => void }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5 px-1">
        <Radio size={13} style={{ color: progress.length ? "var(--status-green)" : "var(--text-3)" }} aria-hidden />
        <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>当前推进</h2>
      </div>
      <PrismCard>
        {progress.length === 0 ? (
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-1.5">
              <CircleDashed size={13} style={{ color: "var(--text-3)" }} aria-hidden />
              <span className="text-[11px] font-mono tracking-widest" style={{ color: "var(--text-3)" }}>SYSTEM IDLE</span>
            </div>
            <div className="text-[13px]" style={{ color: "var(--text-2)" }}>当前没有正在推进的 Kanban 任务</div>
            <div className="idle-wave mt-3 rounded-full" aria-hidden />
          </div>
        ) : (
          progress.map((t) => {
            const m = statusMeta(t.status);
            return (
              <motion.button
                key={t.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => onOpen(t.id)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 min-h-[48px] border-0"
                style={{ background: "transparent", cursor: "pointer", borderBottom: "1px solid var(--border-soft)" }}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${t.status === "running" ? "live-dot" : ""}`}
                  style={{ background: m.color }}
                />
                <span className="text-[10px] font-mono tracking-widest shrink-0" style={{ color: m.color }}>
                  {m.label.toUpperCase()}
                </span>
                <span className="text-[13.5px] flex-1 truncate" style={{ color: "var(--text-1)" }}>{t.title}</span>
                {t.assignee && <span className="text-[11px] shrink-0" style={{ color: "var(--text-3)" }}>{t.assignee}</span>}
              </motion.button>
            );
          })
        )}
      </PrismCard>
    </div>
  );
}

/* ---------- Mission Cards: 项目卡 ---------- */
function MissionCards({ projects, tasks, onGoto }: { projects: BoardData["projects"]; tasks: Task[]; onGoto: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {projects.slice(0, 4).map((p, i) => {
        const pt = tasks.filter((t) => t.project_id === p.id);
        const pdone = pt.filter((t) => t.status === "done" || t.status === "archived").length;
        const pct = pt.length ? Math.round((pdone / pt.length) * 100) : 0;
        const accent = i % 2 === 0 ? "rgba(110,168,255,0.06)" : "rgba(148,124,255,0.06)";
        return (
          <PrismCard
            key={p.id}
            className="p-4 cursor-pointer"
            onClick={() => onGoto(p.id)}
            role="button"
            ariaLabel={`查看项目 ${p.name} 的任务`}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") onGoto(p.id); }}
            style={{ background: `linear-gradient(160deg, ${accent}, var(--surface-solid-2) 45%)` }}
          >
            {/* HUD decorative mark — 右上极简 */}
            <div aria-hidden className="absolute top-3 right-4 text-[9px] font-mono tracking-[0.2em] opacity-40" style={{ color: "var(--text-3)" }}>
              {`0${i + 1}`}
            </div>
            <div className="text-[10px] font-mono tracking-[0.18em] mb-1" style={{ color: "var(--text-3)" }}>
              PROJECT {String(i + 1).padStart(2, "0")}
            </div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <b className="text-[14.5px]" style={{ color: "var(--text-1)" }}>{p.name}</b>
              <Capsule color={pct === 100 ? "var(--status-green)" : "var(--accent-blue)"}>{pdone}/{pt.length}</Capsule>
            </div>
            {p.description && (
              <p className="text-[12px] m-0 mb-3 line-clamp-1" style={{ color: "var(--text-3)" }}>{p.description}</p>
            )}
            <div className="h-[3px] rounded-full overflow-hidden" style={{ background: "var(--border-soft)" }}>
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))", boxShadow: "0 0 8px rgba(148,124,255,0.35)" }}
              />
            </div>
          </PrismCard>
        );
      })}
    </div>
  );
}

/* ---------- Recent Activity: 数据流 timeline ---------- */
function DataStream({ events }: { events: BoardData["events"] }) {
  const list = (events || []).slice(0, 8);
  return (
    <div className="px-4 py-3">
      {list.length === 0 ? (
        <EmptyState>暂无动态</EmptyState>
      ) : (
        <div className="relative" style={{ paddingLeft: 18 }}>
          {/* 极细纵向 timeline */}
          <div
            aria-hidden
            className="absolute left-[4px] top-2 bottom-2 w-px"
            style={{ background: "linear-gradient(var(--border-mid), var(--border-soft))" }}
          />
          {list.map((ev, i) => (
            <motion.div
              key={ev.id ?? i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: i === 0 ? 0 : Math.min(i * 0.03, 0.12) }}
              className="relative py-2 flex items-start gap-2.5"
            >
              {/* event node — 最新节点一次 ring */}
              <span
                className={`absolute rounded-full ${i === 0 ? "event-node-fresh" : ""}`}
                style={{
                  left: -18, top: 10, width: 9, height: 9,
                  background: i === 0 ? "var(--accent-cyan)" : "var(--border-mid)",
                  border: "2px solid var(--surface-solid-2)",
                }}
              />
              <span className="text-[10px] tabular-nums shrink-0 mt-0.5 font-mono" style={{ color: "var(--text-3)" }}>
                {(ev.ts || "").slice(5, 16)}
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
      )}
    </div>
  );
}

/* ---------- Control Stack 右栏 ---------- */
function ControlStack({ attention, automations, profiles, tasks }: {
  attention: ReturnType<typeof attentionItems>;
  automations: BoardData["automations"];
  profiles: BoardData["profiles"];
  tasks: Task[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Attention */}
      <section>
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <AlertTriangle size={13} style={{ color: attention.length ? "var(--status-orange)" : "var(--text-3)" }} aria-hidden />
          <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>需要关注</h2>
        </div>
        <PrismCard>
          {attention.length === 0 ? (
            <EmptyState>当前没有需要你处理的事项</EmptyState>
          ) : (
            attention.slice(0, 6).map((a, i) => (
              <div key={i} className="flex items-start gap-2.5 px-4 py-2.5" style={{ borderBottom: i < Math.min(attention.length, 6) - 1 ? "1px solid var(--border-soft)" : undefined }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: "var(--status-orange)" }} />
                <div className="min-w-0">
                  <div className="text-[12.5px] truncate" style={{ color: "var(--text-1)" }}>{a.title}</div>
                  <div className="text-[11px]" style={{ color: "var(--text-3)" }}>{a.detail}</div>
                </div>
              </div>
            ))
          )}
        </PrismCard>
      </section>

      {/* Automation */}
      <section>
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <Zap size={13} style={{ color: "var(--accent-cyan)" }} aria-hidden />
          <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>自动化</h2>
        </div>
        <PrismCard>
          {automations.length === 0 ? (
            <EmptyState>暂无自动化任务</EmptyState>
          ) : (
            automations.slice(0, 6).map((a, i) => {
              const bad = a.state === "error" || a.last_status === "error" || a.last_delivery_error;
              return (
                <div key={a.name} className="flex items-center gap-2.5 px-4 py-2.5" style={{ borderBottom: i < Math.min(automations.length, 6) - 1 ? "1px solid var(--border-soft)" : undefined }}>
                  <Zap size={13} className="shrink-0" style={{ color: bad ? "var(--status-orange)" : "var(--accent-cyan)" }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] truncate" style={{ color: "var(--text-1)" }}>{a.name}</div>
                    <div className="text-[10.5px] truncate font-mono" style={{ color: "var(--text-3)" }}>
                      {a.schedule || ""}{a.next_run ? ` · 下次 ${a.next_run.slice(0, 16).replace("T", " ")}` : ""}
                    </div>
                  </div>
                  <Capsule color={bad ? "var(--status-orange)" : a.state === "paused" ? "var(--text-3)" : "var(--status-green)"}>
                    {bad ? "异常" : a.state === "paused" ? "已暂停" : a.state === "completed" ? "已完成" : "正常"}
                  </Capsule>
                </div>
              );
            })
          )}
        </PrismCard>
      </section>

      {/* Team Pulse — compact personnel rail */}
      <section>
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <span className="text-[13px]" aria-hidden>◍</span>
          <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>团队任务概览</h2>
        </div>
        <PrismCard>
          {profiles.length === 0 ? (
            <EmptyState>暂无成员数据</EmptyState>
          ) : (
            profiles.slice(0, 8).map((p, i) => {
              const mine = tasks.filter((t) => t.assignee === p.name);
              const running = mine.filter((t) => t.status === "running").length;
              const done = mine.filter((t) => t.status === "done").length;
              return (
                <div
                  key={p.name}
                  className="flex items-center gap-2.5 px-4 py-2 transition-colors"
                  style={{
                    borderBottom: i < Math.min(profiles.length, 8) - 1 ? "1px solid var(--border-soft)" : undefined,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(110,168,255,0.05)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{ background: "linear-gradient(135deg, var(--accent-blue), var(--accent-violet))", color: "#fff" }}
                  >
                    {(p.display_name || p.name).slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] truncate" style={{ color: "var(--text-1)" }}>
                      {p.display_name || p.name}
                      {p.role && <span className="ml-1.5 text-[10.5px]" style={{ color: "var(--text-3)" }}>{p.role}</span>}
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
            })
          )}
        </PrismCard>
      </section>
    </div>
  );
}

/* ---------- Page ---------- */
export function Overview({ data, onOpenTask, onGotoProjectTasks }: Props) {
  const tasks = data.tasks || [];
  const projects = data.projects || [];
  const automations = data.automations || [];
  const profiles = data.profiles || [];
  const events = data.events || [];

  const counts = statusCounts(tasks);
  const work = currentWork(tasks);
  const progress = currentProgress(tasks);
  const attention = attentionItems(tasks, automations);

  return (
    <div className="flex flex-col gap-4">
      {/* Executive Strip — 一块基座 */}
      <ExecutiveStrip counts={counts} workN={work.length} projN={projects.length} />

      {/* telemetry strip — 9 状态 */}
      <div className="flex flex-wrap gap-1.5 px-1">
        {ALL_STATUSES.map((s) => {
          const m = statusMeta(s);
          return <Capsule key={s} color={m.color}>{`${m.label} ${counts[s] || 0}`}</Capsule>;
        })}
      </div>

      {/* 玻璃岛双栏 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        <div className="flex flex-col gap-4">
          <LiveMission progress={progress} onOpen={onOpenTask} />

          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <span className="text-[13px]" aria-hidden>◈</span>
              <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>重点项目</h2>
            </div>
            {projects.length === 0
              ? <PrismCard className="p-2"><EmptyState>暂无项目</EmptyState></PrismCard>
              : <MissionCards projects={projects} tasks={tasks} onGoto={onGotoProjectTasks} />}
          </section>

          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <span className="text-[13px]" aria-hidden>≋</span>
              <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>最近动态</h2>
            </div>
            <PrismCard><DataStream events={events} /></PrismCard>
          </section>
        </div>

        <ControlStack
          attention={attention}
          automations={automations}
          profiles={profiles}
          tasks={tasks}
        />
      </div>
    </div>
  );
}
