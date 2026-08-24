# Firefox slim discovery hardening

This packet hardens the locked slim-mode prototype without enabling page changes or altering the response observer.

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

## Live adapter

`slim-live-discovery.ts` is the only module that reads provider DOM markers. It:

- caps role markers and resolved turn containers at 10,000;
- resolves only conversation-turn test containers or article fallbacks;
- rejects a resolved container with more than one role marker;
- assigns opaque parent and turn tokens;
- verifies actual adjacent document order;
- normalizes roles before they reach the pure policy;
- sends only role, streaming state, order, parent token, and bounded geometry to the pure validator;
- retains element references only for the immediate local DOM operation.

It does not read message text, serialize DOM, write extension storage, log content, or make a network request.

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

This is time-based rather than mutation-count-based. A single-page navigation can generate many mutations before the new conversation DOM settles.

## Controller lifecycle

The locked controller now consumes both the live adapter and the pure drift reducer.

- Stock and the current locked build install no full-page slim-mode mutation observer.
- A future successfully authorized non-stock mode writes recovery configuration first, then starts the observer.
- Latest-window DOM changes temporarily disconnect the observer so the extension does not react to its own removals.
- A latest-window application that fails partway is still treated as destructive and reloads the genuine page, because destructive state is marked before the first removal.
- Stock, fail-open, revocation, emergency disable, and destructive reload paths disconnect the observer.
- Mounted-turn metrics count only discovered elements that remain connected after application.
- SPA route changes enter the tested grace state before failures consume the drift budget.

Live authorization remains disconnected: transform safety starts emergency-disabled and recorded intent still carries `authorizesTransform: false`. Response-body handling remains byte-for-byte pass-through.
