// Prism Card — 玻璃卡片容器
// 指针柔光由全局 controller (lib/pointerLight.ts) 统一驱动: 宿主标注 data-pointer-light,
// controller 写入 --mx/--my, 光斑层见 index.css 的 [data-pointer-light]::after.
// 本地不再各自 onMouseMove(单一输入源, 避免每卡循环监听).
import { type CSSProperties, type ReactNode, type MouseEvent } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
  role?: string;
  ariaLabel?: string;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export function PrismCard({ children, className = "", style, onClick, role, ariaLabel, tabIndex, onKeyDown }: Props) {
  return (
    <div
      className={`prism-card ${className}`}
      style={style}
      data-pointer-light="glass"
      onClick={onClick}
      role={role}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

// color-mix 生成带透明度值: 颜色可能是 CSS 变量字符串(var(--xxx)), 不能拼 hex alpha 后缀,
// 统一走 color-mix(in srgb, <color> pct, transparent)(UI Quality Gate / 对照 Pill alpha 约定).
function colorMix(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

export function Capsule({ label, color, children, title, className }: { label?: string; color?: string; children?: ReactNode; title?: string; className?: string }) {
  return (
    <span className={`pill ${className || ""}`} title={title} style={color ? { color, borderColor: colorMix(color, 27) } : undefined}>
      {color && <span className="dot" style={{ background: color }} />}
      {/* 文本包在 pill-text 容器: 长动态值经 flex 收缩 + ellipsis 截断, 不撑破胶囊边界 (UI Quality Gate) */}
      <span className="pill-text">{label ?? children}</span>
    </span>
  );
}
