# Aurora Workbench — 全站鼠标柔光改造规格

版本：1.0  
审计日期：2026-09-22  
审计基线：`1b1a37b2dcf980608ca919958315ae0354c8dcfd`（GitHub main，本次读取值）  
仓库：`ZhangZhengruiNUS/hermes-company-workbench`

> 用户已喜欢现有鼠标经过项目卡、团队概览、最近动态时的淡蓝白柔光。本轮只将这一效果扩展为全站一致的交互材质，不重做 Aurora 风格、不改变布局或业务功能。
>
> 本文的“现状”来自固定提交的静态源码审计及用户截图；不是对受 Basic Auth 保护的线上站点完成了动态验证。施工者必须在真实构建中复现和验收。

## 1. 现状与根因

### 1.1 当前是组件局部光效，不是全局光效

`web/src/components/PrismCard.tsx`：

- `onMouseMove` 只安装在 PrismCard 根节点。
- 根据 `clientX/Y - getBoundingClientRect().left/top` 计算卡片内坐标。
- 写入该节点的 `--mx` / `--my`。

`web/src/index.css`：

- `.prism-card::after` 绘制 `260px circle` 的 radial-gradient。
- 中心颜色为 `rgba(110, 168, 255, 0.20)`，至 `65%` 渐隐。
- 默认 `opacity:0`，仅 `.prism-card:hover::after` 显示。
- `.cmd-glass::before` 是固定方向高光，不是跟随鼠标的光斑。
- `.quiet-surface` 没有同等指针响应。

因此，顶部 ExecutiveStrip、Topbar、Sidebar、空状态、部分任务表格与 Drawer 没有同等跟随光效，不是随机失效。

### 1.2 附带发现：颜色变量不能直接拼 alpha 后缀

`Overview.tsx` 的 ExecutiveStrip 有 `${c.color}88`、`${c.color}1f`、`${c.color}66` 等写法；其中 c.color 实际是 `var(--accent-blue)` 这类表达式。

`PrismCard.tsx` 中 Capsule 也有 `borderColor: color + "44"`。

这会构成 `var(--accent-blue)88` 一类无效的最终颜色值。需在涉及的光效/边框调用中做最小修正，例如：

```css
color-mix(in srgb, var(--accent-blue) 20%, transparent)
```

也可使用已有 RGB 通道 token。不要全仓改造颜色系统。验收检查解析后的 computed style，不能只检查源码字符串或带 var() 的 CSS.supports 返回值。

## 2. 目标效果

目标是“鼠标经过哪里，哪里的材质都有柔和回应”，不是“只有部分卡片能亮”。

- 保留当前淡蓝白光色、柔边和大致强度，不改为霓虹灯圈。
- 覆盖五个主页面、Sidebar、Topbar、统计条、搜索/筛选容器、两种 Drawer。
- 页面间隙提供更弱的背景柔光，让跨区域移动不显得断裂。
- 全局可用不等于所有组件同时照亮：默认只让当前命中的主要表面响应，离开的表面淡出。
- 鼠标停住后光斑稳定；不持续呼吸、不闪烁、不跟随出长尾。
- 不改变原鼠标形状，不做自定义光标。
- 空状态也可以有弱材质反射，但不得被表现成运行、健康或异常状态。

## 3. 实现方案：一个输入源，两种绘制层

### 3.1 全局控制器

建议新增一个小型模块，例如 `web/src/lib/pointerLight.ts`，在 App 中只初始化一次，放在随路由 key 变化的页面容器之外。

采用最小实现：

1. 单个 `document` 级原生 `pointermove` 监听，记录最后一次视口坐标；事件委托识别表面。
2. 指针坐标存 ref/普通变量，不放入业务 React state/context，不触发整页重渲染。
3. `requestAnimationFrame` 合并同一帧的更新；不为每个卡片建立独立无限循环。
4. 用显式 `data-pointer-light` 标记需要响应的主要表面；事件目标向上找最近的标记容器即可，不在每次移动时全 DOM 遍历。
5. 嵌套表面只激活最内层有效宿主，避免外卡、内行、badge 三重光斑叠亮。
6. 仅更新当前宿主与正在淡出的上一宿主，以及一块背景柔光层。
7. listener / RAF 在卸载时清理；React Strict Mode、反复路由切换不得重复注册。

不需要新增 UI 库、Canvas、WebGL、全局状态管理库、消息机制或复杂光照引擎。

