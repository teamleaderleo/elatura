# iQOO-to-Mac device-presentation experiment results

Status: physical experiment in progress. These findings use upstream scrcpy 4.1
on an iQOO Z11 Turbo running Android 16 and an M5 MacBook Air with 24 GB of
memory. They change no Elatura runtime or Android-companion permission.

All figures below are reviewed content-free aggregates. Raw samples remain
temporary and uncommitted. No screenshot, application content, credential,
device identifier, network endpoint, package/activity name, process/window id,
monitor id, or local path is evidence.

## What already works

- Ordinary USB Android-to-Mac presentation works over the phone's negotiated
  USB 2.0 (480 Mb/s) data link.
- A presentation-only profile disables host control and duplicates Android
  playback audio. This preserves the phone as the only touch/voice input
  surface while the Mac presents it.
- A host-control profile accepts Mac SDK keyboard and absolute mouse input.
- A separate 1920 x 1080, 240 dpi, 60 Hz scrcpy virtual display works. During
  the run Android reported two display devices, both on, two activity display
  stacks, and tasks on both the built-in and non-default display. The physical
  phone remained usable independently while the synthetic workload occupied
  the virtual display.
- The virtual display became usable 445 ms after process spawn in the valid
  timed run. Closing scrcpy removed the virtual display and its activity stack
  while leaving the built-in display on and populated. That is the expected
  negative lifecycle result: this virtual presentation is ephemeral and is not
  application identity.
- USB-assisted TCP/IP setup succeeded without enabling Android's pairing-code
  UI. A fresh scrcpy window subsequently selected the wireless transport while
  USB was still present, demonstrating projection-process replacement without
  terminating the phone-hosted application.

## Resource observations

Process CPU is macOS `%CPU` (100% is one logical core). RSS includes the selected
process tree for the native browser and only scrcpy for projection. Android CPU
comes from `dumpsys cpuinfo` and is coarse enough that repeated values should
not be over-interpreted. Whole-system Mac GPU and input-power telemetry were
heavily confounded by other active applications, so they are not attributed to
the compared workload.

| Arm | Samples | Mac workload median CPU | Mac workload median RSS | Phone median CPU | Phone battery / skin | Phone peak CPU / GPU temperature | Throttling |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| Mac-native synthetic reading | 10 | 0.0% | 863 MB | n/a | n/a | n/a | n/a |
| Mac-native synthetic motion | 9 | 8.7% | 891 MB | n/a | n/a | n/a | n/a |
| Phone-hosted synthetic reading on virtual display | 11 | 1.2% | 111 MB | 29.0% | 36.9 / 40.4 deg C | 62.4 / 58.9 deg C | light |
| Phone-hosted synthetic motion on virtual display | 11 | 50.8% | 123 MB | 29.0% | 36.6 / 39.9 deg C | 56.6 / 51.5 deg C | light |
| Wired presentation-only mirror | 10 | 0.8% | 124 MB | 4.3% | 33.0 / 35.2 deg C | 45.9 / 41.5 deg C | none |
| Wired mirror with Mac control | 15 | 1.8% | 113 MB | 4.3% | 32.6 / 34.5 deg C | 48.6 / 44.2 deg C | none |
| Wireless projection during a real game | 88 | 43.3% | 125 MB | 28.0% | 35.4 / 40.2 deg C | 60.5 / 59.7 deg C | light |

The final native arms use separate clean Chromium profiles with identical launch
flags and seven-process trees. The matched virtual-display arms show that static
presentation consumes roughly one eighth of native Chromium's Mac-side RSS,
while the continuously animated 1280 x 720 canvas makes decode/composition cost
visible: scrcpy rises to roughly half a logical core but remains near one seventh
of native Chromium's RSS. This is not an end-to-end energy claim: the phone pays
the application and encode cost.

The operator kept a real game active on the physical display during the matched
virtual-display arms. Mac-side synthetic-content differences remain attributable
to scrcpy, but phone-wide CPU and temperature are conservative upper bounds, not
clean synthetic-workload deltas. The ten-minute wireless game run and the later
matched arms reached Android thermal status 1. Android defines this as light
throttling where UX is not impacted; earlier wired runs remained at status 0
([Android `PowerManager` reference](https://developer.android.com/reference/android/os/PowerManager#THERMAL_STATUS_LIGHT)).

The phone remained at 80% and reported AC power rather than USB power during
the plugged-in runs. Its vendor kernel interface exposed no readable current,
charge-counter, instantaneous-power, or cycle-count field, so direct/bypass
power and energy-per-arm are unavailable rather than zero. No run reported HAL
thermal throttling. The Mac was also on AC, so its battery-drain comparison is
not established.

## Interaction and continuity observations

- The presentation-only profile mechanically prevents Mac input, so the phone
  remains authoritative for touch and voice. The host-control profile and
  virtual-display profile both launched successfully with Mac keyboard/mouse
  injection enabled. Operator-rated latency, text/scroll quality, audio sync,
  IME behavior, dictation ergonomics, and clipboard behavior are not yet
  recorded.
- Ending and relaunching scrcpy does not end the ordinary phone-hosted app. This
  is the useful continuity property: the physical display and its task stack
  remain on the phone, so there is no application-state transfer when leaving
  the desk. By contrast, the default virtual-display content is destroyed when
  that virtual display is removed.
- The phone sustained an ordinary game on its physical screen while a separate
  virtual presentation display was active. This is positive evidence for a
  pocket-compute/multiple-presentation model, while application compatibility
  on the virtual display still needs per-app testing.

## Negative and pending results

- The Mac currently reports only its built-in display. External-monitor window
  placement, fullscreen ergonomics, and monitor audio are therefore untested.
- Physical USB removal and wireless-only reconnect/lock behavior remain to be
  measured. Wireless setup and selection are proven, but cable-independent
  stability is not yet proven.
- Audio-forwarding profiles start successfully, but audible quality and sync
  have not been operator-confirmed.
- Upstream scrcpy defaults to bidirectional automatic clipboard synchronization.
  The reusable profiles now disable it; clipboard ergonomics remain untested
  until a fixed synthetic string can be used without exposing private content.
- The phone has useful broad CPU, memory, battery-temperature, skin-temperature,
  and HAL thermal-status telemetry. Direct current/power and encoder-specific
  utilization are unavailable through the unprivileged vendor interfaces tried.
- One early presentation-only launch failed because scrcpy 4.1 requires
  `--audio-source=playback` with `--audio-dup`; the reusable profiles preserve
  that negative and the fix. A second early launch showed that `--stay-awake`
  is invalid with `--no-control`; the presentation-only profile omits it.
- An early startup figure was invalid because scrcpy buffered its log on a pipe.
  The helper now uses a pseudo-terminal, discards the raw stream, and retains
  only the first-render timing. The invalid figure is excluded.
- iPhone Mirroring is installed but still at Apple's onboarding screen. Starting
  it may create persistent device access and is deliberately deferred until an
  action-time operator confirmation after the Android path is complete. AirPlay
  has not yet been exercised.

## Architectural conclusion so far

The physical discriminator is promising but not yet complete. Stock scrcpy can
already keep execution, session state, and touch authority on Android while the
Mac provides a replaceable window, and the independent virtual display works.
That earns continued measurement; it does not yet earn an Elatura runtime or
generic application-lane protocol change. Elatura should retain only a possible
future private projection binding. Alalana remains optional content-free
command/receipt transport, and Stensibly remains the work/authority owner.
