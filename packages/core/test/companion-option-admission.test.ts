// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  type CompanionRequestEnvelope,
} from "../src/companion.js";

describe("companion option admission", () => {
  it("does not invoke top-level option accessors", () => {
    let invoked = false;
    const options = Object.defineProperties(
      {
        sessionId: "option-session",
        conversations: [],
      },
      {
        acceptedAdapters: {
          enumerable: true,
          get() {
            invoked = true;
            return [];
          },
        },
      },
    );

    expect(
      () => new SyntheticCompanion(options),
    ).toThrow(/own-data records/u);
    expect(invoked).toBe(false);
  });

  it("does not invoke policy accessors", () => {
    let invoked = false;
    const policy = Object.defineProperty({}, "maxPageEntries", {
      enumerable: true,
      get() {
        invoked = true;
        return 1;
      },
    });

    expect(
      () =>
        new SyntheticCompanion({
          sessionId: "option-session",
          conversations: [],
          policy,
        }),
    ).toThrow(/own-data records/u);
    expect(invoked).toBe(false);
  });

  it("rejects unknown option and policy fields", () => {
    expect(
      () =>
        new SyntheticCompanion({
          sessionId: "option-session",
          conversations: [],
          hidden: true,
        } as unknown as ConstructorParameters<typeof SyntheticCompanion>[0]),
    ).toThrow(/own-data records/u);

    expect(
      () =>
        new SyntheticCompanion({
          sessionId: "option-session",
          conversations: [],
          policy: {
            maxPageEntries: 1,
            hidden: 1,
          } as unknown as NonNullable<
            ConstructorParameters<typeof SyntheticCompanion>[0]["policy"]
          >,
        }),
    ).toThrow(/own-data records/u);
  });

  it("does not invoke dispatch option accessors", async () => {
    const companion = new SyntheticCompanion({
      sessionId: "option-session",
      conversations: [],
    });
    const request: CompanionRequestEnvelope = {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: "option-session",
      requestId: "option-status",
      operation: "status",
      payload: { conversationId: null },
    };
    let invoked = false;
    const options = Object.defineProperty({}, "beforeCommit", {
      enumerable: true,
      get() {
        invoked = true;
        return async () => undefined;
      },
    });

    await expect(
      companion.dispatch(
        request,
        options as unknown as Parameters<SyntheticCompanion["dispatch"]>[1],
      ),
    ).rejects.toThrow(/own-data records/u);
    expect(invoked).toBe(false);
  });
});
