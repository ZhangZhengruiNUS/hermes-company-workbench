#!/usr/bin/env python3
"""Workbench API — Hermes Company 工作台实时读写后端.
架构: shared/reports/WORKBENCH_ARCH.md (architect, 2026-09-15)
- 读: profiles 列表/SOUL/skills/config(脱敏)
- 写: SOUL 保存(备份+原子写+乐观锁), skill enable/disable(mv 不删除)
- 秘书(secretary)=default profile(~/.hermes/), 老板确认开放可写
- 仅监听 127.0.0.1:8081
"""
import json, os, re, hashlib, shutil, time, yaml
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

HERMES_HOME = os.environ.get("WORKBENCH_HERMES_HOME", os.path.expanduser("~/.hermes"))
PROFILES_DIR = os.path.join(HERMES_HOME, "profiles")
DEFAULT_HOME = HERMES_HOME  # secretary = default profile
BACKUP_DIR = os.path.join(HERMES_HOME, "backups", "workbench")
DISABLED_DIR = os.path.join(HERMES_HOME, "backups", "workbench_disabled")
AUDIT_LOG = os.path.join(HERMES_HOME, "backups", "workbench_audit.log")
PORT = int(os.environ.get("WORKBENCH_PORT", "8081"))
# ---- 写锁: 默认只读, 解锁需密码 ----
# 密码存环境变量 WORKBENCH_WRITE_PASSWORD; 未设置时生成随机密码并打印(仅服务端可见)
import secrets as _secrets
WRITE_PASSWORD = os.environ.get("WORKBENCH_WRITE_PASSWORD") or None
if WRITE_PASSWORD is None:
    # 持久化到仅 root/owner 可读文件, 避免每次重启变化
    _pwfile = os.path.join(HERMES_HOME, "backups", "workbench_write_password")
    if os.path.isfile(_pwfile):
        with open(_pwfile) as f:
            WRITE_PASSWORD = f.read().strip()
    else:
        WRITE_PASSWORD = _secrets.token_urlsafe(12)
        os.makedirs(os.path.dirname(_pwfile), exist_ok=True)
        with open(_pwfile, "w") as f:
            f.write(WRITE_PASSWORD)
        os.chmod(_pwfile, 0o600)
SESSIONS = {}  # token -> expiry (写会话, 2 小时)
SESSION_TTL = 2 * 3600


# default profile 的模型名等展示信息(手动维护, 与 UI 团队页一致)
SECRETARY_META = {"name": "secretary", "cn": "秘书", "line": "运营线", "model": "glm-5.3-flash"}

# ============ Kanban 实时只读层 (B路线) ============
import sqlite3 as _sql
import threading as _threading
import queue as _queue

KANBAN_DB = os.path.join(HERMES_HOME, "kanban.db")
PROJECTS_DB = os.path.join(HERMES_HOME, "projects.db")
EVENT_KINDS_CORE = {"created", "claimed", "spawned", "promoted", "completed",
                    "archived", "blocked", "unblocked", "crashed", "timed_out",
                    "gave_up", "dependency_wait", "commented", "attached"}
# 任务可见状态白名单; 未知状态原样透传, 前端按未知样式展示
TASK_LIST_COLS = ("id,title,assignee,status,priority,project_id,created_at,started_at,"
                  "completed_at,last_heartbeat_at,current_run_id,result")

def _ro_connect(path=KANBAN_DB, timeout=0.8):
    """只读打开 SQLite; 短超时不长期占锁; 不建库不迁移"""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"database missing: {path}")
    uri = f"file:{path}?mode=ro"
    conn = _sql.connect(uri, uri=True, timeout=timeout)
    conn.row_factory = _sql.Row
    return conn