### 3.2 第一层：页面背景柔光

在现有 Aurora 背景中加入一个低强度、固定视口坐标的柔光节点。

- 位于主要内容之下，不放在高 z-index 上盖住所有文字。
- 只负责页面间隙和背景连续感。
- 保留现有极光动画，不继续调高全局极光强度。
- 优先移动一个有固定尺寸的渐变层，而不是每帧重画整屏巨大渐变。
- 初始未接收到有效指针位置时隐藏，不在左上角或页面中央凭空显示灯斑。

仅增加这一层不够：现有 Quiet Surface 和部分项目底色不透明，光会被挡住，所以必须配合局部表面层。

### 3.3 第二层：各材质的局部反光

新增可复用的轻量光效绘制层，例如 `PointerLightLayer`。标记及名称可按现有结构微调。

可用的语义标记示例：

```text
data-pointer-light="glass"  导航、工具栏、统计条、普通卡片
data-pointer-light="quiet"  空状态、长文本/表格的主容器
data-pointer-light="off"    明确不参与的子区域
```

光斑中心用相同的全局指针位置换算为宿主局部坐标：

```text
localX = clientX - rect.left
localY = clientY - rect.top
```

注意宿主边框原点差异，画布与坐标保持一致；若使用局部缩放的宿主须正确换算，不能把缩放前后的坐标混用。本轮不增加卡片 scale/tilt 动画。

实现约束：

- 光效视觉上位于宿主底色之上、正文/图标/输入内容之下。
- 光层 `aria-hidden`、`pointer-events:none`，不设置 tabindex，不参与命中/选择/表单操作。
- 只裁剪光层到当前圆角，不为加光效给所有宿主统一添加 overflow:hidden。
- 光层本身可 absolute；宿主原有 relative/sticky/fixed/absolute 由原组件保持。
- 禁止给 `.cmd-glass` 或新的通用光效类重新写全局 `position:relative`。
- 不给所有子元素全局补 position/z-index；按实际宿主做最小、明确的层叠处理。
- 不改变既有 Flex/Grid 子项关系、padding、width、height、transform。
- `.cmd-glass::before` 的静态折射与原 PrismCard 跟随层不能重复覆盖同一伪元素。统一迁移/替换旧鼠标高光实现，只保留一个跟随光斑。
- 不把所有表面替换成 PrismCard；不要顺带让导航、表格、空状态都继承卡片 hover 抬升。

## 4. 全站接入清单

| 区域 | 最小接入方式 | 必须保持 |
|---|---|---|
| Sidebar | 主要玻璃表面接入；导航保留当前选中态 | sticky / 手机 fixed、焦点和点击 |
| Topbar | 命令栏接入；搜索壳可较弱响应 | sticky、搜索输入、锁状态、主题切换 |
| ExecutiveStrip | 整条统一光照，不对五格重复叠灯 | 手机两列/项目跨行，桌面五格 |
| 当前推进、需关注 | 内容表面均可响应；空状态使用 quiet 强度 | 真实业务语义，不制造“有任务/健康” |
| 总览项目/自动化/团队/动态 | 旧 PrismCard 高光迁入公共层，保留视觉味道 | 统计、缓存状态、事件顺序、头像 |
| Tasks 看板 | 任务卡或明确的列内表面接入，不给每个 badge 单独一盏灯 | 水平滚动、截断、筛选、深链 |
| Tasks 列表 | 列表主容器弱反光，与原 row hover 协调 | sticky header、行点击、文字选择 |
| Team | 成员卡、组织面板、tab 控制容器 | 分组、默认模型 chip、打开抽屉 |
| Projects | 项目卡、控制区域 | 进度/状态语义及跳转 |
| Activity | 事件列表主容器弱反光 | 历史分页、SSE插入、滚动不跳 |
| Task/Team Drawer | 共享 DrawerShell 中接入，同一输入源 | Portal、全高贴右、遮罩、锁滚与焦点 |
| Dropdown/搜索框等 | 给已有外壳接入；不依赖原生 input/select 的伪元素 | 可输入、可选择、可关闭 |
| 页面间隙 | 背景柔光 | 不覆盖模态遮罩，不制造假交互 |

不要求每个文字节点、状态点、头像都独立注册光效。统一的父容器光照已能覆盖这些区域。

## 5. 路由、滚动与 Portal

