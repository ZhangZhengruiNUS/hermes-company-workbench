// Aurora Pointer Light — 全局指针柔光控制器
// 设计依据: web/docs/AURORA_POINTER_LIGHT_SPEC.md
// 核心原则:
//  1) 单一输入源: 一个 document 级原生 pointermove 监听, 坐标存普通变量, 不进 React 状态。
//  2) 两种绘制层: 页面背景柔光(单点) + 各 [data-pointer-light] 材质表面的局部跟随反光。
//  3) rAF 合并: 每帧只对「当前宿主 + 上一宿主(淡出) + 一个背景层」做最小更新, 不做全 DOM 遍历/每卡循环。
//  4) 事件委托 + 就近宿主: 从事件目标向上找最近的 [data-pointer-light] 宿主; 嵌套时只响应最内层宿主。
//  5) 复用既有 --mx/--my 自定义属性命名, 让 CSS 伪元素直接消费, 不改接口契约。

// 启动门控: 仅在「支持 hover 且为 fine 指针」的设备上启用; 触摸/触屏 hover 不启用。
// prefers-reduced-motion: reduce → 禁用指针跟随动画与背景柔光, 保留静态 hover/focus(由 CSS 处理)。
function finePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? true;
}

function reducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// 宿主强度映射 — 由 data-pointer-light 取值决定该表面的光斑强度档位
const LIGHT_TIER: Record<string, number> = {
  glass: 0.2, // 基准
  nav: 0.16,  // 导航/工具栏/统计 70-90%
  quiet: 0.09, // 空态/表格 35-55%
};

export interface PointerLightHandle {
  // 布局变化(滚动/路由切换/drawer 开关/尺寸变化)后重新命中光标下最近的宿主并对其光斑。
  rehit: () => void;
  // 关闭: 移除全部监听与光斑层, 幂等。
  destroy: () => void;
}

type Listener = () => void;

