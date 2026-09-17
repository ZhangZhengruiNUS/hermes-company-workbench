#!/usr/bin/env python3
"""push_via_api.py — 通过 GitHub Git Data API (api.github.com) 推送本地 main。

背景: 本机网络 github.com 的 git Smart HTTP 端点被阻, `git push` 不可用;
api.github.com 可达, 故用 Git Data API (blob→tree→commit→ref) 实现等效推送。
本脚本保留本地 commit 的完整元数据(含 parent 链), 保证推送后远端历史与本地一致。

用法:
  export GITHUB_TOKEN=<token>          # 不写入任何文件/URL/日志
  python3 push_via_api.py [--force]

行为:
  - 逐个上传本地 HEAD 可达的全部 blob/tree (幂等, 已存在自动跳过);
  - 重建 tree 链并创建 commit, **显式携带 parent=远端当前 main HEAD**(除非远端
    HEAD 已是本地历史中的祖先, 此时跳过);
  - ref 更新默认 force=false 非快进即报错停止; --force 才允许覆盖(慎用);
  - 不删除仓库、不改写远端已有提交。

依赖: 无第三方包, 需本机 git 与环境变量 GITHUB_TOKEN。
"""
import base64, json, os, subprocess, sys, urllib.request, urllib.error

REPO = os.environ.get("PUSH_REPO", "ZhangZhengruiNUS/hermes-company-workbench")
BRANCH = os.environ.get("PUSH_BRANCH", "main")
API = f"https://api.github.com/repos/{REPO}"
TOKEN = os.environ.get("GITHUB_TOKEN")
assert TOKEN, "need GITHUB_TOKEN in env"
FORCE = "--force" in sys.argv

def api(method, path, body=None):
    req = urllib.request.Request(f"{API}/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"token {TOKEN}", "Accept": "application/vnd.github+json",
                 "User-Agent": "workbench-push"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode() or "{}")

def run(*a):
    return subprocess.run(a, capture_output=True)

# ---- 本地状态 ----
local_head = run("git","rev-parse","HEAD").stdout.decode().strip()
local_log = run("git","log","--format=%H %P").stdout.decode().strip().splitlines()
parents_of = {}
for line in local_log:
    sha, _, p = line.partition(" ")
    parents_of[sha] = p.split() if p else []
print("local HEAD:", local_head[:8], "history depth:", len(local_log))

# ---- 远端状态 ----
remote_ref = api("GET", f"git/ref/heads/{BRANCH}")
remote_head = (remote_ref.get("object") or {}).get("sha")
print("remote main:", (remote_head or "none")[:8])
def remote_meta(sha):
    return api("GET", f"git/commits/{sha}")

diverged = bool(remote_head and remote_head not in parents_of and remote_head != local_head)
remote_baseline_local = None   # 远端 HEAD 对应的本地提交(sha 相等或 tree 等价)
if remote_head in parents_of or remote_head == local_head:
    remote_baseline_local = remote_head
if diverged:
    # 例外: 本地历史上曾被 API 断链推送(丢父链)过的提交, 远端 sha 与本地不同——
    # 通过 tree 匹配确认是否同一逻辑提交
    meta = remote_meta(remote_head) or {}
    local_equiv = None
    for sha in parents_of:
        if run("git","rev-parse",f"{sha}^{{tree}}").stdout.decode().strip() == ((meta.get("tree") or {}).get("sha") or ""):
            local_equiv = sha; break
    if local_equiv:
        print(f"remote {remote_head[:8]} 与本地 {local_equiv[:8]} 内容同源(tree 相同, 历史上被断链推送)")
        print("→ 作为初始发布基线接受: 本次提交将 parent 到该断链提交, 恢复连续性")
        diverged = False
        remote_baseline_local = local_equiv
    else:
        print(f"STOP: remote {remote_head[:8]} 无法与本地任何提交对应(tree 不匹配)。请人工比对。")
        sys.exit(2)

# ---- 空仓解锁 (GitHub 对空仓的 Git Data API 返回 409) ----
info = api("GET", "")
if info.get("size") == 0:
    readme = run("git","show","HEAD:README.md").stdout
    rr = api("PUT", "contents/README.md",
             {"message": "Initial commit (via contents API)", "content": base64.b64encode(readme).decode()})
    if not rr.get("commit"): print("unlock fail:", rr.get("message")); sys.exit(1)
    remote_head = rr["commit"]["sha"]
    print("empty repo unlocked, temp commit:", remote_head[:8])

# ---- 重建 tree (自底向上, GitHub tree API 要求 6 位 mode) ----
def parse_tree(sha):
    raw = run("git","cat-file","tree",sha).stdout
    items, i = [], 0
    while i < len(raw):
        sp = raw.index(b" ", i); nul = raw.index(b"\x00", sp)
        mode = raw[i:sp].decode(); name = raw[sp+1:nul].decode()
        osha = raw[nul+1:nul+21].hex(); i = nul + 21
        items.append((name, "040000" if mode == "40000" else mode,
                      "tree" if mode == "40000" else "blob", osha))
    return items

_tree_cache = {}
def push_tree(sha):
    if sha in _tree_cache: return _tree_cache[sha]
    items = [{"path": n, "mode": m, "type": t,
              "sha": push_tree(s) if t == "tree" else s}
             for n, m, t, s in parse_tree(sha)]
    r = api("POST","git/trees",{"tree": items})
    assert "sha" in r, r
    _tree_cache[sha] = r["sha"]
    return r["sha"]

