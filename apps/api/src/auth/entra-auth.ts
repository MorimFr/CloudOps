import type { FastifyInstance, FastifyRequest } from "fastify";

import { errors } from "../errors.js";
import type {
  ApiTokenValidator,
  ValidatedApiToken,
} from "./token-validator.js";

const BEARER_TOKEN_PATTERN =
  /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

export class EntraAuth {
  readonly #validator: ApiTokenValidator;
  readonly #contexts = new WeakMap<FastifyRequest, ValidatedApiToken>();

  public constructor(validator: ApiTokenValidator) {
    this.#validator = validator;
  }

  public register(app: FastifyInstance): void {
    app.addHook("onRequest", async (request) => {
      if (
        request.method === "OPTIONS" ||
        request.routeOptions.url === "/api/v1/health"
      ) {
        return;
      }

      const header = request.headers.authorization;
      if (header === undefined) {
        throw errors.authenticationRequired();
      }
      const match = BEARER_TOKEN_PATTERN.exec(header);
      const accessToken = match?.[1];
      if (!accessToken) {
        throw errors.invalidApiToken();
      }

      const context = await this.#validator.validate(accessToken);
      this.#contexts.set(request, context);
    });

    app.addHook("onResponse", async (request) => {
      this.#contexts.delete(request);
    });
  }

  public require(request: FastifyRequest): ValidatedApiToken {
    const context = this.#contexts.get(request);
    if (!context) {
      throw errors.authenticationRequired();
    }
    return context;
  }
}
