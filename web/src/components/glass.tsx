// Glass 原语 — 统一材质/圆角/hover
import type { CSSProperties, ReactNode, MouseEvent } from "react";

interface CardProps {
  children: ReactNode;
  variant?: "glass1" | "glass2" | "solid" | "read";
  hover?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
  role?: string;
  ariaLabel?: string;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

const variantClass = {
  glass1: "glass-1",
  glass2: "glass-2",
  solid: "glass-solid",
  read: "glass-read",
};

export function Card({
  children, variant = "glass1", hover = false, className = "",
  style, onClick, role, ariaLabel, tabIndex, onKeyDown,
}: CardProps) {
  return (
    <div
      className={`rounded-[var(--radius-card)] ${variantClass[variant]} ${hover ? "glass-hover cursor-pointer" : ""} ${className}`}
      style={style}
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

export function Pill({ label, color, children }: { label?: string; color?: string; children?: ReactNode }) {
  return (
    <span className="pill" style={color ? { color, borderColor: color + "44" } : undefined}>
      {color && <span className="dot" style={{ background: color }} />}
      {label ?? children}
    </span>
  );
}

export function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5 px-1">
      <h2 className="text-[13px] font-semibold tracking-wide" style={{ color: "var(--text-2)" }}>{children}</h2>
      {extra}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="py-5 text-center text-[13px]" style={{ color: "var(--text-3)" }}>
      {children}
    </div>
  );
}
