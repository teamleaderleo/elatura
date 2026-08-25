// SPDX-License-Identifier: MPL-2.0
import type {
  CompanionRequestEnvelope,
  CompanionResponseEnvelope,
  SyntheticCompanion,
} from "@elatura/core/companion";

export type CompanionTransportSnapshot = Readonly<{
  dispatchedRequestCount: number;
  completedRequestCount: number;
  cancelledRequestCount: number;
  inFlightRequestCount: number;
}>;

export interface CompanionTransport {
  dispatch(
    request: CompanionRequestEnvelope,
    signal?: AbortSignal,
  ): Promise<CompanionResponseEnvelope>;
  readonly snapshot: CompanionTransportSnapshot;
}

/**
 * Synthetic-only transport used by the browser controller tests and the first
 * local web experiment. It retains no response history and owns no source data.
 */
export class InProcessCompanionTransport implements CompanionTransport {
  readonly #companion: SyntheticCompanion;
  #dispatchedRequestCount = 0;
  #completedRequestCount = 0;
  #cancelledRequestCount = 0;
  #inFlightRequestCount = 0;

  constructor(companion: SyntheticCompanion) {
    this.#companion = companion;
  }

  get snapshot(): CompanionTransportSnapshot {
    return Object.freeze({
      dispatchedRequestCount: this.#dispatchedRequestCount,
      completedRequestCount: this.#completedRequestCount,
      cancelledRequestCount: this.#cancelledRequestCount,
      inFlightRequestCount: this.#inFlightRequestCount,
    });
  }

  async dispatch(
    request: CompanionRequestEnvelope,
    signal?: AbortSignal,
  ): Promise<CompanionResponseEnvelope> {
    this.#dispatchedRequestCount += 1;
    this.#inFlightRequestCount += 1;
    try {
      const response = await this.#companion.dispatch(request, {
        beforeCommit: async () => {
          await Promise.resolve();
          if (signal?.aborted === true) {
            throw new Error("The local companion request was cancelled.");
          }
        },
      });
      if (response.errorCode === "request-cancelled") {
        this.#cancelledRequestCount += 1;
      } else {
        this.#completedRequestCount += 1;
      }
      return response;
    } finally {
      this.#inFlightRequestCount -= 1;
    }
  }
}
