/**
 * Ping this deployment so free-tier hosts are less likely to sleep while the
 * process is already awake. Sleeping instances still need an external cron to
 * /api/health?warm=1 (see README).
 */

const DEFAULT_MINUTES = 8;

let timer: ReturnType<typeof setInterval> | null = null;

function targetUrl(): string | null {
  const raw =
    process.env.KEEP_ALIVE_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    "";
  if (!raw) return null;
  const base = raw.replace(/\/$/, "");
  return `${base}/api/health?warm=1`;
}

async function ping(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "shichirigahama-forecast/keep-alive",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    console.info(`keep-alive: ${response.status} ${url}`);
  } catch (error) {
    console.warn("keep-alive: ping failed", error);
  }
}

export function startKeepAlive() {
  if (timer) return;
  if (process.env.DISABLE_KEEP_ALIVE === "1") {
    console.info("keep-alive: disabled by DISABLE_KEEP_ALIVE=1");
    return;
  }
  const url = targetUrl();
  if (!url) {
    console.info(
      "keep-alive: set KEEP_ALIVE_URL or RENDER_EXTERNAL_URL, or ping /api/health?warm=1 from an external cron",
    );
    return;
  }
  const minutes = Math.max(
    5,
    Number(process.env.KEEP_ALIVE_MINUTES || DEFAULT_MINUTES) || DEFAULT_MINUTES,
  );
  console.info(`keep-alive: every ${minutes} min → ${url}`);
  const delay = setTimeout(() => {
    void ping(url);
  }, 30_000);
  delay.unref?.();
  timer = setInterval(() => {
    void ping(url);
  }, minutes * 60_000);
  timer.unref?.();
}
