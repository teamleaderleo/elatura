# Live application-lane benchmark packet

Issues: #116, #117, #118  
Historical evidence that constrains this packet: #3, #83, #95, #114, PR #115

This packet defines a matched browser/application experiment for one heavyweight live application and for repeated switching among several heavyweight application lanes. It is deliberately hostile to convenient interpretation. The executor should be able to run it from this document and the fixed schemas without inventing a method halfway through collection.

## 1. Claim boundary

The primary question is:

> Can an Elatura-managed live authenticated application lane preserve useful access to the genuine application while reducing resident browser/application cost, repeated observation, or recovery burden relative to ordinary fully loaded browser tabs?

This packet does **not** test whether Elatura is a better local transcript search tool. PR #115 already tested a bounded Elatura viewport against ordinary local JSONL + `rg` when a clean local representation existed. The control won materially on wall time, visible tool calls, visible bytes, entries exposed, irrelevant entries, expansions, and tokens while producing the same held-out answer. Keep that result exactly. It remains valid evidence for that question.

This packet moves to a different control: live browser/application state.

No composite score is permitted. Every metric remains visible independently.

## 2. Historical evidence ledger

The executor records these as prior evidence before collecting a new sample:

1. **Issue #3 / current live-baseline machinery** — useful controls already exist for fixed browser identity, rotated run order, strict session binding, content-free manifests, and rejecting incomplete/mixed cohorts. Its comparison surface is narrower than this packet: Edge stock, Firefox stock, Firefox observe; cold open/hard reload/client navigation; readiness, peak browser memory, and observed network totals.
2. **Issue #83 synthetic companion work** — bounded client/protocol/render/cache state can be tested for plateau and monotonic growth. Physical browser performance was explicitly unclaimed there. Synthetic bounded-state success therefore counts as feasibility, never as proof of live-browser savings.
3. **Issue #95 slim Firefox work** — render suppression, bounded DOM windowing, response/hydration cost, and application-held JavaScript state are separate mechanisms. A DOM/render improvement cannot be described as a network or runtime-state saving without direct evidence.
4. **Issue #114 / PR #115** — bounded viewport semantics worked, retained sidecar state plateaued, stale/drifted behavior remained explicit, and the ordinary local-search control still won. The result also exposed measurement defects in earlier attempts. This packet copies the useful discipline: fixed content-free fields, independent dimensions, raw repeated samples, explicit negative evidence, and no aggregate score.
5. **Issue #118 Google Docs direction** — application-specific intervention starts observation-only. Existing virtualization may already solve much of the problem. A result showing little Elatura headroom is a successful experiment outcome.

A later product direction does not erase any item above.

## 3. Top-level browser matrix

The six requested top-level conditions are fixed:

| Code | Condition | Engine family | Elatura |
|---|---|---|---|
| `ES` | Edge stock | Blink/V8 | absent |
| `CS` | Chrome stock | Blink/V8 | absent |
| `CRS` | Chromium stock | Blink/V8 | absent |
| `FS` | Firefox stock | Gecko/SpiderMonkey | absent |
| `FE` | Firefox + Elatura | Gecko/SpiderMonkey | present |
| `CRE` | Chromium + Elatura | Blink/V8 | present |

Record exact browser version and build token for every condition before the first run. Any browser update during a stage invalidates that stage.

### 3.1 Required internal Elatura control

Every `FE` and `CRE` slot contains two full-browser-restart subruns:

- `passive`: the same Elatura extension/broker/attachment is present and collecting only the benchmark-required local telemetry. Working-set intervention is disabled.
- `managed`: the exact frozen Elatura intervention under test is enabled.

The two subruns use the same profile lineage, lane set, workload, duration, and collector. Alternate order by block:

- odd block: `passive` then `managed`;
- even block: `managed` then `passive`.

Fully quit the browser and broker and wait 60 seconds between the two subruns.

This yields three different Elatura quantities that must remain separate:

