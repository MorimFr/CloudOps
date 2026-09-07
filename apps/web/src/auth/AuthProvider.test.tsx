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
        <AuthProvider instance={instance} apiScope="api://api/Assessment.Run">
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
      <AuthProvider instance={instance} apiScope="api://api/Assessment.Run">
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
