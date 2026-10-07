export async function register() {
  // Only the Node server runtime should keep the learner alive.
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { startContinuousLearning } = await import("./lib/continuous-learn");
  startContinuousLearning();
}