def _task_row(r):
    """tasks 行 -> 页面友好 dict; result 截断(详情接口给全文)"""
    return {
        "id": r["id"], "title": r["title"], "assignee": r["assignee"],
        "status": r["status"], "priority": r["priority"], "project_id": r["project_id"],
        "created_at": r["created_at"], "started_at": r["started_at"],
        "completed_at": r["completed_at"], "last_heartbeat_at": r["last_heartbeat_at"],
        "has_run": bool(r["current_run_id"]),
        "result_preview": (r["result"] or "")[:160] if r["result"] else ""
    }

def board_payload():
    """单一短读事务: 任务列表+统计+当前事件游标, 保证同一响应口径一致"""
    db = _ro_connect()
    try:
        rows = db.execute(f"SELECT {TASK_LIST_COLS} FROM tasks ORDER BY COALESCE(completed_at,created_at) DESC").fetchall()
        max_ev = db.execute("SELECT COALESCE(MAX(id),0) FROM task_events").fetchone()[0]
        tasks = [_task_row(r) for r in rows]
        counts = {}
        for t in tasks:
            counts[t["status"]] = counts.get(t["status"], 0) + 1
        running = db.execute(
            "SELECT COUNT(*) FROM task_runs WHERE status='running' AND ended_at IS NULL").fetchone()[0]
    finally:
        db.close()
    # 真实项目实体 (projects.db 为独立库, 只读并查; 跨库非原子, 仅展示用)
    # 故障不再伪装成"无项目": projects_ok=false 时前端显示数据源错误
    projects, projects_ok, projects_err = [], True, ""
    if os.path.isfile(PROJECTS_DB):
        pdb = None
        try:
            pdb = _ro_connect(path=PROJECTS_DB)
            prows = pdb.execute(
                "SELECT id,name,description,color,created_at FROM projects ORDER BY created_at").fetchall()
            for p in prows:
                projects.append({"id": p["id"], "name": p["name"], "desc": p["description"] or "",
                                 "color": p["color"] or "", "created_at": p["created_at"]})
        except Exception as e:
            projects_ok, projects_err = False, str(e)[:120]
        finally:
            if pdb is not None:
                pdb.close()
    return {"tasks": tasks, "counts": counts, "total": len(tasks),
            "events_cursor": max_ev, "runs_running": running,
            "projects": projects, "projects_ok": projects_ok, "projects_error": projects_err,
            "fetched_at": int(time.time())}

def events_payload(after_id=0, limit=200, before_id=0, order="asc"):
    """真实 task_events; heartbeat 不进入页面事件流(高频噪声).
    两种读法:
    - 增量补取: order=asc + after_id(已消费游标), 返回 has_more+next_cursor
    - 历史向前分页: order=desc + before_id(已加载最旧一条 id), 返回更旧一页 + has_more
    过滤 heartbeat 不影响游标确定性。"""
    db = _ro_connect()
    try:
        if order == "desc":
            # 历史分页: 取 id<before 的最近 limit 条非heartbeat, 再倒序输出(最新在前)
            rows = db.execute(
                "SELECT e.id, e.task_id, e.kind, e.payload, e.created_at, t.title, t.assignee "
                "FROM task_events e LEFT JOIN tasks t ON t.id=e.task_id "
                "WHERE e.kind!='heartbeat' AND (?<=0 OR e.id<?) "
                "ORDER BY e.id DESC LIMIT ?", (before_id, before_id, limit)).fetchall()
            rows = list(rows)[::-1]  # 统一 id ASC 内部序, 前端自行倒排
            page = rows[-limit:] if limit else []
            evs = []
            for r in page:
                evs.append(_event_dict(r))
            return {"events": evs, "has_more": len(page) >= limit,
                    "next_before": page[0]["id"] if page else before_id}
        rows = db.execute(
            "SELECT e.id, e.task_id, e.kind, e.payload, e.created_at, t.title, t.assignee "
            "FROM task_events e LEFT JOIN tasks t ON t.id=e.task_id "
            "WHERE e.id>? AND e.kind!='heartbeat' "
            "ORDER BY e.id ASC LIMIT ?+40", (after_id, limit)).fetchall()
    finally:
        db.close()
    evs = [_event_dict(r) for r in rows]
    # 超页心跳可能挤占窗口: 已取行数 >= limit 时向后探测确保进度确定
    has_more = len(evs) >= limit
    page = evs[:limit]
    next_cursor = page[-1]["id"] if page else after_id
    return {"events": page, "has_more": has_more, "next_cursor": next_cursor,
            "cursor": next_cursor, "after": after_id}