- **runtime/attachment overhead** = `passive - matched stock`;
- **gross intervention effect** = `managed - passive`;
- **net Elatura effect** = `managed - matched stock`.

If a metric cannot isolate passive from managed, report only the net value and mark the other deltas unavailable.

### 3.2 What the matrix can identify

Use these attribution labels and no stronger ones:

- `Edge stock vs Chrome stock vs Chromium stock`: browser-product/build/service differences **within the Blink/V8 family**.
- `Firefox stock vs Chromium stock`: browser-family difference. Product integration and engine differ together, so a pure engine causal claim is unavailable.
- `Firefox managed vs Firefox stock`: net Elatura effect on the Firefox transport.
- `Chromium managed vs Chromium stock`: net Elatura effect on the Chromium transport.
- `managed vs passive` inside one transport: effect of the working-set intervention after the Elatura runtime is already present.
- agreement of Firefox and Chromium paired deltas: evidence that an effect may generalize across transports. Disagreement is transport-specific evidence and stays visible.

Do not call an Edge/Chrome/Chromium difference an engine effect. They share the same engine family.

## 4. Application matrix

The live ChatGPT pathological workload is the primary confirmatory application because it is already Elatura's best-instrumented pathological case.

Google Docs is the required application-effect replication because #118 intentionally exercises a different application model. A cross-application claim requires both applications to have completed interpretable runs.

### 4.1 ChatGPT primary application

Use one operator-owned, already-completed pathological conversation for the single-lane workload. During resource runs:

- no message submission;
- no new branch creation;
- no deletion/editing;
- viewport begins at the latest completed region;
- composer is empty;
- side panels/popovers are closed;
- browser zoom is 100%;
- the same conversation identity is used in every browser condition;
- content, title, URL, account identity, and transcript text remain outside committed artifacts.

The target is intentionally private/live. The manifest contains only a fixed local workload token such as `chatgpt-pathological-a`.

### 4.2 Google Docs application-effect fixture

Use an operator-owned synthetic document. Create the document once, duplicate it for lane tests, and freeze its content before benchmarking.

V1 fixture recipe:

- 100,000 synthetic words;
- 200 level-2 headings distributed evenly;
- 20 tables, each 20 rows x 10 columns, containing fixed synthetic tokens;
- no images, embeds, comments, suggestions, or external links in the first fixture;
- default Docs zoom and browser zoom 100%;
- outline, comments, side panels, and dialogs closed;
- caret at the beginning of heading 100 for the single-lane workload;
- no edits during resource runs.

Record only the fixed fixture token `gdocs-text-100k-v1` and the numeric recipe counts. Do not commit document text or URL.

This first fixture intentionally gives Google Docs' own virtualization every chance to win. Rich media/comments can become a later protocol revision after the text-first result is known.

### 4.3 Application-effect claim rule

ChatGPT and Google Docs are not size-matched representations. Cross-application differences therefore mean **application + workload effects**, not a normalized per-byte application cost.

A claim that Elatura's savings generalize across applications requires the within-application paired Elatura deltas to point in the same direction. Raw absolute memory/CPU differences between ChatGPT and Docs are descriptive only.

## 5. Workload A — one pathological heavyweight application

Run the full six-condition matrix on ChatGPT first. Run the Google Docs replication after the ChatGPT stage is interpretable.

### 5.1 Sample count

- ChatGPT: 5 blocks.
- Google Docs replication: 3 blocks.

One block contains all six top-level conditions. `FE` and `CRE` each contain their two required passive/managed subruns.

### 5.2 Canonical run phases

Each physical subrun follows this exact sequence:

1. Restore the condition's canonical profile snapshot.
2. Confirm no target-browser or Elatura-broker process remains.
3. Wait 60 seconds.
4. Start the external resource sampler.
5. Launch the browser.
6. Open the target application directly.
7. Record `applicationActionableMs`: launch command to the first point where the expected current region is visible and the normal interaction target is enabled.
8. Record DOMContentLoaded when measurable. Keep it separate from application-actionable readiness.
9. After actionable readiness, leave the page foregrounded for 120 seconds with no interaction.
10. Record a 600-second steady foreground interval.
11. Run 10 background/return probes:
    - switch to one fixed neutral local tab;
    - dwell 30 seconds;
    - return to the application;
    - record return-to-actionable latency;
    - perform the neutral responsiveness action in section 11;
    - dwell 10 seconds before the next probe.
