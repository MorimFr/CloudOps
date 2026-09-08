import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import {
  createCloudOpsMsalInstance,
  readEntraBrowserSettings,
} from "./auth/msal";
import "./styles.css";
import "./catalog.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("CloudOps could not find the application root.");
}

const applicationRoot = rootElement;

async function bootstrap() {
  const settings = readEntraBrowserSettings();
  let instance = null;

  if (settings) {
    try {
      instance = await createCloudOpsMsalInstance(settings);
    } catch {
      // MSAL failures are presented through the disabled login gate without
      // logging tenant, account, token, or challenge details.
    }
  }

  createRoot(applicationRoot).render(
    <StrictMode>
      <AuthProvider instance={instance} apiScope={settings?.apiScope ?? null}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </StrictMode>,
  );
}

void bootstrap();
