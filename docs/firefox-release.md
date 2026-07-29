# Firefox signing and distribution

Reviewed against current official Mozilla documentation on 2026-07-29.

## Non-negotiable boundary

An unsigned Elatura ZIP is a review candidate, not an installable release artifact. Extensions distributed for normal Firefox release or beta builds require Mozilla signing through addons.mozilla.org (AMO), including self-distributed unlisted extensions.

Official references:

- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- https://extensionworkshop.com/documentation/publish/source-code-submission/
- https://extensionworkshop.com/documentation/publish/self-distribution/

## Channels

### Development

Use `npm run run:firefox` or temporary loading through Firefox developer tooling. Development output is not distributed and makes no signing claim.

### Unsigned review candidate

Use:

```sh
npm run release:candidate:unsigned -- --channel=unlisted
```

This produces a deterministic unsigned ZIP, source archive, and release-candidate manifest. It is for code review, reproducibility checks, and later signing input. Its filename and manifest explicitly state that it is unsigned and not installable on ordinary release/beta Firefox.

### Unlisted signed alpha

After #3 and #4 are complete, a limited alpha may be submitted to AMO's `unlisted` channel. `web-ext` 10 requires an explicit channel and returns a Mozilla-signed XPI for self-distribution.

The approved signing environment may run the equivalent of:

```sh
web-ext sign \
  --channel=unlisted \
  --source-dir=extension/firefox/dist \
  --artifacts-dir=artifacts/firefox-signed \
  --upload-source-code=artifacts/firefox-release/elatura-source-<revision>.zip \
  --amo-metadata=release/amo-metadata.json \
  --api-key="$WEB_EXT_API_KEY" \
  --api-secret="$WEB_EXT_API_SECRET"
```

This command is documentation only. It is deliberately absent from package scripts and pull-request workflows.

### Listed production

A public production release uses the AMO `listed` channel after M1 evidence, the full #4 gate, reviewer-ready metadata, and explicit release approval. AMO becomes the public distribution/update channel.

## Credential policy

AMO API credentials:

- are personal/high-trust release credentials;
- are never committed or uploaded as artifacts;
- are never available to pull-request CI;
- are never printed, echoed, or copied into review notes;
- are not required for normal builds or candidate generation;
- belong only in a manually approved signing environment.

Ordinary CI remains read-only and cannot sign or publish.

## Source review

Elatura compiles TypeScript into extension JavaScript. Every AMO submission therefore includes:

- a human-readable source archive from the exact Git revision;
- the frozen `package-lock.json`;
- `docs/amo-build-instructions.md`;
- capability and release policies;
- tests and build scripts;
- the content-free build and release-candidate manifests.

No minification, obfuscation, or bundling is used.

## Post-signing record

After AMO returns a signed XPI, release approval records:

- candidate manifest SHA-256;
- signed XPI SHA-256;
- extension id and version;
- AMO channel;
- source revision;
- reviewer/submission reference where available;
- manual clean-profile installation result;
- observed requested permissions and host permissions.

This attestation contains no API credentials or private browser data. A signed XPI is not treated as equivalent to the unsigned ZIP; its signature changes the artifact hash.

## No automatic publishing yet

There is no signing or publishing workflow in the repository. Introducing one requires a separate review of protected environments, approvals, secret scope, artifact retention, provenance, rollback, and compromise response.