12. Stop the primary resource sampler.
13. Collect the supplemental DOM/runtime checkpoint in section 12.
14. Perform the restart-recovery probe in section 13.
15. Export only the content-free manifest and raw numeric sampler file.

The 120-second settle interval is never included in the cold-start metric and is never silently merged into steady-state CPU/memory.

## 6. Workload B — repeated switching among heavyweight lanes

The primary lane count is exactly 8. A different lane count requires a new plan revision; do not silently use 6 or 10 because the machine feels slow.

Run homogeneous lane sets first:

- `chatgpt-switch-8`: eight fixed heavyweight ChatGPT conversations/application lanes;
- `gdocs-switch-8`: eight copies of `gdocs-text-100k-v1`.

A mixed 4 ChatGPT + 4 Docs run is optional external-validity evidence and never substitutes for the homogeneous sets.

### 6.1 Sample count

- ChatGPT 8-lane switching: 3 blocks.
- Google Docs 8-lane switching: 3 blocks.
- Optional mixed 4+4: 2 descriptive blocks.

### 6.2 Lane identity

Freeze lane ordinals `1..8` before the first block. The same underlying application lane maps to the same ordinal across every browser condition.

For ChatGPT, choose the eight lanes before collection and never replace a lane midway because one browser handles it badly. If one lane becomes unavailable, abort the block and repair the test set before restarting.

For Docs, make eight identical copies of the frozen synthetic fixture and place the caret at these heading numbers respectively:

`25, 50, 75, 100, 125, 150, 175, 200`.

### 6.3 Canonical switching run

Each physical subrun follows this exact sequence:

1. Restore the canonical profile snapshot and start the sampler.
2. Launch the browser.
3. Open lanes 1 through 8 in ordinal order.
4. Wait until all eight are actionable.
5. Dwell 120 seconds on lane 1.
6. Perform 2 complete warm-up rotations through lanes `1,2,3,4,5,6,7,8`. Warm-up samples remain in the raw time series but are flagged `warmup` and excluded from plateau tests.
7. Perform 12 recorded rotations through the same ordinal order: 96 recorded activations.
8. For every activation:
   - start the switch latency timer at the benchmark activation event;
   - stop the primary switch timer when the lane becomes visible and application-actionable;
   - record whether the lane reports discard/reload/recovery state;
   - perform the neutral responsiveness action;
   - dwell until 15 seconds have elapsed from activation, then activate the next lane.
9. After rotation 12, activate the neutral local tab and leave all eight application lanes backgrounded for 300 seconds.
10. Return through lanes 1..8 once, recording long-background recovery latency and reload/discard state.
11. Stop the primary sampler.
12. Collect supplemental DOM/runtime checkpoints for lanes 1 and 8 only.
13. Perform one whole-browser restart-recovery probe and reopen lanes 1..8 in ordinal order.
14. Export the content-free manifest and raw numeric sampler file.

Do not shorten dwell time on a slow condition. Overrunning the 15-second dwell because actionable readiness itself exceeded 15 seconds is recorded as a latency failure; activate the next lane immediately after the failed/late readiness observation.

## 7. Fixed condition order

Use this balanced six-condition order. Do not group browsers by vendor.

Mapping: `1=ES`, `2=CS`, `3=CRS`, `4=FS`, `5=FE`, `6=CRE`.

Balanced rows:

1. `ES, CS, CRE, CRS, FE, FS`
2. `CS, CRS, ES, FS, CRE, FE`
3. `CRS, FS, CS, FE, ES, CRE`
4. `FS, FE, CRS, CRE, CS, ES`
5. `FE, CRE, FS, ES, CRS, CS`
6. `CRE, ES, FE, CS, FS, CRS`

