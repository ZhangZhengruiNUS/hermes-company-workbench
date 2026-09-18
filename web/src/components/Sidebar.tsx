// Sidebar — 5 导航, 玻璃材质, 底部实时状态小玻璃板 (无 ICP)
import type { LiveState } from "../lib/live";

export type ViewId = "overview" | "tasks" | "team" | "projects" | "activity";

const NAV: { id: ViewId; label: string }[] = [
  { id: "overview", label: "总览" },
  { id: "tasks", label: "任务" },
  { id: "team", label: "团队" },
  { id: "projects", label: "项目" },
  { id: "activity", label: "活动" },
];

const LIVE_TEXT: Record<LiveState, string> = {
  live: "实时数据",
  polling: "降级轮询",
  reconnecting: "正在重连",
  error: "读取失败",
};

interface Props {
  view: ViewId;
  onView: (v: ViewId) => void;
  liveState: LiveState;
  lastSnap: Date | null;
  version: string;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({ view, onView, liveState, lastSnap, version, mobileOpen, onCloseMobile }: Props) {
  return (
    <nav
      aria-label="主导航"
      className={`
        glass-2 rounded-[var(--radius-xl)] flex flex-col shrink-0
        w-[210px] p-3 sticky top-3 self-start h-[calc(100vh-24px)]
        max-md:fixed max-md:inset-y-2 max-md:left-2 max-md:z-40 max-md:w-[220px]
        ${mobileOpen ? "max-md:flex" : "max-md:hidden"}
      `}
    >
      {/* 品牌区 */}
      <div className="flex items-center gap-2.5 px-2 py-3 mb-2">
        <div
          className="w-9 h-9 rounded-[12px] flex items-center justify-center font-bold text-[15px] shrink-0"
          style={{
            background: "linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-violet) 100%)",
            color: "#fff",
          }}
        >
          HC
        </div>
        <div className="leading-tight">
          <b className="text-[14px] block" style={{ color: "var(--text-1)" }}>Hermes Company</b>
          <small className="text-[11px]" style={{ color: "var(--text-3)" }}>AI 团队工作台</small>
        </div>
      </div>

      {/* 导航 */}
      <div className="flex flex-col gap-1 flex-1">
        {NAV.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id}
              onClick={() => { onView(n.id); onCloseMobile?.(); }}
              aria-current={active ? "page" : undefined}
              className={`
                text-left px-3 py-2.5 rounded-[var(--radius-ctl)] text-[13.5px] flex items-center gap-2.5
                transition-colors duration-150 min-h-[44px]
                ${active ? "font-medium" : ""}
              `}
              style={
                active
                  ? {
                      background: "linear-gradient(135deg, rgba(110,168,255,0.18), rgba(148,124,255,0.14))",
                      border: "1px solid var(--border-focus)",
                      color: "var(--text-1)",
                    }
                  : { border: "1px solid transparent", color: "var(--text-2)" }
              }
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: active ? "var(--accent-blue)" : "var(--text-3)", opacity: active ? 1 : 0.4 }}
              />
              {n.label}
            </button>
          );
        })}
      </div>

      {/* 底部实时状态 */}
      <div className="glass-1 rounded-[var(--radius-ctl)] px-3 py-2.5 mt-2 text-[11px] leading-relaxed" style={{ color: "var(--text-3)" }}>
        <div className="flex items-center gap-1.5" style={{ color: "var(--text-2)" }}>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: liveState === "live" ? "var(--status-green)" : liveState === "error" ? "var(--status-red)" : "var(--status-orange)",
            }}
          />
          {LIVE_TEXT[liveState]}
        </div>
        {lastSnap && <div>更新 {lastSnap.toLocaleTimeString("zh-CN", { hour12: false })}</div>}
        <div className="opacity-70">Workbench · {version}</div>
      </div>
    </nav>
  );
}
