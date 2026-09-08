import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

export default defineConfig({
  plugins: [react(), {
    name: "isolated-msal-popup-callback",
    // Vite otherwise injects HMR/React Refresh scripts into this HTML in dev.
    // Serve only the static code asset, before HTML transformation middleware.
    configureServer(server) {
      const callback = readFileSync(new URL("./auth-redirect.html", import.meta.url));
      server.middlewares.use((request, response, next) => {
        if ((request.method !== "GET" && request.method !== "HEAD") || request.url?.split("?")[0] !== "/auth-redirect.html") {
          next();
          return;
        }
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.end(request.method === "HEAD" ? undefined : callback);
      });
    },
  }],
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        authRedirect: fileURLToPath(
          new URL("./auth-redirect.html", import.meta.url),
        ),
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    headers: {
      "Cache-Control": "no-store",
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    headers: {
      "Cache-Control": "no-store",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