Use:

- 5-block stages: rows 1,2,3,4,5;
- 3-block stages: rows 1,3,5;
- 2-block descriptive stages: rows 2,5.

If a block is contaminated and must be repeated, repeat the entire block using the same row. Never move one failed condition to the end of the day and keep it paired with the original block.

## 8. Profile, cache, and machine controls

### 8.1 Machine

All conditions in one stage run on the same physical machine, OS build, display configuration, power mode, and network connection.

Before a block:

- connect AC power;
- disable scheduled OS/browser updates for the collection window;
- close unrelated browsers and heavyweight applications;
- record physical memory, logical CPU count, OS build token, display pixel dimensions, and display scale;
- wait 5 minutes after login/reboot or any major unrelated workload;
- abort the block if the OS reports critical memory pressure or sustained swap thrashing.

Do not manufacture memory pressure during the primary run. Browser discarding that happens naturally is evidence. Artificial pressure belongs in a separate later experiment.

### 8.2 Profiles

Use dedicated benchmark profiles only.

For Firefox and Chromium, create a common signed-in profile lineage before installing Elatura, then create:

- one stock snapshot;
- one Elatura snapshot.

The snapshots must share the same application account/workload state as closely as the browser permits. If copying a signed-in profile forces reauthentication or changes protected storage, create independent dedicated logins and mark the stage `profilePairing=independent-login`; paired Elatura causality is then weaker and the result must say so.

Edge and Chrome each use their own dedicated signed-in benchmark profile.

### 8.3 Canonical snapshot

The canonical snapshot is made after authentication and browser setup but before opening the target benchmark workload. Restore it before every physical subrun.

This packet calls the launch condition **cold-process / canonical-profile**, not cold-cache. OS file cache, DNS, provider caches, service workers, and account-side state can remain warm. Never label this as a clean-room cold network start.

## 9. Resource sampling

Primary performance data comes from an external OS-level process sampler. Browser DevTools must stay closed during the primary timed intervals.

Sampling period: exactly 2 seconds.

For every sample record, when measurable:

- elapsed monotonic milliseconds;
- total target-host RSS bytes: browser process tree plus any Elatura broker process required for that condition;
- browser-process-tree RSS bytes excluding a separately measurable external Elatura broker;
- external Elatura broker RSS bytes or `null`;
- summed target-host CPU percent;
- browser-process-tree CPU percent;
- external Elatura broker CPU percent or `null`;
- target-host process count;
- browser-process-tree process count;
- external Elatura process count;
- current phase token;
- current lane ordinal or `null`.

Never subtract an estimated extension memory value from Firefox. If extension cost cannot be isolated inside Firefox's process model, leave the isolated field `null`; the net host RSS already contains it.

### 9.1 Primary memory outputs

For each phase report the raw distribution and these derived values:

- median RSS;
- p95 RSS;
- maximum RSS;
- final-quarter median RSS;
- minimum RSS after an observed discard/reload;
- area under RSS-vs-time curve in byte-seconds.

Peak memory alone cannot support a saving claim.

### 9.2 Primary CPU outputs

For each phase report:

- median summed CPU percent;
- p95 summed CPU percent;
- maximum summed CPU percent;
- integrated CPU-percent-seconds;
- idle/background CPU separately from switch/active CPU.

Do not normalize away core count. The machine identity is fixed within a stage.

## 10. Plateau analysis

Use only recorded post-warm-up switch-boundary samples for the switching plateau test.

For each of these metrics independently:

- target-host RSS;
- browser-tree RSS;
- target-host process count;
- Elatura retained entry/record/artifact bytes when exposed;
- DOM nodes when repeated measurement is available;

compute:

1. median of rotations 1-4;
2. median of rotations 5-8;
3. median of rotations 9-12;
4. Theil-Sen slope per completed rotation over all 12 rotation-end samples;
5. maximum value and rotation where it occurred.

Classify the metric:

