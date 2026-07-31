# Firefox slim DOM executor

This packet isolates and tests the destructive latest-window operation before it is wired into the locked browser controller.

## Problem addressed

The original prototype validates and mutates each removal range in sequence. If a later range drifts or a browser DOM operation throws, an earlier range may already have been removed. The controller must know whether mutation began so it can reload the genuine Stock page rather than attempting an in-place recovery from a partially modified DOM.

## Executor contract

`executeSlimDomRemoval` receives:

- bounded placeholder plans from the pure window planner;
- a generic host that resolves opaque turn ids and performs local node operations;
- a hard maximum placeholder count.

The executor preflights every range before the first mutation:

- placeholder budget and existing placeholder count;
- non-empty range and positive finite block height;
- unique turn ids;
- every turn resolves;
- every resolved node is connected;
- different turn ids do not resolve to the same node;
- projected placeholder count stays within budget.

Only after all ranges pass does execution begin.

## Failure reporting

Every result includes `mutationStarted`.

- Preflight failures return `mutationStarted: false` and perform no host mutation.
- Host failures during insertion, merge, or removal return `mutationStarted: true` once any mutating host call was attempted.
- Successful results report removed turns, created placeholders, merged placeholders, and placeholder counts before and after.

The later browser integration must set its destructive-state flag from this result before entering fail-open handling. That ensures a partial host failure causes a Stock reload.

## Test host

The unit suite uses a content-free fake node host and covers:

- complete preflight before any mutation;
- ordinary placeholder insertion and range removal;
- merging into an adjacent placeholder;
- duplicate ids and duplicate node resolution;
- disconnected nodes;
- projected placeholder overflow;
- partial host failure after insertion;
- invalid budgets and range heights.

The module contains no provider selector, browser API, transcript field, logging sink, or network operation.

## Integration status

This packet deliberately does not modify `slim-content-controller.ts`. A following reviewed packet will adapt the browser DOM to `SlimDomHost`, replace the local range mutation loop, propagate `mutationStarted`, and keep live authorization disconnected.
