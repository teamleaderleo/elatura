// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { assertContentFreeReport } from "../src/report.js";

describe("assertContentFreeReport", () => {
  it("accepts an aggregated redacted observation report", () => {
    expect(() =>
      assertContentFreeReport({
        schemaVersion: 1,
        privacy: {
          responseBodiesCaptured: false,
          messageTextCaptured: false,
          queryStringsCaptured: false,
          credentialsCaptured: false,
        },
        requestPaths: [{ pathTemplate: "/backend-api/conversation/:id", bytes: 1024 }],
      }),
    ).not.toThrow();
  });

  it.each(["cookie", "authorization", "message_text", "responseBody", "queryString", "rawUrl"])(
    "rejects the forbidden field %s",
    (field) => {
      expect(() => assertContentFreeReport({ [field]: "private" })).toThrow(/forbidden field/);
    },
  );

  it("rejects query strings hidden in path templates", () => {
    expect(() => assertContentFreeReport({ pathTemplate: "/conversation/:id?token=private" })).toThrow(
      /query string/,
    );
  });
});
