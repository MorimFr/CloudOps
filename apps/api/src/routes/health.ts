import type { FastifyInstance } from "fastify";

import type { AssessmentRuntime } from "../services/powershell-runtime.js";

export function registerHealthRoute(
  app: FastifyInstance,
  runtime: AssessmentRuntime,
): void {
  app.get("/api/v1/health", async (_request, reply) => {
    const powershell = await runtime.isAvailable();
    return reply.code(powershell ? 200 : 503).send({
      status: powershell ? "ok" : "degraded",
      runtime: { powershell },
    });
  });
}