- `plateau`: final-third median <= middle-third median + max(5% of middle-third median, one measurement quantum) **and** absolute slope <= 0.5% of the overall median per rotation;
- `growth`: either threshold is exceeded in the positive direction;
- `decline`: slope exceeds the threshold in the negative direction;
- `unavailable`: required samples are missing.

The one-measurement quantum is the smallest non-zero step observed in that metric's samples. This prevents integer process-count noise from being treated like byte precision.

Also report sensitivity at 0.25% and 1.0% slope thresholds. The classification never replaces the raw medians/slope.

### 10.1 Discard-qualified plateau

If RSS reaches a plateau only because one or more lanes were discarded/reloaded, label it `plateau-with-discard`. Report the discard count and recovery costs next to the memory result. Do not present that memory reduction as a free saving.

## 11. Switch latency and input responsiveness

### 11.1 Switch latency

Primary switch latency is:

`activation event -> application actionable`

Application actionable means:

- target lane is visible;
- the expected current application region is present;
- the normal interaction target is enabled;
- the lane is not displaying a browser/application reload placeholder, fatal error, or unresolved recovery state.

Record every activation, including timeouts. Timeout threshold: 15,000 ms. A timeout remains in the failure count and is never silently dropped from the latency distribution.

### 11.2 Neutral responsiveness action

After a lane becomes actionable:

- ChatGPT: focus the empty composer and press `ArrowRight`, then `ArrowLeft`; do not insert text or submit.
- Google Docs: focus the editor and press `ArrowRight`, then `ArrowLeft`; this may move the caret but must not alter document content.

Record `inputAckMs` only when the benchmark probe can observe a real input event and a subsequent application/frame acknowledgement with the same method across the paired conditions. Otherwise record `null`.

A manual stopwatch estimate is forbidden for `inputAckMs`.

Supplementary browser-native INP/Event Timing values may be recorded with an explicit method token. They do not replace the neutral-action measurement.

## 12. DOM and runtime state

DOM/runtime evidence is supplemental and collected after the primary resource sampler stops, unless a non-perturbing existing Elatura counter already exposes it.

At the required checkpoint collect, when measurable:

- element count;
- text-node count;
- document/body subtree node count;
- JS heap used bytes;
- JS heap total bytes;
- application-specific mounted-unit count only when an evidence-backed adapter already defines it;
- Elatura retained entries/records/serialized bytes;
- accessibility-tree node count if the same method is available across the paired comparison.

Use `null` for unsupported fields. Never fill a missing Firefox runtime metric with a Chromium-only metric and compare them as peers.

Opening DevTools for a supplemental probe disqualifies all later primary timing/memory data in that subrun. That is why the probe occurs after the primary sampler stops.

## 13. Discard, reload, and recovery accounting

For every lane activation record fixed booleans/tokens when measurable:

- browser reported discarded before activation;
- `document.wasDiscarded` or equivalent;
- navigation type indicates reload;
- application performed its own visible reload/reconnect;
- lane returned to the expected region;
- unsent draft/caret/selection preserved when applicable;
- recovery required bounded read, screenshot, or full activation steps.

### 13.1 Restart-recovery probe

At the end of every physical subrun:

1. record the current application region token/ordinal locally without content;
2. fully quit the browser and Elatura broker;
3. wait 60 seconds;
4. relaunch the same profile;
5. reopen the target lane(s) through the ordinary product path;
6. measure launch-to-first-actionable lane;
7. for multi-lane runs, reopen all 8 lanes in ordinal order and record time until each is actionable;
8. record number of bounded reads, screenshots, full-page inspections, reloads, and explicit user recovery actions required;
9. record fidelity failures separately.

Recovery time and recovery work stay independent from resident-memory results.

## 14. Attention-routing experiment

Resource switching and attention efficiency are separate questions. Do not infer "useless inspections avoided" from the prescribed 96-switch stress loop.

Run an additional attention-routing trial only after the corresponding 8-lane resource stage succeeds.

### 14.1 Event producer

