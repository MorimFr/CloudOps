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
        idToken: "identity",
        graphToken: "graph",
        refresh_token: "refresh",
        clientSecret: "client-secret",
        oboAssertion: "obo-assertion",
        claimsChallenge: "claims-challenge",
        authenticateHeader: "challenge-header",
        tenantId: "tenant-guid",
        objectId: "object-guid",
        claims: { oid: "claim-object-guid" },
        preferred_username: "person@example.com",
        displayName: "Sensitive Person",
      },
    });

    expect(result).toEqual({
      authorization: REDACTED,
      headers: { cookie: REDACTED, harmless: "GET" },
      nested: {
        accessToken: REDACTED,
        idToken: REDACTED,
        graphToken: REDACTED,
        refresh_token: REDACTED,
        clientSecret: REDACTED,
        oboAssertion: REDACTED,
        claimsChallenge: REDACTED,
        authenticateHeader: REDACTED,
        tenantId: REDACTED,
        objectId: REDACTED,
        claims: REDACTED,
        preferred_username: REDACTED,
        displayName: REDACTED,
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
        idToken: "test-id-token",
        graphToken: "test-graph-token",
        clientSecret: "test-client-secret",
        oboAssertion: "test-obo-assertion",
        claimsChallenge: "test-claims-challenge",
        authenticateHeader: "test-authenticate-header",
        tenantId: "test-tenant-id",
        objectId: "test-object-id",
        claims: "test-claims",
        preferred_username: "test-person@example.com",
        displayName: "test-display-name",
        deeply: { nested: { graphToken: "deep-graph-token" } },
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
    expect(output).not.toContain("test-id-token");
    expect(output).not.toContain("test-graph-token");
    expect(output).not.toContain("test-client-secret");
    expect(output).not.toContain("test-obo-assertion");
    expect(output).not.toContain("test-claims-challenge");
    expect(output).not.toContain("test-authenticate-header");
    expect(output).not.toContain("test-tenant-id");
    expect(output).not.toContain("test-object-id");
    expect(output).not.toContain("test-claims");
    expect(output).not.toContain("test-person@example.com");
    expect(output).not.toContain("test-display-name");
    expect(output).not.toContain("deep-graph-token");
  });
});
