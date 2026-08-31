# iQOO-to-Mac device-presentation experiment results

Status: first physical slice complete. These findings use upstream scrcpy 4.1
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
- An unplugged 20.017-second ordinary-mirror transport sample contained both
  2750 x 1260 H.264 video (878 packets) and 48 kHz stereo Opus audio (999
  packets). Video timestamps spanned 19.917 seconds; audio began 12 ms after
  video and ended 29 ms after it. This proves that useful audio packets traverse
  the same wireless projection, but not audible quality or perceived lip-sync.
  The temporary media sample was moved to Trash.
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
| Phone-hosted physical-display synthetic reading over Wi-Fi | 10 | 0.8% | 125 MB | 16.0% | 32.5 / 35.3 deg C | 50.2 / 41.5 deg C | none |
| Phone-hosted physical-display synthetic motion over Wi-Fi | 10 | 19.9% | 137 MB | 13.0% | 32.6 / 35.5 deg C | 45.1 / 40.3 deg C | none |
| Wired presentation-only mirror | 10 | 0.8% | 124 MB | 4.3% | 33.0 / 35.2 deg C | 45.9 / 41.5 deg C | none |
| Wired mirror with Mac control | 15 | 1.8% | 113 MB | 4.3% | 32.6 / 34.5 deg C | 48.6 / 44.2 deg C | none |
| Wireless-only unplugged high-motion app | 14 | 26.1% | 138 MB | 19.0% | 30.6 / 34.4 deg C | 54.8 / 46.1 deg C | none |
| Wireless projection during a real game | 88 | 43.3% | 125 MB | 28.0% | 35.4 / 40.2 deg C | 60.5 / 59.7 deg C | light |

The native arms use separate clean Chromium profiles with identical launch flags
and seven-process trees. The valid phone arms loaded the same fixed reading and
motion pages in the Android browser on physical display 0; the loopback server
confirmed both requests before measurement. The prior live phone task was held
only as an implementation-local task number and restored afterward.

For reading, projection reduced the measured Mac workload RSS from 863 MB to
125 MB while adding 0.8% of one Mac logical core and leaving the phone at a
coarse 16% broad CPU. For motion, projection reduced Mac workload RSS from 891
MB to 137 MB, but scrcpy used 19.9% of a Mac core versus 8.7% for native
Chromium, in addition to the phone's coarse 13% broad CPU. The experiment
therefore demonstrates a large Mac-memory reduction, not a general Mac-CPU or
whole-system energy reduction.

The earlier virtual-display reading/motion arms remain excluded: Android
accepted those launch requests but routed the synthetic URL to physical display
0 while the virtual output captured black. Their former 1.2%/111 MB and
50.8%/123 MB scrcpy rows are rejected raw observations, not matched evidence.

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
  injection enabled. In the final content-free reading arm, the operator used
  Mac scrolling and text entry followed by direct phone scrolling, and rated
  the overall response "good" and "fast." A transient Mac screenshot confirmed
  crisp large synthetic text at the current scale, but also showed the ordinary
  physical-display browser in a narrow portrait window that initially required
  clearing an overlapping Mac window. The screenshot was moved to Trash.
  Perceived audio sync, advanced IME behavior, dictation ergonomics, and
  clipboard behavior remain unrated.
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
  Sending Android to sleep did turn the panel off and made the presented frame
  black, so it is not a useful viewing mode even though the later recovery arm
  proves the scrcpy process itself survives. Host-only presentation with the
  physical panel dark is therefore a device-specific negative result here; the
  helper restores the physical screen after every bounded attempt.
- In a separate wireless recovery arm, the scrcpy process remained alive while
  Android reported the built-in panel off for 12 seconds and remained alive
  after ADB wake restored the panel. The iQOO did not expose a detectable secure
  keyguard after that interval, so true credential-gated unlock recovery remains
  unmeasured rather than failed.

## Apple-native control

