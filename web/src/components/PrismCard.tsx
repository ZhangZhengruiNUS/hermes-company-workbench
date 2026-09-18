// Prism Card — cursor prism highlight (hover 高光沿鼠标位置轻微移动)
import { useCallback, type CSSProperties, type ReactNode, type MouseEvent } from "react";

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
  const onMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  return (
    <div
      className={`prism-card ${className}`}
      style={style}
      onMouseMove={onMove}
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

export function Capsule({ label, color, children, title }: { label?: string; color?: string; children?: ReactNode; title?: string }) {
  return (
    <span className="pill" title={title} style={color ? { color, borderColor: color + "44" } : undefined}>
      {color && <span className="dot" style={{ background: color }} />}
      {label ?? children}
    </span>
  );
}
