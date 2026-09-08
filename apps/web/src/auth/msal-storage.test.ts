/// <reference types="node" />

import { webcrypto } from "node:crypto";
import {
  PublicClientApplication,
  type INetworkModule,
  type NetworkRequestOptions,
  type NetworkResponse,
} from "@azure/msal-browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMsalConfiguration, deriveCombinedConsentScope } from "./msal";

const webId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const scope = "api://33333333-3333-4333-8333-333333333333/Assessment.Run";

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

afterEach(() => vi.unstubAllGlobals());

describe("real MSAL browser storage behavior", () => {
  it("keeps combined login, reconsent and normal API tokens in RAM without persistent OAuth state", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const databaseOpen = vi.fn(() => { throw new Error("Unexpected database access"); });
    vi.stubGlobal("indexedDB", { open: databaseOpen, deleteDatabase: vi.fn() });
    let nonce = "";
    let callbackHash = "";
    let closed = false;
    const popupRequests: URLSearchParams[] = [];
    const popup = {
      get closed() { return closed; },
      close: () => { closed = true; },
      focus: vi.fn(),
      document: document.implementation.createHTMLDocument("Authentication"),
      location: {
        get href() { return `http://localhost:5173/auth-redirect.html${callbackHash}`; },
        get hash() { return callbackHash; },
        assign: (url: string) => {
          const parameters = new URL(url).searchParams;
          popupRequests.push(parameters);
          nonce = parameters.get("nonce") ?? "";
          callbackHash = `#code=synthetic-code&state=${encodeURIComponent(parameters.get("state") ?? "")}`;
          expect(storageWrite).not.toHaveBeenCalled();
        },
      },
    };
    vi.spyOn(window, "open").mockImplementation(() => {
      closed = false;
      callbackHash = "";
      return popup as unknown as Window;
    });
    const post = vi.fn();
    const network: INetworkModule = {
      async sendGetRequestAsync<T>(): Promise<NetworkResponse<T>> {
        throw new Error("Static identity metadata should avoid network discovery");
      },
      async sendPostRequestAsync<T>(_url: string, options?: NetworkRequestOptions): Promise<NetworkResponse<T>> {
        post(options);
        const now = Math.floor(Date.now() / 1000);
        return {
          status: 200,
          headers: {},
          body: {
            token_type: "Bearer",
            scope,
            expires_in: 3600,
            ext_expires_in: 3600,
            access_token: "synthetic-api-access-token",
            refresh_token: "synthetic-refresh-token",
            client_info: encode({ uid: "local-user", utid: tenantId }),
            id_token: `${encode({ alg: "none" })}.${encode({
              aud: webId, iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
              tid: tenantId, oid: "local-user", sub: "local-user", nonce,
              name: "Synthetic User", preferred_username: "synthetic@example.invalid",
              iat: now, exp: now + 3600,
            })}.synthetic`,
          } as T,
        };
      },
    };
    const configuration = createMsalConfiguration({ clientId: webId, apiScope: scope });
    configuration.auth.cloudDiscoveryMetadata = JSON.stringify({
      metadata: [{ preferred_network: "login.microsoftonline.com", preferred_cache: "login.microsoftonline.com", aliases: ["login.microsoftonline.com"] }],
    });
    configuration.auth.authorityMetadata = JSON.stringify({
      authorization_endpoint: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
      token_endpoint: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
      end_session_endpoint: "https://login.microsoftonline.com/organizations/oauth2/v2.0/logout",
      issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
      jwks_uri: "https://login.microsoftonline.com/organizations/discovery/v2.0/keys",
    });
    configuration.system = { ...configuration.system, networkClient: network, pollIntervalMilliseconds: 1 };
    const instance = new PublicClientApplication(configuration);
    await instance.initialize();
    const combined = deriveCombinedConsentScope(scope);
    const login = await instance.loginPopup({ scopes: [combined] });
    expect(login.accessToken).toBe("synthetic-api-access-token");
    expect(post).toHaveBeenCalledOnce();
    expect(new URLSearchParams(post.mock.calls[0]?.[0].body).get("code_verifier")).toBeTruthy();
    expect(login.account).not.toBeNull();
    const silent = await instance.acquireTokenSilent({ scopes: [scope], account: login.account! });
    expect(silent.accessToken).toBe(login.accessToken);
    expect(post).toHaveBeenCalledOnce();
    await instance.acquireTokenPopup({ scopes: [combined], account: login.account!, prompt: "consent" });
    await instance.acquireTokenSilent({ scopes: [scope], account: login.account!, forceRefresh: true });
    expect(post).toHaveBeenCalledTimes(3);
    expect(popupRequests).toHaveLength(2);
    for (const request of popupRequests) {
      const requestedScopes = request.get("scope")?.split(" ");
      expect(requestedScopes).toContain(combined);
      expect(requestedScopes).not.toContain(scope);
      expect(request.get("scope")).not.toContain("graph.microsoft.com");
    }
    expect(popupRequests[1]?.get("prompt")).toBe("consent");
    expect(new URLSearchParams(post.mock.calls[2]?.[0].body).get("scope")).toContain(scope);
    expect(storageWrite).not.toHaveBeenCalled();
    expect(databaseOpen).not.toHaveBeenCalled();

    const refreshedPage = new PublicClientApplication(configuration);
    await refreshedPage.initialize();
    expect(refreshedPage.getAllAccounts()).toEqual([]);
    expect(storageWrite).not.toHaveBeenCalled();
  });
});
