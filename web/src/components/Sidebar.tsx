// Sidebar — 品牌控制条: 正式 Logo + lucide 导航 icon + active 高亮玻璃槽 + realtime monitor
import {
  LayoutDashboard, ListChecks, Users, FolderKanban, Activity,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { LiveState } from "../lib/live";

export type ViewId = "overview" | "tasks" | "team" | "projects" | "activity";

const NAV: { id: ViewId; label: string; Icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "总览", Icon: LayoutDashboard },
  { id: "tasks", label: "任务", Icon: ListChecks },
  { id: "team", label: "团队", Icon: Users },
  { id: "projects", label: "项目", Icon: FolderKanban },
  { id: "activity", label: "活动", Icon: Activity },
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
  const light = document.documentElement.classList.contains("light");
  const [logoOk, setLogoOk] = useState(true);
  const navRef = useRef<HTMLDivElement>(null);
  const [slotTop, setSlotTop] = useState(0);

  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>(`[data-nav="${view}"]`);
    if (el && navRef.current) setSlotTop(el.offsetTop);
  }, [view]);

  return (
    <nav
      aria-label="主导航"
      className={`
        cmd-glass rounded-[var(--radius-xl)] flex flex-col shrink-0
        w-[216px] p-3 sticky top-3 self-start h-[calc(100vh-24px)]
        max-md:fixed max-md:inset-y-2 max-md:left-2 max-md:z-40 max-md:w-[224px]
        ${mobileOpen ? "max-md:flex" : "max-md:hidden"}
      `}
      style={{ overflow: "visible" }}
    >
      {/* 顶部极轻蓝色柔光 */}
      <div
        aria-hidden
        className="absolute top-0 left-[15%] right-[15%] h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(110,168,255,0.4), transparent)" }}
      />

      {/* 品牌区: 正式 Logo 于轻折射底板 */}
      <div className="flex items-center gap-2.5 px-2 py-3 mb-3">
        <div
          className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0 overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(110,168,255,0.10), rgba(148,124,255,0.08))",
            border: "1px solid var(--border-soft)",
            backdropFilter: "blur(6px)",
          }}
        >
          {logoOk ? (
            <img
              src={`/next/brand/${light ? "logo-dark.png" : "logo-light.png"}`}
              alt="Hermes Company Logo"
              className="w-8 h-8 object-contain"
              onError={() => setLogoOk(false)}
            />
          ) : (
            <span className="text-[13px] font-bold" style={{ color: "var(--accent-blue)" }}>HC</span>
          )}
        </div>
        <div className="leading-tight min-w-0">
          <b className="text-[14px] block" style={{ color: "var(--text-1)" }}>Hermes Company</b>
          <small className="text-[11px]" style={{ color: "var(--text-3)" }}>AI 团队工作台</small>
        </div>
      </div>

      {/* 导航 — active 高亮玻璃槽 (layoutId 共享动画) */}
      <div ref={navRef} className="flex flex-col gap-1 flex-1 relative">
        <motion.div
          layoutId="nav-slot"
          className="absolute left-0 right-0 rounded-[var(--radius-ctl)] pointer-events-none"
          style={{
            top: slotTop,
            height: 44,
            background: "linear-gradient(135deg, rgba(110,168,255,0.18), rgba(148,124,255,0.14))",
            border: "1px solid var(--border-focus)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        />
        {NAV.map(({ id, label, Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              data-nav={id}
              onClick={() => { onView(id); onCloseMobile?.(); }}
              aria-current={active ? "page" : undefined}
              className="relative text-left px-3 py-2.5 rounded-[var(--radius-ctl)] text-[13.5px] flex items-center gap-2.5 min-h-[44px] transition-colors duration-150 z-10"
              style={{ border: "1px solid transparent", color: active ? "var(--text-1)" : "var(--text-2)", background: "transparent", cursor: "pointer" }}
            >
              <Icon size={16} style={{ color: active ? "var(--accent-blue)" : "var(--text-3)" }} aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      {/* 底部 realtime monitor */}
      <div className="quiet-surface rounded-[var(--radius-ctl)] px-3 py-2.5 mt-2 text-[11px] leading-relaxed" style={{ color: "var(--text-3)" }}>
        <div className="flex items-center gap-1.5" style={{ color: "var(--text-2)" }}>
          <span
            className={`w-1.5 h-1.5 rounded-full ${liveState === "live" ? "live-dot" : ""}`}
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
