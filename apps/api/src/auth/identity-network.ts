import type {
  INetworkModule,
  NetworkRequestOptions,
  NetworkResponse,
} from "@azure/msal-node";

import { errors } from "../errors.js";

const MAX_IDENTITY_RESPONSE_BYTES = 1024 * 1024;

/** Request-scoped, abortable MSAL transport. No cookies, redirects or disk cache. */
export function createIdentityNetwork(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): INetworkModule {
  async function send<T>(
    method: "GET" | "POST",
    url: string,
    options?: NetworkRequestOptions,
  ): Promise<NetworkResponse<T>> {
    const chunks: Uint8Array[] = [];
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let combined: Buffer | undefined;
    try {
      const target = new URL(url);
      if (
        target.origin !== "https://login.microsoftonline.com" ||
        target.username !== "" || target.password !== "" ||
        target.hash !== "" || signal.aborted
      ) {
        throw errors.graphUnavailable();
      }
      const response = await fetcher(target, {
        method,
        ...(options?.headers ? { headers: options.headers } : {}),
        ...(method === "POST" && options?.body ? { body: options.body } : {}),
        signal,
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.body || (response.status >= 300 && response.status < 400)) {
        throw errors.graphUnavailable();
      }
      reader = response.body.getReader();
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_IDENTITY_RESPONSE_BYTES) {
          chunk.value.fill(0);
          throw errors.graphUnavailable();
        }
        chunks.push(chunk.value);
      }
      combined = Buffer.concat(chunks, size);
      const body = JSON.parse(combined.toString("utf8")) as T;
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body,
      };
    } catch {
      throw errors.graphUnavailable();
    } finally {
      combined?.fill(0);
      for (const chunk of chunks) chunk.fill(0);
      if (reader) {
        try { await reader.cancel(); } catch { /* Best-effort cleanup. */ }
        reader.releaseLock();
      }
    }
  }

  return {
    sendGetRequestAsync: <T>(url: string, options?: NetworkRequestOptions) =>
      send<T>("GET", url, options),
    sendPostRequestAsync: <T>(url: string, options?: NetworkRequestOptions) =>
      send<T>("POST", url, options),
  };
}
