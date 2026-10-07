import {
  getContinuousLearnStatus,
  setContinuousLearnStarted,
  setContinuousLearnTickResult,
  setContinuousLearnTicking,
} from "./continuous-learn-state";

const TICK_MS = 15 * 60 * 1000;
const START_DELAY_MS = 45_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(reason: string) {
  const status = getContinuousLearnStatus();
  if (status.ticking) {
    console.info(`continuous-learn: skip (${reason}), already running`);
    return;
  }
  setContinuousLearnTicking(true);
  try {
    console.info(`continuous-learn: tick (${reason})`);
    const { getForecast } = await import("./forecast");
    const { loadMosStore, summarizeMos } = await import("./mos");
    const forecast = await getForecast(false);
    const summary = summarizeMos(await loadMosStore());
    setContinuousLearnTickResult(forecast.errors[0] ?? null);
    console.info(
      `continuous-learn: done pairs=${summary.pairCount} activeBins=${summary.activeBins}` +
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
    `continuous-learn: scheduled every ${TICK_MS / 60_000} minutes (first tick in ${START_DELAY_MS / 1000}s)`,
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
