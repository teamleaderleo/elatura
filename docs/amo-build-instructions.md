# AMO reviewer build instructions

Elatura's Firefox extension is written in TypeScript and compiled into `extension/firefox/dist`. The submitted source archive contains the complete tracked repository at the candidate revision.

## Environment

- Node.js 22 or later
- npm with lockfile support
- Git

No browser profile, API credential, signing key, native program, or private fixture is required to build and inspect the extension.

## Build and verify

From the source archive root:

```sh
npm ci --ignore-scripts
npm run check
npm run release:candidate:unsigned -- --channel=unlisted
```

`npm run check` performs:

- frozen workspace-lock verification
- static security, permission, transform-safety, and release-policy checks
- TypeScript project compilation
- the complete Vitest suite
- Firefox extension lint
- deterministic build-manifest generation
- a deterministic unsigned Firefox candidate smoke build

The explicit candidate command rebuilds the extension and produces:

- an unsigned ZIP clearly named as unsigned
- a human-readable source ZIP created from the exact Git revision
- `release-candidate.json`, which records content-free SHA-256 digests and identifies the requested future AMO channel

The candidate command builds the unsigned extension ZIP twice after normalizing generated-file modification times and refuses the candidate if the two hashes differ.

## Source-to-output mapping

- `extension/firefox/src/*.ts` compiles to `extension/firefox/dist/*.js`
- `extension/firefox/static/*` is copied to `extension/firefox/dist`
- `scripts/copy-extension-assets.mjs` performs the copy
- `scripts/generate-build-manifest.mjs` records the final built file inventory and digest

There is no minification, obfuscation, bundling, remote code download, or generated control flow. The JavaScript output remains readable TypeScript compiler output.

## Signing boundary

The source-build commands do not sign or publish anything. Mozilla signing is a separate manually approved operation. AMO API credentials must be supplied only in the approved signing environment and must not be placed in this source archive, repository, pull-request CI, logs, or release-candidate artifacts.
