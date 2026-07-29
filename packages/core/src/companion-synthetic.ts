// SPDX-License-Identifier: MPL-2.0
import {
  SyntheticCompanion as UncheckedSyntheticCompanion,
  type SyntheticCompanionOptions,
} from "./companion-runtime.js";
import { validateAndMeasureReadOnlyRepresentation } from "./representation.js";

/**
 * Public synthetic companion entrypoint.
 *
 * Valid representations must carry explicit synthetic provenance. Malformed
 * fixtures still reach the runtime so callers can exercise corrupt-source
 * behaviour without creating a private-content admission path.
 */
export class SyntheticCompanion extends UncheckedSyntheticCompanion {
  constructor(options: SyntheticCompanionOptions) {
    const conversations = options.conversations.map((input) => {
      const validated = validateAndMeasureReadOnlyRepresentation(input.representation);
      if (validated.ok && validated.value.representation.provenance.synthetic !== true) {
        throw new TypeError("SyntheticCompanion accepts synthetic provenance only.");
      }
      return input;
    });
    super({ ...options, conversations });
  }
}
