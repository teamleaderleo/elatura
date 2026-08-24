# Firefox slim discovery hardening

This packet prepares the locked slim-mode prototype for a later live-adapter refactor. It does not enable page changes and does not alter the response observer.

## Pure discovery contract

`slim-discovery.ts` accepts only content-free candidates:

- bounded opaque candidate id;
- bounded opaque parent token;
- integer document-order index;
- one role from `user`, `assistant`, `tool`, `system`, or `unknown`;
- streaming boolean;
- bounded block-size estimate.

It rejects:

- empty or oversized candidate sets;
- malformed candidate entries;
- invalid or duplicate ids;
- multiple parent tokens;
- non-increasing document order;
- unknown values outside the local role vocabulary;
- invalid streaming flags or block-size estimates;
- layouts without any user or assistant turn.

Provider role strings are normalized into the fixed local vocabulary. Arbitrary role strings are not retained.

The candidate validation and grouping pass is linear in the candidate count and stops before iteration when the 10,000-candidate limit is exceeded.

## Grouping

A user turn starts a new group. Following assistant, tool, system, or unknown turns remain in that group until the next user turn. Provider content is never needed for grouping.

An initial system/tool/assistant prefix uses `group-0`. The window planner remains responsible for retaining the latest groups and any streaming group.

## Drift handling

The pure drift reducer separates:

- unsupported initial layout;
- route-transition grace;
- recovered stable discovery;
- post-application selector drift;
- terminal fail-open.

A route change starts a 1.5-second grace period. Discovery failures inside that period do not consume the consecutive-failure budget. Outside grace, a previously applied mode fails open after three consecutive discovery failures.

This is intentionally time-based rather than mutation-count-based. A single-page navigation can generate many mutations before the new conversation DOM settles.

## Integration status

The current controller in PR #106 remains locked and does not import this module. The next adapter-refactor packet should:

1. collect role markers with an explicit traversal/candidate budget;
2. assign opaque parent and order tokens;
3. pass candidates through `validateAndGroupSlimDiscovery`;
4. use the returned descriptors with `planSlimWindow`;
5. replace the ad hoc drift counters with `reduceSlimDrift`;
6. derive mounted-turn counts from a second successful bounded discovery rather than broad selectors;
7. retain the same session-recovery and Stock fail-open behavior.

Live authorization remains a separate reviewed gate after this integration is compiled, linted, and manually inspected.
