# Firefox slim DOM fixture harness

This packet adds provider-free integration coverage for the locked Firefox slim-mode prototype. It does not enable page changes and does not use real conversation content.

## Observation seam

The live DOM adapter now converts bounded page observations into `SlimLiveContainerObservation` values:

- opaque container id;
- opaque parent token;
- integer document order;
- bounded role-marker values;
- streaming boolean;
- bounded height estimate.

The observation builder validates fixture identity and marker accounting before passing content-free candidates into the pure discovery/grouping policy.

It rejects:

- invalid, duplicate, or oversized container ids;
- invalid or impossible marker totals;
- zero or multiple role markers assigned to a container;
- missing or split parents;
- ambiguous document order;
- invalid streaming or geometry fields;
- layouts without user or assistant turns.

Role markers that do not resolve to a recognized turn container may remain in the bounded total and are otherwise ignored. This models provider chrome or transient DOM markers without treating them as conversation turns.

## Synthetic layouts

The fixture suite covers:

- five ordinary user/assistant pairs and a latest-three window plan;
- a final active streaming response;
- system and unknown provider-role noise;
- bounded role markers outside recognized turn containers;
- multiple role markers resolving to one container;
- split parents;
- repeated document order;
- missing parents;
- duplicate fixture container ids;
- impossible marker accounting.

The successful fixtures run through both `buildSlimLiveObservation` and `planSlimWindow`, so the suite tests the boundary between discovery and window planning rather than each module in isolation.

## Content policy

Fixtures contain no:

- message text;
- conversation titles;
- HTML or Markdown payloads;
- attachments;
- provider conversation or message ids.

The fixture catalog is `benchmarks/slim-dom-fixtures.json`. Repository gates verify the allowed observation fields and keep the harness disconnected from browser APIs, network sinks, response handling, and live authorization.

## Remaining validation

This harness proves deterministic behavior for bounded observations. It does not prove that the current provider selectors match a live ChatGPT build. That remains a private-profile manual validation gate after a separately reviewed live-authorization packet.