def _event_dict(r):
    try:
        payload = json.loads(r["payload"]) if r["payload"] else {}
    except Exception:
        payload = {"raw": str(r["payload"])[:200]}
    return {"id": r["id"], "task_id": r["task_id"], "kind": r["kind"],
            "payload": payload, "created_at": r["created_at"],
            "title": r["title"], "assignee": r["assignee"]}

def task_detail(task_id):
    db = _ro_connect()
    try:
        r = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not r:
            return None
        runs = db.execute(
            "SELECT id,profile,step_key,status,started_at,ended_at,outcome,summary "
            "FROM task_runs WHERE task_id=? ORDER BY started_at DESC LIMIT 10", (task_id,)).fetchall()
        events = db.execute(
            "SELECT id,kind,created_at FROM task_events WHERE task_id=? AND kind!='heartbeat' "
            "ORDER BY id DESC LIMIT 30", (task_id,)).fetchall()
        # 依赖链 (task_links 只表依赖不表归属): 上游=阻塞本任务的父任务, 下游=依赖本任务的子任务
        ups = db.execute(
            "SELECT l.parent_id AS id, t.title, t.status FROM task_links l "
            "LEFT JOIN tasks t ON t.id=l.parent_id WHERE l.child_id=?", (task_id,)).fetchall()
        downs = db.execute(
            "SELECT l.child_id AS id, t.title, t.status FROM task_links l "
            "LEFT JOIN tasks t ON t.id=l.child_id WHERE l.parent_id=?", (task_id,)).fetchall()
    finally:
        db.close()
    d = _task_row(r)
    d["body"] = (r["body"] or "")[:4000]
    d["result"] = (r["result"] or "")[:8000]
    d["runs"] = [dict(x) for x in runs]
    d["events"] = [dict(x) for x in events]
    d["upstream"] = [dict(x) for x in ups]
    d["downstream"] = [dict(x) for x in downs]
    return d

def runs_payload():
    """当前/最近运行证据(团队页'进行中'展示)"""
    db = _ro_connect()
    try:
        rows = db.execute(
            "SELECT r.task_id, r.profile, r.status, r.started_at, r.last_heartbeat_at, t.title "
            "FROM task_runs r LEFT JOIN tasks t ON t.id=r.task_id "
            "WHERE r.status='running' AND r.ended_at IS NULL").fetchall()
    finally:
        db.close()
    return [{"task_id": x["task_id"], "profile": x["profile"], "status": x["status"],
             "started_at": x["started_at"], "last_heartbeat_at": x["last_heartbeat_at"],
             "title": x["title"]} for x in rows]

