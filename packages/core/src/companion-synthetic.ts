// SPDX-License-Identifier: MPL-2.0
import { isCompanionEntryId } from "./companion-protocol.js";
import {
  SyntheticCompanion as UncheckedSyntheticCompanion,
  type SyntheticCompanionOptions,
} from "./companion-runtime.js";
import { validateAndMeasureReadOnlyRepresentation } from "./representation.js";

/**
 * Public synthetic companion entrypoint.
 *
 * Valid representations must carry explicit synthetic provenance and entry ids
 * that the version-1 protocol can round-trip. Malformed fixtures still reach
 * the runtime so callers can exercise corrupt-source behaviour without
 * creating a private-content admission path.
 */
export class SyntheticCompanion extends UncheckedSyntheticCompanion {
  constructor(options: SyntheticCompanionOptions) {
    const conversations = options.conversations.map((input) => {
      const validated = validateAndMeasureReadOnlyRepresentation(input.representation);
      if (validated.ok) {
        if (validated.value.representation.provenance.synthetic !== true) {
          throw new TypeError("SyntheticCompanion accepts synthetic provenance only.");
        }
        if (
          validated.value.representation.entries.some(
            (entry) => !isCompanionEntryId(entry.id),
          )
        ) {
          throw new TypeError(
            "SyntheticCompanion requires version-1-compatible entry identifiers.",
          );
        }
      }
      return input;
    });
    super({ ...options, conversations });
  }
}
