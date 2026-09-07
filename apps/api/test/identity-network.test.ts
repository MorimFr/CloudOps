import { describe, expect, it, vi } from "vitest";

import { createIdentityNetwork } from "../src/auth/identity-network.js";

describe("identity network boundary", () => {
  it("pins the host and avoids redirects, cookies and response caching", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"access_token":"synthetic"}'));
    const network = createIdentityNetwork(controller.signal, fetcher);
    await expect(network.sendPostRequestAsync("https://login.microsoftonline.com/tenant/oauth2/v2.0/token", { body: "synthetic-body" }))
      .resolves.toMatchObject({ body: { access_token: "synthetic" } });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST", redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal,
    });
    await expect(network.sendPostRequestAsync("https://attacker.invalid/token", { body: "private-body" }))
      .rejects.toMatchObject({ code: "GRAPH_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("aborts a pending token POST and returns a safe failure", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => await new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("sensitive transport details")), { once: true });
    }));
    const operation = createIdentityNetwork(controller.signal, fetcher)
      .sendPostRequestAsync("https://login.microsoftonline.com/tenant/oauth2/v2.0/token");
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: "GRAPH_UNAVAILABLE" });
  });

  it("rejects an oversized streamed response", async () => {
    const bytes = new Uint8Array(1024 * 1024 + 1).fill(65);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    })));
    await expect(createIdentityNetwork(new AbortController().signal, fetcher)
      .sendGetRequestAsync("https://login.microsoftonline.com/organizations/metadata"))
      .rejects.toMatchObject({ code: "GRAPH_UNAVAILABLE" });
    expect(bytes.every((value) => value === 0)).toBe(true);
  });
});
