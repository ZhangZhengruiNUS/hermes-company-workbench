// Topbar — 页面标题 / Live chip / 搜索 / 主题切换 / 编辑锁状态
import { Moon, Sun, Search, Lock, LockOpen } from "lucide-react";
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
    <header className="glass-1 rounded-[var(--radius-lg)] flex items-center gap-3 px-4 py-2.5 mb-3 sticky top-3 z-30">
      {/* 手机菜单按钮 */}
      <button
        className="md:hidden text-[20px] leading-none min-w-[44px] min-h-[44px] flex items-center justify-center"
        onClick={onOpenMobileNav}
        aria-label="打开导航菜单"
        style={{ color: "var(--text-2)" }}
      >
        ☰
      </button>

      <h1 className="text-[15px] font-semibold m-0" style={{ color: "var(--text-1)" }}>
        {TITLES[view]}
      </h1>

      {/* Live chip */}
      <span
        className="pill"
        style={{
          color: liveState === "live" ? "var(--status-green)" : liveState === "error" ? "var(--status-red)" : "var(--status-orange)",
          borderColor: "var(--border-soft)",
        }}
        title={`实时连接状态: ${LIVE_TEXT[liveState]}`}
      >
        <span className={liveState === "live" ? "live-dot" : "dot"} style={{ background: "currentColor" }} />
        {LIVE_TEXT[liveState]}
      </span>

      <div className="flex-1" />

      {/* 搜索 */}
      <div className="relative hidden sm:block">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜索任务标题 / ID"
          aria-label="搜索任务"
          className="rounded-[var(--radius-ctl)] pl-8 pr-3 py-2 text-[13px] w-[210px] outline-none transition-colors"
          style={{
            background: "var(--surface-solid-2)",
            border: "1px solid var(--border-soft)",
            color: "var(--text-1)",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--border-focus)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--border-soft)")}
        />
      </div>

      {/* 编辑锁状态 */}
      <span
        className="pill"
        style={{ color: unlocked ? "var(--status-green)" : "var(--text-3)" }}
        title={unlocked ? "编辑已解锁 (写权限开启)" : "编辑已锁定 (只读)"}
      >
        {unlocked ? <LockOpen size={12} /> : <Lock size={12} />}
        {unlocked ? "已解锁" : "已锁定"}
      </span>

      {/* 主题切换 */}
      <button
        onClick={onToggleTheme}
        aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-[var(--radius-ctl)] transition-colors"
        style={{ color: "var(--text-2)", background: "transparent", border: "none", cursor: "pointer" }}
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}
