// SPDX-License-Identifier: MPL-2.0

/**
 * Parse only complete, one-line viewport envelopes from a command's output.
 * Codex can execute a shell loop that emits multiple JSON envelopes; treating
 * the whole aggregated output as one JSON document loses every measurement in
 * that command.  Non-JSON lines (help, shell noise, and diagnostics) remain
 * intentionally excluded from benchmark accounting.
 */
export function parseViewportEnvelopes(commands) {
  const parsed = [];
  if (!Array.isArray(commands)) return parsed;
  for (const command of commands) {
    const output = command?.aggregated_output;
    if (typeof output !== "string") continue;
    for (const line of output.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const value = JSON.parse(trimmed);
        if (value && typeof value === "object" && !Array.isArray(value) && typeof value.operation === "string") {
          parsed.push(value);
        }
      } catch {
        // Help and ordinary shell output are intentionally ignored.
      }
    }
  }
  return parsed;
}
