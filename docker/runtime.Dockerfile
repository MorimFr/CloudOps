# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.20.0

FROM node:${NODE_VERSION}-trixie-slim AS node-powershell

ARG NODE_VERSION
ARG TARGETARCH
ARG POWERSHELL_VERSION=7.6.5

USER root

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    case "${TARGETARCH}" in \
      amd64) \
        ps_asset="powershell_${POWERSHELL_VERSION}-1.deb_amd64.deb"; \
        ps_sha256="dd683d29a5c95ed43e426f4fe1679469d8b89e78ea955455f6238a0b0e6f1a24"; \
        ;; \
      arm64) \
        ps_asset="powershell_${POWERSHELL_VERSION}-1.deb_arm64.deb"; \
        ps_sha256="df09c222871de1f63a65308d50dd717b5e9ff01a1df1b9a5ead0953a56020dbd"; \
        ;; \
      *) \
        echo "Unsupported target architecture: ${TARGETARCH}" >&2; \
        exit 1; \
        ;; \
    esac; \
    curl --fail --silent --show-error --location \
      "https://github.com/PowerShell/PowerShell/releases/download/v${POWERSHELL_VERSION}/${ps_asset}" \
      --output "/tmp/${ps_asset}"; \
    echo "${ps_sha256}  /tmp/${ps_asset}" | sha256sum --check --strict -; \
    apt-get install -y --no-install-recommends "/tmp/${ps_asset}"; \
    rm -f "/tmp/${ps_asset}"; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*; \
    node --version | grep -Fx "v${NODE_VERSION}"; \
    pwsh --version | grep -Fx "PowerShell ${POWERSHELL_VERSION}"

ENV POWERSHELL_TELEMETRY_OPTOUT=1 \
    POWERSHELL_UPDATECHECK=Off \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

FROM node-powershell AS dependencies

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN npm ci && chown -R node:node /workspace

FROM dependencies AS development

COPY --chown=node:node . .

USER node

FROM dependencies AS builder

COPY . .

RUN npm run build && npm prune --omit=dev

FROM node-powershell AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HOME=/tmp/cloudops-home \
    CLOUDOPS_ENGINE_ROOT=/workspace/engine

WORKDIR /workspace

COPY --from=builder --chown=node:node /workspace/package.json /workspace/package-lock.json ./
COPY --from=builder --chown=node:node /workspace/node_modules ./node_modules
COPY --from=builder --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /workspace/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder --chown=node:node /workspace/engine ./engine

USER node

EXPOSE 3000

CMD ["node", "apps/api/dist/server.js"]
