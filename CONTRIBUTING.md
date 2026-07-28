# Contributing

Elatura is still defining its safety and compatibility boundaries. Small, evidence-backed changes are preferred over broad framework work.

## Principles

1. **Fail open.** Unknown or invalid application state must fall back to the unmodified website.
2. **No private-content telemetry.** Tests and benchmark reports must not contain conversation text, cookies, authorization headers, or unredacted identifiers.
3. **Measure before optimizing.** Performance claims require reproducible local reports.
4. **Keep adapters isolated.** Application-specific assumptions belong in an adapter, not the generic core.
5. **Preserve unknown data.** A transform must not silently discard fields or content types it does not understand.

## Before opening a pull request

```bash
npm install
npm run check
```

Explain which measured problem the change addresses and how failure behaves.
