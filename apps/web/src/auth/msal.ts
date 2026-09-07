import {
  BrowserCacheLocation,
  PublicClientApplication,
  type Configuration,
} from "@azure/msal-browser";

export const MICROSOFT_ORGANIZATIONS_AUTHORITY =
  "https://login.microsoftonline.com/organizations";
export const AUTH_REDIRECT_PATH = "/auth-redirect.html";

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_SCOPE_PATTERN =
  /^api:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/Assessment\.Run$/i;

export interface EntraBrowserSettings {
  readonly clientId: string;
  readonly apiScope: string;
}

export function readEntraBrowserSettings(): EntraBrowserSettings | null {
  const clientId = import.meta.env.VITE_ENTRA_WEB_CLIENT_ID?.trim() ?? "";
  const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE?.trim() ?? "";
  const scopeMatch = API_SCOPE_PATTERN.exec(apiScope);

  if (
    !GUID_PATTERN.test(clientId) ||
    !scopeMatch?.[1] ||
    !GUID_PATTERN.test(scopeMatch[1]) ||
    scopeMatch[1].toLowerCase() === clientId.toLowerCase()
  ) {
    return null;
  }

  return { clientId, apiScope };
}

export function createMsalConfiguration(
  settings: EntraBrowserSettings,
  origin = window.location.origin,
): Configuration {
  const redirectUri = `${origin}${AUTH_REDIRECT_PATH}`;

  return {
    auth: {
      clientId: settings.clientId,
      authority: MICROSOFT_ORGANIZATIONS_AUTHORITY,
      redirectUri,
      postLogoutRedirectUri: redirectUri,
      clientCapabilities: ["CP1"],
    },
    cache: {
      cacheLocation: BrowserCacheLocation.MemoryStorage,
      temporaryCacheLocation: BrowserCacheLocation.MemoryStorage,
      cacheRetentionDays: 0,
      cacheMigrationEnabled: false,
      storeAuthStateInCookie: false,
    },
    system: {
      allowPlatformBroker: false,
      loggerOptions: {
        piiLoggingEnabled: false,
        loggerCallback: () => {
          // Authentication messages can contain identifiers or challenges.
        },
      },
    },
  };
}

export async function createCloudOpsMsalInstance(
  settings: EntraBrowserSettings,
): Promise<PublicClientApplication> {
  const instance = new PublicClientApplication(createMsalConfiguration(settings));
  await instance.initialize();
  return instance;
}
