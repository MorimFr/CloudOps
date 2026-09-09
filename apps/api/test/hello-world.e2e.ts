// Explicit local-only E2E harness. Not imported by the production application.
// RSA signing keys and synthetic API tokens exist only in process memory.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.js";
import { createLocalAuthHarness } from "./auth-helpers.js";

const harness = await createLocalAuthHarness();
const app = await buildApp({
  logger: false, config: { nodeEnv: "test" }, tokenValidator: harness.validator,
  graphTokenBroker: { acquireToken: async () => { throw new Error("Graph is forbidden in this synthetic E2E"); } },
});
try {
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  let token = await harness.issueToken();
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../../scripts/validate-e2e.mjs", import.meta.url))], {
    shell: false, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLOUDOPS_API_URL: address, CLOUDOPS_E2E_API_TOKEN: token },
  });
  token = "";
  // The child reports only a generic outcome; no captured payloads or keys.
  child.stdout.resume();
  child.stderr.resume();
  const timeout = setTimeout(() => child.kill(), 45000);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", () => reject(new Error("Local E2E process failed")));
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error("Local Hello World E2E failed")));
    });
    console.log("PASS: manifest discovery -> authenticated HTTP -> PowerShell -> RAM ZIP -> download-once (synthetic identity).");
  } finally { clearTimeout(timeout); }
} finally { await app.close(); }
