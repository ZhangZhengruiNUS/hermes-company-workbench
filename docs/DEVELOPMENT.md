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
4. **提交并推送**：`git commit && git push` —— GitHub 是版本记录
5. **部署（独立步骤）**：把仓库产物复制到生产路径并重启 API 服务；部署失败不影响仓库历史

## 红线

- 不把生产编辑直接变成未经检查的公开提交
- `git add` 使用明确文件清单，禁止在混杂目录 `git add .`
- 任何含真实任务数据、服务器地址、个人信息的截图/文档不入库
- 上游 Hermes schema 变更后需回归验证 `/api/v1/board` 与游标语义