Use a second device or second operator so event generation does not consume CPU/memory on the measurement host.

Use the fixed lane permutation:

`2,5,1,7,4,8,3,6`

At 90-second intervals the producer causes one real application-local change in the next lane:

- ChatGPT: a benign predetermined test prompt is submitted from the producer device into that disposable test lane; generation start/end/error state is observed on the measurement host if the product propagates it.
- Google Docs: the producer inserts then saves one predetermined synthetic token at the current caret region of that test document.

The resource-only pathological ChatGPT conversation is never modified for this trial; use separate heavyweight disposable lanes.

Record actual event start/end times because provider timing is outside local control.

### 14.2 Policies

Run two policies as separate subruns with the same frozen lane set and producer schedule:

`round-robin` stock policy:

- inspect one lane every 30 seconds in ordinal order;
- an inspection means activating the lane and determining whether actionable change occurred since the previous verified inspection.

`signal-first` Elatura policy:

- inspect a lane when an earned Elatura signal marks changed/generating/possible-completion/error/recovery-needed;
- perform a watchdog inspection of every lane at least once every 300 seconds even without a signal;
- use the read ladder below.

The signal-first policy is evaluated only in `FE managed` and `CRE managed`. Stock browsers provide the round-robin operational control.

### 14.3 Read ladder

For every signal-first inspection use the minimum next rung and record escalation:

1. local event/state delta only;
2. bounded DOM/text/accessibility/application-state read;
3. screenshot;
4. full genuine application activation/computer-use inspection.

Do not take a screenshot merely to make the evidence look richer.

### 14.4 Fixed attention definitions

`actionable change`:

- ChatGPT: generation started, generation ended/possible completion, application error, or new producer-side turn visible;
- Google Docs: producer edit becomes visible, autosave/reconnect error appears, or collaboration state requires operator verification.

`useless inspection`:

- an inspection with no actionable change since the lane's previous verified inspection and no watchdog deadline due.

`false-positive wakeup`:

- an Elatura signal causes inspection and ground truth shows no actionable change.

`missed change`:

- ground truth contains an actionable change that remains uninspected for more than 120 seconds and no truthful signal/explicit UNKNOWN caused escalation.

`false completion`:

- Elatura signals completion while the application is still generating or is in an ambiguous/error state.

False completion is a fidelity failure, not a tradeable performance metric.

### 14.5 Attention outputs

Report independently:

- total inspections;
- useless inspections;
- false-positive wakeups;
- missed changes;
- false completions;
- signal-to-inspection latency;
- change-to-useful-attention latency;
- bounded reads;
- screenshots;
- full application activations;
- watchdog activations;
- escalations per ladder rung;
- operator/agent decision errors when a fixed decision task is used.

## 15. Elatura signal admission rule

A signal name is admitted to the experiment only when the application adapter has an evidence-backed event for it and the signal can be produced without retaining transcript/document content.

Candidate fixed tokens:

- `changed`;
- `generating`;
- `possible-completion`;
- `idle`;
- `error`;
- `drifted`;
- `discarded-or-unavailable`;
- `visual-attention-requested`.

Signals remain observations. They grant no submission/edit/navigation authority.

## 16. Fidelity gates

A performance run remains descriptive but cannot support a promotion claim when any required fidelity gate fails.

ChatGPT gates:

- genuine signed-in application remains authoritative;
- composer remains available in active mode;
- current/streaming output remains visible or truthfully recoverable;
- citations/tools/errors/status needed for normal use remain accessible;
- drift/uncertainty returns to the truthful stock/full path;
- no automatic message submission.

Google Docs gates:

- caret/selection region remains correct after return;
- no unsaved local edit is lost;
- autosave state remains truthful;
- producer collaboration edit becomes visible;
- comments/suggestions/permissions remain reachable when present;
- normal editing works after managed mode returns active;
- no automatic edit/submission occurs.

Any silent data loss, wrong current region, false completion, or unrecoverable partial page is a hard fidelity failure.

## 17. Cold-start versus steady-state reporting

