# Elatura Android notification companion

This first Android packet observes ChatGPT notification events on a user-owned phone and records only a bounded, tokenized diagnostic hint.

It is intentionally local-only:

- no `INTERNET` permission;
- no relay, server, analytics, telemetry, or background polling;
- no ChatGPT message submission or page refresh;
- no raw notification title or body persisted;
- only `com.openai.chatgpt` is admitted;
- at most 64 tokenized records and 16 pending projection jobs;
- one button clears local hints;
- one button clears all app state and deletes the Android Keystore HMAC key.

A notification is presented only as a **possible completion**. Missing, grouped, delayed, replaced, or generic notifications remain expected.

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

Launch **Elatura Companion**, tap **Open notification access**, and explicitly enable the listener. The app cannot grant this access itself.

## First physical-device diagnostic

Run at least 30 ChatGPT completions across the job types you actually use. Record only content-free results:

- notification received or missed;
- posted-to-observed latency;
- whether a title token and text token were available;
- grouped or replaced behavior during concurrent work;
- `isOngoing`, category, and posted/removed sequence;
- whether ChatGPT's own notification tap opens the intended conversation.

Do not copy notification text into reports. The app's diagnostic screen exposes timestamps, booleans, counters, and opaque token prefixes only.

## Next packet

After the phone diagnostic proves that the signal is useful, add explicit device pairing and an authenticated outbound relay. That packet must retain the same bounded queue, use Android Keystore-backed device credentials, include expiry/sequence/acknowledgement rules, and remain incapable of arbitrary remote command execution.
