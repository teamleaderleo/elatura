// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  INVALID_PATH_TEMPLATE,
  isRedactedPathTemplate,
  redactPath,
} from "../src/path-redaction.js";

describe("observer path redaction", () => {
  it("keeps only coarse segment classes", () => {
    const template = redactPath(
      "https://chatgpt.com/backend-api/conversation/123e4567-e89b-42d3-a456-426614174000?token=secret#fragment",
    );

    expect(template).toBe("/:compound-l/:word-l/:uuid");
    expect(template).not.toContain("backend-api");
    expect(template).not.toContain("conversation");
    expect(template).not.toContain("secret");
    expect(isRedactedPathTemplate(template)).toBe(true);
  });

  it("redacts short slugs, filenames, numbers, and encoded values", () => {
    const cases = [
      { url: "https://chatgpt.com/my-secret-project", literals: ["my-secret-project"] },
      { url: "https://chatgpt.com/files/plan.pdf", literals: ["files", "plan.pdf"] },
      { url: "https://chatgpt.com/api/123456", literals: ["api", "123456"] },
      { url: "https://chatgpt.com/a/%E2%9C%93", literals: ["%E2%9C%93"] },
      { url: "https://chatgpt.com/opaque/AbC_12-x", literals: ["opaque", "AbC_12-x"] },
    ];

    for (const { url, literals } of cases) {
      const template = redactPath(url);
      expect(isRedactedPathTemplate(template)).toBe(true);
      for (const literal of literals) expect(template).not.toContain(literal);
    }
  });

  it("bounds output for deep paths and oversized segments", () => {
    const deepUrl = `https://chatgpt.com/${Array.from({ length: 100 }, (_, index) => `segment-${index}`).join("/")}`;
    const deepTemplate = redactPath(deepUrl);
    expect(deepTemplate.endsWith("/:path-overflow")).toBe(true);
    expect(deepTemplate.length).toBeLessThan(1200);
    expect(isRedactedPathTemplate(deepTemplate)).toBe(true);

    const longTemplate = redactPath(`https://chatgpt.com/${"x".repeat(10_000)}`);
    expect(longTemplate).toBe("/:segment-xl");
    expect(longTemplate).not.toContain("x".repeat(32));
  });

  it("preserves path depth without preserving empty or literal segments", () => {
    expect(redactPath("https://chatgpt.com/a//b/")).toBe("/:word-s/:empty/:word-s/:empty");
    expect(redactPath("https://chatgpt.com/")).toBe("/");
  });

  it("returns a fixed token for malformed URLs", () => {
    expect(redactPath("not a url")).toBe(INVALID_PATH_TEMPLATE);
    expect(isRedactedPathTemplate(INVALID_PATH_TEMPLATE)).toBe(true);
  });

  it("rejects literal or query-bearing templates", () => {
    expect(isRedactedPathTemplate("/backend-api/:uuid")).toBe(false);
    expect(isRedactedPathTemplate("/:word-m/:uuid?secret=yes")).toBe(false);
    expect(isRedactedPathTemplate("https://chatgpt.com/:word-m")).toBe(false);
  });
});
