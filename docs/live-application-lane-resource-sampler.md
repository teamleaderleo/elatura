# Live application-lane external resource sampler

This is the repository implementation of #116's external 2-second OS resource sampler.

It exists to measure the dominant browser/application process cost from outside the browser while keeping process command lines, application content, authenticated URLs, titles, credentials, and browser projection identifiers out of the raw numeric evidence.

The sampler is an instrumentation tool. It does not change the frozen #116 condition matrix, phase schedule, lifecycle interventions, stage counts, plateau rules, fidelity rules, or readiness authority.

## Supported hosts

V1 supports:

- macOS (`darwin`);
- Linux.

Both use the OS `ps` implementation with only these numeric columns:

```text
pid
ppid
rss
%cpu
```

Windows is explicitly unsupported in v1. Add a Windows provider only after its accounting method can be matched and tested; do not silently substitute a different metric.

## Accounting model

The sampler receives two **explicit local process roots** through a private control file:

```text
browserRootPid
externalElaturaRootPid   // optional
```

It snapshots the complete numeric process table, follows parent/child links, and aggregates descendants of each root.

The two trees must not overlap.

### Browser tree

```text
browserTree = browser root + every descendant visible in the same ps snapshot
```

`browserTreeRssBytes` is the sum of per-process RSS reported by `ps`, converted from KiB to bytes.

`browserTreeCpuPercent` is the sum of per-process `%CPU`. One busy logical core is approximately 100%; the aggregate may exceed 100%.

### External Elatura tree

Use `externalElaturaRootPid` only for an Elatura broker/host that is genuinely outside the browser process tree.

When no separate Elatura process exists, leave this root unset. The run sample then uses:

```text
externalElaturaRssBytes = null
externalElaturaCpuPercent = null
externalElaturaProcessCount = 0
```

An extension executing inside browser processes is already included in the browser tree and must not be double-counted as an external Elatura process.

### Target host

For this sampler:

```text
target host process set = browser tree ∪ external Elatura tree
```

The corresponding RSS, CPU, and process-count fields are the aggregate of that union.

This is the workload process set, not whole-machine used memory.

### RSS caveat

Summed process RSS can count shared physical pages in more than one process. The frozen result schema asks for RSS and the same method is used across matched conditions. Treat PSS/private-byte measurements as separate supplemental diagnostics where a platform-specific method is available; never relabel them as this RSS series.

## Privacy boundary

The `ps` command requests no process name, command, arguments, environment, path, URL, or title column.

The JSONL sampler output contains no PID at all. It contains only:

- sampler metadata/method tokens;
- timestamps;
- root state: `unset | present | missing`;
- the exact numeric/fixed-enum `resourceSample` fields used by the run schema;
- a graceful footer.

The private control file **does contain root PIDs**. Keep it local and outside every benchmark `final/` directory. The state writer creates it with owner-only file permissions where supported.

## 1. Create the private sampler state

Before launching the measured browser, create the control file with roots unset:

```sh
npm run live-lane:sampler:state -- \
  artifacts/live-application-lane/work/sampler-state.json \
  --phase launch \
  --lane clear \
  --browser-root-pid clear \
  --elatura-root-pid clear \
  --memory-pressure unknown
```

The state has exactly:

```text
schemaVersion
phase
laneOrdinal
browserRootPid
externalElaturaRootPid
memoryPressureClass
updatedAt
```

Updates are written through an atomic same-directory replace so the sampling loop sees either the old complete state or the new complete state.

Omitted update options preserve the current value.

## 2. Start the sampler

Use a new output path:

```sh
npm run live-lane:sampler -- \
  --state artifacts/live-application-lane/work/sampler-state.json \
  --out artifacts/live-application-lane/work/resource-samples.jsonl
```

The sampler refuses to overwrite an existing sidecar.

Sampling begins immediately and remains fixed at 2,000 ms. Stop an unbounded physical run with `SIGINT` or `SIGTERM`; the collector writes a graceful footer after the last complete sample.

For collector-sanity/synthetic runs only, a bounded duration is available:

```sh
npm run live-lane:sampler -- \
  --state artifacts/live-application-lane/work/sampler-state.json \
  --out artifacts/live-application-lane/work/sanity.jsonl \
  --duration-ms 10000
```

Do not change the physical #116 sampling cadence by choosing another period; the CLI exposes no period override.

The header's `startedAt` is the collector's canonical UTC start boundary. Use that timestamp for the physical run's `startedAt` when producing the run manifest so the raw series and manifest share one boundary.

## 3. Bind the browser process root

After the benchmark browser main process exists, update only the local control file with the exact root PID selected by the launch/operator procedure:

```sh
npm run live-lane:sampler:state -- \
  artifacts/live-application-lane/work/sampler-state.json \
  --browser-root-pid <pid> \
  --phase initial-hydration
```

