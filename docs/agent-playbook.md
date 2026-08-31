# Elatura detailed coding-agent playbook

This is the task-selected detailed guide for Codex and other coding agents. The repository-root `AGENTS.md` owns the small universal router; load this file only when the task needs the detailed development, browser, benchmark, physical-handoff, or delivery procedure below.

Elatura is an experimental local-first application/browser management layer for heavyweight authenticated web applications. The genuine signed-in application remains authoritative. Elatura manages bounded observation, current browser projections, recovery, attention facts, interaction exclusion, and safe browser-resource policy around it.

## Read first

Before changing behavior, read:

1. `README.md` — current product/repository entry point.
2. `docs/developer-workflow.md` — commands, repository map, extension workflow, and benchmark loop.
3. `docs/application-lanes.md` — application-lane product model and ownership boundary.
4. `CONTRIBUTING.md` — review expectations and safety principles.

When GitHub issue access is available, issue #12 is the canonical current execution board. Issue #116 is the primary browser/resource evidence gate. Avoid copying a long current-work list into this file; use #12 for changing coordination state.

## Local development

Recommended runtime is Node 22:

```sh
nvm use
npm ci --ignore-scripts
```

Use the narrow inner loop while editing:

```sh
npm run check:code
npm test -- path/to/focused.test.ts
```

Before treating a branch as mergeable, run:

```sh
npm run check
```

`npm run check` is the complete repository gate: security/capability checks, TypeScript, all Vitest tests, Firefox build/lint, build-manifest generation, and unsigned release-candidate smoke.

A focused test or `check:code` result is iteration evidence only.

## Product invariants

Preserve these unless the owning issue explicitly changes them.

### 1. The application stays authoritative

Elatura may observe, reduce resident working state, reload, recover, or present bounded alternate views. It never promotes a local representation into application authority.

### 2. Application lanes outlive browser projections

Canonical lane identity is:

```text
laneRef + generation
```

Tab ids, window ids, process ids, CDP target ids, document projection refs, and profile ids are private ephemeral browser projections. Never substitute one of them for a durable lane identity in `packages/core` or a consumer-facing protocol.

### 3. Generation first

Old generations never mutate, bind, renew, plan, receive effects for, or repopulate newer lane state. Revalidate generation/current projection around asynchronous reads and immediately before physical effects.

### 4. Observation is zero authority

Events, observations, browser receipts, recovery facts, screenshots, and completion hints grant:

```text
grantsWorkAuthority = false
authorizesWorkDispatch = false
```

Elatura does not rank missions, dispatch work, assign responsibility, or become the portfolio scheduler. Stensibly owns work authority and scheduling.

### 5. Unknown lifecycle eligibility stays conservative

`unknown` never silently becomes permission for freeze, discard, destructive DOM work, or interaction. Active generation, unsaved interaction, IME composition, modal work, media/device activity, downloads, application drift, and unverified recovery remain blockers according to the canonical lifecycle contracts.

### 6. Browser-native behavior comes first

Use stock browser lifecycle primitives where they solve the measured problem. Custom CDP/provider/browser machinery must earn itself through evidence. Keep the Chromium host thin.

### 7. Private content stays out of committed evidence

Do not commit or log transcript/document text, prompts, generated answers, cookies, authorization headers, credentials, raw authenticated URLs, private titles, profile ids, tab/target/process ids, screenshots, raw DOM, or accessibility text unless a separately reviewed contract explicitly allows that artifact class.

Prefer opaque bounded tokens and fixed enums.

### 8. Fail open toward the genuine application

Unknown/drifted/unsupported intervention state returns to the ordinary application path. A local optimization must never trap the user away from the authoritative site.

## Directory ownership

- `packages/core/` — provider-neutral lane/runtime/lifecycle, companion, cache, representation, and protocol contracts.
- `packages/adapter-chatgpt/` — ChatGPT-specific graph identity, continuity, lifecycle activity, transformation, and representation logic.
- `packages/companion-web/` — bounded local companion implementation and lifecycle accounting.
- `packages/fixtures/` — deterministic synthetic/malformed workloads.
- `extension/firefox/` — Firefox observation, ChatGPT activity probes, slim-mode laboratory, reports, and safety controls.
- `extension/chromium/` — thin Chromium projection/lifecycle host.
- `benchmarks/` — evidence contracts, schemas, fixtures, and benchmark-side logic.
- `scripts/` — security/release gates, benchmark operators, validators, and local developer tools.
- `docs/` — product contracts, methods, privacy/safety boundaries, and runbooks.

