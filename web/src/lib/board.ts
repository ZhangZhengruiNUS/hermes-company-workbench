// 板数据 hooks — 并行拉取 board + automations + profiles + events, 合并为前端视图模型
// 共享数据语义(§2.1/§2.2/§2.3): 完成/归档严格分开, 子数据源失败不得伪装成功, 时间统一时区
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type BoardData, type Task, type Profile, type Project, type Automation, type EventItem, isCurrentWork, ACTIVE_STATUSES, TERMINAL_STATUSES } from "./api";

const BOARD_PATH = "/api/v1/board";

// 后端各端点原始结构 → 统一视图模型
interface RawBoard {
  tasks?: Task[];
  projects?: unknown[];
  projects_ok?: boolean;
  projects_error?: string;
  counts?: Record<string, number>;
  events_cursor?: number;
  fetched_at?: number;
}
interface RawAutomations { automations?: Record<string, unknown>[]; source_ok?: boolean; }
interface RawProfiles { [k: string]: unknown } // 数组或 {name: {...}} 均兼容
interface RawEvents { events?: Record<string, unknown>[]; has_more?: boolean; next_cursor?: number }

function normProjects(raw: RawBoard, d: BoardData): void {
  // projects 是数组; projects_ok 只是 bool 标志, projects_error 是字符串
  const src = Array.isArray(raw.projects) ? raw.projects : [];
  d.projects = (src as Record<string, unknown>[]).map((p) => ({
    id: String(p.id ?? p.project_id ?? ""),
    name: String(p.name ?? p.title ?? p.id ?? ""),
    description: p.description ? String(p.description) : undefined,
    status: p.status ? String(p.status) : undefined,
    created_at: p.created_at ? String(p.created_at) : undefined,
  }));
}

function normAutomations(raw: RawAutomations): Automation[] {
  return (raw.automations || []).map((a) => {
    // §2.2: last_error(执行失败) 与 last_delivery_error(送达失败) 严格区分, 不得互相混淆映射
    const state = a.state ? String(a.state) : undefined;
    const last_status = a.last_status != null ? String(a.last_status) : null;
    const has_issue = a.has_issue === true || a.has_issue === "true";
    return {
      name: String(a.name ?? a.id ?? ""),
      schedule: a.schedule_display ? String(a.schedule_display) : a.schedule ? String(a.schedule) : undefined,
      state,
      last_status,
      last_delivery_error: a.last_delivery_error != null ? String(a.last_delivery_error) : null,
      last_error: a.last_error != null ? String(a.last_error) : null,
      has_issue,
      issue_summary: a.issue_summary ? String(a.issue_summary) : undefined,
      next_run: a.next_run_at ? String(a.next_run_at) : a.next_run ? String(a.next_run) : undefined,
      last_success: a.last_success_at ? String(a.last_success_at) : undefined,
      last_run_at: a.last_run_at ? String(a.last_run_at) : undefined,
      ticker_heartbeat: a.ticker_heartbeat ? String(a.ticker_heartbeat) : undefined,
      ticker_success: a.ticker_success ? String(a.ticker_success) : undefined,
    };
  });
}

function normProfiles(raw: unknown): Profile[] {
  let list: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) list = raw as Record<string, unknown>[];
  else if (raw && typeof raw === "object") {
    // {name: {...}} 或 {profiles: [...]}
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.profiles)) list = obj.profiles as Record<string, unknown>[];
    else list = Object.entries(obj).map(([name, v]) => ({ name, ...(typeof v === "object" && v ? v as object : {}) }));
  }
  return list.map((p) => ({
    name: String(p.name ?? ""),
    display_name: p.cn ? String(p.cn) : p.display_name ? String(p.display_name) : undefined,
    role: p.role ? String(p.role) : p.line ? String(p.line) : undefined,
    department: p.department ? String(p.department) : undefined,
    model: p.model ? String(p.model) : undefined,
  })).filter((p) => p.name);
}

