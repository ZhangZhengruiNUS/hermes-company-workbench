export function AuroraBackground() {
  return (
    <div className="aurora-bg" aria-hidden="true">
      {/* Layer B: 大尺度极光 */}
      <div className="aurora-blob blue" />
      <div className="aurora-blob violet" />
      <div className="aurora-blob cyan" />
      {/* Layer D: 局部 spectral haze */}
      <div className="spectral-haze" />
      {/* Layer C: grain noise */}
      <div className="aurora-noise" />
      {/* Pointer Light — 全局指针背景柔光层 (controller 在 lib/pointerLight.ts 驱动,
          仅一个固定尺寸渐变层, 位于内容之下/极光之上) */}
      <div className="pointer-bg-light" />
    </div>
  );
}