export function initPointerLight(): PointerLightHandle {
  if (!finePointer() || reducedMotion()) {
    // 不合规环境(触摸/触屏或减少动态)不安装任何监听, 返回空操作句柄。
    return { rehit: () => {}, destroy: () => {} };
  }

  let rafId = 0;
  let activeHost: HTMLElement | null = null; // 当前跟随光斑的宿主
  let bgLayer: HTMLElement | null = null; // 页面背景柔光层(由 CSS 类 .pointer-bg-light 提供)

  // 全局坐标(视口坐标, 每次 pointermove 更新, 供命中与背景层共用)。
  let vx = 0;
  let vy = 0;
  let hasPos = false;

  const HOST_SELECTOR = "[data-pointer-light], .quiet-surface";
  const bgLayerClass = "pointer-bg-light";

  function getBgLayer(): HTMLElement | null {
    if (bgLayer && bgLayer.isConnected) return bgLayer;
    bgLayer = document.querySelector<HTMLElement>(`.${bgLayerClass}`);
    return bgLayer;
  }

  // 背景层: 有有效指针位置时点亮并跟随, 否则淡出(透明度由 CSS transition 控制)。
  // 命中点落在 drawer 遮罩(data-pl-veil)上时淡出背景层, 柔光不穿透遮罩(drawer 内面板仍以自身宿主响应)。
  function applyBg(on: boolean, veil = false) {
    const el = getBgLayer();
    if (!el) return;
    const show = on && hasPos && !veil;
    if (show) {
      // 仅更新 transform(合成器友好), 不重绘整屏。
      const size = el.offsetWidth || 480;
      el.style.transform = `translate3d(${vx - size / 2}px, ${vy - size / 2}px, 0)`;
      el.style.opacity = "1";
    } else {
      el.style.opacity = "0";
    }
  }

  // 计算宿主内局部坐标 -> 写 --mx/--my, 复用 PrismCard 既有自定义属性约定。
  function writeLocal(host: HTMLElement) {
    const r = host.getBoundingClientRect();
    host.style.setProperty("--mx", `${vx - r.left}px`);
    host.style.setProperty("--my", `${vy - r.top}px`);
  }

  // 淡出宿主(移除点亮状态, 由 CSS transition 平滑淡出)。
  function fadeOut(host: HTMLElement | null) {
    if (!host) return;
    host.classList.remove("pl-on");
    // 清除遗留局部坐标, 避免下一次快速回笔时闪烁旧值。
    host.style.removeProperty("--mx");
    host.style.removeProperty("--my");
  }

  // 点亮宿主并写入局部坐标。
  function lightOn(host: HTMLElement) {
    writeLocal(host);
    host.classList.add("pl-on");
  }

  function hasTier(host: HTMLElement): boolean {
    const t = host.getAttribute("data-pointer-light");
    if (t === "off") return false;
    // 显式标记(data-pointer-light=glass|nav|quiet) 或 语义类 quiet-surface(隐式 quiet 档) 均可响应。
    return (t !== null && t in LIGHT_TIER) || host.classList.contains("quiet-surface");
  }

  // 命中宿主强度(用于后台层是否强化; 此实现统一由 CSS data 档位处理, 此处仅作启用判断)。
  function isEligible(host: HTMLElement | null): host is HTMLElement {
    return !!host && hasTier(host);
  }

  // 从事件目标向上找最近宿主; 若宿主被标记 data-pointer-light="off" 则视为无宿主(该区域不跟随)。
  function resolveHost(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const host = target.closest<HTMLElement>(HOST_SELECTOR);
    if (!host) return null;
    return isEligible(host) ? host : null;
  }

  // 单帧更新: 命中当前宿主, 切换点亮/淡出, 同步背景层。
  function tick() {
    rafId = 0;
    const target = document.elementFromPoint(vx, vy);
    // drawer 遮罩检测: 命中点落在 data-pl-veil(含子面板) 时, 背景柔光淡出不穿透。
    const veil = !!(target instanceof Element && target.closest("[data-pl-veil]"));
    const next = resolveHost(target);
    if (next !== activeHost) {
      if (activeHost) fadeOut(activeHost);
      activeHost = next;
      if (activeHost) lightOn(activeHost);
    } else if (activeHost) {
      // 同一宿主内移动 -> 仅更新局部坐标。
      writeLocal(activeHost);
    }
    applyBg(true, veil);
  }

  function schedule() {
    if (rafId) return;
    rafId = requestAnimationFrame(tick);
  }

  // —— 事件源: 唯一 document 级 pointermove ——
  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === "touch") return; // 触摸/触屏不跟随
    vx = e.clientX;
    vy = e.clientY;
    hasPos = true;
    schedule();
  }

  // 指针离开页面 / 窗口失焦 / 取消: 淡出并清空跟随状态, 避免光斑残留。
  function onPointerLeave() {
    if (activeHost) fadeOut(activeHost);
    activeHost = null;
    applyBg(false);
  }

  // 滚动 / 路由 / 布局变化: 光标不动但内容移动, 需用缓存坐标重新命中。
  // 只要已有有效指针位置就重新命中 — 覆盖光标停在空白处时, 下方内容随路由/滚动换掉的情形。
  function rehit() {
    if (!hasPos) return;
    schedule();
  }

  // 页面隐藏: 暂停跟随并淡出(省电)。
  function onVisibility() {
    if (document.hidden) {
      if (activeHost) fadeOut(activeHost);
      activeHost = null;
      applyBg(false);
    }
  }

  const onResize = rehit;
  const onScroll = () => { if (hasPos) schedule(); };
  const cleanup: Listener[] = [
    () => window.removeEventListener("pointermove", onPointerMove),
    () => window.removeEventListener("resize", onResize),
    () => window.removeEventListener("scroll", onScroll, true),
    () => document.removeEventListener("pointerleave", onPointerLeave),
    () => document.removeEventListener("visibilitychange", onVisibility),
    () => document.removeEventListener("mouseleave", onPointerLeave),
  ];

  function destroy() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (activeHost) fadeOut(activeHost);
    activeHost = null;
    applyBg(false);
    cleanup.forEach((fn) => fn());
  }

  // 只安装一次 document 级监听, 事件委托到所有 [data-pointer-light] 宿主。
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  document.addEventListener("pointerleave", onPointerLeave);
  document.addEventListener("visibilitychange", onVisibility);
  // 兜底: 鼠标从整个文档移出到外部时, 部分浏览器不触发 pointerleave, 用 mouseleave 兜底。
  document.documentElement.addEventListener("mouseleave", onPointerLeave);

  // 记录销毁函数(含新增监听), 便于扩展。
  cleanup.push(() =>
    document.documentElement.removeEventListener("mouseleave", onPointerLeave)
  );

  // 初始化背景层引用并默认淡出。
  getBgLayer();
  applyBg(false);

  return { rehit, destroy };
}