- 用户切换总览/任务/团队/项目/活动后自动生效，无需手动刷新。
- `DrawerShell` 当前 `createPortal(..., document.body)`；不能把 DOM 命中查找限制在 #root 内。
- 建议 document 级输入监听；React Portal 保留 Context/React 事件传播，但 CSS 继承仍取决于真实 DOM 位置，不能假定 #root 上的变量自然传入 body 下的面板。
- Drawer 打开时只激活最上层可交互区域；光不穿透遮罩“点亮”背后的任务卡。背景灯可暂时淡出，面板继续响应。
- 页面滚动、抽屉内部滚动、resize、路由切换完成、抽屉开关时要更新目标和几何位置。指针没动但内容滚过来也应对准。
- 可使用缓存的 clientX/Y + elementFromPoint 重新命中，再调用同一更新函数；不要只依赖最初 mousemove 的 event.target。
- 遇到过渡动画引起几何变化时，在实际可见稳定节点上更新，不长期依赖过期 rect。
- pointerleave 页面、window blur、页面隐藏、pointercancel：清理激活表面并淡出，不残留一团光。
- viewport 与局部坐标不可混用 pageX/clientX；不得为了重新定位光斑改动 Drawer 外壳。

## 6. 视觉参数建议（起点，按实测调整）

| 对象 | 建议起点 |
|---|---|
| 标准深色卡片 | 优先沿用当前 260px radius、淡蓝白 alpha 0.20 的味道 |
| 导航/统计条 | 与卡片统一色相，强度约标准卡片的 70%–90% |
| 空状态/密集表格/正文容器 | 约标准卡片的 35%–55%，保持可感知 |
| 页面间隙背景 | 半径约 360–480px，alpha 约 0.025–0.045 |
| 深色渐变色心 | 当前淡蓝白为基准，不引入第二套彩虹色 |
| 浅色主题 | 低强度冷蓝灰反光，不是纯白光洗白页面 |
| 淡入/淡出 | 约 150–220ms，不拖尾 |
| 跟随 | 默认紧跟；可有极短平滑，但不出现明显惯性长尾 |

数值不是验收替代物。不能以“CSS变量有变化”代替眼睛实际看得到柔光，也不能靠提高亮度到影响文字来凑效果。

## 7. 性能及无障碍边界

- `(hover:hover) and (pointer:fine)` 时启用；按实际 pointerType 排除 touch。触摸设备不做点击残留光斑。
- `prefers-reduced-motion:reduce` 时关闭跟随移动和背景指针光，保留普通静态 hover/focus 反馈。
- 页面隐藏时暂停/清理；鼠标停止且淡入/淡出收敛后不持续运行本模块 RAF。
- 按帧合并输入，先读 geometry 再写 CSS 变量，避免多次交错读写。
- 不随每个 pointermove 全局查找/测量所有任务卡或整个 DOM。
- 不用 React setState 逐帧更新鼠标坐标；不重置 SSE、不触发 API refresh。
- 不对 body/#root 整体设置为光效服务的 transform/filter/will-change，避免新定位/层叠副作用。
- 背景动画、渐变重绘、blur 并非免费；用浏览器 Performance 简单比较开启前后，若明显卡顿则减半径/绘制范围，不增加引擎。

## 8. 验收：必须看“动起来”，不是只看 DOM

### 8.1 开发侧针对性检查

1. 总览连续移动路径：侧栏 → 顶栏 → 五指标 → 当前推进空态 → 需关注空态 → 项目 → 团队 → 动态。全部有对应反光，无悬停闪跳或边界残影。
2. 任务/团队/项目/活动各至少一处真实内容表面有效；路由来回切换不重复注册监听。
3. 抽屉分别在页顶和滚动后打开，光跟鼠标正确定位；进入面板不点亮遮罩后的卡片。
4. 鼠标固定、页面/抽屉滚动及窗口改宽后光斑对准；SSE 更新插入内容不导致卡片光坐标长期错位。
5. 点击卡片、输入搜索、切筛选、选择文字、按Esc、Tab焦点、抽屉锁滚等不受光层拦截。
6. 深/浅色各检查1440桌面；390触摸和 reduced-motion 模式确认无指针灯残留、布局无变化。
7. 加光前后比较 Drawer/Topbar/Sidebar/ExecutiveStrip 的 computed position 和 rect；复用现有 geometry harness，不能重现定位及溢出缺陷。
8. 标准卡片内部“鼠标远端/近端”至少两个位置截图可见变化；测试截图可临时冻结 ambient 动画以排除无关像素差。
9. 修复 var+alpha 拼接后验证最终 computed shadow/border/background 值；不只看无console error。
10. 原有业务 smoke（导航、任务深链、筛选、SSE、编辑鉴权）按受影响范围跑；本轮不重跑全部历史故障套件。

