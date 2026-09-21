// DrawerShell — 共享侧滑抽屉外壳 (UI Quality Audit P1)
// 供 TaskDetailDrawer 与 TeamDrawer 共用, 禁止再复制两份外壳.
// 关键点:
//   - React Portal 渲染到 document.body: 避开 Motion/transform/overflow/stacking-context 造成的错位(抽屉跑到底部根因)
//   - geometry: overlay 覆盖全 viewport(fixed inset-0), 抽屉固定右侧(top/right/bottom=0, width=min(480px,100vw)),
//     不落普通 flow; 页面顶部与滚动后打开位置一致
//   - 交互: Esc 关 / 遮罩关 / focus 困在 dialog 内不 Tab 到背景 / 关闭后焦点归还触发元素 / 背景锁滚动 / 开关不横跳
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  label: string; // dialog aria-label
  children: ReactNode;
}

export function DrawerShell({ open, onClose, label, children }: DrawerShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // 焦点管理 + 背景锁滚动(带滚动条补偿, 开关不横跳)
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement;

    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPadRight = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    // 打开聚焦抽屉内首个可聚焦元素(通常是关闭按钮)
    const raf = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])");
      first?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadRight;
      prevFocusRef.current?.focus();
    };
  }, [open]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // focus trap: Tab 循环在 dialog 内, 不逃到背景
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])")
      ).filter((el) => el.offsetParent !== null); // 只困可见元素
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault(); first.focus();
      }
    };
    panel.addEventListener("keydown", handler);
    return () => panel.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      {/* overlay — 覆盖全 viewport */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
        aria-hidden
      />
      {/* drawer panel — 右侧固定, 不落普通 flow */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="cmd-glass absolute top-0 right-0 bottom-0 flex flex-col overflow-hidden"
        style={{
          width: "min(480px, 100vw)",
          borderLeft: "1px solid var(--border-mid)",
          boxShadow: "-12px 0 48px -20px rgba(0,0,0,0.55)",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
