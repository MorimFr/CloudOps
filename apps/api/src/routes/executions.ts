import { ExecutionIdSchema } from "@cloudops/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { errors } from "../errors.js";
import type {
  ArtifactLease,
  ExecutionManager,
} from "../services/execution-manager.js";

const ExecutionParamsSchema = z
  .object({ executionId: ExecutionIdSchema })
  .strict();

function parseExecutionId(params: unknown): string {
  const parsed = ExecutionParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw errors.invalidRequest();
  }
  return parsed.data.executionId;
}

function sendArtifact(
  reply: FastifyReply,
  executionId: string,
  lease: ArtifactLease,
): FastifyReply {
  let disposed = false;
  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    lease.dispose();
  };

  reply.raw.once("finish", dispose);
  reply.raw.once("close", dispose);
  reply.raw.once("error", dispose);

  try {
    return reply
      .header("Content-Type", "application/zip")
      .header(
        "Content-Disposition",
        `attachment; filename="cloudops-${executionId}.zip"`,
      )
      .header("Cache-Control", "no-store, no-cache, must-revalidate")
      .header("Pragma", "no-cache")
      .header("Expires", "0")
      .send(lease.buffer);
  } catch (error) {
    dispose();
    throw error;
  }
}

export function registerExecutionRoutes(
  app: FastifyInstance,
  executionManager: ExecutionManager,
): void {
  app.get("/api/v1/executions/:executionId", async (request, reply) => {
    const executionId = parseExecutionId(request.params);
    return reply.send(executionManager.require(executionId));
  });

  app.get(
    "/api/v1/executions/:executionId/artifact",
    async (request, reply) => {
      const executionId = parseExecutionId(request.params);
      const lease = executionManager.checkoutArtifact(executionId);
      return sendArtifact(reply, executionId, lease);
    },
  );

  app.delete(
    "/api/v1/executions/:executionId",
    async (request, reply) => {
      const executionId = parseExecutionId(request.params);
      if (!executionManager.cancel(executionId)) {
        throw errors.executionNotFound();
      }
      return reply.code(204).send();
    },
  );
}
