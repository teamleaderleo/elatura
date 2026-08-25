// SPDX-License-Identifier: MPL-2.0
import type {
  CompanionRequestEnvelope,
  CompanionResponseEnvelope,
} from "@elatura/core/companion";
import type { BoundedBrowserRequestLedger } from "./browser-request-ledger.js";
import type {
  CompanionTransport,
  CompanionTransportSnapshot,
} from "./transport.js";

/**
 * The only network path this package supports: one fixed same-origin protocol
 * path, POST, JSON. The actual browser call is injected so the bounded logic
 * stays testable and no transport primitive is referenced from library code.
 */
export const COMPANION_PROTOCOL_PATH = "/companion/v1";

export type CompanionHttpPost = (
  url: string,
  body: string,
  signal?: AbortSignal,
) => Promise<string>;

export type HttpCompanionTransportOptions = Readonly<{
  /** Fixed same-origin base; must not carry a path, query, credentials, or trailing slash. */
  origin: string;
  post: CompanionHttpPost;
  ledger: BoundedBrowserRequestLedger;
  maxRequestSerializedBytes?: number;
  maxResponseSerializedBytes?: number;
}>;

export class HttpCompanionTransportError extends Error {}

const ORIGIN = /^https?:\/\/[A-Za-z0-9._~-]+(?::\d{1,5})?$/u;
const OPERATION_TOKEN = /^[a-z][a-z0-9_-]{0,63}$/u;

function operationToken(request: CompanionRequestEnvelope): string {
  return OPERATION_TOKEN.test(request.requestId)
    ? `op-${request.operation}`
    : "op-unknown";
}

/**
 * A bounded loopback-only transport. Requests are serialized once, measured
 * against fixed byte ceilings, sent to exactly `${origin}${COMPANION_PATH}`,
 * and answered by a response whose byte length is capped before parsing.
 * Every settled outcome is recorded in the separately bounded ledger.
 */
export class HttpCompanionTransport implements CompanionTransport {
  readonly #origin: string;
  readonly #post: CompanionHttpPost;
  readonly #ledger: BoundedBrowserRequestLedger;
  readonly #maxRequestSerializedBytes: number;
  readonly #maxResponseSerializedBytes: number;
  #inFlightRequestCount = 0;

  constructor(options: HttpCompanionTransportOptions) {
    if (!ORIGIN.test(options.origin)) {
      throw new TypeError("origin must be a fixed HTTP(S) origin without a path.");
    }
    this.#origin = options.origin;
    this.#post = options.post;
    this.#ledger = options.ledger;
    this.#maxRequestSerializedBytes =
      options.maxRequestSerializedBytes ?? 65_536;
    this.#maxResponseSerializedBytes =
      options.maxResponseSerializedBytes ?? 2_097_152;
  }

  get snapshot(): CompanionTransportSnapshot {
    return Object.freeze({
      dispatchedRequestCount: this.#ledger.snapshot.dispatchedRequestCount,
      completedRequestCount:
        this.#ledger.snapshot.completedRequestCount +
        this.#ledger.snapshot.refusedOverLimitRequestCount,
      cancelledRequestCount: this.#ledger.snapshot.cancelledRequestCount,
      inFlightRequestCount: this.#inFlightRequestCount,
    });
  }

  async dispatch(
    request: CompanionRequestEnvelope,
    signal?: AbortSignal,
  ): Promise<CompanionResponseEnvelope> {
    const token = operationToken(request);
    let body: string;
    try {
      body = JSON.stringify(request);
    } catch {
      this.#ledger.recordFailedRequest(token);
      throw new HttpCompanionTransportError("request-serialization-failed");
    }
    if (
      body.length === 0 ||
      body.length > this.#maxRequestSerializedBytes
    ) {
      this.#ledger.recordFailedRequest(token);
      throw new HttpCompanionTransportError("request-over-serialized-limit");
    }

    this.#inFlightRequestCount += 1;
    const aborted = (): boolean => signal?.aborted === true;
    try {
      if (aborted()) {
        this.#ledger.recordCancelledRequest(token);
        throw new HttpCompanionTransportError("request-cancelled");
      }
      let raw: string;
      try {
        raw = await this.#post(
          `${this.#origin}${COMPANION_PROTOCOL_PATH}`,
          body,
          signal,
        );
      } catch (error) {
        if (aborted() || isAbortError(error)) {
          this.#ledger.recordCancelledRequest(token);
          throw new HttpCompanionTransportError("request-cancelled");
        }
        this.#ledger.recordFailedRequest(token);
        throw new HttpCompanionTransportError("transport-post-failed");
      }
      if (raw.length > this.#maxResponseSerializedBytes) {
        this.#ledger.recordCompletedRequest(
          request.requestId,
          token,
          body.length,
          raw.length,
        );
        throw new HttpCompanionTransportError("response-over-serialized-limit");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.#ledger.recordFailedRequest(token);
        throw new HttpCompanionTransportError("response-not-json");
      }
      if (!isResponseEnvelopeShape(parsed)) {
        this.#ledger.recordFailedRequest(token);
        throw new HttpCompanionTransportError("response-envelope-invalid");
      }
      this.#ledger.recordCompletedRequest(
        request.requestId,
        token,
        body.length,
        raw.length,
      );
      return parsed;
    } finally {
      this.#inFlightRequestCount -= 1;
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isResponseEnvelopeShape(value: unknown): value is CompanionResponseEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.requestId === "string" &&
    typeof candidate.operation === "string" &&
    typeof candidate.ok === "boolean" &&
    typeof candidate.usage === "object" &&
    candidate.usage !== null
  );
}