Keep these labels separate:

- `cold-process`: browser/broker process absent before launch; canonical signed-in profile restored;
- `initial-application-hydration`: navigation until application actionable;
- `steady-foreground`: 600-second post-settle single-lane interval;
- `steady-switch`: 12 recorded multi-lane rotations after warm-up;
- `long-background-return`: return after 300 seconds with all application lanes backgrounded;
- `restart-recovery`: whole-browser restart probe.

Never average cold and steady samples into one memory or CPU number.

## 18. Required raw artifacts

Keep private/live raw artifacts on the test machine unless separately reviewed. The committed/shared result should be content-free.

For every physical subrun retain locally:

- run manifest;
- 2-second resource sample series;
- switch event ledger;
- optional DOM/runtime checkpoint;
- attention inspection ledger when applicable.

The content-free run manifest schema is `benchmarks/schema/live-application-lane-run-v1.schema.json`.

Forbidden committed fields include:

- transcript/document content;
- titles;
- URLs;
- query strings;
- cookies/credentials/tokens;
- screenshots;
- raw DOM/HTML;
- accessibility text;
- process command lines;
- free-form operator notes.

Use fixed failure codes and numeric fields instead of prose inside manifests.

## 19. Analysis plan

### 19.1 Per-condition distributions

For every metric report per condition/submode:

- sample count;
- usable/fidelity-failed run count;
- median;
- p95;
- maximum/worst case;
- raw per-run values or time-series-derived values.

### 19.2 Paired deltas

Compute only these predeclared deltas:

- `CS - CRS` and `ES - CRS`: Blink-family browser-product deltas;
- `FS - CRS`: browser-family delta;
- `FE passive - FS`: Firefox Elatura runtime/attachment overhead;
- `FE managed - FE passive`: Firefox intervention gross effect;
- `FE managed - FS`: Firefox net Elatura effect;
- `CRE passive - CRS`: Chromium Elatura runtime/attachment overhead;
- `CRE managed - CRE passive`: Chromium intervention gross effect;
- `CRE managed - CRS`: Chromium net Elatura effect;
- steady-state minus cold-process within the same condition;
- Google Docs paired delta minus ChatGPT paired delta only as a cross-application comparison of effects, never as one combined score.

Positive/negative direction must be named per metric. For memory/CPU/latency/counts lower is usually better; for fidelity, missed-change and false-completion counts must remain zero for promotion.

### 19.3 Blocks and uncertainty

Use block-level paired differences. When at least 5 paired blocks exist, report a descriptive bootstrap 95% interval over block differences using a fixed random seed recorded in the analysis artifact. Do not emit p-values or "statistically significant" language from this packet.

Three-block replication stages are descriptive and report the three paired differences directly.

### 19.4 Missing data

Missing and unsupported measurements remain `null` with a fixed reason code. Never impute a browser-only metric from another browser or substitute a nearby run.

### 19.5 Promotion language

A saving claim for a metric requires:

- the matched managed-vs-stock delta to improve;
- passive overhead to be reported alongside it;
- no hidden discard/reload explanation;
- fidelity gates for that run to pass;
- the effect to survive the steady-state interval, not only the first few minutes.

A cross-transport Elatura claim requires Firefox and Chromium paired evidence to be directionally compatible. A cross-application claim additionally requires the Google Docs replication.

## 20. Challenge checklist before conclusions

The analyst must answer each item explicitly:

- Did memory fall because the browser discarded tabs and push cost into recovery?
- Did Elatura move memory into a broker or extension process outside the browser total?
- Did a lower DOM count leave the application's JS/runtime state unchanged?
- Did a passive observer attachment create enough overhead to erase the managed saving?
- Did the intervention improve cold start but worsen steady switching, or the reverse?
- Did one browser version/build drift during the matrix?
- Did profile/cache history differ between paired stock and Elatura runs?
- Did the application already virtualize aggressively, leaving little headroom?
- Did signal-first inspection avoid visits while missing changes or increasing screenshots?
- Did a "completion" signal merely observe stream end without proving useful completion?
- Did a lower process count reflect process reuse while RSS/CPU stayed high?
- Did one anomalous lane dominate the 8-lane result?
- Are Edge/Chrome/Chromium differences being mislabeled as engine differences?
- Is any PR #115 claim being reinterpreted beyond the local-representation question it tested?

