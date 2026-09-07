import { createContext, useContext } from "react";

import type { CloudOpsAuthState } from "./types";

export const CloudOpsAuthContext = createContext<CloudOpsAuthState | null>(null);

export function useCloudOpsAuth(): CloudOpsAuthState {
  const context = useContext(CloudOpsAuthContext);
  if (!context) {
    throw new Error("CloudOps authentication provider is missing.");
  }
  return context;
}
