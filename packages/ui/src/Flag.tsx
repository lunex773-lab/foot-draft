/** National flags drawn in a 30 x 20 box (simplified). */
const W = 30;
const H = 20;

function vertical(colors: string[]) {
  const w = W / colors.length;
  return colors.map((c, i) => <rect key={i} x={i * w} y={0} width={w + 0.05} height={H} fill={c} />);
}
function horizontal(colors: string[], weights?: number[]) {
  const ws = weights ?? colors.map(() => 1);
  const total = ws.reduce((s, v) => s + v, 0);
  let y = 0;
  return colors.map((c, i) => {
    const h = (ws[i] / total) * H;
    const el = <rect key={i} x={0} y={y} width={W} height={h + 0.05} fill={c} />;
    y += h;
    return el;
  });
}
function nordic(bg: string, cross: string, inner?: string) {
  return (
    <>
      <rect width={W} height={H} fill={bg} />
      <rect x={8} y={0} width={inner ? 5 : 4} height={H} fill={cross} />
      <rect x={0} y={inner ? 7.5 : 8} width={W} height={inner ? 5 : 4} fill={cross} />
      {inner && (
        <>
          <rect x={9.25} y={0} width={2.5} height={H} fill={inner} />
          <rect x={0} y={8.75} width={W} height={2.5} fill={inner} />
        </>
      )}
    </>
  );
}
const star = (cx: number, cy: number, r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    pts.push(`${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`);
  }
  return pts.join(' ');
};

export function FlagShapes({ code }: { code: string }) {
  switch (code) {
    case 'ENG':
      return (
        <>
          <rect width={W} height={H} fill="#fff" />
          <rect x={13} width={4} height={H} fill="#ce1124" />
          <rect y={8} width={W} height={4} fill="#ce1124" />
        </>
      );
    case 'ESP':
      return <>{horizontal(['#aa151b', '#f1bf00', '#aa151b'], [1, 2, 1])}</>;
    case 'FRA':
      return <>{vertical(['#002395', '#ffffff', '#ed2939'])}</>;
    case 'GER':
      return <>{horizontal(['#000000', '#dd0000', '#ffce00'])}</>;
    case 'ITA':
      return <>{vertical(['#009246', '#ffffff', '#ce2b37'])}</>;
    case 'NED':
      return <>{horizontal(['#ae1c28', '#ffffff', '#21468b'])}</>;
    case 'BEL':
      return <>{vertical(['#000000', '#fae042', '#ed2939'])}</>;
    case 'EST':
      return <>{horizontal(['#0072ce', '#000000', '#ffffff'])}</>;
    case 'JPN':
      return (
        <>
          <rect width={W} height={H} fill="#fff" />
          <circle cx={15} cy={10} r={6} fill="#bc002d" />
        </>
      );
    case 'ARG':
      return (
        <>
          {horizontal(['#74acdf', '#ffffff', '#74acdf'])}
          <circle cx={15} cy={10} r={2.4} fill="#f6b40e" />
        </>
      );
    case 'BRA':
      return (
        <>
          <rect width={W} height={H} fill="#009c3b" />
          <polygon points="15,2.5 27,10 15,17.5 3,10" fill="#ffdf00" />
          <circle cx={15} cy={10} r={4.6} fill="#002776" />
          <path d="M10.6 9 Q15 7.6 19.4 10.4" stroke="#fff" strokeWidth={0.9} fill="none" />
        </>
      );
    case 'NGA':
      return <>{vertical(['#008751', '#ffffff', '#008751'])}</>;
    case 'SEN':
      return (
        <>
          {vertical(['#00853f', '#fdef42', '#e31b23'])}
          <polygon points={star(15, 10, 3.4)} fill="#00853f" />
        </>
      );
    case 'CIV':
      return <>{vertical(['#f77f00', '#ffffff', '#009e60'])}</>;
    case 'GHA':
      return (
        <>
          {horizontal(['#ce1126', '#fcd116', '#006b3f'])}
          <polygon points={star(15, 10, 3.2)} fill="#000" />
        </>
      );
    case 'MAR':
      return (
        <>
          <rect width={W} height={H} fill="#c1272d" />
          <polygon points={star(15, 10.4, 5)} fill="none" stroke="#006233" strokeWidth={0.9} />
        </>
      );
    case 'COL':
      return <>{horizontal(['#fcd116', '#003893', '#ce1126'], [2, 1, 1])}</>;
    case 'SWE':
      return nordic('#006aa7', '#fecc00');
    case 'DEN':
      return nordic('#c8102e', '#ffffff');
    case 'NOR':
      return nordic('#ba0c2f', '#ffffff', '#00205b');
    case 'IRL':
      return <>{vertical(['#169b62', '#ffffff', '#ff883e'])}</>;
    case 'POL':
      return <>{horizontal(['#ffffff', '#dc143c'])}</>;
    case 'AUT':
      return <>{horizontal(['#ed2939', '#ffffff', '#ed2939'])}</>;
    default:
      return <rect width={W} height={H} fill="#888" />;
  }
}

/** Flag positioned so that its top-left corner is at the origin. */
export function FlagGroup({ code, stroke = '#00000055' }: { code: string; stroke?: string }) {
  return (
    <g>
      <FlagShapes code={code} />
      <rect width={W} height={H} fill="none" stroke={stroke} strokeWidth={0.8} />
    </g>
  );
}

export function Flag({ code, width = 24 }: { code: string; width?: number }) {
  return (
    <svg width={width} height={(width * 2) / 3} viewBox="0 0 30 20" role="img" aria-label={code}>
      <FlagGroup code={code} />
    </svg>
  );
}
