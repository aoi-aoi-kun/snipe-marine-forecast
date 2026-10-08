import path from "node:path";

/**
 * Durable learning / forecast cache root.
 * Set CACHE_DIR (e.g. /app/.cache on a Render Disk) to survive redeploys.
 */
export function getCacheDir(): string {
  const fromEnv = process.env.CACHE_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(process.cwd(), ".cache");
}
