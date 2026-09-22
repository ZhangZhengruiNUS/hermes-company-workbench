// Team 页 — 双 tab(成员/组织) + 成员卡 + 只读成员抽屉(SOUL/Skills/配置)
// 语义基准: v5_template.html L1448-1511 (renderTeam/openMember) + L1683-1696 (双 tab 切换)
// 只读边界(§4.5): 本轮不实现编辑/解锁/写操作; 抽屉为纯只读, 复制不引用 TaskDetailDrawer
import { useEffect, useState } from "react";
import { PrismCard } from "../components/PrismCard";
import { Capsule } from "../components/PrismCard";
import { EmptyState, SectionTitle } from "../components/glass";
import { DrawerShell } from "../components/Drawer";
import { api, type BoardData, type Task } from "../lib/api";
import { fmtTs } from "../lib/board";
import { X, Loader, AlertTriangle } from "lucide-react";

interface Props {
  data: BoardData;
}

// 硬编码顺序: 运营线 → 研发线(旧版 L1452)
const LINES = ["运营线", "研发线"];

/* ---------- Member Avatar: 生产资产 img + 中文首字 hsl 色块 fallback(旧版 L1477) ---------- */
function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
function MemberAvatar({ name, fallback }: { name: string; fallback: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
        style={{ background: `hsl(${nameHash(name)},45%,45%)`, color: "#fff" }}
      >
        {fallback}
      </div>
    );
  }
  return (
    <img
      src={`/avatars/${name}.png`}
      alt={fallback}
      loading="lazy"
      onError={() => setErr(true)}
      className="w-7 h-7 rounded-full object-cover shrink-0"
    />
  );
}

/* ---------- 成员抽屉 数据(单人级 wbCache, 会话内 tab 切换不重拉) ---------- */
interface SoulData { content?: string; mtime?: number; sha256?: string; }
interface SkillItem { name: string; enabled: boolean; }
interface ConfigData { model?: string; config?: unknown; }

const wbCache: Record<string, Record<string, unknown>> = {};

