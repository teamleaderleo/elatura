# Measurement plan

No performance claim counts without a reproducible comparison against the same workload.

## Modes to compare

1. Microsoft Edge stable, clean profile
2. Firefox stable, clean profile
3. Firefox with Elatura observe mode
4. Firefox with future safe mode
5. Firefox with future validated cache mode

## Primary measurements

- response bytes
- request duration
- time until newest useful content is visible
- time until a composer-like input accepts focus
- time until scrolling responds
- peak content-process memory
- extension/native-process memory
- long-task count and duration
- reload success and crashes
- memory released after closing the tab

DOM node count is secondary because virtualized applications may retain substantial state outside the visible DOM.

## Report hygiene

Reports must contain browser and adapter versions, modes, timings, sizes, outcomes, and environment notes. They must not contain response bodies, conversation text, cookies, authorization headers, query strings, or raw conversation identifiers.

## Initial success targets

Targets remain provisional until a baseline exists:

- at least 2× faster cold time-to-composer than the failing Edge case
- at least 5× faster validated warm reload
- peak browser content-process memory no more than 35% of Edge's peak
- twenty consecutive reloads without losing access
- unknown schemas always pass through untouched
