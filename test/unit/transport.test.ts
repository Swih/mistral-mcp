/**
 * Unit tests for transport selection — pure-function resolveTransportOptions.
 * (End-to-end HTTP tests live in test/stdio/ and spawn the built server.)
 */

import { describe, expect, it } from "vitest";
import {
  resolveTransportOptions,
  timingSafeTokenEquals,
} from "../../src/transport.js";

describe("resolveTransportOptions", () => {
  it("defaults to stdio on 127.0.0.1:3333/mcp", () => {
    const opts = resolveTransportOptions([], {});
    expect(opts.mode).toBe("stdio");
    expect(opts.httpHost).toBe("127.0.0.1");
    expect(opts.httpPort).toBe(3333);
    expect(opts.httpPath).toBe("/mcp");
    expect(opts.statelessHttp).toBe(false);
    expect(opts.httpAuthToken).toBeUndefined();
    expect(opts.httpAllowedOrigins).toBeUndefined();
  });

  it("selects http via --http flag", () => {
    const opts = resolveTransportOptions(["--http"], {});
    expect(opts.mode).toBe("http");
  });

  it("selects http via MCP_TRANSPORT env", () => {
    const opts = resolveTransportOptions([], { MCP_TRANSPORT: "http" });
    expect(opts.mode).toBe("http");
  });

  it("reads host / port / path from env", () => {
    const opts = resolveTransportOptions([], {
      MCP_TRANSPORT: "http",
      MCP_HTTP_HOST: "0.0.0.0",
      MCP_HTTP_PORT: "4444",
      MCP_HTTP_PATH: "/rpc",
    });
    expect(opts.httpHost).toBe("0.0.0.0");
    expect(opts.httpPort).toBe(4444);
    expect(opts.httpPath).toBe("/rpc");
  });

  it("parses allowed origins as a comma-separated list", () => {
    const opts = resolveTransportOptions([], {
      MCP_HTTP_ALLOWED_ORIGINS: "https://a.example , https://b.example",
    });
    expect(opts.httpAllowedOrigins).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("honors MCP_HTTP_STATELESS=1", () => {
    const opts = resolveTransportOptions([], { MCP_HTTP_STATELESS: "1" });
    expect(opts.statelessHttp).toBe(true);
  });

  it("captures MCP_HTTP_TOKEN", () => {
    const opts = resolveTransportOptions([], { MCP_HTTP_TOKEN: "s3cret" });
    expect(opts.httpAuthToken).toBe("s3cret");
  });

  it("rejects an invalid port", () => {
    expect(() =>
      resolveTransportOptions([], { MCP_HTTP_PORT: "not-a-port" })
    ).toThrow(/invalid MCP_HTTP_PORT/);
    expect(() =>
      resolveTransportOptions([], { MCP_HTTP_PORT: "0" })
    ).toThrow(/invalid MCP_HTTP_PORT/);
    expect(() =>
      resolveTransportOptions([], { MCP_HTTP_PORT: "99999" })
    ).toThrow(/invalid MCP_HTTP_PORT/);
  });
});

describe("timingSafeTokenEquals", () => {
  it("accepts matching bearer tokens", () => {
    expect(timingSafeTokenEquals("s3cret", "s3cret")).toBe(true);
  });

  it("rejects different bearer tokens", () => {
    expect(timingSafeTokenEquals("wrong", "s3cret")).toBe(false);
  });

  it("rejects prefix matches", () => {
    expect(timingSafeTokenEquals("s3", "s3cret")).toBe(false);
  });
});
