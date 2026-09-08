// Synthetic UI-only entry. Playwright intercepts main.tsx in its own isolated
// browser context. This file is never imported by the production application.
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "../src/App";
import { CloudOpsAuthContext } from "../src/auth/useCloudOpsAuth";
import type { CloudOpsAuthState } from "../src/auth/types";
import "../src/styles.css";
import "../src/catalog.css";

if (!import.meta.env.DEV) throw new Error("UI test fixture requires development mode");
const auth: CloudOpsAuthState = {
  configured: true, authenticated: true, busy: false,
  account: { displayName: "Usuário de teste", username: "synthetic@example.invalid", tenantId: "22222222-2222-4222-8222-222222222222" },
  error: null, authIssue: null, sessionEpoch: 1,
  login: async () => undefined, logout: async () => undefined, switchAccount: async () => undefined, clearError: () => undefined,
  getApiAccessToken: async () => `synthetic-api-${"a".repeat(48)}`,
  requestCombinedConsent: async () => undefined,
};
createRoot(document.getElementById("root")!).render(
  <CloudOpsAuthContext.Provider value={auth}><BrowserRouter><App /></BrowserRouter></CloudOpsAuthContext.Provider>,
);
