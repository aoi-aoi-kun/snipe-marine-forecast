export async function register() {
  // Only the Node server runtime should keep the learner alive.
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { restoreLearningCache, mirrorLearningCache } = await import(
    "./lib/learning-persist"
  );
  const { startContinuousLearning } = await import("./lib/continuous-learn");
  const { startKeepAlive } = await import("./lib/keep-alive");
  const { touchOps } = await import("./lib/ops-uptime");
  // Prefer Disk mirror / image seed over an empty ephemeral cache after redeploy.
  await restoreLearningCache();
  void touchOps("boot");
  // Ensure mirror exists even before the first learn tick.
  void mirrorLearningCache();
  startContinuousLearning();
  startKeepAlive();
}
