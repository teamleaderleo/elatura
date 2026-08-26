# Application lane benchmark packet

Tracking issue: #116  
Schema: `benchmark-application-lane-run-v1`

This packet measures one logical Elatura application lane against an ordinary stock-browser application session while keeping the genuine signed-in application authoritative.

## What the manifest records

The manifest separates logical lane identity from replaceable browser projection state.

Lane fields contain only bounded local tokens and classes. Browser profile/session handles, tab ids, CDP target ids, renderer process ids, window ids, URLs, credentials, page content, and screenshot bytes have no field in the schema.

Projection accounting records only aggregate lifecycle facts:

- bindings;
- replacements;
- losses;
- recoveries;
- unrecovered losses;
- maximum simultaneous projections.

A projection replacement can therefore be measured without turning a tab or process id into durable product identity.

## Attention ladder

Every attention episode is classified by the highest observation rung actually required:

```text
signal only
  -> bounded semantic read
  -> screenshot
  -> full genuine-application activation
```

The manifest also records raw operation counts, false-positive signals, and changes discovered without a prior useful signal. The highest-rung buckets must sum exactly to the episode count.

Screenshots may be used during a run. Only the screenshot operation count and timing enter the manifest; screenshot bytes remain outside committed evidence.

## Resource samples

Record up to 64 content-free samples across these fixed phases:

- `idle`
- `streaming-or-editing`
- `switch`
- `inspection`
- `recovery`

Each sample may contain browser/process byte counts, CPU time, DOM element/text-node counts, mounted application-unit count, and Elatura retained bytes. Unavailable measurements are `null` where the schema permits them.

Do not substitute one browser's private memory estimator for another without recording that limitation beside the private run notes. The committed manifest contains values only, never raw process identifiers or command output.

## Fidelity

`authoritativeApplicationPreserved` must always be true for an admitted manifest. Other fidelity fields are measurements and may record a poor result:

- normal interaction availability;
- current streaming/edit/caret/work state preservation;
- recovery failures;
- drift-triggered fail-open count.

A bad Elatura result should remain a valid benchmark result when the authority/privacy contract held.

## First matched run

Use the existing pathological ChatGPT workload.

### Stock Firefox cohort

- ordinary signed-in Firefox application session;
- `cohort: stock`;
- `interventionLevel: stock-observe`;
- use content-free instrumentation only.

### Elatura Firefox cohort

- same machine, account/workload class, and run plan;
- `cohort: elatura`;
- use only the safest intervention level already earned by current Firefox work;
- keep live transform authorization at its current reviewed setting.

Exercise:

1. cold/initial usable state;
2. idle residency;
3. active response streaming;
4. repeated switch away/back;
5. one deliberate projection-loss/recovery case such as controlled tab reload or browser restart where the experiment can preserve truthfully comparable state;
6. bounded inspection when useful;
7. screenshot only when semantic observation is insufficient;
8. full application activation whenever verification or interaction requires it.

## Validation

Build first so the benchmark parser exists in `benchmarks/dist`, then run:

```bash
npm run benchmark:application-lane -- /absolute/path/to/run.json
```

The validator prints only application/browser/cohort/intervention classes and aggregate counts. It never prints the lane key, target locator, path, native browser id, credentials, page content, or screenshot bytes.

The example packet is `benchmarks/examples/benchmark-application-lane-run-v1.example.json`.

## Interpretation

Compare matched manifests field by field. Do not create a single aggregate score in the first packet.

The useful questions are:

- does Elatura reduce resident browser/application cost;
- does switching or recovery improve;
- do signals eliminate useless inspections;
- how often bounded semantic reads avoid screenshots or full activation;
- does ordinary human interaction remain usable and truthful;
- does projection replacement preserve the logical lane without browser identities becoming product identity.

A direct API or clean local representation remains the control for tasks where it already supplies the needed data more cheaply. This benchmark exists for live authenticated interactive application state.