### 8.2 独立 reviewer

Reviewer 不得引用开发者 PASS 代替操作。亲自沿上述路径移动指针，检查实际光斑、文本、模态层级和滚动。

交付一段短录屏（优先，20–40秒即可）覆盖总览上半部、另一个页面、一个Drawer；不能录屏时提供明确指针坐标下的前后对比截图。不得包含凭据/Token。

如发现漏接区域、坐标不准、文字被漂白、几何变化或点击受阻，退回定点修复，不重做视觉方向。

## 9. 发布及长期规则

- 核对当前本地/远端/正式部署基线，不用本文旧SHA覆盖之后的新提交。
- 新版正式入口是 `/`。2026-09-24 Aurora 环境收敛后 /next/ 预览入口已降级为短期只读 redirect(nginx return 302 /)，不再作为开发部署目标。
- 不复制私人凭据或改变nginx/HTTPS/认证模型。不得重开8080。
- 本轮仅前端光效相关文件及测试/文档；不改DB、后端、live数据语义、任务状态和统计。
- 记录源码SHA、构建base及产物，不能仅因文件名相同就认为部署一致。
- Reviewer PASS 后交用户看动效，再按现有发布流程切正式版。

在已有共享UI checklist补充一个简短段落，同时让frontend/reviewer各自的Quality Gate引用或幂等合并，避免另造一套长文：

> 跨站装饰效果必须覆盖所有主要材质及Portal；不得改变宿主position/overflow/transform；不得拦截交互；检查动态坐标、滚动、嵌套强度、减少动态模式和CSS最终计算值；review必须实际移动指针而不只验DOM或截图已生成。

## 10. 最终报告

```text
【Aurora Global Pointer Light】
BASELINE_SHA=
IMPLEMENTATION=
OVERVIEW_FULL_COVERAGE=
FIVE_PAGES=
SIDEBAR_TOPBAR_METRICS=
QUIET_SURFACES=
DRAWER_PORTAL=
SCROLL_RESIZE_ALIGNMENT=
NESTED_SURFACE_POLICY=
COLOR_ALPHA_FIX=
LAYERING_AND_READABILITY=
POINTER_INTERACTION=
PERFORMANCE=
TOUCH_AND_REDUCED_MOTION=
GEOMETRY_REGRESSION=
REVIEWER_RESULT=
MOTION_EVIDENCE=
QUALITY_RULE_UPDATED=
LOCAL_SOURCE_SHA=
REMOTE_SOURCE_SHA=
BUILD_BASE_AND_BUNDLE=
PREVIEW_URL=
PRODUCTION_CHANGED=NO
KNOWN_LIMITATIONS=
```

## 11. 审计来源与实现参考

以下是本次审计实际读取的源码路径；均固定到上面的提交，可与后续修改做diff：

- `web/src/components/PrismCard.tsx`：局部输入和坐标变量、Capsule颜色拼接。
- `web/src/index.css`：三类材质、Prism跟随渐变、hover范围与圆角裁剪。
- `web/src/pages/Overview.tsx`：ExecutiveStrip、Quiet空态、MissionCards、ControlStack、动态列表。
- `web/src/components/Topbar.tsx`：静态高光及sticky，不含指针跟随逻辑。
- `web/src/App.tsx`：跨路由Shell、Motion容器位置。
- `web/src/components/Drawer.tsx`：Portal到body与已修复的几何/焦点/滚动逻辑。

固定提交入口及官方参考：

```text
https://github.com/ZhangZhengruiNUS/hermes-company-workbench/tree/1b1a37b2dcf980608ca919958315ae0354c8dcfd/web/src
https://react.dev/reference/react-dom/createPortal
https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect
https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/pointer-events
https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/pointer
https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color-mix
```

## 11. 环境收敛 (2026-09-24)

正式环境成为唯一运行入口:

1. Git main -> build (npm run build) -> production deploy (/var/www/hermes-report/production/)。
2. /next/ 已降级: nginx return 302 /, 不再作为开发部署目标, 旧"部署到 next 后人工复制到正式"流程作废。
3. 后续改动默认直接走 production 发布流程; 回滚备份保留在 /var/www/hermes-report/production.rollback-*。
