// Topbar — Floating Command Bar: 8-12px 呼吸空间, command palette 搜索, 圆形玻璃主题按钮
import { Moon, Sun, Search, Lock, LockOpen, Menu } from "lucide-react";
import type { LiveState } from "../lib/live";
import type { ViewId } from "./Sidebar";

const TITLES: Record<ViewId, string> = {
  overview: "总览",
  tasks: "任务",
  team: "团队",
  projects: "项目",
  activity: "活动",
};

const LIVE_TEXT: Record<LiveState, string> = {
  live: "秒级同步",
  polling: "降级轮询",
  reconnecting: "正在重连",
  error: "读取失败",
};

interface Props {
  view: ViewId;
  liveState: LiveState;
  unlocked: boolean;
  theme: string;
  onToggleTheme: () => void;
  search: string;
  onSearch: (v: string) => void;
  onOpenMobileNav: () => void;
}

export function Topbar({ view, liveState, unlocked, theme, onToggleTheme, search, onSearch, onOpenMobileNav }: Props) {
  return (
    <header className="cmd-glass rounded-[var(--radius-lg)] flex items-center gap-3 px-4 py-2.5 mb-5 sticky top-3 z-30">
      {/* 顶部微弱 white highlight */}
      <div
        aria-hidden
        className="absolute top-0 left-[10%] right-[10%] h-px pointer-events-none"
        style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)" }}
      />

      <button
        className="md:hidden text-[20px] leading-none min-w-[44px] min-h-[44px] flex items-center justify-center"
        onClick={onOpenMobileNav}
        aria-label="打开导航菜单"
        style={{ color: "var(--text-2)", background: "transparent", border: "none" }}
      >
        <Menu size={20} />
      </button>

      <h1 className="text-[15px] font-semibold m-0" style={{ color: "var(--text-1)" }}>
        {TITLES[view]}
      </h1>

      {/* Live chip — 精致 capsule */}
      <span
        className="pill"
        style={{
          color: liveState === "live" ? "var(--status-green)" : liveState === "error" ? "var(--status-red)" : "var(--status-orange)",
        }}
        title={`实时连接状态: ${LIVE_TEXT[liveState]}`}
      >
        <span className={liveState === "live" ? "live-dot" : "dot"} style={{ background: "currentColor" }} />
        {LIVE_TEXT[liveState]}
      </span>

      <div className="flex-1" />

      {/* 搜索 — command palette 风格 */}
      <div className="relative hidden sm:block">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜索任务标题 / ID"
          aria-label="搜索任务"
          className="rounded-[var(--radius-ctl)] pl-8 pr-3 py-2 text-[13px] w-[220px] outline-none transition-colors"
          style={{
            background: "rgba(0,0,0,0.18)",
            border: "1px solid var(--border-soft)",
            color: "var(--text-1)",
            boxShadow: "inset 0 1px 3px rgba(0,0,0,0.2)",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--border-focus)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--border-soft)")}
        />
      </div>

      {/* 锁状态独立 capsule */}
      <span
        className="pill"
        style={{ color: unlocked ? "var(--status-green)" : "var(--text-3)" }}
        title={unlocked ? "编辑已解锁 (写权限开启)" : "编辑已锁定 (只读)"}
      >
        {unlocked ? <LockOpen size={12} /> : <Lock size={12} />}
        {unlocked ? "已解锁" : "已锁定"}
      </span>

      {/* 主题切换 — 圆形玻璃控制 */}
      <button
        onClick={onToggleTheme}
        aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
        className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
        style={{
          color: "var(--text-2)",
          background: "var(--surface-1)",
          border: "1px solid var(--border-soft)",
          cursor: "pointer",
          backdropFilter: "blur(8px)",
        }}
      >
        {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </header>
  );
}
