// TaskDetailDrawer — 侧滑详情抽屉 (§2.5)
// 语义与旧版一致: 桌面右侧 overlay + 抽屉, 手机全屏
// race condition 保护 (detailSeq), 焦点管理, Escape 关闭, URL 同步
import { useEffect, useRef, useState } from "react";
import { api, statusMeta, type Task } from "../lib/api";
import { Capsule } from "../components/PrismCard";
import { fmtTs } from "../lib/board";
import { X, ExternalLink, AlertTriangle, Loader } from "lucide-react";

interface TaskDetail {
  id: string;
  title: string;
  body?: string;
  result?: string;
  status: string;
  assignee?: string;
  project_id?: string | null;
  project_name?: string;
  created_at?: number;
  completed_at?: number;
  body_full?: string;
  result_full?: string;
  result_preview?: string;
  runs?: { profile: string; status: string; started_at?: number; summary?: string }[];
  events?: { id: number; kind: string; created_at: number }[];
  upstream?: { id: string; title: string; status: string }[];
  downstream?: { id: string; title: string; status: string }[];
}

interface Props {
  taskId: string | null;
  data: Task | null;   // board 快照; 完整详情由 useTaskDetail 获取 (taskId 未知时可为 null)
  open: boolean;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}

/* ---- 旧版 parity: detailSeq race protection ---- */
let detailSeq = 0;

/* ---- 旧版 parity: avatarHtml ---- */
const AVATARS: Record<string, string> = {
  secretary: "secretary.png", researcher: "researcher.png", reviewer: "reviewer.png",
  archivist: "archivist.png", monitor: "monitor.png", pm: "pm.png",
  expert: "expert.png", frontend: "frontend.png", backend: "backend.png",
};
function avatarHtml(name: string): string {
  const first = (name || "?")[0].toUpperCase();
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  if (AVATARS[name]) {
    return `<span class="avatar av-img" style="width:18px;height:18px;border-radius:50%;display:inline-block;overflow:hidden;vertical-align:middle">
      <img src="/avatars/${AVATARS[name]}" alt="${name}" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.classList.add('av-fallback')" />
    </span>`;
  }
  return `<span class="avatar" style="display:inline-block;width:18px;height:18px;border-radius:50%;background:hsl(${h},45%,45%);color:#fff;font-size:10px;text-align:center;line-height:18px;vertical-align:middle">${first}</span>`;
}

function useTaskDetail(taskId: string | null) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) { setDetail(null); return; }
    const seq = ++detailSeq;
    setLoading(true);
    setError(null);

    api.get<Record<string, unknown>>(`/api/v1/tasks/${encodeURIComponent(taskId)}`).then((raw) => {
      if (seq !== detailSeq) return;
      const d: TaskDetail = {
        id: taskId,
        title: String(raw.title ?? raw.id ?? ""),
        body: raw.body ? String(raw.body) : undefined,
        result: raw.result ? String(raw.result) : undefined,
        status: String(raw.status ?? ""),
        assignee: raw.assignee ? String(raw.assignee) : undefined,
        project_id: raw.project_id ? String(raw.project_id) : undefined,
        project_name: raw.project_name ? String(raw.project_name) : undefined,
        created_at: typeof raw.created_at === "number" ? raw.created_at : undefined,
        completed_at: typeof raw.completed_at === "number" ? raw.completed_at : undefined,
        body_full: raw.body ? String(raw.body) : undefined,
        result_full: raw.result ? String(raw.result) : undefined,
        result_preview: raw.result_preview ? String(raw.result_preview) : undefined,
        runs: Array.isArray(raw.runs) ? (raw.runs as Record<string, unknown>[]).map((x) => ({
          profile: String(x.profile ?? ""),
          status: String(x.status ?? ""),
          started_at: typeof x.started_at === "number" ? x.started_at : undefined,
          summary: x.summary ? String(x.summary) : undefined,
        })) : undefined,
        events: Array.isArray(raw.events) ? (raw.events as Record<string, unknown>[]).map((x) => ({
          id: Number(x.id ?? 0),
          kind: String(x.kind ?? ""),
          created_at: Number(x.created_at ?? 0),
        })) : undefined,
        upstream: Array.isArray(raw.upstream) ? (raw.upstream as Record<string, unknown>[]).map((x) => ({
          id: String(x.id ?? ""),
          title: String(x.title ?? ""),
          status: String(x.status ?? ""),
        })) : undefined,
        downstream: Array.isArray(raw.downstream) ? (raw.downstream as Record<string, unknown>[]).map((x) => ({
          id: String(x.id ?? ""),
          title: String(x.title ?? ""),
          status: String(x.status ?? ""),
        })) : undefined,
      };
      setDetail(d);
      setLoading(false);
    }).catch((e) => {
      if (seq !== detailSeq) return;
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });

    return () => { /* keep seq protection */ };
  }, [taskId]);

  return { detail, loading, error };
}

