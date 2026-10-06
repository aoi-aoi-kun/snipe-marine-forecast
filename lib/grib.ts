// Minimal GRIB2 reader for the small regular lat/lon subsets NOMADS returns
// (simple packing, grid definition template 0). Values are checked against
// eccodes on the fixtures in lib/fixtures.

export type GridPoint = { lat: number; lon: number; value: number };

export type GribField = {
  category: number;
  parameter: number;
  surfaceType: number;
  surfaceValue: number;
  pdt: number;
  forecastHour: number;
  rangeStartHour: number | null;
  rangeLengthHour: number | null;
  statProcess: number | null;
  points: GridPoint[];
};

const text = (bytes: Uint8Array, start: number, n: number) =>
  String.fromCharCode(...bytes.subarray(start, start + n));

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u16(bytes: Uint8Array, offset: number) {
  return view(bytes).getUint16(offset, false);
}

function u32(bytes: Uint8Array, offset: number) {
  return view(bytes).getUint32(offset, false);
}

function i16(bytes: Uint8Array, offset: number) {
  return view(bytes).getInt16(offset, false);
}

function i32(bytes: Uint8Array, offset: number) {
  return view(bytes).getInt32(offset, false);
}

function f32(bytes: Uint8Array, offset: number) {
  return view(bytes).getFloat32(offset, false);
}

function u64(bytes: Uint8Array, offset: number) {
  return u32(bytes, offset) * 2 ** 32 + u32(bytes, offset + 4);
}

function messages(buf: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let i = 0;
  while (i + 16 <= buf.length) {
    if (text(buf, i, 4) !== "GRIB") break;
    const length = u64(buf, i + 8);
    if (length < 16 || i + length > buf.length) break;
    out.push(buf.subarray(i, i + length));
    i += length;
  }
  return out;
}

function sections(msg: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let p = 16;
  while (p + 4 <= msg.length - 4) {
    const len = u32(msg, p);
    if (len < 5 || p + len > msg.length) break;
    out.push(msg.subarray(p, p + len));
    p += len;
  }
  return out;
}

function unitToHours(unit: number, amount: number): number {
  switch (unit) {
    case 0:
      return amount / 60;
    case 1:
      return amount;
    case 2:
      return amount * 24;
    case 10:
      return amount * 3;
    case 11:
      return amount * 6;
    case 12:
      return amount * 12;
    case 13:
      return amount / 3600;
    default:
      throw new Error(`未対応の時間単位です (${unit})`);
  }
}

function referenceTime(sec1: Uint8Array): number {
  const year = u16(sec1, 12);
  const month = sec1[14];
  const day = sec1[15];
  const hour = sec1[16];
  const minute = sec1[17];
  const second = sec1[18];
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function readProduct(sec4: Uint8Array, refMs: number) {
  const pdt = u16(sec4, 7);
  const category = sec4[9];
  const parameter = sec4[10];
  const unit = sec4[17];
  const forecastTime = u32(sec4, 18);
  const surfaceType = sec4[22];
  const surfaceScale = sec4[23] > 127 ? sec4[23] - 256 : sec4[23];
  const surfaceScaled = i32(sec4, 24);
  const surfaceValue = surfaceScaled / 10 ** surfaceScale;
  let forecastHour = unitToHours(unit, forecastTime);
  let rangeStartHour: number | null = null;
  let rangeLengthHour: number | null = null;
  let statProcess: number | null = null;

  if (pdt === 8) {
    const year = u16(sec4, 34);
    const month = sec4[36];
    const day = sec4[37];
    const hour = sec4[38];
    const minute = sec4[39];
    const end = Date.UTC(year, month - 1, day, hour, minute);
    forecastHour = (end - refMs) / 3_600_000;
    statProcess = sec4[46];
    const rangeUnit = sec4[48];
    const rangeLength = u32(sec4, 49);
    rangeLengthHour = unitToHours(rangeUnit, rangeLength);
    rangeStartHour = forecastHour - rangeLengthHour;
  }

  return {
    pdt,
    category,
    parameter,
    surfaceType,
    surfaceValue,
    forecastHour,
    rangeStartHour,
    rangeLengthHour,
    statProcess,
  };
}

function gridPoints(sec3: Uint8Array): { lat: number; lon: number }[] {
  const template = u16(sec3, 12);
  if (template !== 0) {
    throw new Error(`未対応の格子テンプレートです (${template})`);
  }
  const ni = u32(sec3, 30);
  const nj = u32(sec3, 34);
  const la1 = i32(sec3, 46) / 1e6;
  const lo1 = i32(sec3, 50) / 1e6;
  const di = i32(sec3, 63) / 1e6;
  const dj = i32(sec3, 67) / 1e6;
  const scan = sec3[71];
  const iDir = (scan & 0x80) === 0 ? 1 : -1;
  const jDir = (scan & 0x40) !== 0 ? 1 : -1;
  const jFastest = (scan & 0x20) !== 0;
  const alternate = (scan & 0x10) !== 0;
  const points: { lat: number; lon: number }[] = [];

  const push = (i: number, j: number) => {
    points.push({
      lat: la1 + j * jDir * dj,
      lon: lo1 + i * iDir * di,
    });
  };

  if (!jFastest) {
    for (let j = 0; j < nj; j++) {
      const reverse = alternate && j % 2 === 1;
      for (let step = 0; step < ni; step++) {
        const i = reverse ? ni - 1 - step : step;
        push(i, j);
      }
    }
  } else {
    for (let i = 0; i < ni; i++) {
      for (let j = 0; j < nj; j++) push(i, j);
    }
  }
  return points;
}

function unpack(sec5: Uint8Array, sec7: Uint8Array, n: number): number[] {
  const template = u16(sec5, 9);
  if (template !== 0) {
    throw new Error(`未対応の圧縮です (${template})`);
  }
  const reference = f32(sec5, 11);
  const binaryScale = i16(sec5, 15);
  const decimalScale = i16(sec5, 17);
  const bits = sec5[19];
  const decimal = 10 ** decimalScale;
  const binary = 2 ** binaryScale;
  if (bits === 0) {
    return Array.from({ length: n }, () => reference / decimal);
  }
  const data = sec7.subarray(5);
  let bitpos = 0;
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    let packed = 0;
    for (let k = 0; k < bits; k++) {
      const byte = data[bitpos >> 3] ?? 0;
      packed = (packed << 1) | ((byte >> (7 - (bitpos & 7))) & 1);
      bitpos++;
    }
    values.push((reference + packed * binary) / decimal);
  }
  return values;
}