Application-specific assumptions belong in adapters or reviewed browser/application seams, not generic core.

## Browser boundaries

### Chromium

The current Chromium lifecycle host is intentionally small:

- Manifest V3 / Chrome 132+;
- zero requested permissions and host permissions;
- no content script in the lifecycle host;
- browser ids stay private;
- durable lane identity stays with the caller/runtime;
- stock reload/discard/focus primitives perform physical effects;
- currentness/correlation is revalidated around every managed effect.

Do not add debugger/CDP, content access, storage, URL/title inspection, or provider logic simply because it is convenient. Tie any capability expansion to a measured missing primitive.

### Firefox

Firefox has broader reviewed ChatGPT page access and is the current application-observation/slim-mode laboratory. Production Firefox source/static files are recursively scanned by the repository security gate.

`browser.storage` and `browser.webRequest` remain background-only capabilities under the current security policy. New page-side producers should emit bounded fixed tokens, stay fail-closed under drift, and avoid content/network/log sinks.

## Live application-lane benchmark

The #116 resource experiment is preregistered. Treat its plan/schema/protocol semantics as frozen evidence rules unless the owning issue explicitly reopens them.

Do not casually:

- change the planned condition matrix, counts, timing, cooldown, switch schedule, or primary metrics;
- add convenient result fields to final schemas after seeing live data;
- put supplemental diagnostics into a resource-stage `final/` directory;
- weaken strict schema/privacy/timing admission;
- reinterpret a partial stage as a full-session result.

Operator flow:

```text
live-lane:plan
  -> live-lane:verify-plan
  -> live-lane:next
  -> execute the reported physical subrun
  -> add run + projection pair
  -> repeat
  -> live-lane:check at the stage boundary
```

Useful commands:

```sh
npm run live-lane:verify-plan -- <plan.json>
npm run live-lane:next -- <plan.json> <stage-final-dir> --stage chatgpt-single
npm run live-lane:check -- <plan.json> <stage-final-dir> --stage chatgpt-single
npm run benchmark:chatgpt-activity -- <diagnostic.json>
```

`live-lane:next` has progress/cooldown guidance authority only. `live-lane:check` owns stage/full evidence readiness.

Negative benchmark results are valid results. Preserve them and stop deeper product investment when a preregistered gate says to stop.

## Working before physical browser access

Prefer repository work that can be proven with synthetic fixtures, pure contracts, content-free diagnostics, static gates, and hosted CI.

Good pre-physical tasks include:

- parser/currentness/fidelity edge cases;
- operator and developer ergonomics;
- explicit dependency/package/export integrity;
- security/privacy regression coverage;
- deterministic fixture and evidence-admission tooling;
- simplifying duplicate code while preserving machine-checked behavior;
- documenting a precise physical procedure.

Avoid inventing a new lifecycle abstraction or provider capability merely to stay busy.

When the remaining question truly depends on an authenticated browser profile, OS process-tree measurements, human editing fidelity, or live provider behavior, stop pretending repository code can answer it. Leave the repo green and return the exact owner-machine/Codex computer-use procedure and expected artifacts.

## Change discipline

- Prefer one semantic owner and one narrow claim per PR.
- Search current open/merged work before adding another owner for the same fact.
- Close superseded alternate implementations rather than maintaining parallel APIs.
- Reuse canonical parsers/types/helpers before copying validation logic.
- Keep resource limits as ceilings, not targets.
- Avoid optimizing small Elatura bookkeeping while browser/application costs dominate the experiment.
- Keep failure output content-free and deterministic where tooling handles private/local artifacts.
- Restack and rerun the exact combined head when `main` moves under a contract-sensitive branch.

A PR description should state the observed problem, behavior change, failure/privacy/currentness boundary, tests, exact-head CI result, and consuming issue/experiment.

## Handoff checkpoint

Before handing work to a computer-use worker, the repository should be green and the task should say exactly which physical fact remains unknown. For #116 the decisive facts are whole-browser resource cost, recovery latency/fidelity, and useful authenticated lane capacity under matched stock versus managed conditions. Repository code should support that measurement; it should not manufacture the answer.
