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
  west: 139.36,
  east: 139.62,
  south: 35.11,
  north: 35.36,
};

function project(lat: number, lon: number, width: number, height: number) {
  const x = ((lon - VIEW.west) / (VIEW.east - VIEW.west)) * width;
  const y = ((VIEW.north - lat) / (VIEW.north - VIEW.south)) * height;
  return { x, y };
}

function cellPath(width: number, height: number): string {
  const nw = project(OFFSHORE_GRID.north, OFFSHORE_GRID.west, width, height);
  const ne = project(OFFSHORE_GRID.north, OFFSHORE_GRID.east, width, height);
  const se = project(OFFSHORE_GRID.south, OFFSHORE_GRID.east, width, height);
  const sw = project(OFFSHORE_GRID.south, OFFSHORE_GRID.west, width, height);
  return `M ${nw.x} ${nw.y} L ${ne.x} ${ne.y} L ${se.x} ${se.y} L ${sw.x} ${sw.y} Z`;
}

/** Schematic map: ECMWF grid cell and Enoshima Yacht Harbor. */
export function AreaMap() {
  const width = 640;
  const height = 420;
  const offshore = project(OFFSHORE_POINT.lat, OFFSHORE_POINT.lon, width, height);
  const harbor = project(HARBOR_POINT.lat, HARBOR_POINT.lon, width, height);

  const cellKmLat = GRID_STEP_DEG * kmPerDegreeLat();
  const cellKmLon = GRID_STEP_DEG * kmPerDegreeLon(OFFSHORE_POINT.lat);

  // Simplified Shonan coast (schematic, not survey-grade).
  const coast = [
    [35.33, 139.37],
    [35.325, 139.41],
    [35.318, 139.445],
    [35.312, 139.468],
    [35.305, 139.485],
    [35.295, 139.5],
    [35.28, 139.515],
    [35.26, 139.53],
    [35.24, 139.545],
  ]
    .map(([lat, lon]) => project(lat, lon, width, height))
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  const scaleKm = 5;
  const scalePx =
    (scaleKm / kmPerDegreeLon(OFFSHORE_POINT.lat) / (VIEW.east - VIEW.west)) * width;
  const scaleX = width - scalePx - 28;
  const scaleY = height - 22;

  return (
    <figure className="overflow-hidden rounded-xl border border-line/70 bg-[#e8f2f4]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="area-map-title area-map-desc"
        className="h-auto w-full"
      >
        <title id="area-map-title">予報升と江の島ヨットハーバーの位置</title>
        <desc id="area-map-desc">
          相模湾西岸付近。約25km四方のECMWF予報升と、岸の江の島ヨットハーバー実況地点を示す模式図です。
        </desc>

        <defs>
          <linearGradient id="seaGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#d9ecef" />
            <stop offset="100%" stopColor="#c5dfe5" />
          </linearGradient>
          <pattern id="gridHatch" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 8 L8 0" stroke="#0f6b74" strokeOpacity="0.12" strokeWidth="1" />
          </pattern>
        </defs>

        <rect x="0" y="0" width={width} height={height} fill="url(#seaGrad)" />

        {/* Land */}
        <path
          d={`${coast} L ${width} ${height} L 0 ${height} Z`}
          fill="#dfe8df"
          stroke="#9eb0a8"
          strokeWidth="1.2"
        />

        {/* Grid cell */}
        <path
          d={cellPath(width, height)}
          fill="url(#gridHatch)"
          stroke="#0f6b74"
          strokeWidth="2"
          strokeDasharray="6 4"
        />

        {/* Connector */}
        <line
          x1={harbor.x}
          y1={harbor.y}
          x2={offshore.x}
          y2={offshore.y}
          stroke="#5a6d74"
          strokeWidth="1"
          strokeDasharray="3 4"
          opacity="0.7"
        />
        <text
          x={(harbor.x + offshore.x) / 2 + 6}
          y={(harbor.y + offshore.y) / 2 - 6}
          fill="#5a6d74"
          fontSize="11"
          fontFamily="var(--font-plex), sans-serif"
        >
          約 {HARBOR_TO_OFFSHORE_KM.toFixed(1)} km
        </text>

        {/* Harbor marker */}
        <circle cx={harbor.x} cy={harbor.y} r="7" fill="#c5851a" stroke="#fff" strokeWidth="2" />
        <text
          x={harbor.x - 8}
          y={harbor.y - 14}
          fill="#0e1a22"
          fontSize="12"
          fontWeight="600"
          fontFamily="var(--font-plex), sans-serif"
        >
          江の島ヨットハーバー
        </text>
        <text
          x={harbor.x - 8}
          y={harbor.y + 22}
          fill="#5a6d74"
          fontSize="10"
          fontFamily="var(--font-plex), sans-serif"
        >
          実況（5分）
        </text>

        {/* Offshore marker */}
        <circle cx={offshore.x} cy={offshore.y} r="7" fill="#0f6b74" stroke="#fff" strokeWidth="2" />
        <text
          x={offshore.x - 36}
          y={offshore.y + 24}
          fill="#0e1a22"
          fontSize="12"
          fontWeight="600"
          fontFamily="var(--font-plex), sans-serif"
        >
          七里ヶ浜沖（格子点）
        </text>
        <text
          x={offshore.x - 36}
          y={offshore.y + 38}
          fill="#5a6d74"
          fontSize="10"
          fontFamily="var(--font-plex), sans-serif"
        >
          予報（3時間）
        </text>

        {/* Cell size label */}
        <text
          x={project(OFFSHORE_GRID.north, OFFSHORE_GRID.west, width, height).x + 8}
          y={project(OFFSHORE_GRID.north, OFFSHORE_GRID.west, width, height).y + 16}
          fill="#0f6b74"
          fontSize="11"
          fontWeight="500"
          fontFamily="var(--font-plex), sans-serif"
        >
          ECMWF 升 約 {cellKmLat.toFixed(0)}×{cellKmLon.toFixed(0)} km
        </text>

        {/* North */}
        <g transform={`translate(24, 24)`}>
          <line x1="0" y1="18" x2="0" y2="0" stroke="#0e1a22" strokeWidth="1.5" />
          <path d="M0 0 L-4 8 L4 8 Z" fill="#0e1a22" />
          <text x="-4" y="30" fontSize="10" fill="#5a6d74" fontFamily="var(--font-plex), sans-serif">
            北
          </text>
        </g>

        {/* Scale bar */}
        <g transform={`translate(${scaleX}, ${scaleY})`}>
          <line x1="0" y1="0" x2={scalePx} y2="0" stroke="#0e1a22" strokeWidth="2" />
          <line x1="0" y1="-3" x2="0" y2="3" stroke="#0e1a22" strokeWidth="1.5" />
          <line x1={scalePx} y1="-3" x2={scalePx} y2="3" stroke="#0e1a22" strokeWidth="1.5" />
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
      <figcaption className="border-t border-line/60 bg-paper/70 px-4 py-3 text-xs leading-5 text-muted sm:text-sm sm:leading-6">
        破線の四角が ECMWF IFS 0.25° の1升（北緯 {OFFSHORE_GRID.south.toFixed(2)}–
        {OFFSHORE_GRID.north.toFixed(2)}°、東経 {OFFSHORE_GRID.west.toFixed(2)}–
        {OFFSHORE_GRID.east.toFixed(2)}°）。沖の数値はこの升の代表点、ハーバーは岸の実測です。海岸線は模式図です。
      </figcaption>
    </figure>
  );
}
