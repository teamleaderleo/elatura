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

## What the screen shows

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

Launch **Elatura Companion**, tap **Open notification access**, and explicitly enable the listener. The app cannot grant this access itself. Android automatically requests a rebind when the system reports a listener disconnect.

## First physical-device diagnostic

1. Open Elatura Companion and confirm the health card says **Listening**.
2. Confirm **Test context** identifies the phone, Android version, ChatGPT version, Elatura version, and the expected build.
3. Tap **Start or reset test session**.
4. Run at least 30 ChatGPT completions across the job types you actually use.
5. After independently confirming one task completed, tap **Record one completed test case**.
6. Follow the guided questions:
   - notification arrived or missed;
   - when it arrived, correct chat, failed/wrong chat, or tap not tested.
7. Use **Undo latest saved case** immediately after a mistaken entry.
8. Use **Share content-free diagnostic report** and attach or paste the result into issue #96 or #99.

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

- guided iQOO/OriginOS onboarding and listener survival checks;
- expanded content-free notification metadata and removal reasons;
- a compact everyday completion inbox with diagnostics moved behind an Advanced screen;
- explicit device pairing and authenticated outbound relay only after physical evidence supports it.
