import type { ActiveWarning } from "./types";
import { warningName } from "./warning-codes";

const KAMAKURA_CODE = "1420400";
const INACTIVE = new Set(["解除", "発表警報・注意報はなし"]);

type WarningKind = {
  code?: string;
  status?: string;
  additions?: string[];
  properties?: {
    significancyPart?: {
      locals?: { areaName?: string; additions?: string[] }[];
    };
  }[];
};

type WarningArea = { areaCode?: string; kinds?: WarningKind[] };

type WarningBulletin = {
  reportDatetime?: string;
  warning?: {
    class20Items?: WarningArea[];
  };
};

function notesOf(kind: WarningKind): string[] {
  const notes = new Set<string>();
  for (const addition of kind.additions ?? []) notes.add(addition);
  for (const property of kind.properties ?? []) {
    for (const local of property.significancyPart?.locals ?? []) {
      if (local.areaName) notes.add(local.areaName);
      for (const addition of local.additions ?? []) notes.add(addition);
    }
  }
  return [...notes];
}

export function parseWarnings(raw: unknown): ActiveWarning[] {
  const bulletins = (Array.isArray(raw) ? raw : []) as WarningBulletin[];
  const ordered = [...bulletins].sort((a, b) =>
    (a.reportDatetime ?? "").localeCompare(b.reportDatetime ?? ""),
  );
  const current = new Map<string, ActiveWarning & { inactive: boolean }>();

  for (const bulletin of ordered) {
    const area = bulletin.warning?.class20Items?.find(
      (item) => item.areaCode === KAMAKURA_CODE,
    );
    if (!area?.kinds) continue;
    const cleared = area.kinds.some(
      (kind) => !kind.code && kind.status === "発表警報・注意報はなし",
    );
    if (cleared) current.clear();
    for (const kind of area.kinds) {
      if (!kind.code || !kind.status) continue;
      const inactive = INACTIVE.has(kind.status);
      current.set(kind.code, {
        code: kind.code,
        name: warningName(kind.code),
        status: kind.status,
        notes: notesOf(kind),
        severe: warningName(kind.code).includes("警報"),
        inactive,
      });
    }
  }

  return [...current.values()]
    .filter((warning) => !warning.inactive)
    .map((warning) => ({
      code: warning.code,
      name: warning.name,
      status: warning.status,
      notes: warning.notes,
      severe: warning.severe,
    }))
    .sort((a, b) => Number(a.code) - Number(b.code));
}