# ---- SSE 广播中心: 单一巡检线程扫描 task_events, 所有订阅者共享 ----
class EventHub:
    def __init__(self):
        self._subs = []          # list of queue.Queue
        self._lock = _threading.Lock()
        self._cursor = 0
        self._profile_sig = ""   # profiles 目录签名(覆盖 profile 文件变化)

    def subscribe(self):
        q = _queue.Queue(maxsize=64)
        with self._lock:
            self._subs.append(q)
        return q

    def unsubscribe(self, q):
        with self._lock:
            if q in self._subs:
                self._subs.remove(q)

    def broadcast(self, obj):
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(obj)
            except Exception:
                # 队列满: 订阅者跟不上。显式要求其重新同步, 而不是移除后静默只发 keepalive
                try:
                    q.put_nowait({"type": "resync"})
                except Exception:
                    self.unsubscribe(q)

    def _profile_signature(self):
        try:
            parts = []
            for n in list_profile_names():
                h = profile_home(n)
                st_soul = os.path.getmtime(os.path.join(h, "SOUL.md")) if os.path.isfile(os.path.join(h, "SOUL.md")) else 0
                sk = os.path.join(h, "skills")
                st_sk = int(os.path.getmtime(sk)) if os.path.isdir(sk) else 0
                # config.yaml 纳入变化检测 (mtime+size, size 防 mtime 精度不足)
                cfg = os.path.join(h, "config.yaml")
                if os.path.isfile(cfg):
                    st_cfg = f"{int(os.path.getmtime(cfg))}:{os.path.getsize(cfg)}"
                else:
                    st_cfg = "0"
                parts.append(f"{n}:{int(st_soul)}:{st_sk}:{st_cfg}")
            return "|".join(parts)
        except Exception:
            return ""

    def start(self):
        def loop():
            time.sleep(1.0)
            try:
                db = _ro_connect()
                try:
                    self._cursor = db.execute("SELECT COALESCE(MAX(id),0) FROM task_events").fetchone()[0]
                finally:
                    db.close()
                self._profile_sig = self._profile_signature()
            except Exception:
                pass
            while True:
                time.sleep(1.5)
                try:
                    db = _ro_connect()
                    try:
                        rows = db.execute(
                            "SELECT e.id, e.task_id, e.kind, e.created_at, t.title, t.assignee "
                            "FROM task_events e LEFT JOIN tasks t ON t.id=e.task_id "
                            "WHERE e.id>? ORDER BY e.id ASC LIMIT 50", (self._cursor,)).fetchall()
                        if rows:
                            self._cursor = rows[-1]["id"]
                    finally:
                        db.close()
                    # 广播任何非 heartbeat 事件(不限于 CORE 白名单): 活动 API 返回全部
                    # 非 heartbeat 事件, 白名单遗漏的 kind(如 project_linked/自定义 kind)
                    # 若不广播, 前端永远收不到通知, 页面无法实时刷新。count 仍按 CORE 统计。
                    notable = [r for r in rows if r["kind"] != "heartbeat"]
                    if notable:
                        core_kinds = sorted({r["kind"] for r in notable if r["kind"] in EVENT_KINDS_CORE})
                        self.broadcast({"type": "events", "cursor": self._cursor,
                                        "count": len(notable), "kinds": core_kinds})
                except FileNotFoundError:
                    self.broadcast({"type": "source_error", "error": "kanban.db missing"})
                except Exception as e:
                    self.broadcast({"type": "source_error", "error": str(e)[:120]})
                # profile/config 文件变化检测(每轮都做, 不依赖有无新 task_events)
                try:
                    sig = self._profile_signature()
                    if sig != self._profile_sig:
                        self._profile_sig = sig
                        self.broadcast({"type": "profiles_changed"})
                except Exception:
                    pass
        t = _threading.Thread(target=loop, daemon=True, name="wb-event-scanner")
        t.start()

HUB = EventHub()

PROFILE_CN = {"expert": "架构师", "frontend": "前端工程师", "backend": "后端工程师", "researcher": "研究员",
              "reviewer": "审稿人", "pm": "产品经理", "archivist": "档案员", "monitor": "监控员"}

SENSITIVE_RE = re.compile(r"(key|token|secret|password|auth)", re.I)

def profile_home(name):
    if name == "secretary":
        return DEFAULT_HOME
    return os.path.join(PROFILES_DIR, name)

def list_profile_names():
    names = sorted(d for d in os.listdir(PROFILES_DIR)
                   if os.path.isdir(os.path.join(PROFILES_DIR, d)) and not d.startswith("."))
    return names + ["secretary"]  # secretary 固定在末尾, 对应 UI 运营线首位

def sha256_file(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

def load_yaml(path):
    try:
        with open(path) as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}

