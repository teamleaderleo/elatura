// SPDX-License-Identifier: MPL-2.0
import {
  isCompanionEntryId,
  resolveCompanionWorkingSetPolicy,
  type CompanionResponseEnvelope,
} from "./companion-protocol.js";
import {
  SyntheticCompanion as UncheckedSyntheticCompanion,
  type SyntheticCompanionDispatchOptions,
  type SyntheticCompanionOptions,
} from "./companion-runtime.js";
import { validateAndMeasureReadOnlyRepresentation } from "./representation.js";

const MAX_COMPANION_REFERENCE_CODE_UNITS = 4_096;

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
    const policy = resolveCompanionWorkingSetPolicy(options.policy);
    const minimumResponseStringCodeUnits = Math.max(
      MAX_COMPANION_REFERENCE_CODE_UNITS,
      policy.maxPageEntryTextCodeUnits,
      policy.maxSnippetCodeUnits,
    );
    if (policy.maxCodeResponseCodeUnits < minimumResponseStringCodeUnits) {
      throw new RangeError(
        `maxCodeResponseCodeUnits must be at least ${minimumResponseStringCodeUnits} for serializable companion responses.`,
      );
    }

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
    super({ ...options, policy, conversations });
  }

  override async dispatch(
    input: unknown,
    options: SyntheticCompanionDispatchOptions = {},
  ): Promise<CompanionResponseEnvelope> {
    const response = await super.dispatch(input, options);
    return response.errorCode === "request-cancelled"
      ? { ...response, usage: this.usage }
      : response;
  }
}
