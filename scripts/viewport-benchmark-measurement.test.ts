// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseViewportEnvelopes } from "./viewport-benchmark-measurement.mjs";

describe("viewport benchmark measurement parser", () => {
  it("parses every newline-delimited envelope in one command", () => {
    const envelopes = parseViewportEnvelopes([
      {
        aggregated_output: [
          "Usage: viewport ...",
          JSON.stringify({ operation: "search", ok: true, result: { results: [{ entryId: "synthetic-2g-1-user" }] } }),
          JSON.stringify({ operation: "open", ok: true, region: { entries: [{ id: "synthetic-2g-1-user" }] } }),
          JSON.stringify({ operation: "page-after", ok: true, region: { entries: [{ id: "synthetic-2g-2-assistant" }] } }),
          "diagnostic: ignored",
          JSON.stringify({ operation: "get-resource", ok: true, result: { block: { text: "omitted" } } }),
        ].join("\n"),
      },
    ]);

    expect(envelopes.map((envelope) => envelope.operation)).toEqual([
      "search",
      "open",
      "page-after",
      "get-resource",
    ]);
    expect(envelopes).toHaveLength(4);
  });

  it("accepts CRLF and ignores malformed or non-object lines", () => {
    const envelopes = parseViewportEnvelopes([
      { aggregated_output: `not-json\r\n{"operation":"status","ok":true}\r\n[1,2]\r\n{"operation":42}\r\n` },
      { aggregated_output: "" },
    ]);
    expect(envelopes).toEqual([{ operation: "status", ok: true }]);
  });
});
