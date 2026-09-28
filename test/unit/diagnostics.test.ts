import { expect, it } from "vitest";
import { configurationReport } from "../../src/diagnostics.js";

it("reports only local configuration and redacts endpoint credentials and query", () => {
  const result = configurationReport({ profile: "self-hosted", profileInferred: true, customEndpoint: true,
    baseUrl: "https://user:secret@example.test/api?token=secret" }, true);
  expect(result.endpoint).toBe("https://example.test/api");
  expect(result.api_access).toBe("not_probed");
  expect(result.quota).toBe("unknown");
  expect(result.exposed_tools).not.toContain("mistral_ocr");
  expect(JSON.stringify(result)).not.toContain("secret");
});
