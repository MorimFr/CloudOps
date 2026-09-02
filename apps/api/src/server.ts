import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });
  let closing = false;

  const close = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    await app.close();
  };

  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });

  await app.listen({ host: config.host, port: config.port });
}

main().catch(() => {
  // Startup errors are deliberately generic: configuration, internal paths, and
  // environment values must not be reflected to logs or callers.
  console.error("CloudOps API failed to start.");
  process.exitCode = 1;
});
