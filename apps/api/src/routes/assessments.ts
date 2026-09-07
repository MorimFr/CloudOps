import {
  AssessmentIdSchema,
  CreateExecutionBodySchema,
} from "@cloudops/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { errors } from "../errors.js";
import type { EntraAuth } from "../auth/entra-auth.js";
import type { AssessmentRegistry } from "../services/assessment-registry.js";
import type { ExecutionManager } from "../services/execution-manager.js";

const AssessmentParamsSchema = z
  .object({ assessmentId: AssessmentIdSchema })
  .strict();

export function registerAssessmentRoutes(
  app: FastifyInstance,
  registry: AssessmentRegistry,
  executionManager: ExecutionManager,
  auth: EntraAuth,
): void {
  app.get("/api/v1/assessments", async (request, reply) => {
    auth.require(request);
    return reply.send(registry.list());
  });

  app.post(
    "/api/v1/assessments/:assessmentId/executions",
    async (request, reply) => {
      const params = AssessmentParamsSchema.safeParse(request.params);
      const body = CreateExecutionBodySchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        throw errors.invalidRequest();
      }

      const execution = await executionManager.create(
        {
          assessmentId: params.data.assessmentId,
          options: body.data.options,
        },
        auth.require(request),
      );
      return reply.code(202).send(execution);
    },
  );
}
