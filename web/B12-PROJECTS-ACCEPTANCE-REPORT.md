# Hermes Aurora — Phase C · B12 项目页 验收报告

日期: 2026-09-21
LOCAL_SOURCE_SHA: `a7f0c1b`  REMOTE_SOURCE_SHA: `dc0099e`  (与本卡基线一致)
交付版本: commit `d6a880e3` (bundle `assets/index-B1JVgk8N.js`); 远端 origin/main 推送至 `bc012eb0` (parent `dc0099ed`, 与本地 a7f0c1b tree 等价, 连续)
部署位置: https://workbench.zgzwr.site/next/
验收驱动: fixture-server(mock /api + /_ctl + SSE) → 真实 /next/ 构建 (web/dist)

## 验收结论

| 批次 | 判定 | 结果 |
|------|------|------|
| B12 项目页验收 (verify-projects.cjs) | PASS | 29/29 |
| 回归 B1/B2/B8/B9 (verify-b1b2b8b9.cjs) | PASS | 32/32 |
| 回归 B3–B8 (fixture-runner.cjs) | PASS | 48/48 (B3–B7 29/29 包含其中) |
| 构建 + 静态检查 | PASS | `tsc -b && vite build` 0 error; oxlint 0 error |

## B12 项目页明细 (verify-projects.cjs) — 29/29 PASS

驱动真实构建 vs `projScenario` 夹具 (每个场景确定性重建 tasks/projects/events):

- error (`projects_ok=false`) — 显「项目数据源不可用 · 数据库连接失败」，**不伪装成「暂无项目」/正常**
- empty — 显「暂无项目」
- notasks — 有项目但 0 任务：显「暂无任务」，**不渲染进度条/「共 N 个任务」徽章**
- alldone — `done>0 且 done===未归档 && 未归档>0` → 「关联任务已全部完成 · 历史归档 1 项」，公式 title = `完成 2 / 未归档 2`，页面**不出现「100%」**
- mixed — 徽章计数与 mock 一致（待办 1 / 就绪 1 / 进行中 1 / 阻塞 1 / 完成 2），进度文案「当前任务: 2/6 已完成」，公式 title = `完成 2 / 未归档 6`，阻塞徽章出现
- jump — 点「查看本项目任务」→ hash 变为 `#tasks?project=proj_gamma` 且任务页过滤生效（当前工作含 Gamma 待办/就绪/运行，排除 done）
- light 1440 / mobile 390 / reduced-motion — 无横向溢出、触达目标 ≥44px、reduced-motion 正常渲染

## 回归

- B1/B2/B8/B9 (verify-b1b2b8b9.cjs) — 32/32 PASS（看板/完成度/详情抽屉/深链不受影响）
- B3–B8 (fixture-runner.cjs) — 48/48 PASS（事件实时/停滞恢复/分页插入/SSE↔轮询/子源容错/乱序完成；B3–B7 核心 29 项全绿）

## 变更文件

- 新增 `web/src/pages/Projects.tsx` — 项目库 quick-view 卡片页（错误/空/无任务/全完成/混合态 + 进度公式 + 徽章 + 最近活动 + 跳转过滤）
- 修改 `web/src/App.tsx` — `view==="projects"` 渲染 `<Projects/>`，团队/活动页保留迁移占位
- 修改 `web/src/index.css` — 修复 L75 `--color-accent-violet: --accent-violet;` 缺 `var()` 的 bug
- 修改 `web/fixture-server.cjs` — 新增 `applyProjScenario()` + `/_ctl/projScenario?name=` 场景控制
- 新增 `web/verify-projects.cjs` — B12 验收脚本（驱动 Playwright + 截图）
- 截图: `web/screenshots/b12-projects-{error,empty,notasks,alldone,mixed,jump-filter,light}-*.png`, `b12-projects-dark-390.png`, `b12-projects-reduced-motion.png`

## 说明

- 徽章配色沿用 v5_template L1690–1749 语义：待办/归档 `--text-3`，就绪 `--accent-cyan`，进行中 `--accent-blue`，阻塞 `--status-red`，完成 `--status-green`。
- 最近活动行用 `useLiveEvents()`（live.ts ACT_EVENTS 池）按 task→project 归属过滤，无可用事件显「—」，不报错。
