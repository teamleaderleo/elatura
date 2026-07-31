# Elatura Android notification companion

This Android packet observes ChatGPT notification events on a user-owned phone and records only bounded, tokenized diagnostic hints.

It is intentionally local-only:

- no `INTERNET` permission;
- no relay, server, analytics, telemetry, or background polling;
- no ChatGPT message submission or page refresh;
- no raw notification title or body persisted;
- only `com.openai.chatgpt` is admitted;
- at most 64 tokenized records and 16 pending projection jobs;
- exact duplicate events are suppressed;
- malformed local records are counted and repaired on the next write;
- one control clears captured hints while retaining service/test evidence;
- one control clears all app state and deletes the Android Keystore HMAC key.

A notification is presented only as a **possible completion**. Missing, grouped, delayed, replaced, generic, or duplicated notifications remain expected.

## First-run setup

The first launch opens a guided setup screen. Later launches open the diagnostic dashboard. Long-press the app icon and choose **Open setup guide** to return to setup at any time.

The guide keeps three kinds of evidence separate:

1. **Android-verified checks** — ChatGPT is installed, notification access is granted, and the listener has connected in the current process.
2. **User-confirmed vendor checks** — settings such as OriginOS installation restrictions and iManager auto-start that ordinary apps cannot verify directly.
3. **Observed signal** — at least one genuine ChatGPT notification reached the listener.

The guide does not call the device ready for a background trial until the required checks for that detected device family are complete. Manual checkboxes are reminders rather than system attestations.

### iQOO / vivo OriginOS

On an iQOO or vivo phone:

1. Open **Elatura app settings** from the guide.
2. If OriginOS blocks notification access for the side-loaded APK, use the system option to remove restrictions or allow restricted settings. Exact wording may vary by OriginOS update.
3. Open **iManager → App management → Permission management → Auto-start** and enable Elatura Companion.
4. Return to Elatura and grant notification access.
5. Wait for the listener status to become connected.
6. Let one real ChatGPT task finish and confirm the first ChatGPT hint appears.

Elatura reports Android's standard battery-optimization exemption status but does not request broad battery, accessibility, overlay, administrator, or arbitrary command authority. OriginOS controls remain separate from Android's standard Doze status.

## What the diagnostic screen shows

The phone UI redraws when the local store changes. It does not poll and rebuild the entire screen every second. Relative ages and notification-access health refresh on a lightweight 30-second timer while the activity is visible.

The diagnostic separates four kinds of evidence:

1. **Listener health** — notification-access grant, service starts, connection callbacks, current-process confirmation, and the latest captured event.
2. **Test context** — phone model, Android version/API, ChatGPT and Elatura app versions, CI build commit/run, and Elatura's battery-optimization exemption status.
3. **Signal quality** — observed/retained/duplicate counts, posted and removed events, routing-token availability, grouping, latency percentiles, worker/teardown drops, errors, and malformed-record counts.
4. **Guided physical test** — one internally consistent completed-task case at a time, with one-step Undo.

The shared diagnostic report contains device/app/build context, timestamps, counters, booleans, latency values, guided test totals, and bounded event metadata. It intentionally omits notification title/body text and all HMAC token values. Sharing requires an explicit user-selected target app.

## Toolchain

- Android Studio Quail 2 or compatible
- Android Gradle Plugin 9.3.0
- Gradle 9.5.0
- JDK 17
- Android SDK 36

Open this directory as an Android Studio project, or build from a shell with a compatible Gradle installation:

```sh
gradle -p android/notification-companion :app:testDebugUnitTest :app:assembleDebug
```

Install the debug APK on a connected user-owned phone:

```sh
adb install -r android/notification-companion/app/build/outputs/apk/debug/app-debug.apk
```

The `Android notification companion` GitHub Actions workflow also runs the unit tests, assembles the debug APK, embeds its commit/run identifiers, and uploads it as a seven-day artifact when the workflow succeeds.

## First physical-device diagnostic

1. Complete the setup guide and open the diagnostic dashboard.
2. Confirm the health card says **Listening**.
3. Confirm **Test context** identifies the phone, Android version, ChatGPT version, Elatura version, and the expected build.
4. Tap **Start or reset test session**.
5. Run at least 30 ChatGPT completions across the job types you actually use.
6. After independently confirming one task completed, tap **Record one completed test case**.
7. Follow the guided questions:
   - notification arrived or missed;
   - when it arrived, correct chat, failed/wrong chat, or tap not tested.
8. Use **Undo latest saved case** immediately after a mistaken entry.
9. Use **Share content-free diagnostic report** and attach or paste the result into issue #96 or #99.

The report automatically records:

- phone manufacturer/model and Android version/API;
- ChatGPT and Elatura app versions;
- Elatura build commit and GitHub workflow run;
- Elatura battery-optimization exemption status;
- completed test-case count and notification arrival/miss totals;
- correct, failed, and not-tested deep-link totals;
- posted-to-observed latency distribution;
- title/text routing-token availability;
- grouped and replaced behavior visible in the event sequence;
- ongoing versus possible-completion events;
- listener restarts/disconnects;
- bounded queue and teardown drops, duplicates, local corruption, and processing errors.

Describe only the broad job types tested when posting the report. Do not include conversation titles or message text.

## Next packets

- expanded content-free notification metadata and removal reasons;
- reboot, force-stop, permission-revoke, and OriginOS background-cleanup survival tests;
- a compact everyday completion inbox with diagnostics moved behind an Advanced screen;
- explicit device pairing and authenticated outbound relay only after physical evidence supports it.
