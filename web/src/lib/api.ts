// API 客户端 — 复用现有后端契约, 不改语义
// Basic Auth: 同源请求浏览器自动携带 (nginx 层)
// 写 token: X-Workbench-Write-Token 头 (沿用 sessionStorage)

const WRITE_TOKEN_KEY = "wb_wtoken";

export function getWriteToken(): string {
  try {
    return sessionStorage.getItem(WRITE_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setWriteToken(t: string) {
  try {
    if (t) sessionStorage.setItem(WRITE_TOKEN_KEY, t);
    else sessionStorage.removeItem(WRITE_TOKEN_KEY);
  } catch { /* noop */ }
}

function authHeaders(): Record<string, string> {
  const t = getWriteToken();
  return t ? { "X-Workbench-Write-Token": t } : {};
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function handle(resp: Response) {
  let body: { ok?: boolean; data?: unknown; error?: string } = {};
  try {
    body = await resp.json();
  } catch { /* empty body */ }
  if (!resp.ok || body.ok === false) {
    throw new ApiError(resp.status, body.error || `HTTP ${resp.status}`, body.data);
  }
  return body.data;
}

// 同源绝对 URL — 避免 URL 嵌入凭据时相对路径 fetch 继承凭据报错
const ORIGIN = window.location.origin;
const U = (p: string) => ORIGIN + p;

export const api = {
  async get<T = unknown>(path: string): Promise<T> {
    const r = await fetch(U(path), { headers: authHeaders(), credentials: "same-origin" });
    return handle(r) as Promise<T>;
  },
  async post<T = unknown>(path: string, data?: unknown): Promise<T> {
    const r = await fetch(U(path), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(data ?? {}),
    });
    return handle(r) as Promise<T>;
  },
};

// ---- 类型定义 (与后端契约一致) ----
export const STATUS_META: Record<string, { label: string; color: string }> = {
  triage:    { label: "分诊",   color: "var(--text-3)" },
  todo:      { label: "待办",   color: "var(--text-2)" },
  scheduled: { label: "已排期", color: "var(--status-blue)" },
  ready:     { label: "就绪",   color: "var(--accent-cyan)" },
  running:   { label: "进行中", color: "var(--accent-blue)" },
  blocked:   { label: "阻塞",   color: "var(--status-red)" },
  review:    { label: "待审",   color: "var(--status-orange)" },
  done:      { label: "完成",   color: "var(--status-green)" },
  archived:  { label: "归档",   color: "var(--text-3)" },
};
export const UNKNOWN_STATUS = { label: "未知", color: "var(--text-3)" };
export function statusMeta(s: string) {
  return STATUS_META[s] || UNKNOWN_STATUS;
}
// 本机 9 状态展示顺序
export const ALL_STATUSES = ["triage","todo","scheduled","ready","running","blocked","review","done","archived"];

export interface Task {
  id: string;
  title: string;
  body?: string;
  status: string;
  assignee?: string;
  project_id?: string | null;
  priority?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  links?: { upstream?: string[]; downstream?: string[] };
}
export interface Project {
  id: string;
  name: string;
  description?: string;
  status?: string;
  created_at?: string;
}
export interface Profile {
  name: string;
  display_name?: string;
  role?: string;
  department?: string;
  model?: string;
  avatar?: string;
}
export interface Automation {
  name: string;
  schedule?: string;
  state?: string;
  last_status?: string | null;
  last_delivery_error?: string | null;
  last_error?: string | null;        // 执行失败, 与 last_delivery_error 严格区分(§2.2)
  has_issue?: boolean;               // 后端自动化 has_issue 字段, 必须保留(§2.2)
  issue_summary?: string;
  next_run?: string;
  last_success?: string;
  last_run_at?: string;
  ticker_heartbeat?: string;
  ticker_success?: string;
}
export interface BoardData {
  tasks: Task[];
  projects: Project[];
  profiles: Profile[];
  automations: Automation[];
  events?: EventItem[];
  // §2.2: 保留原始 meta 供 source-ok/error 区分
  meta?: {
    events_cursor?: number;
    fetched_at?: number;
    projects_ok?: boolean;
    projects_error?: string;
    counts?: Record<string, number>;
  };
}
export interface EventItem {
  id?: number;
  ts?: string;
  time?: string;
  kind?: string;
  task_id?: string;
  task_title?: string;
  actor?: string;
  detail?: string;
}

// 状态判定 (与现有语义一致)
export const ACTIVE_STATUSES = ["ready", "running", "blocked", "review"];
export const TERMINAL_STATUSES = ["done", "archived"];
export function isCurrentWork(t: Task) {
  return !TERMINAL_STATUSES.includes(t.status);
}
