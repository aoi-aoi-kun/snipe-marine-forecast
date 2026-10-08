import {
  getContinuousLearnStatus,
  setContinuousLearnStarted,
  setContinuousLearnTickResult,
  setContinuousLearnTicking,
} from "./continuous-learn-state";

const TICK_MS = 10 * 60 * 1000;
/** Wait until the HTTP server is accepting traffic before heavy work. */
const START_DELAY_MS = 90_000;
/** Every 3rd tick (~30 min) force refresh so harbor/IFS caches do not stall learning. */
const REFRESH_EVERY_N_TICKS = 3;

let timer: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;

async function tick(reason: string) {
  const status = getContinuousLearnStatus();
  if (status.ticking) {
    console.info(`continuous-learn: skip (${reason}), already running`);
    return;
  }
  setContinuousLearnTicking(true);
  tickCount += 1;
  // Free-tier OOM risk: never pull all 46 IFS steps on the first tick.
  // Startup / early ticks only refresh harbor; full IFS comes later.
  const refresh =
    reason !== "startup" && tickCount >= 2 && tickCount % REFRESH_EVERY_N_TICKS === 0;
  try {
    console.info(`continuous-learn: tick (${reason}) refresh=${refresh}`);
    const { getForecast } = await import("./forecast");
    const { loadMosStore, summarizeMos } = await import("./mos");
    const { loadNowcastCalib, summarizeNowcastCalib } = await import("./nowcast-learn");
    const { loadPatternStore } = await import("./pattern");
    const { loadMetaCalib, summarizeMetaCalib } = await import("./meta-calib");

    // Always refresh harbor so 5-minute observations keep feeding MOS / nowcast / meta.
    const forecast = await getForecast({ refresh, refreshHarbor: true });
    const mos = summarizeMos(await loadMosStore());
    const nowcast = summarizeNowcastCalib(await loadNowcastCalib());
    const patterns = await loadPatternStore();
    const meta = summarizeMetaCalib(await loadMetaCalib());

    setContinuousLearnTickResult(forecast.errors[0] ?? null);
    const { touchOps } = await import("./ops-uptime");
    await touchOps("learn");
    console.info(
      `continuous-learn: done mosPairs=${mos.pairCount} nowcastCases=${nowcast.caseCount} ` +
        `rampPatterns=${patterns.events.length} ` +
        `metaλ mos=${meta.mosLambda.toFixed(2)}/${meta.mosCases} pattern=${meta.patternLambda.toFixed(2)}/${meta.patternCases}` +
        (forecast.errors[0] ? ` error=${forecast.errors[0]}` : ""),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "学習に失敗しました";
    setContinuousLearnTickResult(message);
    console.warn("continuous-learn: failed", error);
  } finally {
    setContinuousLearnTicking(false);
  }
}

/** Start background learning while the Node server process is alive. */
export function startContinuousLearning() {
  if (getContinuousLearnStatus().started) return;
  if (process.env.DISABLE_CONTINUOUS_LEARN === "1") {
    console.info("continuous-learn: disabled by DISABLE_CONTINUOUS_LEARN=1");
    return;
  }
  setContinuousLearnStarted(true, TICK_MS / 60_000);
  console.info(
    `continuous-learn: MOS + nowcast + ramp + meta-λ every ${TICK_MS / 60_000} min ` +
      `(first tick in ${START_DELAY_MS / 1000}s)`,
  );
  const delay = setTimeout(() => {
    void tick("startup");
  }, START_DELAY_MS);
  delay.unref?.();
  timer = setInterval(() => {
    void tick("interval");
  }, TICK_MS);
  timer.unref?.();
}

export function continuousLearnStatus() {
  return getContinuousLearnStatus();
}
