/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUDOPS_API_URL?: string;
  readonly VITE_ENTRA_WEB_CLIENT_ID?: string;
  readonly VITE_ENTRA_API_SCOPE?: string;
  readonly VITE_SHOW_DEV_ASSESSMENTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
