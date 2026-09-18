// App shell — 路由(hash) + 数据 + SSE + 主题 + 布局
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AuroraBackground } from "./components/Aurora";
import { Sidebar, type ViewId } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Overview } from "./pages/Overview";
import { useBoard } from "./lib/board";
import { useLiveFeed } from "./lib/live";
import { useTheme } from "./lib/theme";

const VERSION = "__WB_VERSION__";
const V = VERSION.startsWith("__WB") ? "dev" : VERSION;

// hash 路由: #overview / #tasks?task=<id> / #team / #projects / #activity
function parseHash(): { view: ViewId; taskId: string | null } {
  const h = location.hash.replace(/^#/, "");
  const [viewPart, queryPart] = h.split("?");
  const valid: ViewId[] = ["overview", "tasks", "team", "projects", "activity"];
  const view = (valid.includes(viewPart as ViewId) ? viewPart : "overview") as ViewId;
  let taskId: string | null = null;
  if (queryPart) {
    const m = new URLSearchParams(queryPart);
    taskId = m.get("task");
  }
  return { view, taskId };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);
  const view = route.view;
  // taskId 在 Phase B 任务详情 drawer 中使用; Phase A 预览仅路由透传
  void route.taskId;
  const [search, setSearch] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const { data, error, refresh } = useBoard();
  const { liveState, lastSnap } = useLiveFeed(refresh);

  const goto = useCallback((v: ViewId) => {
    location.hash = v;
  }, []);

  const openTask = useCallback((id: string) => {
    location.hash = `tasks?task=${encodeURIComponent(id)}`;
  }, []);

  const gotoProjectTasks = useCallback((projectId: string) => {
    location.hash = `tasks?project=${encodeURIComponent(projectId)}`;
  }, []);

  // 解锁状态: 简单反映 sessionStorage 是否有 token (编辑锁语义)
  const unlocked = useMemo(() => {
    try { return !!sessionStorage.getItem("wb_wtoken"); } catch { return false; }
  }, [data]);

  const content = (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {error && (
          <div className="glass-read rounded-[var(--radius-card)] px-4 py-3 mb-3 text-[13px]" style={{ color: "var(--status-red)" }}>
            数据读取失败: {error}（将随实时连接自动重试）
          </div>
        )}
        {view === "overview" && data && (
          <Overview data={data} error={null} onOpenTask={openTask} onGotoProjectTasks={gotoProjectTasks} />
        )}
        {view !== "overview" && (
          <div className="glass-1 rounded-[var(--radius-card)] p-8 text-center text-[13px]" style={{ color: "var(--text-3)" }}>
            {view === "tasks" && "任务页迁移中 — Phase B 实现 (当前请使用正式入口)"}
            {view === "team" && "团队页迁移中 — Phase C 实现"}
            {view === "projects" && "项目页迁移中 — Phase C 实现"}
            {view === "activity" && "活动页迁移中 — Phase C 实现"}
          </div>
        )}
        {!data && !error && (
          <div className="glass-1 rounded-[var(--radius-card)] p-8 text-center text-[13px]" style={{ color: "var(--text-3)" }}>
            正在加载数据…
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );

  return (
    <div className="min-h-screen">
      <AuroraBackground />
      <div className="flex gap-3 p-3 max-w-[1440px] mx-auto">
        <Sidebar
          view={view}
          onView={goto}
          liveState={liveState}
          lastSnap={lastSnap}
          version={V}
          mobileOpen={mobileNav}
          onCloseMobile={() => setMobileNav(false)}
        />
        <main className="flex-1 min-w-0">
          <Topbar
            view={view}
            liveState={liveState}
            unlocked={unlocked}
            theme={theme}
            onToggleTheme={toggle}
            search={search}
            onSearch={(v) => { setSearch(v); if (v && view !== "tasks") goto("tasks"); }}
            onOpenMobileNav={() => setMobileNav(true)}
          />
          {content}
        </main>
      </div>
    </div>
  );
}
