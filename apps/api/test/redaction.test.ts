import { Writable } from "node:stream";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  REDACTED,
  redactSensitiveData,
} from "../src/security/redaction.js";
import { createSecureLoggerOptions } from "../src/security/secure-logging.js";

describe("secure redaction", () => {
  it("redacts authorization, cookies, and secrets recursively", () => {
    const result = redactSensitiveData({
      authorization: "Bearer tenant-secret",
      headers: { cookie: "session=value", harmless: "GET" },
      nested: {
        accessToken: "access",
        refresh_token: "refresh",
        clientSecret: "client-secret",
      },
    });

    expect(result).toEqual({
      authorization: REDACTED,
      headers: { cookie: REDACTED, harmless: "GET" },
      nested: {
        accessToken: REDACTED,
        refresh_token: REDACTED,
        clientSecret: REDACTED,
      },
    });
    expect(JSON.stringify(result)).not.toContain("tenant-secret");
  });

  it("never serializes artifact buffers", () => {
    expect(redactSensitiveData({ artifact: Buffer.from("sensitive") })).toEqual(
      { artifact: REDACTED },
    );
  });

  it("redacts credentials in actual Fastify logger output", async () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const app = Fastify({
      logger: {
        ...createSecureLoggerOptions("production"),
        stream: destination,
      },
    });

    app.log.info(
      {
        authorization: "Bearer test-authorization",
        cookie: "test-cookie",
        accessToken: "test-access-token",
        clientSecret: "test-client-secret",
        event: "redaction_test",
      },
      "safe test event",
    );
    await app.close();

    expect(output).toContain("[REDACTED]");
    expect(output).toContain("redaction_test");
    expect(output).not.toContain("test-authorization");
    expect(output).not.toContain("test-cookie");
    expect(output).not.toContain("test-access-token");
    expect(output).not.toContain("test-client-secret");
  });
});
