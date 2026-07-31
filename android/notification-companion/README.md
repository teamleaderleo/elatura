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

The phone UI refreshes while it is open and separates three kinds of evidence:

1. **Listener health** — notification-access grant, service starts, connection callbacks, current-process confirmation, and the latest captured event.
2. **Signal quality** — observed/retained/duplicate counts, posted and removed events, routing-token availability, grouping, latency percentiles, worker drops, errors, and malformed-record counts.
3. **Physical test tally** — user-verified notification arrivals, misses, correct deep links, and failed or wrong deep links.

The shared diagnostic report contains timestamps, counters, booleans, latency values, manual tallies, and event metadata. It intentionally omits notification title/body text and all HMAC token values.

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

The `Android notification companion` GitHub Actions workflow also runs the unit tests, assembles the debug APK, and uploads it as a seven-day artifact when the workflow succeeds.

Launch **Elatura Companion**, tap **Open notification access**, and explicitly enable the listener. The app cannot grant this access itself. Android automatically requests a rebind when the system reports a listener disconnect.

## First physical-device diagnostic

1. Open Elatura Companion and confirm the health card says **Listening**.
2. Tap **Start or reset test tally**.
3. Run at least 30 ChatGPT completions across the job types you actually use.
4. After independently confirming each completion:
   - tap **Mark notification arrived** when Android delivered a ChatGPT notification;
   - tap **Mark notification missed** when the task completed without one.
5. For notifications you tap:
   - record whether the intended chat opened;
   - record a failure when nothing useful opened or the wrong chat opened.
6. Use **Share content-free diagnostic report** and attach or paste the result into issue #96.

Include these non-content details beside the report:

- phone model;
- Android version;
- ChatGPT app version;
- Elatura APK commit or workflow run;
- whether battery optimization was left at its default;
- broad job types tested, without conversation titles or text.

The report already records:

- notification received/missed tally;
- posted-to-observed latency distribution;
- title/text routing-token availability;
- grouped and replaced behavior visible in the event sequence;
- ongoing versus possible-completion events;
- listener restarts/disconnects;
- deep-link success/failure tally;
- bounded queue drops, duplicates, local corruption, and processing errors.

## Next packet

Add explicit device pairing and an authenticated outbound relay only after the physical test demonstrates that notification coverage and routing metadata are useful enough. That packet must retain bounded queues, use Android Keystore-backed device credentials, include expiry/sequence/acknowledgement rules, and remain incapable of arbitrary remote command execution.
