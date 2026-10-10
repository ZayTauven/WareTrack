// Brand mark: three blades of an exploded hexagon, an isometric cube seen edge-on.
// public/favicon.svg is generated from the same geometry.

const MARK_OUTER = 44;
const MARK_INNER = 17;
const MARK_GAP = 3.5;

function bladePath(startDeg: number): string {
  const at = (radius: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    const mid = ((startDeg + 60) * Math.PI) / 180;
    return `${(50 + radius * Math.cos(rad) + MARK_GAP * Math.cos(mid)).toFixed(2)} ${(50 + radius * Math.sin(rad) + MARK_GAP * Math.sin(mid)).toFixed(2)}`;
  };
  const points = [
    at(MARK_OUTER, startDeg),
    at(MARK_OUTER, startDeg + 60),
    at(MARK_OUTER, startDeg + 120),
    at(MARK_INNER, startDeg + 120),
    at(MARK_INNER, startDeg + 60),
    at(MARK_INNER, startDeg),
  ];
  return `M${points.join('L')}Z`;
}

const BLADES = [
  { d: bladePath(-90), fill: '#ff7a24' },
  { d: bladePath(30), fill: '#e85d0c' },
  { d: bladePath(150), fill: '#ff9147' },
];

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      {BLADES.map((blade) => (
        <path key={blade.fill} className="brand-blade" d={blade.d} fill={blade.fill} stroke={blade.fill} strokeWidth={4} strokeLinejoin="round" />
      ))}
    </svg>
  );
}