function useProfileTab<T>(name: string, tab: string, path: string, cacheKey: string): { data: T | null; loading: boolean; error: string | null } {
  // 懒初始化: 初始状态直接由 wbCache 种子化(只在挂载时读一次, 不在渲染期变更缓存)
  const [data, setData] = useState<T | null>(() => {
    const c = wbCache[name];
    return c ? (c[tab] as T | undefined) ?? null : null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    const c = wbCache[name];
    return c ? !(tab in c) : true;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const memberCache = wbCache[name] || (wbCache[name] = {});
    if (tab in memberCache) return; // 已缓存 → 状态已种子化, 不重拉
    let cancelled = false;
    api.get<unknown>(path)
      .then((raw) => {
        if (cancelled) return;
        memberCache[tab] = raw;
        setData(raw as T);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [name, tab, path, cacheKey]);

  return { data, loading, error };
}

/* ---------- 成员抽屉(只读; 容器/遮罩语言复制自 TaskDetailDrawer, 不引用该文件) ---------- */
const DRAWER_TABS = ["SOUL", "Skills", "配置"] as const;
type DrawerTab = (typeof DRAWER_TABS)[number];

interface TeamDrawerProps {
  profile: { name: string; display_name?: string } | null;
  onClose: () => void;
}
function TeamDrawer({ profile, onClose }: TeamDrawerProps) {
  const open = !!profile;
  if (!profile) return null;

  const name = profile.name;
  const display = profile.display_name || name;

  return (
    <DrawerShell open={open} onClose={onClose} label={`成员详情: ${display}`}>
      {/* header */}
      <div className="flex items-start gap-2 px-5 pt-5 pb-3 shrink-0" style={{ borderBottom: "1px solid var(--border-soft)" }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <MemberAvatar name={name} fallback={display.slice(0, 1)} />
            <span className="text-[11px] font-mono" style={{ color: "var(--text-3)" }}>{name}</span>
          </div>
          <h2 className="text-[16px] font-semibold m-0 truncate" style={{ color: "var(--text-1)" }}>
            {display} · 实时数据
          </h2>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors"
          style={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", color: "var(--text-2)", cursor: "pointer" }}
          aria-label="关闭详情"
        >
          <X size={15} />
        </button>
      </div>

      <TeamDrawerBody profile={profile} />
    </DrawerShell>
  );
}

function TeamDrawerBody({ profile }: { profile: { name: string; display_name?: string } }) {
  const [tab, setTab] = useState<DrawerTab>("SOUL");
  // 抽屉每次打开都重新挂载(TeamDrawer 关闭时返回 null), 初始 tab 即 SOUL,
  // 对应旧版 openMember 默认 loadWbTab("soul") 语义.

  const name = profile.name;

  const soul = useProfileTab<SoulData>(name, "soul", `/api/v1/profiles/${encodeURIComponent(name)}/soul`, "soul");
  const skills = useProfileTab<SkillItem[]>(name, "skills", `/api/v1/profiles/${encodeURIComponent(name)}/skills`, "skills");
  const config = useProfileTab<ConfigData>(name, "config", `/api/v1/profiles/${encodeURIComponent(name)}/config`, "config");

  return (
    <>
      {/* tab bar */}
      <div className="flex gap-1 px-4 pt-3 shrink-0" role="tablist" aria-label="成员详情分类">
        {DRAWER_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="min-h-[44px] px-3 rounded-t-md text-[12px] font-semibold transition-colors"
            style={{
              color: tab === t ? "var(--text-1)" : "var(--text-3)",
              background: tab === t ? "var(--surface-1)" : "transparent",
              borderBottom: tab === t ? "2px solid var(--accent-blue)" : "2px solid transparent",
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* body — scroll */}
      <div className="flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarWidth: "thin" }}>
        {tab === "SOUL" && <SoulPane {...soul} />}
        {tab === "Skills" && <SkillsPane data={skills.data} loading={skills.loading} error={skills.error} />}
        {tab === "配置" && <ConfigPane data={config.data} loading={config.loading} error={config.error} />}
      </div>
    </>
  );
}

function LoadingPane() {
  return (
    <div className="flex items-center gap-2 py-4" style={{ color: "var(--text-3)" }}>
      <Loader size={14} className="animate-spin" />
      <span className="text-[13px]">加载中…</span>
    </div>
  );
}
function ErrorPane({ error }: { error: string }) {
  return (
    <div className="flex items-start gap-2 py-4" style={{ color: "var(--status-red)" }}>
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span className="text-[13px]">加载失败: {error}</span>
    </div>
  );
}

function SoulPane({ data, loading, error }: { data: SoulData | null; loading: boolean; error: string | null }) {
  if (loading) return <LoadingPane />;
  if (error) return <ErrorPane error={error} />;
  return (
    <div>
      <div className="text-[11px] mb-2" style={{ color: "var(--text-3)" }}>
        实时读取 · 更新 {data?.mtime ? fmtTs(data.mtime) : "—"} ·{" "}
        <span className="font-mono">{(data?.sha256 || "").slice(0, 10)}</span>
      </div>
      <pre
        className="whitespace-pre-wrap text-[13px] leading-relaxed m-0 p-3 rounded-[var(--radius-card)]"
        style={{ background: "var(--surface-1)", color: "var(--text-1)", fontFamily: "inherit" }}
      >
        {data?.content || ""}
      </pre>
    </div>
  );
}

function SkillsPane({ data, loading, error }: { data: SkillItem[] | null; loading: boolean; error: string | null }) {
  if (loading) return <LoadingPane />;
  if (error) return <ErrorPane error={error} />;
  const skills = data || [];
  const enabled = skills.filter((s) => s.enabled).length;
  return (
    <div>
      <div className="text-[11px] mb-2" style={{ color: "var(--text-3)" }}>
        共 {skills.length} 个 skill · 启用 {enabled} 个 · 目录存在即启用
      </div>
      <div className="flex flex-col">
        {skills.length === 0 && (
          <EmptyState>暂无 skills</EmptyState>
        )}
        {skills.map((s, i) => (
          <div
            key={i}
            className="flex items-center justify-between min-h-[44px] px-3"
            style={{ borderBottom: "1px solid var(--border-soft)" }}
          >
            <span className="text-[13px]" style={{ color: "var(--text-1)" }}>{s.name}</span>
            <Capsule color={s.enabled ? "var(--status-green)" : "var(--text-3)"}>
              {s.enabled ? "已启用" : "已禁用"}
            </Capsule>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigPane({ data, loading, error }: { data: ConfigData | null; loading: boolean; error: string | null }) {
  if (loading) return <LoadingPane />;
  if (error) return <ErrorPane error={error} />;
  return (
    <div>
      <div className="text-[11px] mb-2" style={{ color: "var(--text-3)" }}>
        服务端已脱敏(key/token/secret 字段打码) · 只读
      </div>
      <div className="text-[13px] mb-2">
        默认模型: <b className="font-mono" style={{ color: "var(--text-1)" }}>{data?.model || "—"}</b>
      </div>
      <pre
        className="whitespace-pre-wrap text-[12px] leading-relaxed m-0 p-3 rounded-[var(--radius-card)] font-mono"
        style={{ background: "var(--surface-1)", color: "var(--text-2)" }}
      >
        {data?.config != null ? JSON.stringify(data.config, null, 2) : "{}"}
      </pre>
    </div>
  );
}

/* ---------- 成员卡 摘要/脚注 计算(状态语义: running=执行中, done=完成, 禁止 done+archived 混算) ---------- */
interface MemberCardInfo {
  summary: string;
  summaryKind: "current" | "recent" | "none";
  openN: number;
  finN: number;
}
function memberCardInfo(mine: Task[]): MemberCardInfo {
  // 执行中 = status==="running"(旧版 L1465)
  const open = mine.filter((t) => t.status === "running");
  // 完成 = status==="done"(旧版 L1466), 不混算 archived
  const done = mine.filter((t) => t.status === "done");
  const openN = open.length;
  const finN = done.length;
  let summary = "";
  let summaryKind: MemberCardInfo["summaryKind"] = "none";
  if (open.length > 0) {
    const cur = open[0];
    summary = `当前任务: ${cur.title || ""}`;
    summaryKind = "current";
  } else if (done.length > 0) {
    // 最近完成 = 按 completed_at 最新的 done(旧版 L1468-1469)
    const recent = done.slice().sort((a, b) => (Number(b.completed_at || 0)) - (Number(a.completed_at || 0)))[0];
    summary = `最近任务: ${recent.title || ""}`;
    summaryKind = "recent";
  } else {
    summary = "暂无任务记录";
    summaryKind = "none";
  }
  return { summary, summaryKind, openN, finN };
}

/* ---------- Team 主组件 ---------- */
export function Team({ data }: Props) {
  const [tab, setTab] = useState<"members" | "org">("members");
  const [drawerName, setDrawerName] = useState<string | null>(null);

  const profiles = data.profiles || [];
  const tasks = data.tasks || [];

  // 分组: role 字段 = line(board.ts normProfiles 映射), 仅 运营线/研发线; secretary 组内首位
  const groups = LINES.map((line) => {
    const ps = profiles.filter((p) => (p.role || "其他") === line);
    const sorted = [...ps].sort((a, b) => {
      if (a.name === "secretary") return -1;
      if (b.name === "secretary") return 1;
      return 0;
    });
    return { line, members: sorted };
  }).filter((g) => g.members.length > 0);

  const drawerProfile = drawerName ? (profiles.find((p) => p.name === drawerName) ?? null) : null;

  return (
    <div className="max-w-[980px]">
      {/* 双 tab: 成员 / 组织(默认成员, 切换不丢状态) */}
      <div className="flex gap-1 mb-3 relative" role="tablist" aria-label="团队视图" data-pointer-light="glass">
        {(["members", "org"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="min-h-[44px] px-4 rounded-md text-[13px] font-semibold transition-colors"
            style={{
              color: tab === t ? "var(--text-1)" : "var(--text-3)",
              background: tab === t ? "var(--surface-1)" : "transparent",
              border: "1px solid var(--border-soft)",
              cursor: "pointer",
            }}
          >
            {t === "members" ? "成员" : "组织"}
          </button>
        ))}
      </div>

      {tab === "members" ? (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.line}>
              <SectionTitle>{`${g.line} · ${g.members.length} 岗`}</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {g.members.map((p) => {
                  const mine = tasks.filter((t) => t.assignee === p.name);
                  const info = memberCardInfo(mine);
                  const display = p.display_name || p.name;
                  return (
                    <PrismCard
                      key={p.name}
                      className="cursor-pointer"
                      onClick={() => setDrawerName(p.name)}
                      role="button"
                      ariaLabel={`查看 ${display} 详情`}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawerName(p.name); } }}
                    >
                      <div className="flex items-center gap-2.5">
                        <MemberAvatar name={p.name} fallback={display.slice(0, 1)} />
                        <div className="min-w-0">
                          <span className="text-[13px] font-semibold block truncate" style={{ color: "var(--text-1)" }}>{display}</span>
                          <span className="text-[11px] font-mono block truncate" style={{ color: "var(--text-3)" }}>{p.name}</span>
                        </div>
                      </div>
                      <div className="mt-2 text-[12px] line-clamp-2 min-w-0 break-words" title={info.summary} style={{ color: info.summaryKind === "none" ? "var(--text-3)" : "var(--text-2)" }}>
                        {info.summary}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="flex-1 min-w-0 text-[11px] truncate" style={{ color: "var(--text-3)" }}>
                          {info.openN > 0 ? `${info.openN} 项执行中 · ` : ""}{info.finN} 项完成
                        </span>
                        <Capsule title={`默认模型: ${p.model || "—"}`} className="max-w-[190px] shrink-0">默认模型 {p.model || "—"}</Capsule>
                      </div>
                    </PrismCard>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* 组织 tab: 标题 + 每线成员胶囊(旧版 L1493-1498) */
        <PrismCard>
          <div className="px-5 py-4">
            <div className="text-[15px] font-semibold mb-3" style={{ color: "var(--text-1)" }}>
              Hermes Company · {profiles.length} 岗 · 2 部门
            </div>
            {groups.map((g) => (
              <div key={g.line} className="mb-3">
                <h4 className="text-[13px] font-semibold mb-2" style={{ color: "var(--text-2)" }}>{g.line}</h4>
                <div className="flex flex-wrap gap-2">
                  {g.members.map((p) => (
                    <span key={p.name} className="pill">
                      {(p.display_name || p.name)}{" "}
                      <span className="text-[11px] font-mono" style={{ color: "var(--text-3)" }}>{p.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </PrismCard>
      )}

      <TeamDrawer profile={drawerProfile} onClose={() => setDrawerName(null)} />
    </div>
  );
}
