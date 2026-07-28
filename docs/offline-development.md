# Offline development before the private baseline

The private signed-in benchmark is important, but it does not block most of Elatura's correctness and tooling work.

## Work that can proceed safely

### Synthetic pathological workloads

`@elatura/fixtures` creates deterministic, content-free conversation-shaped graphs with configurable:

- turn-group counts
- alternate branches
- hidden or tool-like nodes
- message payload sizes
- seeded output
- unknown forward-compatibility fields

These fixtures are test workloads, not claims about ChatGPT's current private schema. Live observation remains authoritative for adapter compatibility.

Generate one with:

```bash
npm run generate:fixture -- \
  --turns 5000 \
  --branches-every 20 \
  --hidden-per-turn 2 \
  --payload-bytes 4096 \
  --seed 2026 \
  --out artifacts/synthetic-5000.json
```

Malformed fixture helpers deliberately introduce missing references, reciprocal-link mismatches, and active-path cycles so fail-open behavior can be tested without private data.

### Selection planning

The core can trace and validate a parent-linked active path, group consecutive nodes through an adapter-supplied callback, and produce a deterministic selection plan containing:

- the complete active path
- retained recent groups
- omitted prefix and boundary parent
- optional root anchor
- optional branch sibling roots
- a reason for every selected node

A selection plan does **not** materialize a transformed application response. Rewriting parent/child links and preserving all application-specific dependencies still waits for live adapter evidence.

### Observation report analysis

Exported observation reports can be parsed, privacy-checked, reconciled, and summarized in batches:

```bash
npm run analyze:reports -- benchmarks/reports --out artifacts/observe-summary.json
```

The analyzer reports count, minimum, median, nearest-rank p95, maximum, and mean for core metrics. It also aggregates redacted request-path totals. Reports with unsafe privacy flags, raw URLs, query strings, duplicate path classes, invalid values, or totals that do not reconcile are rejected.

## Work that remains gated by the live run

The following should not be guessed from synthetic fixtures:

- the current request class carrying the pathological conversation
- the exact current payload schema
- which nodes and fields ChatGPT requires for branch controls and submission
- whether response filtering sees the relevant bytes early enough
- observer overhead on the real workload
- the first safe materialized response transform

Elatura should arrive at the live run with strong tools and invariants, then use the measured result to choose the next adapter-specific step.