Any unanswered item blocks product language.

## 21. Stage gates

Execute in this order:

### Gate 0 — collector sanity

Use the existing synthetic companion/browser fixture to prove the resource sampler, raw sample retention, and plateau analyzer produce deterministic content-free output. This is instrumentation validation only.

### Gate 1 — ChatGPT single-lane

Run 5 full blocks. Continue only when:

- all six top-level conditions have matched usable data;
- Elatura passive and managed subruns are distinguishable;
- fidelity is interpretable;
- memory/CPU/actionable readiness are complete enough for paired analysis.

### Gate 2 — ChatGPT 8-lane switch

Run 3 blocks. Continue only when:

- all eight lanes remain identifiable;
- 12 recorded rotations complete or failures are preserved;
- plateau classification is available for primary memory/process metrics;
- discard/reload and recovery accounting is complete.

### Gate 3 — attention routing

Run only after Gate 2. This stage can show fewer inspections, or it can show that signals add noise and screenshots. Either result is useful.

### Gate 4 — Google Docs replication

Run the same A and B protocols with the frozen Docs fixture. Managed Elatura mode may legitimately return `unsupported`/fail-open if caret/autosave/collaboration safety has not been earned. In that case, no application-general Elatura saving claim is allowed.

## 22. Decision table

Record conclusions per dimension, never as one score:

| Dimension | Result |
|---|---|
| cold-process memory | improve / neutral / regress / unavailable |
| steady-state memory | improve / neutral / regress / unavailable |
| CPU idle | improve / neutral / regress / unavailable |
| CPU switching | improve / neutral / regress / unavailable |
| process count | improve / neutral / regress / unavailable |
| DOM/runtime state | improve / neutral / regress / unavailable |
| switch latency | improve / neutral / regress / unavailable |
| input responsiveness | improve / neutral / regress / unavailable |
| discard/reload frequency | improve / neutral / regress / unavailable |
| recovery cost | improve / neutral / regress / unavailable |
| useless inspections | improve / neutral / regress / unavailable |
| screenshots/reads | improve / neutral / regress / unavailable |
| sustained plateau | plateau / growth / decline / unavailable |
| fidelity | pass / fail |

A useful Elatura result can improve one operational constraint while regressing another. Preserve both.

## 23. Stop conditions

Stop a physical subrun immediately and record a fixed failure code for:

- wrong browser/profile/Elatura build;
- wrong lane set;
- browser update during run;
- sampler failure longer than 6 seconds;
- unrelated heavyweight application launched on the measurement host;
- critical OS memory pressure/swap thrash;
- accidental private-content capture in an artifact intended for sharing;
- wrong run order;
- managed-mode silent fidelity failure;
- automatic submission/edit/navigation outside the prescribed test action.

Repeat the whole block when the contamination can affect carryover or machine state. Preserve the failed attempt outside the final comparison set.

## 24. What a negative result means

The following are valid outcomes:

- stock browsers already reach a good memory/latency plateau;
- Chrome/Edge/Chromium product differences dominate Elatura effects;
- Firefox's unique intervention saves DOM/render cost while Chromium wins computer-use telemetry;
- Elatura passive overhead erases its managed savings;
- Elatura saves resident memory by causing expensive reload/recovery;
- signals reduce useless inspections but add screenshots or false wakeups;
- Google Docs already virtualizes well enough that Elatura adds little;
- the managed Google Docs intervention cannot preserve editing fidelity and correctly fails open;
- the live-browser question shows no meaningful Elatura advantage.

If the live-browser result is negative, retain PR #115's negative local-search result beside it. Do not invent an agent-office claim to rescue the direction.
