# Phone-hosted device-presentation experiment

Issue #186 asks whether the iQOO can remain the genuine application computer
while the Mac or an external monitor provides a replaceable presentation and
input surface. This packet changes no Elatura runtime or Android-companion
permission. It wraps upstream scrcpy 4.1 and collects only content-free resource
samples.

## Privacy boundary

The helper emits no device serial, ADB/TCP endpoint, IP address, process/window
identifier, package inventory, application identifier, local path, screenshot,
notification, clipboard value, credential, or application content. Raw ADB,
system-profiler, process, and thermal output is parsed in memory and discarded.
Every profile disables scrcpy's default automatic clipboard synchronization;
clipboard behavior must be tested separately with a fixed synthetic string.

Do not commit raw terminal logs. Commit only reviewed aggregates or conclusions.

## Readiness

Install upstream scrcpy and Android platform tools, then connect exactly one
operator-owned Android device:

```sh
brew install scrcpy
brew install --cask android-platform-tools
node scripts/device-projection-experiment.mjs doctor
```

The doctor output distinguishes aggregate Android-like USB presence from ADB
authorization without emitting USB identifiers. It must report one authorized
Android device. Authorization, unlock, USB-debugging enablement, and the Android
trust prompt remain explicit physical actions.

## Named runs

Each `run` opens scrcpy, samples the Mac and phone every five seconds, and closes
the projection after the requested duration:

```sh
node scripts/device-projection-experiment.mjs run mirror-present --duration=60 --output=/tmp/mirror-present.jsonl
node scripts/device-projection-experiment.mjs run mirror-control --duration=60 --output=/tmp/mirror-control.jsonl
node scripts/device-projection-experiment.mjs run mirror-control-screen-off --duration=60 --output=/tmp/screen-off.jsonl
node scripts/device-projection-experiment.mjs run virtual-landscape --app=Chrome --duration=60 --output=/tmp/virtual.jsonl
node scripts/device-projection-experiment.mjs run wireless-bootstrap --duration=60 --output=/tmp/wireless.jsonl
```

Use `measure` for a matched host idle or Mac-native arm without launching
scrcpy:

```sh
node scripts/device-projection-experiment.mjs measure --label=mac-native --duration=60 --output=/tmp/mac-native.jsonl
```

For an isolated native browser profile, pass a bounded content-free
`--process-token` that appears only in that profile's command line. The helper
emits only aggregate matching process count, CPU, and RSS; it never emits the
command line, token match, or process ids.

Both native measurement and scrcpy profiles hold the Mac awake for the bounded
run. A sample collected after lock/display sleep is inadmissible for presentation
quality or matched resource comparison.

The launcher runs scrcpy under the system pseudo-terminal wrapper only to obtain
an unbuffered first-render timestamp. Raw scrcpy output is discarded because it
may contain the local device serial or wireless endpoint.

`serve-workload` provides loopback-only synthetic reading and motion/audio pages
for matched Mac-native and phone-hosted runs. It accepts only GET requests for
the fixed paths and serves no private data. Use an ephemeral port by default and
keep the resolved port out of committed evidence.

While exactly one scrcpy virtual display exists,
`launch-workload-on-virtual --port=N --path=reading` resolves its implementation-
local display id in memory, establishes the scoped ADB loopback reverse, and
launches the workload there. Neither the display id nor the local forwarding
endpoint enters output or evidence.

`summarize` converts sanitized JSONL into min/median/max/mean numeric aggregates.
Review the aggregate before committing it; do not commit the raw run file.

`mirror-present` blocks Mac input and duplicates playback audio so phone touch,
phone voice, and phone speakers remain independently usable. `mirror-control`
uses absolute SDK mouse input for ordinary desktop pointing and SDK keyboard
input for the lowest-friction first pass. `mirror-control-screen-off` wakes the
physical display again after its bounded run so the experiment does not leave
the operator's phone dark. `virtual-landscape` creates a separate
1920×1080 logical display at 240 dpi and may launch an app selected by a bounded
human-readable prefix; the helper never records the resolved package name.

`wireless-bootstrap` is run only after the wired baseline. It lets scrcpy enable
TCP/IP while USB is present, without putting the resolved endpoint in the run
artifact. A later already-configured run may use the `wireless` profile.

## Measurement interpretation

The sampler records aggregate Mac CPU, memory summary, scrcpy RSS/CPU, power
source, battery/system power telemetry, GPU utilization, display counts, and
Android battery/temperature/current/charge, total CPU, available memory, thermal
CPU/GPU/battery/skin maxima from the current HAL section, and logical display
counts where the platform exposes them. It does not
request administrator access for `powermetrics`. Treat unavailable fields as
unavailable evidence, not zero.

Qualitative observations remain separate and content-free: startup/reconnect
time, text and scroll quality, pointer/touch latency, audio sync, IME/clipboard,
orientation, fullscreen/external-monitor utility, and whether walking away
requires any state transfer. Preserve failures and unsupported vendor telemetry.

Use the same public or synthetic workload and same timed interaction script for
Mac-native and phone-hosted arms. Do not infer an Elatura resource win from one
process sample or from scrcpy alone; compare matched whole-system deltas and the
phone cost as well.