export function TaskDetailDrawer({ taskId, data, open, onClose, onOpenTask }: Props) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const { detail, loading, error } = useTaskDetail(open ? taskId : null);

  // focus management
  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement as HTMLElement;
      // 延迟聚焦关闭按钮 (等动画)
      requestAnimationFrame(() => closeRef.current?.focus());
    } else if (prevFocusRef.current) {
      prevFocusRef.current.focus();
    }
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  // 旧版 UI 组合: data 可能为 null (taskId 未知/不在 board 快照), 依赖 detail 或错误态
  const t = detail || data || { id: taskId || "", title: "任务不存在", status: "" } as unknown as TaskDetail;
  const m = statusMeta(t.status);
  const projectInfo = detail?.project_name || (detail?.project_id) || data?.project_id || null;

  return (
    <>
      {/* overlay */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-250"
        style={{
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(4px)",
          opacity: open ? 1 : 0,
        }}
        onClick={onClose}
        aria-hidden
      />

      {/* drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`任务详情: ${t.title}`}
        className="fixed top-0 right-0 h-full z-50 flex flex-col transition-transform duration-250 cmd-glass"
        style={{
          width: "min(480px, 100vw)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          borderLeft: "1px solid var(--border-mid)",
          boxShadow: "-12px 0 48px -20px rgba(0,0,0,0.55)",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div className="flex items-start gap-2 px-5 pt-5 pb-3 shrink-0" style={{ borderBottom: "1px solid var(--border-soft)" }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Capsule color={m.color}>{m.label}</Capsule>
              {t.assignee && (
                <span className="text-[11px] font-mono" style={{ color: "var(--text-3)" }}>{t.assignee}</span>
              )}
            </div>
            <h2 className="text-[16px] font-semibold m-0 truncate" style={{ color: "var(--text-1)" }}>
              {t.title}
            </h2>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors"
            style={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", color: "var(--text-2)", cursor: "pointer" }}
            aria-label="关闭详情"
          >
            <X size={15} />
          </button>
        </div>

        {/* body — scroll */}
        <div className="flex-1 overflow-y-auto px-5 py-3" style={{ scrollbarWidth: "thin" }}>
          {loading && (
            <div className="flex items-center gap-2 py-4" style={{ color: "var(--text-3)" }}>
              <Loader size={14} className="animate-spin" />
              <span className="text-[13px]">加载中…</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-2 py-4" style={{ color: "var(--status-red)" }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span className="text-[13px]">详情加载失败: {error}</span>
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-4">
              {/* fields */}
              <FieldRow label="状态" value={m.label} badge={<Capsule color={m.color}>{m.label}</Capsule>} />
              <FieldRow label="负责人" value={t.assignee ? (
                <span
                  style={{ color: "var(--text-1)" }}
                  dangerouslySetInnerHTML={{ __html: avatarHtml(t.assignee) + " " + t.assignee }}
                />
              ) : "未指派"} />
              <FieldRow label="所属项目" value={projectInfo || "独立任务(未挂项目)"} muted={!projectInfo} />
              <FieldRow label="创建时间" value={t.created_at ? fmtTs(t.created_at) : "—"} />
              {t.completed_at && <FieldRow label="完成时间" value={fmtTs(t.completed_at)} />}
              {(t as TaskDetail).result_preview && <FieldRow label="结果摘要" value={(t as TaskDetail).result_preview! + "…"} />}
              {/* body/result from detail API */}
              {detail && (
                <>
                  <SectionDivider />
                  <DetailSection label="任务要求" value={detail.body_full || "暂无描述"} emptyText="暂无描述" />
                  <DetailSection
                    label="最终结果"
                    value={detail.result_full || ""}
                    emptyText={detail.status !== "done" && detail.status !== "archived" ? "暂无结果(任务未完成)" : "暂无结果"}
                  />

                  {/* runs */}
                  {detail.runs && detail.runs.length > 0 && (
                    <>
                      <SectionDivider />
                      <div>
                        <h3 className="text-[12px] font-semibold mb-1.5" style={{ color: "var(--text-2)" }}>执行记录</h3>
                        {detail.runs.map((r, i) => (
                          <div
                            key={i}
                            className="py-1.5"
                            style={{ borderBottom: "1px solid var(--border-soft)" }}
                          >
                            <span className="text-[12px]" style={{ color: "var(--text-1)" }}>{r.profile}</span>
                            <span className="text-[11px] ml-2" style={{ color: "var(--text-3)" }}>{r.status}</span>
                            {r.started_at && <span className="text-[11px] ml-2" style={{ color: "var(--text-3)" }}>{fmtTs(r.started_at)}</span>}
                            {r.summary && <div className="text-[11px]" style={{ color: "var(--text-3)" }}>{r.summary.slice(0, 120)}</div>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* events */}
                  {detail.events && detail.events.length > 0 && (
                    <>
                      <SectionDivider />
                      <div>
                        <h3 className="text-[12px] font-semibold mb-1.5" style={{ color: "var(--text-2)" }}>事件(最近 {detail.events.length} 条)</h3>
                        {detail.events.slice(0, 10).map((e) => (
                          <div key={e.id} className="py-0.5 text-[12px]" style={{ color: "var(--text-2)" }}>
                            <span className="text-[10px] font-mono px-1 py-0.5 rounded" style={{ background: "var(--surface-1)", color: "var(--text-3)" }}>{e.kind}</span>
                            {" "}{fmtTs(e.created_at)}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* dependency chain */}
                  {(detail.upstream && detail.upstream.length > 0) || (detail.downstream && detail.downstream.length > 0) ? (
                    <>
                      <SectionDivider />
                      <div>
                        <h3 className="text-[12px] font-semibold mb-1.5" style={{ color: "var(--text-2)" }}>依赖链</h3>
                        {detail.upstream?.map((x) => (
                          <DepRow key={x.id} x={x} mark="↑" onOpenTask={onOpenTask} />
                        ))}
                        {detail.downstream?.map((x) => (
                          <DepRow key={x.id} x={x} mark="↓" onOpenTask={onOpenTask} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <SectionDivider />
                      <div className="text-[12px]" style={{ color: "var(--text-3)" }}>无上游/后续依赖</div>
                    </>
                  )}
                </>
              )}

              {/* tech info */}
              <SectionDivider />
              <div>
                <h3 className="text-[12px] font-semibold mb-1" style={{ color: "var(--text-2)" }}>技术信息</h3>
                <div className="text-[11px] font-mono" style={{ color: "var(--text-3)" }}>
                  任务 ID: {t.id}
                </div>
                {projectInfo && (
                  <div className="text-[11px] font-mono" style={{ color: "var(--text-3)" }}>
                    项目 ID: {data?.project_id}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FieldRow({ label, value, badge, muted }: { label: string; value: React.ReactNode; badge?: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11px] font-semibold shrink-0 w-[60px] py-1" style={{ color: "var(--text-3)" }}>{label}</span>
      <div className={`flex-1 text-[13px] ${muted ? "" : ""}`} style={{ color: muted ? "var(--text-3)" : "var(--text-1)" }}>
        {badge || value}
      </div>
    </div>
  );
}

function SectionDivider() {
  return <div className="h-px my-2" style={{ background: "var(--border-soft)" }} />;
}

function DetailSection({ label, value, emptyText }: { label: string; value: string; emptyText: string }) {
  return (
    <div>
      <h3 className="text-[12px] font-semibold mb-1" style={{ color: "var(--text-2)" }}>{label}</h3>
      {value ? (
        <p className="text-[13px] leading-relaxed m-0 whitespace-pre-wrap" style={{ color: "var(--text-1)" }}>{value}</p>
      ) : (
        <p className="text-[13px] m-0" style={{ color: "var(--text-3)" }}>{emptyText}</p>
      )}
    </div>
  );
}

function DepRow({ x, mark, onOpenTask }: { x: { id: string; title: string; status: string }; mark: string; onOpenTask: (id: string) => void; }) {
  return (
    <div className="flex items-center gap-1.5 py-1">
      <span className="text-[11px]" style={{ color: "var(--text-3)" }}>{mark}</span>
      <button
        onClick={() => onOpenTask(x.id)}
        className="text-[12px] text-left border-0 p-0 cursor-pointer transition-colors"
        style={{ color: "var(--accent-blue)", background: "none" }}
      >
        {(x.title || x.id).slice(0, 44)}
        <ExternalLink size={10} className="inline ml-0.5" style={{ color: "var(--text-3)" }} />
      </button>
      <span className="text-[10px] ml-auto" style={{ color: "var(--text-3)" }}>{x.status}</span>
    </div>
  );
}