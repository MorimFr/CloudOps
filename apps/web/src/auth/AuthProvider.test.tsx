import type {
  AccountInfo,
  PublicClientApplication,
} from "@azure/msal-browser";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { useMsalMock } = vi.hoisted(() => ({
  useMsalMock: vi.fn(),
}));

vi.mock("@azure/msal-react", () => ({
  MsalProvider: ({ children }: { readonly children: ReactNode }) => children,
  useMsal: useMsalMock,
}));

import { AuthProvider } from "./AuthProvider";
import { useCloudOpsAuth } from "./useCloudOpsAuth";
import { ConsentInteractionError } from "./consent";

function SessionHarness() {
  const auth = useCloudOpsAuth();
  return (
    <div>
      <span>{auth.authenticated ? "authenticated" : "signed-out"}</span>
      <button type="button" onClick={() => void auth.logout()}>
        Logout
      </button>
    </div>
  );
}

function account(id: string): AccountInfo {
  return {
    homeAccountId: `home-${id}`,
    environment: "login.microsoftonline.com",
    tenantId: "22222222-2222-4222-8222-222222222222",
    username: `${id}@example.invalid`,
    localAccountId: id,
    name: id,
  } as AccountInfo;
}

const apiScope = "api://11111111-1111-4111-8111-111111111111/Assessment.Run";
const consentScope = "api://11111111-1111-4111-8111-111111111111/.default";

function setupConsentAuth() {
  let active: AccountInfo | null = account("current");
  const accounts = [active];
  const loginPopup = vi.fn(async () => ({ account: active, accessToken: "api-consent-result-not-state" }));
  const acquireTokenPopup = vi.fn(async () => ({ account: active, accessToken: "api-popup-result-not-state" }));
  const acquireTokenSilent = vi.fn(async () => ({ account: active, accessToken: "normal-api-token-not-state" }));
  const instance = {
    getActiveAccount: () => active,
    setActiveAccount: (next: AccountInfo | null) => { active = next; },
    loginPopup, acquireTokenPopup, acquireTokenSilent,
    clearCache: vi.fn(async () => undefined), logoutPopup: vi.fn(async () => undefined),
  } as unknown as PublicClientApplication;
  useMsalMock.mockReturnValue({ instance, accounts });
  const hook = renderHook(() => useCloudOpsAuth(), { wrapper: ({ children }: { readonly children: ReactNode }) =>
    <AuthProvider instance={instance} apiScope={apiScope}>{children}</AuthProvider> });
  return { ...hook, instance, loginPopup, acquireTokenPopup, acquireTokenSilent };
}

describe("combined consent boundary", () => {
  it("onboards and switches accounts with only the API .default scope", async () => {
    const { result, loginPopup } = setupConsentAuth();
    await act(async () => { await result.current.login(); });
    expect(loginPopup).toHaveBeenNthCalledWith(1, { scopes: [consentScope] });
    await act(async () => { await result.current.switchAccount(); });
    expect(loginPopup).toHaveBeenNthCalledWith(2, { scopes: [consentScope], prompt: "select_account" });
    expect(JSON.stringify(result.current)).not.toContain("api-consent-result-not-state");
  });

  it("acquires normal API tokens with Assessment.Run, never .default or Graph", async () => {
    const { result, acquireTokenSilent } = setupConsentAuth();
    await expect(result.current.getApiAccessToken()).resolves.toBe("normal-api-token-not-state");
    expect(acquireTokenSilent).toHaveBeenCalledWith({ scopes: [apiScope], account: account("current") });
  });

  it("recovers with prompt=consent and then refreshes Assessment.Run separately", async () => {
    const { result, acquireTokenPopup, acquireTokenSilent } = setupConsentAuth();
    await act(async () => { await expect(result.current.requestCombinedConsent()).resolves.toBeUndefined(); });
    expect(acquireTokenPopup).toHaveBeenCalledWith({
      scopes: [consentScope], prompt: "consent", account: account("current"),
      authority: "https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222",
    });
    await result.current.getApiAccessToken({ forceRefresh: true });
    expect(acquireTokenSilent).toHaveBeenCalledWith({ scopes: [apiScope], account: account("current"), forceRefresh: true });
    expect(JSON.stringify(result.current)).not.toMatch(/api-popup-result-not-state|normal-api-token-not-state|graphToken/);
  });

  it("returns a safe cancellation without retaining the raw MSAL error", async () => {
    const { result, acquireTokenPopup, acquireTokenSilent } = setupConsentAuth();
    acquireTokenPopup.mockRejectedValueOnce({ errorCode: "user_cancelled", message: "raw-sensitive-token" });
    await act(async () => {
      const error = await result.current.requestCombinedConsent().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ConsentInteractionError);
      expect(error).toMatchObject({ cancelled: true, issue: { state: "CONSENT_REQUIRED" } });
      expect(JSON.stringify(error)).not.toContain("raw-sensitive-token");
    });
    expect(acquireTokenSilent).not.toHaveBeenCalled();
  });

  it("recognizes administrative approval on login and consent recovery", async () => {
    const { result, loginPopup, acquireTokenPopup } = setupConsentAuth();
    loginPopup.mockRejectedValueOnce({ errorNo: "90094", message: "raw-directory-data" });
    await act(async () => { await result.current.login(); });
    expect(result.current.authIssue?.state).toBe("ADMIN_APPROVAL_REQUIRED");
    expect(result.current.error).not.toContain("raw-directory-data");
    acquireTokenPopup.mockRejectedValueOnce({ errorMessage: "AADSTS90095: raw-directory-data" });
    await act(async () => {
      await expect(result.current.requestCombinedConsent()).rejects.toMatchObject({ issue: { state: "ADMIN_APPROVAL_REQUIRED" } });
    });
  });

  it("does not retry an assessment under a different identity selected in a consent popup", async () => {
    const { result, acquireTokenPopup } = setupConsentAuth();
    acquireTokenPopup.mockResolvedValueOnce({ account: account("different"), accessToken: "must-not-escape" });
    await act(async () => { await expect(result.current.requestCombinedConsent()).rejects.toBeInstanceOf(ConsentInteractionError); });
    expect(result.current.account?.username).toBe("current@example.invalid");
  });
});

