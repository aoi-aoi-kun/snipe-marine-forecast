export async function register() {
  // Only the Node server runtime should keep the learner alive.
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { startContinuousLearning } = await import("./lib/continuous-learn");
  const { startKeepAlive } = await import("./lib/keep-alive");
  const { touchOps } = await import("./lib/ops-uptime");
  void touchOps("boot");
  startContinuousLearning();
  startKeepAlive();
}
