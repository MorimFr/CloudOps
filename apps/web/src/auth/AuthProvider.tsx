import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type PublicClientApplication,
} from "@azure/msal-browser";
import { MsalProvider, useMsal } from "@azure/msal-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { CloudOpsAuthContext } from "./useCloudOpsAuth";
import { deriveCombinedConsentScope, MICROSOFT_ORGANIZATIONS_AUTHORITY } from "./msal";
import { safeConsentError, type AuthIssue } from "./consent";
import type {
  ApiTokenRequest,
  CloudOpsAccount,
  CloudOpsAuthState,
} from "./types";

interface AuthProviderProps {
  readonly instance: PublicClientApplication | null;
  readonly apiScope: string | null;
  readonly children: ReactNode;
}

function publicAccount(account: AccountInfo | null): CloudOpsAccount | null {
  if (!account) {
    return null;
  }

  return {
    displayName: account.name?.trim() || "Conta Microsoft",
    username: account.username,
    tenantId: account.tenantId,
  };
}

function DisabledAuthProvider({ children }: { readonly children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const value = useMemo<CloudOpsAuthState>(
    () => ({
      configured: false,
      authenticated: false,
      busy: false,
      account: null,
      error,
      authIssue: null,
      sessionEpoch: 0,
      login: async () => {
        setError("Configure os App Registrations Microsoft Entra no arquivo .env.");
      },
      switchAccount: async () => {
        setError("A autenticação Microsoft Entra ainda não está configurada.");
      },
      logout: async () => undefined,
      clearError: () => setError(null),
      getApiAccessToken: async () => {
        throw new Error("Microsoft Entra authentication is not configured.");
      },
      requestCombinedConsent: async () => {
        throw safeConsentError(undefined);
      },
    }),
    [error],
  );

  return (
    <CloudOpsAuthContext.Provider value={value}>
      {children}
    </CloudOpsAuthContext.Provider>
  );
}

function MsalAuthBridge({
  apiScope,
  children,
}: {
  readonly apiScope: string;
  readonly children: ReactNode;
}) {
  const { instance, accounts } = useMsal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authIssue, setAuthIssue] = useState<AuthIssue | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [signedOut, setSignedOut] = useState(false);
  const sessionRevision = useRef(0);
  const sessionAllowed = useRef(true);
  const interactionBusy = useRef(false);
  const combinedConsentScope = deriveCombinedConsentScope(apiScope);

  const activeAccount = signedOut
    ? null
    : instance.getActiveAccount() ?? accounts[0] ?? null;

  useEffect(() => {
    if (!signedOut && !instance.getActiveAccount() && accounts[0]) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, instance, signedOut]);

  const performLogin = useCallback(
    async (prompt?: "select_account") => {
      if (interactionBusy.current) return;
      interactionBusy.current = true;
      setBusy(true);
      setError(null);
      setAuthIssue(null);
      try {
        const result = await instance.loginPopup({
          scopes: [combinedConsentScope],
          ...(prompt ? { prompt } : {}),
        });
        if (!result.account) {
          throw new Error("Authentication result did not include an account.");
        }
        instance.setActiveAccount(result.account);
        sessionAllowed.current = true;
        setSignedOut(false);
        setSessionEpoch(++sessionRevision.current);
      } catch (reason) {
        const safe = safeConsentError(reason);
        setError(safe.message);
        setAuthIssue(safe.issue);
      } finally {
        interactionBusy.current = false;
        setBusy(false);
      }
    },
    [combinedConsentScope, instance],
  );

  const requestCombinedConsent = useCallback(async () => {
    const account = instance.getActiveAccount() ?? accounts[0];
    if (!account || !sessionAllowed.current || interactionBusy.current) throw safeConsentError(undefined);
    const revision = sessionRevision.current;
    interactionBusy.current = true;
    setBusy(true);
    try {
      // This response is for the CloudOps API, not Graph. Its token is not
      // returned or put into React state; execution acquires Assessment.Run next.
      const result = await instance.acquireTokenPopup({
        scopes: [combinedConsentScope],
        prompt: "consent",
        account,
        authority: `${MICROSOFT_ORGANIZATIONS_AUTHORITY.replace(/\/organizations$/, "")}/${account.tenantId}`,
      });
      if (
        !sessionAllowed.current || revision !== sessionRevision.current ||
        result.account?.homeAccountId !== account.homeAccountId ||
        result.account?.tenantId !== account.tenantId ||
        result.account?.localAccountId !== account.localAccountId
      ) throw safeConsentError(undefined);
    } catch (reason) {
      throw safeConsentError(reason);
    } finally {
      interactionBusy.current = false;
      setBusy(false);
    }
  }, [accounts, combinedConsentScope, instance]);

  const logout = useCallback(async () => {
    const account = instance.getActiveAccount() ?? accounts[0] ?? undefined;
    setBusy(true);
    setError(null);
    setAuthIssue(null);
    sessionAllowed.current = false;
    setSignedOut(true);
    instance.setActiveAccount(null);
    setSessionEpoch(++sessionRevision.current);
    try {
      await instance.logoutPopup({ account });
    } catch {
      setError("A sessão local foi limpa; o logout Microsoft pode não ter concluído.");
    } finally {
      try {
        // Switching accounts can leave more than one account in the in-memory
        // MSAL cache. Clear the complete local cache so logout cannot silently
        // fall back to a previously used account.
        await instance.clearCache();
      } catch {
        setError("Não foi possível limpar completamente a sessão local.");
      }
      instance.setActiveAccount(null);
      setBusy(false);
    }
  }, [accounts, instance]);

  const getApiAccessToken = useCallback(
    async (request: ApiTokenRequest = {}) => {
      const account = instance.getActiveAccount() ?? accounts[0];
      if (!account || !sessionAllowed.current) {
        throw new Error("Microsoft authentication is required.");
      }
      const revision = sessionRevision.current;
      const currentSessionToken = (token: string): string => {
        if (!sessionAllowed.current || revision !== sessionRevision.current) {
          throw new Error("Microsoft authentication session changed.");
        }
        return token;
      };

      const tokenRequest = {
        scopes: [apiScope],
        account,
        ...(request.claims ? { claims: request.claims } : {}),
        ...(request.forceRefresh ? { forceRefresh: true } : {}),
      };

      if (request.interactive) {
        const interactive = await instance.acquireTokenPopup(tokenRequest);
        return currentSessionToken(interactive.accessToken);
      }

      try {
        const silent = await instance.acquireTokenSilent(tokenRequest);
        return currentSessionToken(silent.accessToken);
      } catch (reason) {
        if (!(reason instanceof InteractionRequiredAuthError)) {
          throw reason;
        }
        const interactive = await instance.acquireTokenPopup(tokenRequest);
        return currentSessionToken(interactive.accessToken);
      }
    },
    [accounts, apiScope, instance],
  );

  const value = useMemo<CloudOpsAuthState>(
    () => ({
      configured: true,
      authenticated: activeAccount !== null,
      busy,
      account: publicAccount(activeAccount),
      error,
      authIssue,
      sessionEpoch,
      login: async () => performLogin(),
      switchAccount: async () => performLogin("select_account"),
      logout,
      clearError: () => { setError(null); setAuthIssue(null); },
      getApiAccessToken,
      requestCombinedConsent,
    }),
    [
      activeAccount,
      busy,
      error,
      authIssue,
      getApiAccessToken,
      logout,
      performLogin,
      requestCombinedConsent,
      sessionEpoch,
    ],
  );

  return (
    <CloudOpsAuthContext.Provider value={value}>
      {children}
    </CloudOpsAuthContext.Provider>
  );
}

export function AuthProvider({
  instance,
  apiScope,
  children,
}: AuthProviderProps) {
  if (!instance || !apiScope) {
    return <DisabledAuthProvider>{children}</DisabledAuthProvider>;
  }

  return (
    <MsalProvider instance={instance}>
      <MsalAuthBridge apiScope={apiScope}>{children}</MsalAuthBridge>
    </MsalProvider>
  );
}