def redact(obj):
    """递归打码敏感字段, 返回脱敏副本"""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if SENSITIVE_RE.search(str(k)):
                out[k] = "[REDACTED]"
            else:
                out[k] = redact(v)
        return out
    if isinstance(obj, list):
        return [redact(x) for x in obj]
    if isinstance(obj, str) and len(obj) > 200:
        return obj[:100] + "…"
    return obj

def model_of(name):
    home = profile_home(name)
    cfg = load_yaml(os.path.join(home, "config.yaml"))
    model = cfg.get("model") or (cfg.get("providers") or {}).get("model") or ""
    if isinstance(model, dict):
        model = model.get("default") or model.get("name") or ""
    return str(model) or (SECRETARY_META["model"] if name == "secretary" else "")

def skill_list(name):
    """返回 [{name, enabled}]; disabled 的从 workbench_disabled/<profile>/ 扫"""
    home = profile_home(name)
    sdir = os.path.join(home, "skills")
    ddir = os.path.join(DISABLED_DIR, name)
    out = []
    if os.path.isdir(sdir):
        out += [{"name": d, "enabled": True} for d in sorted(os.listdir(sdir))
                if os.path.isdir(os.path.join(sdir, d)) and not d.startswith(".")]
    if os.path.isdir(ddir):
        out += [{"name": d, "enabled": False} for d in sorted(os.listdir(ddir))
                if os.path.isdir(os.path.join(ddir, d)) and not d.startswith(".")]
    return out

def profiles_payload():
    arr = []
    for n in list_profile_names():
        home = profile_home(n)
        soul_path = os.path.join(home, "SOUL.md")
        skills = skill_list(n)
        item = {
            "name": n,
            "cn": SECRETARY_META["cn"] if n == "secretary" else PROFILE_CN.get(n, n),
            "line": SECRETARY_META["line"] if n == "secretary" else ("研发线" if n in ("expert", "frontend", "backend") else "运营线"),
            "model": model_of(n),
            "soul_exists": os.path.isfile(soul_path),
            "soul_size": os.path.getsize(soul_path) if os.path.isfile(soul_path) else 0,
            "soul_mtime": int(os.path.getmtime(soul_path)) if os.path.isfile(soul_path) else 0,
            "skills": [s["name"] for s in skills if s["enabled"]],
            "skills_disabled": [s["name"] for s in skills if not s["enabled"]],
            "source": "default-profile" if n == "secretary" else "profile",
        }
        arr.append(item)
    return arr

def audit(action, name, extra=""):
    os.makedirs(os.path.dirname(AUDIT_LOG), exist_ok=True)
    with open(AUDIT_LOG, "a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S+08:00')}\t{action}\t{name}\t{extra}\n")

# ============ 自动化概览(只读 Cron/监控源, Batch 3) ============
CRON_JOBS_FILE = os.environ.get("WORKBENCH_CRON_JOBS",
                                os.path.join(HERMES_HOME, "cron", "jobs.json"))
MONITOR_REGISTRY = os.environ.get("WORKBENCH_MONITOR_REGISTRY",
                                  os.path.join(os.path.expanduser("~/hermes-company/monitoring"), "registry.yaml"))
_AUTOMATIONS_CACHE = {"mtime": None, "data": None, "source_ok": True}

def _issue_of(job):
    """按本机真实语义判定 has_issue/issue_summary; paused/completed 不算故障"""
    lde = job.get("last_delivery_error")
    if lde:
        return True, "执行成功，但消息送达失败"
    le = job.get("last_error")
    if job.get("state") == "error":
        return True, (le or "无法计算下次执行时间")[:160]
    if job.get("last_status") == "error":
        return True, (le or "执行失败")[:160]
    return False, ""

