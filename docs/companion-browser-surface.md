# Synthetic companion browser surface

A minimal framework-free static browser client over the merged bounded
companion stack (`CompanionWebController`, `BoundedCompanionRenderSink`,
`SyntheticCompanion`). It remains synthetic-only and loopback-only end to end.

## Product position after #114 / PR #115

This surface is a reusable **bounded-view and lifecycle test bench**, rather
than the assumed primary Elatura product shell.

PR #115 showed that the bounded agent viewport lost decisively to ordinary
local JSONL + `rg` when both could operate over an already clean local
representation. Preserve that result: direct local/API tools should win that
class of task whenever they are cheaper and sufficient.

The companion machinery remains valuable for application lanes where a bounded
semantic view can avoid a live heavyweight application read, help a human
navigate an oversized application, or serve as the semantic rung before a
screenshot or full application activation. Its strongest reusable evidence is
bounded replacement state, explicit freshness/provenance/omission, lifecycle
cleanup, and retained-state plateau accounting.

See [application-lanes.md](application-lanes.md) for the current product model.

## Safety boundary

This surface does not read a browser profile, touch cookies or authorization
headers, submit messages, persist anything, load remote assets or fonts,
register a service worker, use native messaging, or reach any non-loopback
origin. There is no automation dependency, bundler, or runtime framework; the
client is compiled workspace ESM plus a static import map.

## Layout

- `packages/companion-web/src/`
  - `controller.ts` — lane-owned requests; late/out-of-order/cancelled replies
    lose ownership before they can mutate state;
  - `render-sink.ts` — replacement-based bounded view state (timeline rows,
    search results, one code block, one navigation record);
  - `navigation.ts` — defensive extraction of parent/child/sibling/active-path
    records from validated navigate payloads;
  - `browser-request-ledger.ts` — browser request/cache accounting, bounded
    independently of companion/client/render state;
  - `http-companion-transport.ts` — bounded transport over exactly one fixed
    same-origin protocol path; the actual network call is injected, so library
    code references no transport primitive;
  - `view-model.ts` — content-free projection into plain display rows;
  - `plateau.ts` — deterministic plateau evaluation for switching and
    open/close probes;
  - `probes.ts` — prescribed probe plans, execution loops, and transcript
    lines; explicit round/cycle constants derive each emission cardinality
    and refuse configurations outside the run-manifest schema's 6–32 sample
    window (8 recorded rounds × served conversations; 16 recorded open/close
    cycles × 2), with unrecorded warm-up repetitions that reach the ledger
    cache's bounded steady state before recording.
- `packages/companion-web/browser/` — fixed static assets (`index.html`,
  `app.css`, `app.js`) mounted as plain text; no handler closes over a source
  entry, and every rendered value comes from the latest snapshots.
- `scripts/run-synthetic-companion-loopback.mjs` — Node loopback-only static +
  protocol server.

## Static assets and import map

The page resolves `@elatura/core/companion` through a fixed import map to
`/vendor/@elatura/core/companion.js`. The server serves an explicit allowlist
of built workspace ESM files from `packages/core/dist/` and
`packages/companion-web/dist/` byte-for-byte, so assets are deterministic and
contain only repository source. No sourcemaps, fonts, images, or scripts from
any other location are reachable.

## Loopback-only server boundary

`node scripts/run-synthetic-companion-loopback.mjs --host 127.0.0.1|::1`

- binds only the two loopback literals and refuses every other host before
  listening (`RefusedBindingError`);
- drops any connection whose remote address is not exactly `127.0.0.1` or
  `::1`;
- requires the exact bound endpoint in the `Host` header (DNS-rebinding
  refusal) and refuses cross-site `sec-fetch-site` metadata;
- serves GET/HEAD only for allowlisted asset paths and
  `GET/HEAD /companion/v1/session`;
- serves `POST /companion/v1` only with `Content-Type: application/json` and
  the exact loopback `Origin`;
- bounds request bodies at 65 536 bytes and refuses chunked transfer encoding;
- reduces malformed bodies and hostile envelopes to fixed content-free error
  codes (`invalid-request`) inside protocol-v1 envelopes;
- performs no outbound network behavior of any kind.

Scenario conversations come from a fixed registry
(`--list-scenarios`): `synthetic-100`, `synthetic-10000`, `synthetic-100000`,
`branch-heavy`, `large-code`, `stale-source`, `expired-source`,
`corrupt-source`, `drifted-source`. All fixtures flow through the merged path
`generateSyntheticConversation` → `validateChatGptConversation` →
`toSyntheticChatGptRepresentation` → guarded `SyntheticCompanion`. The drifted
scenario runs alone because adapter acceptance is session-global. A fixed
clock keeps freshness classes deterministic within one server run.

## Visible states

The UI shows fresh/stale/expired/corrupt/drifted sources, cancelled and
over-limit diagnostics (`page-limit`, `search-limit`, `response-too-large`,
`resident-limit`, …), bounded conversation list, timeline window replacement on
paging, bounded search with result selection, parent/child/active-path
navigation with jump-back display, one code block on demand, explicit close and
revoke, and content-free working-set counters spanning client, render,
transport, ledger, and companion usage.

## Automated coverage

`packages/companion-web/test/` covers page replacement, the >resident-limit
switching plateau, ≥100 open/close cleanup, out-of-order/late/cancelled reply
non-repopulation, bounded search/code, hostile and oversized replies, ledger
bounds, HTTP transport refusals, view-model projection, and adversarial
loopback-server probes (binding, connection, method, path, query, traversal,
host, fetch-site, origin, content type, body size, chunked encoding). Full CI
runs via `npm run check`.

## Benchmark packet

See [companion-browser-benchmark.md](companion-browser-benchmark.md) for the
content-free measurement packet and its fixed schema.
