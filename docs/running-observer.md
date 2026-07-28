# Running the M0 observer

The observer is intentionally inactive until a benchmark run is started from the extension popup.

## Install and launch

```bash
npm install
npm run check
npm run run:firefox
```

Use a dedicated Firefox profile for benchmark work. Sign in to ChatGPT normally inside that profile; do not copy cookies or tokens into Elatura.

## One observation run

1. Open the Elatura popup.
2. Choose **Start new run**. This clears previous local measurements and enables byte-for-byte response observation.
3. Open or hard-reload the target conversation.
4. Wait until the newest useful content is visible and the composer can accept input, or record that the page failed.
5. Open the popup and choose **Export JSON**.
6. Choose **Clear and stop** before ordinary browsing.

The report contains aggregated redacted path templates, counts, observed bytes, request durations, errors, browser and extension versions, and page readiness marks. It does not contain response bodies, message text, query strings, cookies, authorization headers, or raw conversation identifiers.

## Baseline matrix

Use the same private conversation and comparable clean profiles:

- Edge stable without Elatura
- Firefox stable without Elatura
- Firefox with Elatura observe mode

Record at least five cold opens and ten hard reloads per mode. Keep individual runs and compare medians plus worst cases. A cold open should begin after a full browser quit and relaunch. A hard reload should use the same signed-in profile without clearing application data between every run.

## Memory

Until Elatura gains native process instrumentation, record numeric peak memory separately with macOS Activity Monitor or a documented command-line procedure. Do not attach screenshots containing private page content.

## Interpretation

"Bytes observed" means bytes delivered through Firefox's extension response filter. It is not automatically equivalent to compressed transfer size on the wire. The observer itself may add overhead, which is why stock Firefox and observe-mode Firefox must both be measured.
