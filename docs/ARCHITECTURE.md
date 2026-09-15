# 架构说明

## 总体形态

```
浏览器 ──HTTP── nginx(8080) ─┬─ 静态: kanban.html + avatars/
                             └─ /api/ 反代 ── workbench_api.py(127.0.0.1:8081)
                                               ├─ kanban.db   (mode=ro, 只读)
                                               ├─ projects.db (mode=ro, 只读)
                                               ├─ profiles/   (读: 全员; 写: 仅配置文件)
                                               └─ EventHub ── SSE /api/v1/stream
```

## 真实数据源

| 数据 | 来源 | 访问方式 |
|---|---|---|
| 任务/统计/活动 | `kanban.db`: `tasks`, `task_events`, `task_runs`, `task_links` | SQLite `file:...?mode=ro` 短事务 |
| 项目实体 | `projects.db`: `projects` | 同上; 空库时项目页显示"暂无项目" |
| 员工/配置 | `~/.hermes/profiles/<name>/` | 读 SOUL/skills/config; 写仅 SOUL/skills 启停 |
| 运行证据 | `task_runs` (status='running' AND ended_at IS NULL) | 团队页"进行中" |

历史包袱处理: 旧版前端曾用构建期快照注入(`v5_data.json`/`__KANBAN_DATA__`), 实时化后已废弃——`build.py` 对残留占位符做断言, 页面全部数据来自运行期 API。

## 实时更新

- 后端 `EventHub`: 单一巡检线程每 1.5s 扫 `task_events` 的自增 id, 有新事件即广播给所有 SSE 订阅者(不是每个浏览器各自扫库)
- 前端单条 SSE 连接; 事件游标(`after=<id>`)用于断线补取
- 降级链: SSE →(断线 3s 重连)→ 10s 轮询 → 页面状态灯显示"秒级同步/降级轮询/正在重连/读取失败"
- `heartbeat` 类高频事件在后端过滤, 不进入页面事件流

## 任务 / 项目 / 依赖关系

- **项目归属唯一真相** = `task.project_id`; 空 = 独立任务。不使用标题相似度自动关联
- **`task_links` 只表示依赖** (parent → child): 父任务全部完成后子任务才具备推进条件。它不表达项目归属
- **统一统计口径**: 完成率 = done / 未归档任务总数; archived 单独计; 无任务显示"暂无任务"而非 100%; 任务全部 done 只表示"关联任务已全部完成", 不等于项目验收
- 项目页/总览/任务页共用同一 `projStats()` 实现, 不存在两套口径

## 员工配置编辑边界

- 写接口覆盖: SOUL.md 保存(备份→原子写 tmp→`os.replace`→sha256 乐观锁, `base_sha` 不匹配返回 409)、skill 启停用(mv 到 disabled 目录, 不删除)
- **永不写** kanban.db / projects.db; 任务与项目的变更走 Hermes 官方 CLI, 页面只读跟随
- 写操作流程: 前端密码解锁(POST /api/v1/unlock)→ 2h token → 携带 token 写 → 服务端审计日志
- 前端默认只读灰置, 顶栏锁按钮切换; 未解锁写请求返回 423

## API 一览

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/v1/health` | GET | 健康检查 |
| `/api/v1/board` | GET | 任务+统计+项目+事件游标(单一短事务保证口径一致) |
| `/api/v1/events?after=N` | GET | 增量事件(过滤 heartbeat) |
| `/api/v1/tasks/<id>` | GET | 任务详情(含 runs/events/upstream/downstream) |
| `/api/v1/runs` | GET | 当前运行证据 |
| `/api/v1/profiles` | GET | 员工列表 |
| `/api/v1/profiles/<n>/soul` | GET/POST | SOUL 读/写(写需 token) |
| `/api/v1/unlock` / `lock` | POST | 写锁开/关 |
| `/api/v1/stream` | GET | SSE 事件流 |
