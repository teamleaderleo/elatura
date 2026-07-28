# Release provenance

Elatura's build manifest records facts about one built extension artifact. It is not a compatibility promise and must not blur independent version domains.

## Build-manifest schema 2

The manifest contains:

- the full source revision
- the frozen dependency-lock digest
- the capability-policy digest
- the built extension digest and per-file digests
- requested extension and host permissions
- npm package versions for adapter packages

The adapter package field is named `adapterPackageVersions`. These are distribution/package versions only.

## Adapter compatibility versions

An adapter's schema or compatibility version answers a different question: which input structures and semantics the adapter understands. It may change independently of the npm package version.

A future adapter-contract milestone will define an explicit compatibility-version registry and add a separately named provenance field. Until then, the build manifest must not infer compatibility from package metadata or label package versions as adapter versions.

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
