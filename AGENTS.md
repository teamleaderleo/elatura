# Elatura agent router

Elatura is a local-first access layer around heavyweight authenticated applications. The genuine signed-in application stays authoritative; Elatura owns bounded observation, browser projections, recovery, lifecycle policy, and presentation around it.

## Always preserve

- Durable application identity is `laneRef + generation`. Browser/window/tab/process/CDP/document/profile ids are private projections, never durable lane identity.
- Generation comes first: stale generations never bind, renew, plan, receive effects for, or repopulate newer state. Revalidate currentness around asynchronous reads and immediately before physical effects.
- Observation grants zero work authority and zero dispatch authority. Elatura does not rank or assign work; Stensibly owns work coordination.
- `unknown` lifecycle/intervention state stays conservative. It never silently permits freeze, discard, destructive DOM work, or interaction.
- Keep authenticated/private content out of committed evidence: no transcripts, prompts/answers, cookies, auth headers, credentials, raw authenticated URLs/titles, screenshots, raw DOM/accessibility text, or ephemeral browser identities unless a separately reviewed contract explicitly allows that artifact class. Prefer bounded opaque tokens and fixed enums.
- Prefer browser-native lifecycle primitives. New CDP/provider/browser capability must answer a measured missing primitive and preserve currentness/privacy.
- Fail open toward the genuine application: drifted, unknown, or unsupported optimization state returns to the ordinary app path rather than trapping the user in a local representation.
- Application-specific assumptions belong in adapters or reviewed browser/application seams, not provider-neutral core.

## Route before reading

Do not preload the whole repository manual. Load the smallest owner for the task:

- changing/current work -> GitHub issue #12 and the owning issue/PR;
- implementation/setup/checks/repository map -> `docs/developer-workflow.md`;
- lane/lifecycle/authority semantics -> `docs/application-lanes.md`;
- contribution/review policy -> `CONTRIBUTING.md` when preparing/reviewing a candidate;
- Chromium/Firefox capability detail, the preregistered live resource experiment, physical-browser procedure, or computer-use handoff -> `docs/agent-playbook.md`, then the exact owning issue/runbook;
- product orientation only -> `README.md`.

Search current open/merged work before adding another owner. Mutable experiment status belongs on its issue/PR, not in this automatic file.

## Verification

Use the narrow repository-owned loop while iterating (`npm run check:code` plus focused tests). Before treating a candidate as mergeable, run `npm run check`; exact setup and command semantics live in `docs/developer-workflow.md`.

A focused check is iteration evidence only. Keep failure output content-free where private/local artifacts are involved.

## Working boundary

Prefer synthetic fixtures, pure contracts, validators, and static/security gates until the remaining question genuinely requires an authenticated browser, OS process measurement, or human fidelity judgment. At that point leave the repository green and hand off the exact physical unknown instead of inventing another lifecycle abstraction.

Negative preregistered results are valid results. One semantic owner and one narrow claim per PR; reuse canonical parsers/types/helpers and close superseded alternate implementations.