function normEvents(raw: RawEvents): EventItem[] {
  return (raw.events || []).map((e) => ({
    id: typeof e.id === "number" ? e.id : undefined,
    ts: e.created_at != null ? new Date(Number(e.created_at) * 1000).toISOString() : e.created_at ? String(e.created_at) : undefined,
    kind: e.kind ? String(e.kind) : undefined,
    task_id: e.task_id ? String(e.task_id) : undefined,
    task_title: e.title ? String(e.title) : undefined,
    actor: e.actor ? String(e.actor) : undefined,
    detail: e.detail ? String(e.detail) : (e.payload ? JSON.stringify(e.payload).slice(0, 80) : undefined),
  }));
}

// BoardData 扩充: 记录子数据源失败, 空结果与失败严格分开(§2.2)
export interface BoardState {
  data: BoardData | null;
  error: string | null;                       // board 主源失败
  sourcesFailed: Partial<Record<"automations" | "profiles" | "events", boolean>>;
  fetchedAt: number | null;
}

export function useBoard() {
  const [state, setState] = useState<BoardState>({ data: null, error: null, sourcesFailed: {}, fetchedAt: null });
  // 镜像最新 state 到 ref, 供 refresh 在异步完成时读取上一次成功数据(LKG)
  const stateRef = useRef<BoardState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // 子源响应统一为 { data?: Raw } 包裹或不包裹两种形态
  function unwrap<T>(v: unknown, fallback: T): T {
    if (v && typeof v === "object" && "data" in (v as object) && (v as { data?: unknown }).data !== undefined) {
      return (v as { data: T }).data;
    }
    return (v as T) ?? fallback;
  }
  // 子源失败判定: HTTP reject 或 显式 source_ok=false (§2.2/B.1.2)
  function sourceUnusable(r: PromiseSettledResult<unknown>, sourceOkKey: string): boolean {
    if (r.status !== "fulfilled") return true;
    const u = unwrap<Record<string, unknown> | null>(r.value, null);
    if (u && sourceOkKey in u && u[sourceOkKey] === false) return true;
    return false;
  }

  const refresh = useCallback(async () => {
    try {
      const raw = await api.get<RawBoard>(BOARD_PATH);

      // 并行拉取其余三个端点; §2.2/B.1: 单个子源失败不得伪装成空成功, 保留 LKG
      const [autoR, profR, evR] = await Promise.allSettled([
        api.get<RawAutomations | { data: RawAutomations }>("/api/v1/automations"),
        api.get<RawProfiles | { data: RawProfiles }>("/api/v1/profiles"),
        api.get<RawEvents | { data: RawEvents }>("/api/v1/events?order=desc&limit=8"),
      ]);
      const sourcesFailed: BoardState["sourcesFailed"] = {};
      if (sourceUnusable(autoR, "source_ok")) sourcesFailed.automations = true;
      if (sourceUnusable(profR, "source_ok")) sourcesFailed.profiles = true;
      if (sourceUnusable(evR, "source_ok")) sourcesFailed.events = true;

      // 只在子源成功时覆盖该 slice; 失败保留上一次成功数据(LKG), 由 UI 标注 stale
      const prev = stateRef.current;
      const d: BoardData = {
        tasks: raw.tasks || [],
        projects: (prev?.data?.projects as Project[]) || [],
        profiles: !sourcesFailed.profiles ? normProfiles(unwrap<RawProfiles>(profR.status === "fulfilled" ? profR.value : null, {})) : (prev?.data?.profiles || []),
        automations: !sourcesFailed.automations ? normAutomations(unwrap<RawAutomations>(autoR.status === "fulfilled" ? autoR.value : null, {})) : (prev?.data?.automations || []),
        events: !sourcesFailed.events ? normEvents(unwrap<RawEvents>(evR.status === "fulfilled" ? evR.value : null, {})) : (prev?.data?.events || []),
      };
      normProjects(raw, d);
      d.meta = {
        events_cursor: raw.events_cursor,
        fetched_at: raw.fetched_at,
        projects_ok: raw.projects_ok !== false,
        projects_error: raw.projects_error || "",
        counts: raw.counts,
      };

      setState({ data: d, error: null, sourcesFailed, fetchedAt: raw.fetched_at ?? Date.now() });
    } catch (e) {
      // 主源失败: 保留 LKG 数据, 仅标记主源错误(避免整页白屏/回退到过期数据时无标注)
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, refresh };
}

// ---- 共享数据语义选择器(§2.1, 单一直实现, 总览/任务/项目/团队摘要共用) ----

// 当前推进: ready/running/blocked/review (语义与旧版一致)
export function currentProgress(tasks: Task[]) {
  return tasks.filter((t) => ACTIVE_STATUSES.includes(t.status));
}

// 当前工作: 非终态(done/archived 之外), 未知状态不静默丢弃
export function currentWork(tasks: Task[]) {
  return tasks.filter(isCurrentWork);
}

// 完成数: 仅 status === "done"(归档不得计入完成)
export function doneCount(tasks: Task[]): number {
  return tasks.filter((t) => t.status === "done").length;
}

// 归档数: 仅 status === "archived"
export function archivedCount(tasks: Task[]): number {
  return tasks.filter((t) => t.status === "archived").length;
}

export function statusCounts(tasks: Task[]) {
  const m: Record<string, number> = {};
  for (const t of tasks) m[t.status] = (m[t.status] || 0) + 1;
  return m;
}

export interface ProjectStats {
  total: number;        // 关联任务总数(含归档)
  done: number;         // 完成(done)数
  archived: number;     // 归档数
  rate: number | null;  // done / 未归档任务数; 无未归档 → null(不显示假 100%)
  activeTasks: Task[];
}
// 统一项目统计口径(§2.1): 归属唯一真相 = task.project_id; 完成率 = done / (total - archived); archived 单列
export function projStats(tasks: Task[], pid: string): ProjectStats {
  const mem = tasks.filter((t) => t.project_id === pid);
  const s: ProjectStats = { total: mem.length, done: 0, archived: 0, rate: null, activeTasks: [] };
  for (const t of mem) {
    if (t.status === "done") s.done++;
    else if (t.status === "archived") s.archived++;
    else if (["running", "blocked", "ready", "todo"].includes(t.status)) s.activeTasks.push(t);
  }
  const active = s.total - s.archived;
  if (active > 0) s.rate = Math.round((s.done / active) * 100);
  return s;
}

// 需要关注: blocked / ready无负责人 / automation 异常
export interface Attention {
  kind: "blocked" | "unassigned" | "automation";
  title: string;
  detail: string;
}
export function attentionItems(tasks: Task[], automations: BoardData["automations"]): Attention[] {
  const out: Attention[] = [];
  for (const t of tasks) {
    if (t.status === "blocked") {
      out.push({ kind: "blocked", title: t.title, detail: "任务被阻塞" });
    } else if (t.status === "ready" && !t.assignee) {
      out.push({ kind: "unassigned", title: t.title, detail: "就绪但未指派负责人" });
    }
  }
  for (const a of automations || []) {
    // §2.2: 只认 has_issue 判定异常; 未知 last_status 中性显示, 不误报
    if (a.has_issue) {
      out.push({ kind: "automation", title: a.name, detail: a.issue_summary || "自动化异常" });
    } else if (a.last_error && !a.has_issue) {
      out.push({ kind: "automation", title: a.name, detail: a.last_error || "自动化执行失败" });
    }
  }
  return out;
}

// ---- 时间格式化(§2.3): 工作台约定时区(Asia/Shanghai), 原始 unix 秒 → 本地日期; 原始值放 tooltip ----
export function fmtTs(ts: unknown): string {
  if (ts == null || ts === "") return "—";
  const n = typeof ts === "number" ? ts : Number(ts);
  if (Number.isNaN(n)) return "—";
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (x: number) => (x < 10 ? "0" + x : "" + x);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtDay(ts: unknown): string {
  if (ts == null || ts === "") return "—";
  const n = typeof ts === "number" ? ts : Number(ts);
  if (Number.isNaN(n)) return "—";
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (x: number) => (x < 10 ? "0" + x : "" + x);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export { TERMINAL_STATUSES };
export type { Profile };
