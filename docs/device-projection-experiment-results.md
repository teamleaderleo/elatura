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
- scrcpy creates a separate 1920 x 1080, 240 dpi, 60 Hz virtual-display object.
  Android reported two display devices, both on, two activity stacks, and tasks
  on both the built-in and non-default display while the physical phone remained
  usable. This proves lifecycle and routing separation, but not useful pixels:
  the virtual SurfaceFlinger output captured black and the browser URL intent
  was routed back to display 0. The earlier synthetic-workload claim is retracted.
- The virtual-display renderer initialized 445 ms after process spawn. Closing
  scrcpy removed the display and its activity stack while leaving the built-in
  display on and populated. The virtual presentation is ephemeral and is not
  application identity.
- USB-assisted TCP/IP setup succeeded without enabling Android's pairing-code
  UI. A fresh scrcpy window subsequently selected the wireless transport while
  USB was still present, demonstrating projection-process replacement without
  terminating the phone-hosted application.
- After physical cable removal, ordinary projection remained stable for a
  bounded high-motion run with one authorized TCP/IP transport and zero USB
  transports in every sample. First render was observed after 525 ms. A single
  transient device frame confirmed a live 2750 x 1260 landscape frame; it was
  immediately moved to Trash and is not evidence content.
- A content-free reconnect probe restored the TCP/IP ADB transport in 61 ms at
  idle and 96 ms while scrcpy was active. The active scrcpy process exited when
  its transport was dropped; it does not self-heal. Explicit wireless relaunch
  succeeded twice with first-render observations of 570 and 719 ms. The
  phone-hosted application remained authoritative throughout.

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
| Wired presentation-only mirror | 10 | 0.8% | 124 MB | 4.3% | 33.0 / 35.2 deg C | 45.9 / 41.5 deg C | none |
| Wired mirror with Mac control | 15 | 1.8% | 113 MB | 4.3% | 32.6 / 34.5 deg C | 48.6 / 44.2 deg C | none |
| Wireless-only unplugged high-motion app | 14 | 26.1% | 138 MB | 19.0% | 30.6 / 34.4 deg C | 54.8 / 46.1 deg C | none |
| Wireless projection during a real game | 88 | 43.3% | 125 MB | 28.0% | 35.4 / 40.2 deg C | 60.5 / 59.7 deg C | light |

The native arms use separate clean Chromium profiles with identical launch flags
and seven-process trees. The attempted phone-hosted reading/motion arms are
excluded: Chrome accepted the launch request but routed the synthetic URL to
the physical display, and the virtual output itself captured black. Their former
1.2%/111 MB and 50.8%/123 MB scrcpy rows are retained here only as rejected raw
observations, not matched evidence. A valid matched Mac-native versus
phone-hosted comparison therefore remains missing.

The ten-minute wireless game run reached Android thermal status 1. Android
defines this as light throttling where UX is not impacted; earlier wired runs
remained at status 0
([Android `PowerManager` reference](https://developer.android.com/reference/android/os/PowerManager#THERMAL_STATUS_LIGHT)).

The phone remained at 80% and reported AC power rather than USB power during
the plugged-in runs. Its vendor kernel interface exposed no readable current,
charge-counter, instantaneous-power, or cycle-count field, so direct/bypass
power and energy-per-arm are unavailable rather than zero. No run reached
moderate or higher thermal status. The Mac was also on AC, so its battery-drain
comparison is not established.

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
- The phone sustained an ordinary game on its physical screen while the separate
  virtual display and activity stack existed. That proves concurrent lifecycle,
  not useful concurrent presentation: the attempted browser workload was routed
  to display 0 and the captured virtual surface was black.
- The upstream `--turn-screen-off` profile did not make the built-in panel report
  off on this iQOO in either a 45-second run or an immediate 15-second retry.
  Sending Android to sleep did turn the panel off, but also stopped the capture
  surface, so it is not a useful presentation mode. Host-only presentation with
  the physical panel dark is therefore a device-specific negative result here;
  the helper restores the physical screen after every bounded attempt.

## Negative and pending results

- The Mac currently reports only its built-in display. External-monitor window
  placement, fullscreen ergonomics, and monitor audio are therefore untested.
- Wireless setup, selection, physical cable removal, cable-independent
  stability, deliberate transport loss, and explicit relaunch are proven.
  Phone-lock behavior remains unmeasured. Automatic scrcpy reconnect after
  transport loss is a negative result; recovery requires relaunch.
- Audio-forwarding profiles start successfully, but audible quality and sync
  have not been operator-confirmed.
- Upstream scrcpy defaults to bidirectional automatic clipboard synchronization.
  The reusable profiles now disable it; clipboard ergonomics remain untested
  until a fixed synthetic string can be used without exposing private content.
- The phone has useful broad CPU, memory, battery-temperature, skin-temperature,
  and HAL thermal-status telemetry. Direct current/power and encoder-specific
  utilization are unavailable through the unprivileged vendor interfaces tried.
- Physical-display-off projection is not established. The documented scrcpy
  option was ineffective on this device, while ordinary Android sleep stopped
  both physical presentation and the captured surface.
- The most important virtual-display discriminator is currently negative on
  this iQOO/Android 16 device. Android creates the display and routes a task
  stack to it, but a browser VIEW intent requested for that display appears on
  display 0. A second test used upstream's minimal `--new-display` plus Settings
  example over the unplugged wireless transport: scrcpy recorded 64 valid
  1920 x 1080 frames, but the presented pixels were uniformly black and the
  non-default stack never reported a resumed activity. The temporary recording
  and extracted frame were moved to Trash. Task/display counts alone were
  misleading; all attempted matched virtual resource rows are excluded. This
  aligns with upstream reports of ROMs routing apps back to the primary display
  and Android 15/16 virtual-display black-screen or lifecycle failures
  ([upstream virtual-display guide](https://github.com/Genymobile/scrcpy/blob/master/doc/virtual-display.md),
  [primary-display routing report](https://github.com/Genymobile/scrcpy/issues/5541),
  [Android 15 black-screen report](https://github.com/Genymobile/scrcpy/issues/6287),
  [Android 16 report](https://github.com/Genymobile/scrcpy/issues/6438)).
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
  Receiver is already enabled for devices on the current Apple Account with a
  password required, but an iPhone-to-Mac stream has not yet been exercised.

## Architectural conclusion so far

Ordinary mirroring is useful enough to continue testing: stock scrcpy keeps
execution, session state, and touch authority on Android while the Mac provides
a replaceable window. The higher-value independent virtual-display discriminator
has not won: lifecycle separation exists, but useful presentation is unproven
and the tested browser route is currently negative. There is no basis for an
Elatura runtime or generic application-lane protocol change. Alalana remains
optional content-free command/receipt transport, and Stensibly remains the
work/authority owner.
