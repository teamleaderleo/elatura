# Contributing

Elatura is still defining its safety and compatibility boundaries. Small, evidence-backed changes are preferred over broad framework work.

## Principles

1. **Fail open.** Unknown or invalid application state must fall back to the unmodified website.
2. **No private-content telemetry.** Tests and benchmark reports must not contain conversation text, cookies, authorization headers, or unredacted identifiers.
3. **Measure before optimizing.** Performance claims require reproducible local reports.
4. **Keep adapters isolated.** Application-specific assumptions belong in an adapter, not the generic core.
5. **Preserve unknown data.** A transform must not silently discard fields or content types it does not understand.
6. **Respect capability boundaries.** Adapter support, build authorization, and runtime reachability are separate decisions.

## Developer workflow

Use Node 22 (the repository includes `.nvmrc`) and install exactly the committed dependency graph:

```bash
nvm use
npm ci --ignore-scripts
```

For ordinary code/test iteration:

```bash
npm run check:code
```

For one focused test file:

```bash
npm test -- path/to/file.test.ts
```

See [`docs/developer-workflow.md`](docs/developer-workflow.md) for the repository map, extension commands, benchmark operator flow, and the distinction between local iteration checks and evidence/merge gates.

## Before opening a pull request

Run the complete repository gate:

```bash
npm run check
```

Explain which measured or observed problem the change addresses, how failure behaves, which project gate applies, and which #12 coordination-board owner consumes the result. For branches that depend on current contracts, revalidate the exact combined head after `main` moves.