export function decodeGrib(buf: Uint8Array): GribField[] {
  const fields: GribField[] = [];
  for (const msg of messages(buf)) {
    const secs = sections(msg);
    const sec1 = secs.find((s) => s[4] === 1);
    const sec3 = secs.find((s) => s[4] === 3);
    const sec4 = secs.find((s) => s[4] === 4);
    const sec5 = secs.find((s) => s[4] === 5);
    const sec6 = secs.find((s) => s[4] === 6);
    const sec7 = secs.find((s) => s[4] === 7);
    if (!sec1 || !sec3 || !sec4 || !sec5 || !sec7) continue;
    if (sec6 && sec6[5] !== 255) {
      throw new Error("ビットマップ付きのGRIB2には対応していません");
    }
    const product = readProduct(sec4, referenceTime(sec1));
    const coords = gridPoints(sec3);
    const values = unpack(sec5, sec7, coords.length);
    fields.push({
      ...product,
      points: coords.map((point, index) => ({
        ...point,
        value: values[index],
      })),
    });
  }
  return fields;
}

export function valueAt(field: GribField, lat: number, lon: number): number {
  let best = Number.POSITIVE_INFINITY;
  let value = Number.NaN;
  for (const point of field.points) {
    const dLat = point.lat - lat;
    const dLon = point.lon - lon;
    const dist = dLat * dLat + dLon * dLon;
    if (dist < best) {
      best = dist;
      value = point.value;
    }
  }
  if (best > 0.3 * 0.3 || !Number.isFinite(value)) {
    throw new Error("格子内に対象地点がありません");
  }
  return value;
}

export type PointSample = {
  forecastHour: number;
  tempK: number;
  u: number;
  v: number;
  cloudPct: number;
  precipRunMm: number;
};

function match(
  fields: GribField[],
  category: number,
  parameter: number,
  surfaceType: number,
  surfaceValue: number,
  pdt?: number,
) {
  return fields.filter(
    (field) =>
      field.category === category &&
      field.parameter === parameter &&
      field.surfaceType === surfaceType &&
      Math.abs(field.surfaceValue - surfaceValue) < 0.01 &&
      (pdt === undefined || field.pdt === pdt),
  );
}

export function extractPoint(
  buf: Uint8Array,
  lat: number,
  lon: number,
): PointSample {
  const fields = decodeGrib(buf);
  const temp = match(fields, 0, 0, 103, 2, 0)[0];
  const u = match(fields, 2, 2, 103, 10, 0)[0];
  const v = match(fields, 2, 3, 103, 10, 0)[0];
  const cloud = match(fields, 6, 1, 10, 0, 0)[0];
  const precips = match(fields, 1, 8, 1, 0).filter(
    (field) => field.statProcess === 1,
  );
  const precip = precips.sort(
    (a, b) => (b.rangeLengthHour ?? 0) - (a.rangeLengthHour ?? 0),
  )[0];
  if (!temp || !u || !v || !cloud || !precip) {
    throw new Error("必要な要素がGRIB2に含まれていません");
  }
  return {
    forecastHour: temp.forecastHour,
    tempK: valueAt(temp, lat, lon),
    u: valueAt(u, lat, lon),
    v: valueAt(v, lat, lon),
    cloudPct: valueAt(cloud, lat, lon),
    precipRunMm: valueAt(precip, lat, lon),
  };
}