- iPhone Mirroring onboarding required one approval on the physical iPhone and
  the Mac login password. The separate offer to forward iPhone notifications
  and Live Activities to the Mac even while mirroring was not in use was
  declined.
- The native Mac window then presented the iPhone's live current application.
  One reversible Mac scroll gesture changed the mirrored frame while the
  connection remained live, establishing Mac-input control without retaining
  the private before/after pixels.
- During a mostly static 10-sample active session, the iPhone Mirroring process
  used 0.1% median CPU and 126 MB median RSS. Whole-system GPU and input-power
  telemetry was again confounded by other Mac activity and is not attributed to
  the session.
- Apple's ready screen explicitly reported that the iPhone camera, microphone,
  and Notification Center are unavailable while iPhone Mirroring is in use.
  This is a materially tighter input/sensor split than Android's ordinary
  mirror, where physical phone touch and voice can remain authoritative.
- Quitting and reopening the native window reached its Mac-login gate in 716 ms
  but did not automatically restore the active session. Re-authentication is
  therefore a real recovery step. The operator was not asked to enter the Mac
  password a second time merely to extend the measurement.
- AirPlay to Mac was operator-confirmed presenting the iPhone's live current
  application, including the active conversation, on the Mac. A delayed direct
  Mac screenshot taken after the Android arms found the AirPlay receiver surface
  entirely black; a second screenshot remained black even while a new scrcpy
  window was active behind it. The black fullscreen surface therefore obscured
  other Mac presentation until AirPlay was explicitly stopped from the iPhone.
  The two temporary screenshots were moved to Trash. Because the useful interval
  had already ended, an attempted five-sample `AirPlay` process aggregate was
  idle (two helpers, 0% CPU, 19 MB RSS) and is not admitted as active-stream
  resource evidence.

## Negative and pending results

- The Mac currently reports only its built-in display. External-monitor window
  placement, fullscreen ergonomics, and monitor audio are therefore untested.
- Wireless setup, selection, physical cable removal, cable-independent
  stability, deliberate transport loss, and explicit relaunch are proven.
  Panel sleep/wake survival is proven for a 12-second off interval. The vendor
  did not engage a detectable secure keyguard, so credential-gated unlock
  behavior remains unavailable. Automatic scrcpy reconnect after transport loss
  is a negative result; recovery requires relaunch.
- Audio forwarding is mechanically established by a complete stereo Opus stream
  alongside ordinary wireless video with a 12 ms start offset and 29 ms end
  offset. Audible quality, output-device routing, and perceived sync have not
  been operator-confirmed.
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
  misleading. A later controlled repeat ruled out the phone lock as the cause:
  Android reported the secure keyguard not showing and `deviceLocked=0` both
  before and during the run. The virtual display and two non-default tasks were
  created, but no non-default activity resumed and 62 recorded frames remained
  near black. The temporary recording and log were moved to Trash. All attempted
  matched virtual resource rows are excluded. This
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
- iPhone Mirroring and AirPlay to Mac are characterized above. AirPlay's useful
  live interval is operator-observed rather than resource-matched, and its later
  fullscreen-black recovery failure is preserved as a negative.

## Architectural conclusion so far

Ordinary mirroring is genuinely useful: stock scrcpy keeps execution, session
state, and touch authority on Android while the Mac provides a replaceable
window, and matched reading/motion arms cut the measured Mac workload RSS by
roughly 85%. It is not a universal efficiency win: the motion arm used more Mac
CPU for scrcpy decoding/presentation than native Chromium used to execute the
same page, before counting phone work.

The higher-value independent virtual-display discriminator has not won:
lifecycle separation exists, but useful pixels and reliable app routing failed
on this phone. Apple's native controls prove the same broad execution-versus-
presentation idea, but add authentication/sensor restrictions and, in this
AirPlay run, a fullscreen-black recovery failure. The earned stopping point is
ordinary scrcpy plus native Continuity tooling, not an Elatura projection
runtime or generic application-lane protocol change. Alalana remains optional
content-free command/receipt transport, and Stensibly remains the work/authority
owner.
