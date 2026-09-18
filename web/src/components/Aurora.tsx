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
    </div>
  );
}
