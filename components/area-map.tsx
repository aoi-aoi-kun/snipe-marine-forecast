import {
  GRID_STEP_DEG,
  HARBOR_POINT,
  HARBOR_TO_OFFSHORE_KM,
  kmPerDegreeLat,
  kmPerDegreeLon,
  OFFSHORE_GRID,
  OFFSHORE_POINT,
} from "@/lib/geo";

const VIEW = {
  west: 139.38,
  east: 139.6,
  south: 35.14,
  north: 35.34,
};

function project(lat: number, lon: number, width: number, height: number) {
  const x = ((lon - VIEW.west) / (VIEW.east - VIEW.west)) * width;
  const y = ((VIEW.north - lat) / (VIEW.north - VIEW.south)) * height;
  return { x, y };
}

function poly(
  points: [number, number][],
  width: number,
  height: number,
  close = false,
): string {
  const parts = points.map(([lat, lon], index) => {
    const { x, y } = project(lat, lon, width, height);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return close ? `${parts.join(" ")} Z` : parts.join(" ");
}

/** Schematic map: ECMWF grid cell and Enoshima Yacht Harbor. */
export function AreaMap() {
  const width = 720;
  const height = 400;
  const offshore = project(OFFSHORE_POINT.lat, OFFSHORE_POINT.lon, width, height);
  const harbor = project(HARBOR_POINT.lat, HARBOR_POINT.lon, width, height);
  const cellKmLat = GRID_STEP_DEG * kmPerDegreeLat();
  const cellKmLon = GRID_STEP_DEG * kmPerDegreeLon(OFFSHORE_POINT.lat);

  const landFill = poly(
    [
      [35.34, 139.38],
      [35.332, 139.42],
      [35.322, 139.455],
      [35.314, 139.475],
      [35.308, 139.49],
      [35.3, 139.505],
      [35.285, 139.52],
      [35.265, 139.535],
      [35.245, 139.55],
      [35.22, 139.6],
      [35.14, 139.6],
      [35.14, 139.38],
    ],
    width,
    height,
    true,
  );

  const coastLine = poly(
    [
      [35.34, 139.38],
      [35.332, 139.42],
      [35.322, 139.455],
      [35.314, 139.475],
      [35.308, 139.49],
      [35.3, 139.505],
      [35.285, 139.52],
      [35.265, 139.535],
      [35.245, 139.55],
      [35.22, 139.6],
    ],
    width,
    height,
  );

  const enoshima = poly(
    [
      [35.302, 139.475],
      [35.304, 139.482],
      [35.301, 139.489],
      [35.297, 139.486],
      [35.298, 139.478],
    ],
    width,
    height,
    true,
  );

  const cell = {
    nw: project(OFFSHORE_GRID.north, OFFSHORE_GRID.west, width, height),
    ne: project(OFFSHORE_GRID.north, OFFSHORE_GRID.east, width, height),
    se: project(OFFSHORE_GRID.south, OFFSHORE_GRID.east, width, height),
    sw: project(OFFSHORE_GRID.south, OFFSHORE_GRID.west, width, height),
  };
  const cellPath = `M ${cell.nw.x} ${cell.nw.y} L ${cell.ne.x} ${cell.ne.y} L ${cell.se.x} ${cell.se.y} L ${cell.sw.x} ${cell.sw.y} Z`;

  const mid = {
    x: (harbor.x + offshore.x) / 2,
    y: (harbor.y + offshore.y) / 2,
  };

  const scaleKm = 5;
  const scalePx =
    (scaleKm / kmPerDegreeLon(OFFSHORE_POINT.lat) / (VIEW.east - VIEW.west)) * width;

  return (
    <figure className="area-map overflow-hidden rounded-lg border border-line/50 bg-paper">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="area-map-title area-map-desc"
        className="h-auto w-full"
      >
        <title id="area-map-title">予報升と江の島ヨットハーバーの位置</title>
        <desc id="area-map-desc">
          相模湾。ECMWFの約25km升と、岸の江の島ヨットハーバーを示す模式図です。
        </desc>

        <defs>
          <linearGradient id="mapSea" x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stopColor="#cfe4e8" />
            <stop offset="55%" stopColor="#b9d5db" />
            <stop offset="100%" stopColor="#9fc4cd" />
          </linearGradient>
          <linearGradient id="mapLand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e7efe6" />
            <stop offset="100%" stopColor="#d5e0d4" />
          </linearGradient>
          <linearGradient id="mapCell" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0f6b74" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#0f6b74" stopOpacity="0.04" />
          </linearGradient>
          <filter id="mapSoft" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#0e1a22" floodOpacity="0.12" />
          </filter>
        </defs>

        <rect width={width} height={height} fill="url(#mapSea)" />

        {/* Soft depth bands in the bay */}
        <ellipse cx={width * 0.62} cy={height * 0.58} rx={210} ry={120} fill="#8eb8c2" opacity="0.18" />
        <ellipse cx={width * 0.7} cy={height * 0.7} rx={160} ry={90} fill="#7aa8b4" opacity="0.12" />

        <path d={landFill} fill="url(#mapLand)" />
        <path d={coastLine} fill="none" stroke="#7f958a" strokeWidth="1.6" strokeLinecap="round" />
        <path d={enoshima} fill="#c5d4c4" stroke="#6f8678" strokeWidth="1" />

        {/* Forecast cell */}
        <path
          d={cellPath}
          fill="url(#mapCell)"
          stroke="#0f6b74"
          strokeWidth="1.75"
          strokeDasharray="7 5"
          strokeLinejoin="round"
        />
        <text
          x={cell.nw.x + 10}
          y={cell.nw.y + 18}
          fill="#0a3f48"
          fontSize="11"
          fontWeight="500"
          fontFamily="var(--font-plex), sans-serif"
          letterSpacing="0.02em"
        >
          ECMWF 升 · 約 {cellKmLat.toFixed(0)}×{cellKmLon.toFixed(0)} km
        </text>

        {/* Distance link */}
        <line
          x1={harbor.x}
          y1={harbor.y}
          x2={offshore.x}
          y2={offshore.y}
          stroke="#5a6d74"
          strokeWidth="1.25"
          strokeDasharray="2.5 3.5"
          opacity="0.85"
        />
        <rect
          x={mid.x - 34}
          y={mid.y - 22}
          width="68"
          height="18"
          rx="9"
          fill="#edf3f4"
          stroke="#b9ccd1"
          strokeWidth="0.75"
        />
        <text
          x={mid.x}
          y={mid.y - 9}
          textAnchor="middle"
          fill="#0e1a22"
          fontSize="10"
          fontWeight="500"
          fontFamily="var(--font-plex), sans-serif"
        >
          {HARBOR_TO_OFFSHORE_KM.toFixed(1)} km
        </text>

        {/* Harbor */}
        <g filter="url(#mapSoft)">
          <circle cx={harbor.x} cy={harbor.y} r="8" fill="#c5851a" />
          <circle cx={harbor.x} cy={harbor.y} r="3.2" fill="#fff8e8" />
        </g>
        <g transform={`translate(${harbor.x + 12}, ${harbor.y - 28})`}>
          <rect width="118" height="34" rx="6" fill="#edf3f4" fillOpacity="0.94" stroke="#b9ccd1" strokeWidth="0.75" />
          <text x="8" y="14" fill="#0e1a22" fontSize="11" fontWeight="600" fontFamily="var(--font-plex), sans-serif">
            江の島ヨットハーバー
          </text>
          <text x="8" y="27" fill="#5a6d74" fontSize="10" fontFamily="var(--font-plex), sans-serif">
            実況 · 5分
          </text>
        </g>

        {/* Offshore point */}
        <g filter="url(#mapSoft)">
          <circle cx={offshore.x} cy={offshore.y} r="8" fill="#0f6b74" />
          <circle cx={offshore.x} cy={offshore.y} r="3.2" fill="#e7f4f5" />
        </g>
        <g transform={`translate(${offshore.x - 52}, ${offshore.y + 14})`}>
          <rect width="104" height="34" rx="6" fill="#edf3f4" fillOpacity="0.94" stroke="#b9ccd1" strokeWidth="0.75" />
          <text x="8" y="14" fill="#0e1a22" fontSize="11" fontWeight="600" fontFamily="var(--font-plex), sans-serif">
            七里ヶ浜沖
          </text>
          <text x="8" y="27" fill="#5a6d74" fontSize="10" fontFamily="var(--font-plex), sans-serif">
            格子点 · 3時間
          </text>
        </g>

        {/* Bay label */}
        <text
          x={width * 0.72}
          y={height * 0.42}
          fill="#0a3f48"
          fillOpacity="0.45"
          fontSize="13"
          fontFamily="var(--font-mincho), serif"
          letterSpacing="0.18em"
        >
          相模湾
        </text>

        {/* North */}
        <g transform="translate(22, 22)">
          <circle cx="10" cy="12" r="16" fill="#edf3f4" fillOpacity="0.85" stroke="#b9ccd1" strokeWidth="0.75" />
          <path d="M10 4 L13.2 12 L10 10.2 L6.8 12 Z" fill="#0e1a22" />
          <text x="10" y="24" textAnchor="middle" fontSize="9" fill="#5a6d74" fontFamily="var(--font-plex), sans-serif">
            N
          </text>
        </g>

        {/* Scale */}
        <g transform={`translate(${width - scalePx - 24}, ${height - 28})`}>
          <rect x="-8" y="-10" width={scalePx + 16} height="26" rx="6" fill="#edf3f4" fillOpacity="0.85" />
          <line x1="0" y1="0" x2={scalePx} y2="0" stroke="#0e1a22" strokeWidth="2" />
          <line x1="0" y1="-3.5" x2="0" y2="3.5" stroke="#0e1a22" strokeWidth="1.5" />
          <line x1={scalePx} y1="-3.5" x2={scalePx} y2="3.5" stroke="#0e1a22" strokeWidth="1.5" />
          <text
            x={scalePx / 2}
            y="14"
            textAnchor="middle"
            fontSize="10"
            fill="#5a6d74"
            fontFamily="var(--font-plex), sans-serif"
          >
            {scaleKm} km
          </text>
        </g>
      </svg>

      <figcaption className="flex flex-col gap-2 border-t border-line/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <p className="text-xs leading-5 text-muted">
          升は北緯 {OFFSHORE_GRID.south.toFixed(2)}–{OFFSHORE_GRID.north.toFixed(2)}°、東経{" "}
          {OFFSHORE_GRID.west.toFixed(2)}–{OFFSHORE_GRID.east.toFixed(2)}°。海岸線は模式図です。
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <li className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-sea" />
            沖・予報
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-sun" />
            ハーバー・実況
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 border-t border-dashed border-sea" />
            ECMWF 升
          </li>
        </ul>
      </figcaption>
    </figure>
  );
}
