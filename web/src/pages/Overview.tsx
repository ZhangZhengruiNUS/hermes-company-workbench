// 总览 v2 — Executive Strip + Live Mission Surface + Mission Cards + Control Stack + 数据流 timeline
// §2.1: 完成=只done, 归档单列; §2.2: 子源失败如实标注; §2.3: fmtTs 工作台时区
import { motion } from "motion/react";
import { useState } from "react";
import { PrismCard, Capsule } from "../components/PrismCard";
import { EmptyState } from "../components/glass";
import { statusMeta, ALL_STATUSES, type BoardData, type Task } from "../lib/api";
import { currentProgress, currentWork, statusCounts, attentionItems, projStats, fmtTs } from "../lib/board";
import { AlertTriangle, Zap, Radio, CircleDashed, Bot, Hexagon, Waves } from "lucide-react";

// color-mix 生成带透明度值: 颜色可能是 CSS 变量(var(--xxx)), 不能拼 hex alpha 后缀(UI Quality Gate)。
function colorMix(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

const EVENT_KIND: Record<string, string> = {
  created: "创建", started: "开始", completed: "完成", archived: "归档",
  blocked: "阻塞", comment: "备注", status: "状态变更", error: "异常",
};

interface Props {
  data: BoardData;
  error: string | null;
  sourcesFailed?: Partial<Record<"automations" | "profiles" | "events", boolean>>;
  onOpenTask: (id: string) => void;
  onGotoProjectTasks: (projectId: string) => void;
}

/* ---------- Executive Strip: §2.1 完成不含归档 ---------- */
function ExecutiveStrip({ counts, workN, projN }: { counts: Record<string, number>; workN: number; projN: number }) {
  // §2.1: 完成仅 status==="done", 不得计入 archived
  const doneN = counts.done || 0;
  const cells = [
    { label: "当前工作", value: workN, color: "var(--accent-blue)" },
    { label: "进行中", value: counts.running || 0, color: "var(--accent-blue)" },
    { label: "阻塞", value: counts.blocked || 0, color: counts.blocked ? "var(--status-red)" : "var(--text-3)" },
    { label: "完成", value: doneN, color: "var(--status-green)" },
    { label: "项目", value: projN, color: "var(--accent-violet)" },
  ];
  // 响应式分隔: 桌面 lg 单行 5 格仅竖分隔(第 2 格起 border-l, 同原 divide-x);
  // 移动 base 双列 + 第 5 格跨行 → 竖分隔在每行第 2 列格子(1,3), 横分隔在 1-2 行格子(0,1,2,3)底边。
  // 保持既有玻璃拟态分隔线(var(--border-soft), 1px), 不引入新视觉元素。
  const cellBorders = [
    "border-b lg:border-b-0",               // 0 col1 r1 (移动底边) / 桌面首格无边框
    "border-l border-b lg:border-b-0",      // 1 col2 r1
    "border-b lg:border-b-0 lg:border-l",   // 2 col1 r2 (移动无左边框) / 桌面第3格左边框
    "border-l border-b lg:border-b-0",      // 3 col2 r2
    "lg:border-l",                          // 4 移动跨全行无边框 / 桌面末格左边框
  ];
  return (
    <div className="cmd-glass rounded-[var(--radius-lg)] relative overflow-hidden" data-exec-strip data-pointer-light="glass">
      {/* hero 背景微光晕 */}
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 40% 90% at 15% 0%, rgba(110,168,255,0.14), transparent 60%), radial-gradient(ellipse 35% 80% at 85% 100%, rgba(148,124,255,0.12), transparent 60%)",
      }} />
      <div className="relative grid grid-cols-2 lg:grid-cols-5">
        {cells.map((c, i) => (
          <div
            key={c.label}
            data-exec-cell
            data-index={i}
            data-label={c.label}
            className={`${cellBorders[i]}${i === 4 ? " col-span-2 lg:col-span-1" : ""} px-6 py-5 transition-colors duration-200 hover:bg-[rgba(110,168,255,0.06)]`}
            style={{ borderColor: "var(--border-soft)" }}
          >
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color, boxShadow: `0 0 8px ${colorMix(c.color, 53)}` }} />
              <span className="text-[11.5px] tracking-wide" style={{ color: "var(--text-3)" }}>{c.label}</span>
            </div>
            <div className="relative">
              <div aria-hidden className="absolute inset-0 pointer-events-none" style={{
                background: `radial-gradient(closest-side, ${colorMix(c.color, 12)}, transparent)`,
              }} />
              <div
                className="relative text-[34px] font-semibold leading-tight tabular-nums mt-0.5"
                style={{ color: c.color, textShadow: `0 0 28px ${colorMix(c.color, 40)}, 0 0 60px ${colorMix(c.color, 20)}` }}
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
      {progress.length === 0 ? (
        <div className="quiet-surface">
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-1.5">
              <CircleDashed size={13} style={{ color: "var(--text-3)" }} aria-hidden />
              <span className="text-[11px] font-mono tracking-widest" style={{ color: "var(--text-3)" }}>SYSTEM IDLE</span>
            </div>
            <div className="text-[13px]" style={{ color: "var(--text-2)" }}>当前没有正在推进的 Kanban 任务</div>
            <div className="idle-wave mt-3 rounded-full" aria-hidden />
          </div>
        </div>
      ) : (
        <PrismCard>
          {progress.map((t) => {
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
          })}
        </PrismCard>
      )}
    </div>
  );
}

