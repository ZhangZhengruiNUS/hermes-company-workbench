# 推送工具说明

`tools/push_via_api.py` — 本机网络环境下 github.com 的 git Smart HTTP 端点不可用时的等效推送通道，走 api.github.com 的 Git Data API。

## 为什么存在

GitHub Git Data API 创建 commit 时若不显式传 `parents` 字段，产生的 commit `parents=[]`（root commit）。这会导致远端历史断裂——即使文件内容与本地完全一致，Git 的可追溯性已经丢失（每个 commit 需重推全部 blob，历史不可 follow）。本工具**始终显式携带本地真实 parents**，并在 ref 更新前校验快进关系。

## 使用

```bash
export GITHUB_TOKEN=<token>      # 仅进程环境, 不要写入文件/URL/命令参数/日志
python3 tools/push_via_api.py    # 在仓库根目录执行
```

行为与保护：

- 幂等上传 blob（已存在自动跳过）→ 自底向上重建 tree → 创建 commit（**parents = 本地 HEAD 的真实父链**）
- ref 更新默认 **force=false**：远端 HEAD 不是本地 HEAD 的祖先（分叉/非快进）即报错停止
- 空仓自动经 contents API 解锁（GitHub 对空仓 Git Data API 返回 409）
- 永不删除仓库；不 `--force` 不改写远端已有提交

推送后自检（红线）：

```bash
git log --format="%H %P"          # 本地父链
curl -s https://api.github.com/repos/<owner>/<repo>/commits | jq '.[] | {sha, parents: [.parents[].sha]}'
# 两边 sha 与 parents 必须逐一对应
```