def _load_cron_jobs():
    """只读 jobs.json; 10s mtime 缓存; 失败返回 (None, False) 不伪装成空"""
    try:
        mt = os.path.getmtime(CRON_JOBS_FILE)
    except OSError:
        return None, False
    if _AUTOMATIONS_CACHE["mtime"] == mt and _AUTOMATIONS_CACHE["data"] is not None:
        return _AUTOMATIONS_CACHE["data"], True
    try:
        with open(CRON_JOBS_FILE, encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return None, False
    jobs = raw.get("jobs") if isinstance(raw, dict) else raw
    if not isinstance(jobs, list):
        return None, False
    out = []
    for j in jobs:
        if not isinstance(j, dict):
            continue
        # 脱敏: 仅输出白名单字段, 绝不透出 prompt/skills/script/origin/chat_id
        typ = "定时任务" if j.get("no_agent") is True else "自动化"
        has_issue, issue = _issue_of(j)
        out.append({
            "id": str(j.get("id") or ""),
            "name": str(j.get("name") or ""),
            "state": j.get("state"),
            "enabled": bool(j.get("enabled")),
            "type": typ,
            "schedule_display": j.get("schedule_display"),
            "next_run_at": j.get("next_run_at"),
            "last_run_at": j.get("last_run_at"),
            "last_status": j.get("last_status"),
            "has_issue": has_issue,
            "issue_summary": issue if has_issue else "",
        })
    _AUTOMATIONS_CACHE.update(mtime=mt, data=out, source_ok=True)
    return out, True

def _load_monitors():
    """只读监控 registry; 当前 registry 空则返回 []; 结构不符也不猜"""
    try:
        with open(MONITOR_REGISTRY, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except Exception:
        return []
    ms = data.get("monitors")
    if not isinstance(ms, list) or not ms:
        return []
    return ms  # 结构核实前不合并展示

def automations_payload():
    jobs, ok = _load_cron_jobs()
    monitors = _load_monitors()
    items = list(jobs or [])
    # 监控: registry 有登记才合并; 当前为空 → 不展示监控分类
    # (监控字段语义待核实, 本轮仅保留 hook)
    return {"source_ok": bool(ok), "automations": items, "monitors": []}

class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # 静默访问日志

    # ---------- helpers ----------
    def _prof_exists(self, name):
        return os.path.isdir(profile_home(name))

    def _wtoken(self):
        """从 Authorization: Bearer <token> 取写会话 token"""
        h = self.headers.get("Authorization") or ""
        return h[7:].strip() if h.startswith("Bearer ") else ""

    def _write_allowed(self):
        """写操作鉴权: 必须携带有效写会话 token"""
        t = self._wtoken()
        exp = SESSIONS.get(t)
        if exp and exp > time.time():
            return True
        if t in SESSIONS:
            del SESSIONS[t]  # 过期清理
        return False

    def _body(self):
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(ln) or b"{}")
        except Exception:
            return {}

    # ---------- GET ----------
    def do_GET(self):
        path = unquote(self.path.split("?", 1)[0]).rstrip("/")
        try:
            if path == "/api/v1/health":
                ok = os.path.isdir(PROFILES_DIR)
                return self._json(200, {"ok": ok, "profiles_dir": ok, "time": time.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
                                        "write_locked": True})  # 写锁状态由 /write-status 提供, health 保持轻量

            if path == "/api/v1/write-status":
                t = self._wtoken()
                unlocked = self._write_allowed()
                return self._json(200, {"ok": True, "data": {"unlocked": unlocked,
                                                             "expires_in": max(0, int(SESSIONS[t] - time.time())) if unlocked else 0}})

            # ---- Kanban 实时只读层 ----
            if path == "/api/v1/board":
                return self._json(200, {"ok": True, "data": board_payload()})

            if path == "/api/v1/automations":
                return self._json(200, {"ok": True, "data": automations_payload()})

            if path == "/api/v1/runs":
                return self._json(200, {"ok": True, "data": runs_payload()})

            if path == "/api/v1/events":
                m = re.search(r"[?&]after=(\d+)", self.path)
                after = int(m.group(1)) if m else 0
                m = re.search(r"[?&]before=(\d+)", self.path)
                before = int(m.group(1)) if m else 0
                order = "desc" if re.search(r"[?&]order=desc", self.path) else "asc"
                return self._json(200, {"ok": True, "data": events_payload(after, 200, before, order)})

            m = re.match(r"^/api/v1/tasks/([^/]+)$", path)
            if m:
                d = task_detail(m.group(1))
                if d is None:
                    return self._json(404, {"ok": False, "error": "task not found"})
                return self._json(200, {"ok": True, "data": d})

            if path == "/api/v1/stream":
                return self._sse()

            if path == "/api/v1/profiles":
                return self._json(200, {"ok": True, "data": profiles_payload()})

            m = re.match(r"^/api/v1/profiles/([^/]+)/soul$", path)
            if m:
                name = m.group(1)
                if not self._prof_exists(name):
                    return self._json(404, {"ok": False, "error": "profile not found"})
                p = os.path.join(profile_home(name), "SOUL.md")
                if not os.path.isfile(p):
                    return self._json(200, {"ok": True, "data": {"content": "", "sha256": "", "mtime": 0, "missing": True}})
                with open(p, encoding="utf-8") as f:
                    content = f.read()
                return self._json(200, {"ok": True, "data": {"content": content, "sha256": sha256_file(p),
                                                             "mtime": int(os.path.getmtime(p))}})

            m = re.match(r"^/api/v1/profiles/([^/]+)/skills$", path)
            if m:
                name = m.group(1)
                if not self._prof_exists(name):
                    return self._json(404, {"ok": False, "error": "profile not found"})
                return self._json(200, {"ok": True, "data": skill_list(name)})

            m = re.match(r"^/api/v1/profiles/([^/]+)/config$", path)
            if m:
                name = m.group(1)
                if not self._prof_exists(name):
                    return self._json(404, {"ok": False, "error": "profile not found"})
                cfg = load_yaml(os.path.join(profile_home(name), "config.yaml"))
                return self._json(200, {"ok": True, "data": {"model": model_of(name), "config": redact(cfg)}})

            return self._json(404, {"ok": False, "error": "not found"})
        except Exception as e:
            return self._json(500, {"ok": False, "error": str(e)})

    # ---------- POST (writes) ----------
    def do_POST(self):
        path = unquote(self.path).rstrip("/")
        try:
            # ---- 解锁/上锁(不要求已有 token) ----
            if path == "/api/v1/unlock":
                body = self._body()
                pw = str(body.get("password") or "")
                # 恒定时间比较, 防时序侧信道
                if _secrets.compare_digest(pw, WRITE_PASSWORD or ""):
                    token = _secrets.token_urlsafe(24)
                    SESSIONS[token] = time.time() + SESSION_TTL
                    audit("unlock", "workbench", "write session opened")
                    return self._json(200, {"ok": True, "data": {"token": token, "ttl": SESSION_TTL}})
                audit("unlock_fail", "workbench", "wrong password")
                return self._json(401, {"ok": False, "error": "密码错误"})

            if path == "/api/v1/lock":
                t = self._wtoken()
                if t in SESSIONS:
                    del SESSIONS[t]
                audit("lock", "workbench", "write session closed")
                return self._json(200, {"ok": True})

            # ---- 其余写操作全部要求已解锁 ----
            if not self._write_allowed():
                return self._json(423, {"ok": False, "error": "工作台处于只读模式, 请先解锁修改(输入密码)",
                                        "data": {"locked": True}})

            m = re.match(r"^/api/v1/profiles/([^/]+)/soul$", path)
            if m:
                return self._save_soul(m.group(1))

            m = re.match(r"^/api/v1/profiles/([^/]+)/skills/([^/]+)/enabled$", path)
            if m:
                return self._toggle_skill(m.group(1), m.group(2))

            return self._json(404, {"ok": False, "error": "not found"})
        except Exception as e:
            return self._json(500, {"ok": False, "error": str(e)})

    def _save_soul(self, name):
        if not self._prof_exists(name):
            return self._json(404, {"ok": False, "error": "profile not found"})
        body = self._body()
        content = body.get("content", "")
        base_sha = body.get("base_sha256", "")
        if not isinstance(content, str) or len(content.strip()) < 100:
            return self._json(400, {"ok": False, "error": "SOUL 内容过短(<100 字节), 已拒绝保存"})
        if len(content) > 200_000:
            return self._json(400, {"ok": False, "error": "SOUL 内容过长(>200KB), 已拒绝保存"})
        p = os.path.join(profile_home(name), "SOUL.md")
        cur_sha = sha256_file(p) if os.path.isfile(p) else ""
        if base_sha and base_sha != cur_sha:
            return self._json(409, {"ok": False, "error": "文件已被其他修改更新(base_sha 不匹配), 请刷新后重试",
                                    "data": {"current_sha256": cur_sha}})
        # 备份
        bk = os.path.join(BACKUP_DIR, name)
        os.makedirs(bk, exist_ok=True)
        if os.path.isfile(p):
            shutil.copy2(p, os.path.join(bk, f"SOUL.md.{time.strftime('%Y%m%d-%H%M%S')}"))
        # 原子写
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, p)
        new_sha = sha256_file(p)
        audit("soul_save", name, f"{cur_sha[:12]}->{new_sha[:12]}")
        # 返回完整对象: 前端用它更新缓存, 避免元数据响应覆盖掉 content/mtime
        return self._json(200, {"ok": True, "data": {"content": content, "sha256": new_sha,
                                                     "mtime": int(os.path.getmtime(p)),
                                                     "note": "SOUL 修改在员工下次会话启动时生效"}})

    def _toggle_skill(self, name, skill):
        if not self._prof_exists(name):
            return self._json(404, {"ok": False, "error": "profile not found"})
        if not re.match(r"^[A-Za-z0-9_-]+$", skill):
            return self._json(400, {"ok": False, "error": "非法 skill 名"})
        body = self._body()
        enabled = bool(body.get("enabled"))
        home = profile_home(name)
        src = os.path.join(home, "skills", skill)
        dst = os.path.join(DISABLED_DIR, name, skill)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            if enabled and os.path.isdir(dst):
                shutil.move(dst, src)
            elif (not enabled) and os.path.isdir(src):
                shutil.move(src, dst)
            else:
                return self._json(404, {"ok": False, "error": "skill 目录不存在(或状态已是目标状态)"})
        except Exception as e:
            return self._json(500, {"ok": False, "error": f"目录移动失败: {e}"})
        audit("skill_toggle", name, f"{skill}->{'enabled' if enabled else 'disabled'}")
        return self._json(200, {"ok": True, "data": {"skill": skill, "enabled": enabled,
                                                     "note": "skill 变更在员工下次会话启动时生效"}})

    def _sse(self):
        """SSE 事件流: hub 推送变化通知; 心跳保活; nginx 需对此路径关 buffering"""
        # chunked 流式响应需要 HTTP/1.1
        self.protocol_version = "HTTP/1.1"
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q = HUB.subscribe()
        try:
            # 初始 hello 告知当前游标(前端据此判断是否需要补取)
            try:
                db = _ro_connect()
                try:
                    cur = db.execute("SELECT COALESCE(MAX(id),0) FROM task_events").fetchone()[0]
                finally:
                    db.close()
            except Exception:
                cur = 0
            self.wfile.write(f"data: {json.dumps({'type':'hello','cursor':cur}, ensure_ascii=False)}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=15)
                    self.wfile.write(f"data: {json.dumps(msg, ensure_ascii=False)}\n\n".encode())
                except Exception:
                    msg = None
                # 每 15s 心跳注释行, 防中间层断开
                self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            HUB.unsubscribe(q)

if __name__ == "__main__":
    os.makedirs(BACKUP_DIR, exist_ok=True)
    os.makedirs(DISABLED_DIR, exist_ok=True)
    HUB.start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    print(f"workbench-api listening on 127.0.0.1:{PORT} (live board layer on)")
    srv.serve_forever()