/* ---------- Member Avatar: 生产资产 img + 中文首字 fallback ---------- */
function MemberAvatar({ name, fallback }: { name: string; fallback: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
        style={{ background: "linear-gradient(135deg, var(--accent-blue), var(--accent-violet))", color: "#fff" }}
      >
        {fallback}
      </div>
    );
  }
  return (
    <img
      src={`/avatars/${name}.png`}
      alt={fallback}
      loading="lazy"
      onError={() => setErr(true)}
      className="w-7 h-7 rounded-full object-cover shrink-0"
    />
  );
}

/* ---------- Mission Cards: §2.1 使用统一 projStats ---------- */
function MissionCards({ projects, tasks, onGoto }: { projects: BoardData["projects"]; tasks: Task[]; onGoto: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {projects.slice(0, 4).map((p, i) => {
        const s = projStats(tasks, p.id);
        const pct = s.rate ?? 0;
        const accent = i % 2 === 0 ? "rgba(110,168,255,0.06)" : "rgba(148,124,255,0.06)";
        // §2.1: none 显示"暂无任务"; 仅有归档时显示"当前无未归档任务 · 历史归档 N 项"
        const progressLabel = s.total === 0
          ? "暂无任务"
          : s.activeTasks.length === 0 && s.rate === null
            ? `当前无未归档任务 · 历史归档 ${s.archived} 项`
            : `${s.done}/${s.total - s.archived} 已完成${s.archived ? ` · 归档 ${s.archived}` : ""}`;
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
              <Capsule color={pct === 100 ? "var(--status-green)" : "var(--accent-blue)"} title={progressLabel}>{s.done}/{s.total - s.archived}</Capsule>
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

/* ---------- Recent Activity: 数据流 timeline, §2.3 使用 fmtTs ---------- */
function DataStream({ events }: { events: BoardData["events"] }) {
  // backend returns ascending (oldest first); reverse so head=newest, fresh ring hits latest
  const list = (events || []).slice(-8).reverse();
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
                {/* §2.3: 原始时间 tooltip */}
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
      )}
    </div>
  );
}

/* ---------- Control Stack 右栏 ---------- */
function ControlStack({ attention, automations, profiles, tasks, sourcesFailed }: {
  attention: ReturnType<typeof attentionItems>;
  automations: BoardData["automations"];
  profiles: BoardData["profiles"];
  tasks: Task[];
  sourcesFailed?: Partial<Record<"automations" | "profiles" | "events", boolean>>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Attention */}
      <section>
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <AlertTriangle size={13} style={{ color: attention.length ? "var(--status-orange)" : "var(--text-3)" }} aria-hidden />
          <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>需要关注</h2>
        </div>
        {attention.length === 0 ? (
          <div className="quiet-surface"><EmptyState>当前没有需要你处理的事项</EmptyState></div>
        ) : (
          <PrismCard>
            {attention.slice(0, 6).map((a, i) => (
              <div key={i} className="flex items-start gap-2.5 px-4 py-2.5" style={{ borderBottom: i < Math.min(attention.length, 6) - 1 ? "1px solid var(--border-soft)" : undefined }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: "var(--status-orange)" }} />
                <div className="min-w-0">
                  <div className="text-[12.5px] truncate" style={{ color: "var(--text-1)" }}>{a.title}</div>
                  <div className="text-[11px]" style={{ color: "var(--text-3)" }}>{a.detail}</div>
                </div>
              </div>
            ))}
          </PrismCard>
        )}
      </section>

      {/* Automation — §2.2: 子源失败如实显示; 有 LKG 缓存时标注 stale, 无历史才显「暂不可用」 */}
      <section>
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <Zap size={13} style={{ color: "var(--accent-cyan)" }} aria-hidden />
          <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>自动化</h2>
          {sourcesFailed?.automations && automations.length > 0 && (
            <span className="pill ml-auto" title="子数据源刷新失败，展示上次成功缓存">
              <span className="dot" style={{ background: "var(--status-orange)" }} />
              缓存 · 刷新失败
            </span>
          )}
        </div>
        {sourcesFailed?.automations && automations.length === 0 ? (
          <div className="quiet-surface"><EmptyState>⚠ 自动化数据暂不可用</EmptyState></div>
        ) : automations.length === 0 ? (
          <div className="quiet-surface"><EmptyState>暂无自动化任务</EmptyState></div>
        ) : (
          <PrismCard>
            {automations.slice(0, 6).map((a, i) => {
              // §2.2: 只认 has_issue, 不再用 last_delivery_error 判异常
              const bad = a.has_issue || (a.last_error != null);
              const tooltip = [
                a.schedule || "",
                a.next_run ? `下次 ${a.next_run.slice(0, 16).replace("T", " ")}` : "",
                a.last_status == null ? "未运行过" : a.last_status,
                a.issue_summary || "",
                sourcesFailed?.automations ? "缓存数据 · 刷新失败" : "",
              ].filter(Boolean).join(" · ");
              return (
                <div key={a.name} className="flex items-center gap-2.5 px-4 py-2.5" title={tooltip} style={{ borderBottom: i < Math.min(automations.length, 6) - 1 ? "1px solid var(--border-soft)" : undefined }}>
                  <Zap size={13} className="shrink-0" style={{ color: bad ? "var(--status-orange)" : "var(--accent-cyan)" }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] truncate" style={{ color: "var(--text-1)" }}>{a.name}</div>
                    <div className="text-[10.5px] truncate font-mono" style={{ color: "var(--text-3)" }}>
                      {a.schedule || ""}{a.next_run ? ` · 下次 ${a.next_run.slice(0, 16).replace("T", " ")}` : ""}
                    </div>
                  </div>
                  {/* §B.1.1: LKG 缓存期间不得把缓存状态宣传成当前「正常」 */}
                  <Capsule color={bad ? "var(--status-orange)" : a.state === "paused" ? "var(--text-3)" : a.last_status == null ? "var(--text-3)" : sourcesFailed?.automations ? "var(--text-3)" : "var(--status-green)"}>
                    {bad ? "异常" : a.state === "paused" ? "已暂停" : a.last_status == null ? "未运行过" : sourcesFailed?.automations ? "正常 · 缓存" : "正常"}
                  </Capsule>
                </div>
              );
            })}
          </PrismCard>
        )}
      </section>

      {/* Team Pulse — compact personnel rail */}
      <section>
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <Bot size={13} style={{ color: "var(--text-3)" }} aria-hidden />
          <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>团队任务概览</h2>
          {sourcesFailed?.profiles && profiles.length > 0 && (
            <span className="pill ml-auto" title="子数据源刷新失败，展示上次成功缓存">
              <span className="dot" style={{ background: "var(--status-orange)" }} />
              缓存 · 刷新失败
            </span>
          )}
        </div>
        {sourcesFailed?.profiles && profiles.length === 0 ? (
          <div className="quiet-surface"><EmptyState>⚠ 成员数据暂不可用</EmptyState></div>
        ) : profiles.length === 0 ? (
          <div className="quiet-surface"><EmptyState>暂无成员数据</EmptyState></div>
        ) : (
          <PrismCard>
            {profiles.slice(0, 9).map((p, i) => {
              const mine = tasks.filter((t) => t.assignee === p.name);
              const running = mine.filter((t) => t.status === "running").length;
              const done = mine.filter((t) => t.status === "done").length;
              return (
                <div
                  key={p.name}
                  className="flex items-center gap-2.5 px-4 py-2 transition-colors"
                  style={{
                    borderBottom: i < Math.min(profiles.length, 9) - 1 ? "1px solid var(--border-soft)" : undefined,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(110,168,255,0.05)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <MemberAvatar name={p.name} fallback={(p.display_name || p.name).slice(0, 1)} />
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
            })}
          </PrismCard>
        )}
      </section>
    </div>
  );
}

/* ---------- Page ---------- */
export function Overview({ data, sourcesFailed, onOpenTask, onGotoProjectTasks }: Props) {
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
      {/* Executive Strip — 一块基座, §2.1 完成不含归档 */}
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
              <Hexagon size={13} style={{ color: "var(--text-3)" }} aria-hidden />
              <h2 className="text-[13px] font-semibold tracking-wide m-0" style={{ color: "var(--text-2)" }}>重点项目</h2>
            </div>
            {projects.length === 0
              ? <PrismCard className="p-2"><EmptyState>暂无项目</EmptyState></PrismCard>
              : <MissionCards projects={projects} tasks={tasks} onGoto={onGotoProjectTasks} />}
          </section>

          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <Waves size={13} style={{ color: "var(--text-3)" }} aria-hidden />
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
          sourcesFailed={sourcesFailed}
        />
      </div>
    </div>
  );
}