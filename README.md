# hermes-company-workbench

面向 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 的**第三方 AI 团队工作台**——把 Hermes Kanban（任务/项目/依赖/运行证据）和员工 Profile 配置（SOUL/Skills）放进一个带实时推送的单页控制台。

> 本项目**不是 Hermes 官方产品**，与 Nous Research 无隶属关系。数据完全来自本机 Hermes 数据目录，只读为主，写操作受密码锁保护。

## 主要功能

- **实时看板**：任务总览/看板/列表三视图，任务状态变化经 SSE 在 ~2 秒内自动上屏，无需刷新
- **项目管理**：项目=围绕明确目标的一组任务；归属唯一真相是 `task.project_id`；独立任务（无项目）可筛选
- **依赖链**：任务详情显示"上游依赖 / 后续任务"（对应 Kanban 的 parent → child 依赖：父任务全部完成后子任务才具备推进条件）
- **活动流**：真实 `task_events` 事件流（heartbeat 已过滤），按事件游标增量拉取
- **团队页**：9 类员工头像、当前运行证据（task_runs）、工作量统计
- **员工配置编辑**：SOUL.md 在线编辑（密码解锁 → 备份+原子写+sha256 乐观锁），skill 启停用（mv 不删除），全程审计日志
- **降级兜底**：SSE 断线自动重连（3s），退化为 10s 轮询，页面状态灯四态明确显示

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3 标准库（`http.server.ThreadingHTTPServer` + sqlite3），无第三方运行时依赖 |
| 前端 | 单文件原生 HTML/CSS/JS（无框架、无构建链），`build.py` 仅做拼装与占位断言 |
| 实时 | SSE（后端单巡检线程 1.5s 扫 `task_events`，集中广播） |
| 反代 | nginx（SSE 路径需关缓冲，见 `deploy/nginx.conf.example`） |

## 架构

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。要点：

- **数据源**：`~/.hermes/kanban.db`（任务真相源）、`~/.hermes/projects.db`（项目实体）、`profiles/`（员工配置）——全部 SQLite `mode=ro` 只读短事务访问
- **实时更新**：API 后端单线程巡检 `task_events`，事件游标（自增 id）断线补取；前端单连接，失败降级轮询
- **归属模型**：任务可属于项目（`project_id` 非空）或独立（空）；`task_links` 只表示依赖，不表示项目归属
- **编辑边界**：写接口只覆盖员工配置文件（SOUL/skills），**不写** Kanban/项目数据库；任务与项目的变更走 Hermes 官方 CLI，页面实时跟随

## 安装启动

依赖：Python 3.9+（仅标准库）、nginx（可选，用于公网/多端访问）。

```bash
# 1. 构建前端单文件
python3 build.py                       # 产物 kanban.html

# 2. 配置（可选, 全部有默认值）
cp .env.example .env                   # 按需修改后 source .env

# 3. 启动 API（默认 127.0.0.1:8081）
python3 workbench_api.py

# 4. 静态托管 kanban.html（任意静态服务器, 需把 /api/ 反代到 8081）
#    本机快速预览(含反代):
python3 deploy/preview_server.py       # http://127.0.0.1:8902/kanban.html
```

生产部署参考 `deploy/nginx.conf.example`（注意 SSE location 必须关缓冲）。

## 配置

所有配置经环境变量（见 [.env.example](.env.example)）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `WORKBENCH_HERMES_HOME` | `~/.hermes` | Hermes 数据目录 |
| `WORKBENCH_PORT` | `8081` | API 监听端口（仅绑定 127.0.0.1） |
| `WORKBENCH_WRITE_PASSWORD` | 未设则自动生成 | 写解锁密码；自动生成时写入 `<home>/backups/workbench_write_password`(0600) |

**没有可用的默认密码**——未设置时自动生成随机密码且只打印到服务端日志。

## 已验证的 Hermes 版本

- Hermes Agent 本机安装（CLI `hermes kanban …`），数据 schema 验证于 **2026-09**（kanban.db 含 `tasks/task_events/task_runs/task_links` 表，`task_events` 无 `event_type` 列、以自增 id 为游标）
- **不声称支持所有 Hermes 版本**——上游 schema 变更（如表结构、游标语义）可能需要同步修改，欢迎提 issue 反馈版本兼容性

## 已知限制

- 任务/项目数据**只读**：变更需通过 Hermes 官方 CLI（`hermes kanban …`），页面实时跟随但不提供反向写
- `projects.db` 若为空，项目页如实显示"暂无项目"；不自动虚构关联
- 无认证的多用户/公网暴露需自行在 nginx 层加访问控制；写操作自带密码锁+审计
- 员工头像未随仓库分发（`assets/avatars/` 为占位目录），部署时自备
- 单机单实例设计，未做水平扩展

## License

MIT（见 [LICENSE](LICENSE)）。Hermes Agent 本身遵循其自有许可。
