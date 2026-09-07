export interface CloudOpsAccount {
  readonly displayName: string;
  readonly username: string;
  readonly tenantId: string;
}

export interface ApiTokenRequest {
  readonly claims?: string;
  readonly forceRefresh?: boolean;
  readonly interactive?: boolean;
}

export type ApiAccessTokenProvider = (
  request?: ApiTokenRequest,
) => Promise<string>;

export interface CloudOpsAuthState {
  readonly configured: boolean;
  readonly authenticated: boolean;
  readonly busy: boolean;
  readonly account: CloudOpsAccount | null;
  readonly error: string | null;
  readonly sessionEpoch: number;
  readonly login: () => Promise<void>;
  readonly switchAccount: () => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly clearError: () => void;
  readonly getApiAccessToken: ApiAccessTokenProvider;
}
