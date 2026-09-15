# 开发与维护指南

## 唯一开发源

本仓库 (`~/hermes-company-workbench/`) 是**唯一**的持续开发源码目录。
线上运行的代码来自本仓库的部署产物；不再维护另一份独立演进的副本。

- 生产服务当前运行: `~/hermes-company/workbench/workbench_api.py`（systemd user 服务 workbench-api）
- 生产静态页: `/var/www/hermes-report/kanban.html`（本仓库 `build.py` 产物）
- 生产数据库与个人配置始终在仓库外（`~/.hermes/`），永不入库

## 修改 → 提交 → 部署 流程

1. **修改**：在本仓库改 `v5_template.html` / `workbench_api.py` 等
2. **测试**：
   - `python3 -m py_compile workbench_api.py`
   - `python3 build.py && node --check`（或浏览器打开产物确认无 JS 错误）
   - 需要真实数据验证时连本机只读库，但**不要**占用生产端口
3. **检查 diff**：`git diff` / `git add -p`，确认无密钥、无私人路径、无运行数据混入
4. **提交**：`git commit`（保持真实父链，本地历史即远端历史）
5. **推送**：本机 github.com 的 git Smart HTTP 端点被网络阻断，`git push` 不可用。使用本仓库自带的 API 推送工具（走 api.github.com）：
   ```bash
   export GITHUB_TOKEN=<your token>   # 仅进程环境, 不写入文件/URL/日志
   python3 tools/push_via_api.py      # 默认非快进即停止; --force 才覆盖(慎用)
   ```
   工具行为：幂等上传 blob/tree → 创建 commit **显式携带本地真实 parents** → ref 更新默认 force=false。不删除仓库、不改写远端已有提交。
6. **部署（独立步骤）**：把仓库产物复制到生产路径并重启 API 服务；部署失败不影响仓库历史

## 红线

- 不把生产编辑直接变成未经检查的公开提交
- `git add` 使用明确文件清单，禁止在混杂目录 `git add .`
- 任何含真实任务数据、服务器地址、个人信息的截图/文档不入库
- 上游 Hermes schema 变更后需回归验证 `/api/v1/board` 与游标语义
- **推送必须保留提交父链**：禁止用"文件内容相同"替代历史校验；每次推送后用 `git log` 与 API commits 接口核对 parents 一致
