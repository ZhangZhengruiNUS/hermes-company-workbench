# Hermes Aurora — Phase B 验收报告 (B0–B11)

日期: 2026-09-20
交付版本: commit `fb17999` (bundle `assets/index-C8ApdwQp.js`)
部署位置: https://workbench.zgzwr.site/next/  (= /var/www/hermes-report/next/)
远端: origin/main = `a585049` (含 fb17999 实现 + B10 校验 + 验收截图)

## 验收结论

| 批次 | 判定 | 结果 |
|------|------|------|
| B0 基线/追溯 | PASS | 构建内嵌 SHA = `fb17999`；已 rebase 到 origin/main，无强推 |
| B1 看板视图 | PASS | 32/32（见 B1/B2/B8/B9）|
| B2 完成度统计 | PASS | 32/32（同上）|
| B3 事件 SSE 实时 | PASS | 29/29（B3–B7 全套）|
| B4 SSE 停滞恢复 | PASS | 29/29 |
| B5 分页期间插入 | PASS | 29/29 |
| B6 SSE↔轮询切换 | PASS | 29/29 |
| B7 子源失败容错 | PASS | 29/29 |
| B8 详情抽屉 + 深链 | PASS | 32/32 |
| B9 详情内容 | PASS | 32/32 |
| B10 生产鉴权共存 | PASS | 5/5（真实服务器）|
| B11 截图/响应式/无障碍 | PASS | 6/6 |

**总计: 72 项检查全部 PASS。**

## 各项明细

### B3–B7 脚本化交互套件 (fixture-acceptance.cjs → fixture-runner.cjs) — 29/29 PASS
用 fixture-server(mock /api + /_ctl + SSE)驱动真实 /next/ 构建：
- B3 SSE 实时事件推送、增量渲染
- B4 SSE 停滞(has_more 但游标不动)→ 客户端抛 "cursor stalled" 终止递归，无死循环，自动恢复
- B5 分页期间新事件插入 → 下一分页正确带上，无遗漏
- B6 SSE 断开 → 轮询降级 → 恢复
- B7 子源(automations/profiles)失败 → 该区域独立降级，主看板不受影响

### B1/B2/B8/B9 (verify-b1b2b8b9.cjs) — 32/32 PASS
驱动真实构建 vs 9 状态 + 未知状态 + 独立任务 + 项目基线：
- B1: 9 状态齐全 + 未知状态可见 + 无负责人独立任务 + 归档视图 + 搜索
- B2: 完成度统计(exec done=2, 归档不计入) + 无虚假 100% + 项目卡过滤
- B8: 有效/归档/无效 id 深链 + 无效 id 错误态(无白屏) + 前进/返回还原
- B9: 详情 body/result/runs/events/deps

### B10 生产鉴权 (verify-b10.cjs, 真实服务器) — 5/5 PASS
https://workbench.zgzwr.site/next/ ：
- /next/ 带 Basic Auth → HTTP 200, ref=assets/index-C8ApdwQp.js
- /next/ 无鉴权 → HTTP 401
- /api/v1/board 带 Basic Auth → 可读
- Basic Auth + X-Workbench-Write-Token 共存 → write-status 200
- 仅 Basic Auth → 可读但写锁定

### B11 截图/响应式/无障碍 (screenshot-b11.cjs) — 6/6 PASS
- 桌面(1440×900 深/浅色)看板列/列表/详情抽屉
- 移动(390×844)无水平溢出、触控目标 ≥44px、详情抽屉
- reduced-motion 尊重

## 验证过程中修复的真实缺陷
- 4.1: 未知状态任务此前在看板视图静默消失(仅建 9 状态列)→ 改为纳入数据中存在状态
- 4.2: 无效/不在板上的任务 id 此前静默渲染空 → 抽屉独立拉取并渲染 "任务不存在" 错误态

## 交付物
- 源码: web/src/pages/Tasks.tsx, web/src/components/TaskDetailDrawer.tsx, web/src/lib/live.ts, web/src/lib/board.ts, web/src/lib/api.ts, web/src/App.tsx
- 验收脚本: web/fixture-acceptance.cjs, web/fixture-server.cjs, web/fixture-runner.cjs, web/verify-b1b2b8b9.cjs, web/verify-b10.cjs, web/screenshot-b11.cjs
- 截图: web/screenshots/b3..b11*.png
- 部署备份: /var/www/hermes-report/next.bak.1789893952