describe("AuthProvider logout", () => {
  it("invalidates the session immediately and discards an in-flight token after logout", async () => {
    const accounts = [account("previous")];
    let resolveToken!: (value: { accessToken: string }) => void;
    let resolveLogout!: () => void;
    const clearCache = vi.fn(async () => { throw new Error("Synthetic cache failure"); });
    const instance = {
      getActiveAccount: vi.fn(() => accounts[0]),
      setActiveAccount: vi.fn(),
      clearCache,
      acquireTokenSilent: vi.fn(() => new Promise((resolve) => { resolveToken = resolve; })),
      logoutPopup: vi.fn(() => new Promise<void>((resolve) => { resolveLogout = resolve; })),
    } as unknown as PublicClientApplication;
    useMsalMock.mockReturnValue({ instance, accounts });
    const { result } = renderHook(() => useCloudOpsAuth(), {
      wrapper: ({ children }: { readonly children: ReactNode }) => (
        <AuthProvider instance={instance} apiScope="api://11111111-1111-4111-8111-111111111111/Assessment.Run">
          {children}
        </AuthProvider>
      ),
    });
    const token = result.current.getApiAccessToken();
    const rejectedToken = expect(token).rejects.toThrow("session changed");
    let logout!: Promise<void>;
    act(() => { logout = result.current.logout(); });
    expect(result.current.authenticated).toBe(false);
    resolveToken({ accessToken: "stale-must-not-be-used" });
    await rejectedToken;
    await act(async () => { resolveLogout(); await logout; });
    expect(result.current.authenticated).toBe(false);
    await expect(result.current.getApiAccessToken()).rejects.toThrow("authentication is required");
  });

  it("clears every cached account so logout cannot fall back to an old account", async () => {
    const first = account("first");
    const second = account("second");
    const accounts = [first, second];
    let activeAccount: AccountInfo | null = second;

    const clearCache = vi.fn(async () => {
      accounts.splice(0, accounts.length);
      activeAccount = null;
    });
    const logoutPopup = vi.fn(async () => undefined);
    const setActiveAccount = vi.fn((next: AccountInfo | null) => {
      activeAccount = next;
    });
    const instance = {
      clearCache,
      getActiveAccount: vi.fn(() => activeAccount),
      logoutPopup,
      setActiveAccount,
    } as unknown as PublicClientApplication;

    useMsalMock.mockReturnValue({ instance, accounts });

    render(
      <AuthProvider instance={instance} apiScope="api://11111111-1111-4111-8111-111111111111/Assessment.Run">
        <SessionHarness />
      </AuthProvider>,
    );

    expect(screen.getByText("authenticated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => {
      expect(clearCache).toHaveBeenCalledWith();
      expect(screen.getByText("signed-out")).toBeInTheDocument();
    });
    expect(logoutPopup).toHaveBeenCalledWith({ account: second });
    expect(setActiveAccount).toHaveBeenLastCalledWith(null);
  });
});