If a separate Elatura broker is part of the planned condition:

```sh
npm run live-lane:sampler:state -- \
  artifacts/live-application-lane/work/sampler-state.json \
  --elatura-root-pid <pid>
```

The state-update command reports only `set` / `unset`; it does not echo PID values.

Root discovery is intentionally outside the sampler. Guessing a browser process by title, command-line substring, active window, or URL could bind the wrong application session and would widen the privacy surface.

If a configured root disappears, the sidecar sample reports `missing` and records a zero-sized tree for that root. It never quietly follows an unrelated process that reused the application role. Explicitly update the root after a reviewed process replacement when the physical protocol requires continued sampling.

## 4. Update phase and lane state

The sampler reads the control file before every snapshot. Update phase/lane at the same operator/harness boundaries used by the frozen run protocol.

Examples:

```sh
npm run live-lane:sampler:state -- \
  artifacts/live-application-lane/work/sampler-state.json \
  --phase settle

npm run live-lane:sampler:state -- \
  artifacts/live-application-lane/work/sampler-state.json \
  --phase steady-foreground \
  --lane 1

npm run live-lane:sampler:state -- \
  artifacts/live-application-lane/work/sampler-state.json \
  --phase background-probe \
  --lane 1
```

The allowed phase vocabulary is exactly the run-schema phase vocabulary.

For switching stages, update `laneOrdinal` when the active sampled lane changes. Use `--lane clear` for phases where a lane ordinal is inapplicable.

### Memory pressure

V1 does not invent cross-platform pressure thresholds from free-memory percentages. The default is `unknown`.

If the physical host has a separately reviewed pressure classifier, the operator/harness can update:

```sh
--memory-pressure normal|warn|critical|unknown
```

The benchmark's existing critical-pressure abort rule remains authoritative.

## 5. Stop and validate the raw sidecar

After the primary resource interval finishes, stop the sampler gracefully.

Validate it before building the run manifest:

```sh
npm run live-lane:sampler:check -- \
  artifacts/live-application-lane/work/resource-samples.jsonl
```

The checker requires:

- one exact header first;
- one or more exact sample records;
- monotonic captured timestamps and `elapsedMs`;
- exact run-schema resource-sample fields;
- matching footer sample count;
- graceful `signal` or `duration` completion;
- all privacy declarations false.

It reports:

- sample count;
- minimum / median / maximum observed elapsed interval;
- samples where the browser root was configured but missing;
- samples where the external Elatura root was configured but missing;
- sample count per phase.

The checker deliberately does not invent a timing-jitter acceptance threshold. #116 preregisters a 2-second target but no generic maximum-jitter rule. Preserve spacing diagnostics and interpret abnormal collection honestly.

A missing footer or an explicit sampler-error footer is invalid raw collector evidence.

## 6. Extract run-schema resource samples

To write a separate JSON array containing only the exact `resourceSample` objects:

```sh
npm run live-lane:sampler:check -- \
  artifacts/live-application-lane/work/resource-samples.jsonl \
  --extract artifacts/live-application-lane/work/resource-samples-for-run.json
```

The extracted array contains no sampler header, root state, process identifier, or local path. Copy/use that array as the run manifest's `resourceSamples` field according to the frozen run creation procedure.

The raw JSONL and extracted helper file remain outside the stage `final/` directory. The accepted final directory contains only the strict run + projection-ledger pair.

## 7. Collector sanity before authenticated runs

Before first private/live collection:

1. run full repository tests;
2. run the sampler against a synthetic/local process setup;
3. change phase/lane through the control file;
4. verify tree aggregation against known parent/child processes;
5. stop gracefully;
6. run `live-lane:sampler:check`;
7. inspect spacing and missing-root counts;
8. extract the resource-sample array and validate it inside the existing synthetic benchmark/run-schema tests.

Repository tests include a real host `ps` smoke probe on macOS/Linux plus deterministic process-table accounting fixtures. That proves command syntax and aggregation logic without requiring an authenticated application.

## Failure semantics

The sampler stops on:

- invalid/replaced control state;
- failed numeric `ps` snapshot;
- overlapping browser/external-Elatura trees;
- output failure.

When output remains writable, a fixed error footer is written. The checker refuses error-footer sidecars.

The sampler never chooses a replacement root automatically and never converts missing process state into a recovery claim.

## Relationship to final evidence

This tool supplies the raw external numeric resource series required by #116. It does not determine:

- whether a browser/application lane is useful;
- whether recovery succeeded;
- whether a discard/freeze was allowed;
- whether application fidelity passed;
- whether an intervention should be promoted.

Those remain with the run/projection manifests, application fidelity probes, and `live-lane:check` / analysis protocol.
