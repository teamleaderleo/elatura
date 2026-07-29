# Release provenance

Elatura's build manifest records facts about one built extension artifact. It is not a compatibility promise and keeps independent version domains explicit.

## Build-manifest schema 3

The manifest contains:

- the full source revision
- the frozen dependency-lock digest
- the capability-policy digest
- the built extension digest and per-file digests
- requested extension and host permissions
- npm package versions for adapter packages
- the normalized adapter compatibility identity registry and its canonical SHA-256 digest

The adapter package field remains named `adapterPackageVersions`. These are distribution/package versions only.

`adapterCompatibilityRegistry` is a separate object with:

- registry schema version
- canonical SHA-256 digest
- normalized entries containing a fixed local name, adapter id, and compatibility version

The build step reads `packages/adapter-chatgpt/src/compatibility-identities.json`, validates bounded tokens and uniqueness, imports the compiled adapter identity module, and compares the registry with the exported inspection adapter, adapter version policy, and synthetic pipeline adapter. Any mismatch fails manifest generation and therefore fails CI.

## Adapter compatibility versions

An adapter's compatibility version answers a different question from its npm package version: which input formats and semantics the adapter understands. It may change independently of the package version.

The current registry contains:

- `inspection`: `chatgpt-conversation` / `0.3.0`
- `synthetic-transform`: `chatgpt-synthetic-conversation` / `0.1.0`

Updating either compatibility version requires an intentional source-registry change. Build provenance changes through both the normalized entries and the registry digest. The generic package version may remain `0.0.0` during the same change.

The transform-safety gate parses the bundled local denylist and rejects every entry that is not an exact id/version member of this registry. No remote policy, page input, or runtime network source can add an identity.

## Release-candidate schema 2

The deterministic unsigned Firefox release-candidate manifest copies the exact normalized `adapterCompatibilityRegistry` object from build-manifest schema 3. The candidate also verifies that the build manifest uses the expected schema and that the registry is present before packaging.

This allows a reviewer to identify both:

- which npm workspace package versions produced the build
- which exact adapter compatibility identities the build declares

The candidate remains unsigned, non-installable as a release claim, and disconnected from Mozilla credentials or publishing.

## Workspace links

The frozen npm lockfile contains local `link: true` entries for workspace packages. The security gate verifies that every such link:

- resolves to a normalized repository-relative path
- stays inside a declared workspace
- points to a workspace package recorded in the lockfile
- uses the package's exact declared name in its `node_modules` key
- is not duplicated through another lock path

Registry-package integrity checks and local-workspace-link checks are separate because local links correctly have no registry tarball digest.

## Release boundary

The build manifest improves inspectability, but it does not replace signing, browser-store review, reproducible-build verification, or adapter compatibility testing. Those remain separate release gates.