# ---- 确定推送链: 从基线 commit 到 local_head 的本地提交序列 ----
# 基线 = remote_head 对应的本地提交(直接 sha 相等, 或 tree 相同的历史断链等价提交)。
# 若 remote_head 不在本地历史中且 tree 也不等价, 前面已 STOP。
chain = []          # 未推送的本地 commit, 按拓扑顺序(旧→新)
cur = local_head
while cur:
    if remote_head and cur == remote_baseline_local:
        break
    chain.append(cur)
    ps = parents_of.get(cur) or []
    cur = ps[0] if ps else None
chain.reverse()
if remote_head is None:
    # 空仓: 全部历史都要推; 但 contents 解锁的临时 commit 不在本地历史, 作为唯一 parent
    chain = [local_head]
if not chain:
    print("remote already up to date")
    sys.exit(0)
# 检查链是否被断链等价提交打断: 若链中某提交的 parent 不在本地历史(不可能, parents_of 覆盖全部)
print(f"commits to push: {len(chain)}")
for sha in chain:
    print("  ", sha[:8], run("git","log","-1","--format=%s",sha).stdout.decode().strip()[:60])

# ---- 上传 blob ----
# 逐 commit 链式推送时, 每个未推送 commit 的树都可能引用 HEAD 树中已被覆盖的旧 blob
# (如同名文件在后续 commit 被改写)。因此必须上传链上全部 commit 树的 blob 并集。
# (blob API 幂等, 已存在的 sha 上传返回相同 sha)
need_blobs = set()
ls = run("git","ls-tree","-r",local_head).stdout.decode()
for line in ls.strip().splitlines():
    meta, path = line.split("\t", 1)
    mode, otype, sha = meta.split()
    need_blobs.add(sha)
for sha in chain:
    tsha = run("git","rev-parse",f"{sha}^{{tree}}").stdout.decode().strip()
    ls = run("git","ls-tree","-r",tsha).stdout.decode()
    for line in ls.strip().splitlines():
        mode, otype, bsha = line.split()[0:3]
        need_blobs.add(bsha)
entries = sorted(need_blobs)
for sha in entries:
    content = run("git","cat-file","blob",sha).stdout
    r = api("POST","git/blobs",{"content": base64.b64encode(content).decode(), "encoding": "base64"})
    if r.get("sha") != sha:
        print(f"blob mismatch {sha[:8]}"); sys.exit(1)
print(f"blobs ok: {len(entries)}")


# ---- 逐个创建远端 commit: parent 指向前一个对应远端 commit ----
# remote_head 可能为空(空仓)或为基线远端 sha; 断链等价场景 parent=remote_head(远端真实 sha)
base_parent = remote_head
new_remote_shas = []
prev_remote = base_parent
for sha in chain:
    rtree = push_tree(run("git","rev-parse",f"{sha}^{{tree}}").stdout.decode().strip())
    msg = run("git","log","-1","--format=%B",sha).stdout.decode()
    an = run("git","log","-1","--format=%an",sha).stdout.decode().strip()
    ae = run("git","log","-1","--format=%ae",sha).stdout.decode().strip()
    ad = run("git","log","-1","--format=%aI",sha).stdout.decode().strip()
    body = {"message": msg, "tree": rtree,
            "author": {"name": an, "email": ae, "date": ad},
            "committer": {"name": an, "email": ae, "date": ad}}
    if prev_remote:
        body["parents"] = [prev_remote]
    r = api("POST","git/commits", body)
    if "sha" not in r:
        print(f"commit fail for {sha[:8]}:", r.get("message")); sys.exit(1)
    print("commit:", sha[:8], "->", r["sha"][:8],
          "parents:", [p["sha"][:8] if isinstance(p, dict) else p[:8] for p in r.get("parents", [])])
    new_remote_shas.append(r["sha"])
    prev_remote = r["sha"]

# ---- ref 更新: 默认非快进拒绝 ----
final_sha = new_remote_shas[-1]
if remote_head is None:
    rr = api("POST","git/refs",{"ref":f"refs/heads/{BRANCH}","sha": final_sha})
    print("ref created:", rr.get("ref") or rr.get("message"))
elif remote_head == final_sha:
    print("ref already at target")
else:
    # 快进判定: 远端 HEAD 必须是新链首个 commit 的 parent(已建立连续性), 或在本地历史中
    first_parents = [p["sha"] if isinstance(p, dict) else p
                     for p in (api("GET", f"git/commits/{new_remote_shas[0]}").get("parents") or [])]
    is_ff = remote_head in first_parents or remote_head in {l.split()[0] for l in local_log}
    if not is_ff and not FORCE:
        print(f"STOP: non-fast-forward (remote {remote_head[:8]} not parent of new chain head). 用 --force 才覆盖。")
        sys.exit(3)
    u = api("PATCH",f"git/refs/heads/{BRANCH}",{"sha": final_sha, "force": bool(FORCE)})
    got = (u.get("object") or {}).get("sha")
    print("ref updated:", got[:8] if got else u.get("message"))
    if got and got != final_sha: sys.exit(1)

print("PUSH DONE")
