import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { lookup as systemLookup, type LookupOptions } from "node:dns";
import { Resolver } from "node:dns/promises";

type LookupCallback = {
  (error: NodeJS.ErrnoException | null, address: string, family: number): void;
  (
    error: NodeJS.ErrnoException | null,
    addresses: { address: string; family: number }[],
  ): void;
};

let systemDns: "unknown" | "ok" | "down" = "unknown";
const publicResolver = new Resolver();
publicResolver.setServers(["1.1.1.1", "8.8.8.8"]);

function publicLookup(hostname: string, options: LookupOptions, callback: LookupCallback) {
  publicResolver.resolve4(hostname).then(
    (addresses) => {
      if (addresses.length === 0) {
        const error = new Error(`DNS で ${hostname} を解決できません`) as NodeJS.ErrnoException;
        error.code = "ENOTFOUND";
        callback(error, "", 0);
        return;
      }
      if (options.all) {
        callback(
          null,
          addresses.map((address) => ({ address, family: 4 })),
        );
        return;
      }
      callback(null, addresses[0], 4);
    },
    (error: NodeJS.ErrnoException) => callback(error, "", 0),
  );
}

function lookup(hostname: string, options: LookupOptions, callback: LookupCallback) {
  if (systemDns === "down") {
    publicLookup(hostname, options, callback);
    return;
  }

  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    systemDns = "down";
    publicLookup(hostname, options, callback);
  }, 1500);

  systemLookup(hostname, { family: 4 }, (error, address, family) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (!error && address) {
      systemDns = "ok";
      if (options.all) callback(null, [{ address, family: family ?? 4 }]);
      else callback(null, address, family);
      return;
    }
    systemDns = "down";
    publicLookup(hostname, options, callback);
  });
}

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  lookup,
});

export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

type GetOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  range?: { start: number; end: number };
  attempts?: number;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestOnce(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      { method: "GET", headers, agent, timeout: timeoutMs },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: new Uint8Array(Buffer.concat(chunks)),
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

export async function getBytes(url: string, options: GetOptions = {}): Promise<{ status: number; body: Uint8Array }> {
  const attempts = options.attempts ?? 3;
  const headers = { ...(options.headers ?? {}) };
  if (options.range) headers.Range = `bytes=${options.range.start}-${options.range.end}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      let current = url;
      for (let redirect = 0; redirect < 3; redirect++) {
        const response = await requestOnce(current, headers, options.timeoutMs ?? 30_000);
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.location;
          if (!location || options.range) throw new HttpStatusError(response.status);
          const next = new URL(location, current);
          if (next.protocol !== "https:") throw new Error("HTTPS 以外には移動しません");
          current = next.toString();
          continue;
        }
        if (
          response.status === 404 ||
          response.status === 400 ||
          response.status === 416
        ) {
          throw new HttpStatusError(response.status);
        }
        if (response.status === 429 || response.status >= 500) {
          throw new HttpStatusError(response.status);
        }
        return { status: response.status, body: response.body };
      }
      throw new Error("転送が多すぎます");
    } catch (error) {
      lastError = error;
      if (
        error instanceof HttpStatusError &&
        (error.status === 404 || error.status === 400 || error.status === 416)
      ) {
        throw error;
      }
      if (attempt < attempts - 1) await delay(400 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("取得に失敗しました");
}
