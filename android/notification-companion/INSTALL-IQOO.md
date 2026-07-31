# Install Elatura Companion on iQOO / OriginOS

Use only the APK bundle produced by the `Android notification companion` GitHub Actions workflow for the exact commit being tested.

The artifact ZIP must contain:

- `app-debug.apk`
- `app-debug.apk.sha256`
- `BUILD-PROVENANCE.txt`

## Before installation

1. Open `BUILD-PROVENANCE.txt` and confirm the commit and workflow run match the handoff you received.
2. Verify the APK checksum against `app-debug.apk.sha256` on a computer when practical.
3. Keep the ChatGPT Android app installed and signed in.

## Install

1. Download and extract the workflow artifact ZIP.
2. Transfer `app-debug.apk` to the iQOO phone or download it directly on the phone.
3. Open the APK and approve installation from the selected file/browser app when OriginOS asks.
4. Launch **Elatura Companion**.

## First-run setup

1. In Elatura, tap **Open Elatura app settings**.
2. If OriginOS shows an installation or restricted-settings warning, use its option to remove restrictions or allow restricted settings.
3. Return to Elatura and tap **Open notification access**.
4. Enable **Elatura ChatGPT completion listener**.
5. Open **iManager → App management → Permission management → Auto-start**.
6. Enable auto-start for **Elatura Companion**.
7. Return to Elatura and mark the two OriginOS confirmations only after completing them.
8. Confirm the status reaches **Ready for a live diagnostic** or **Ready for a background trial**.

## Verify one real signal

1. Open ChatGPT from the signal inbox.
2. Start a small task and allow it to finish while the ChatGPT app is in the background.
3. Wait for the ChatGPT notification.
4. Return to Elatura.
5. Confirm the inbox shows a new signal and the setup guide marks the first real ChatGPT hint as captured.
6. Open **Advanced diagnostics** and record one completed test case.

## What the app can and cannot do

- It reads only notifications posted by `com.openai.chatgpt` after explicit Android notification-listener approval.
- It stores bounded keyed fingerprints and flags, not notification title/body text.
- It has no internet permission, relay, telemetry, accessibility service, overlay, device-admin access, ChatGPT submission, or automatic refresh authority.
- A card labeled **Possible completion** is a notification hint, not verified conversation state.

## Recovery

When the inbox says notification access is missing, reopen the setup guide and grant it again.

When access is granted but the listener is not confirmed:

1. Open Android notification access and toggle Elatura off and back on.
2. Confirm OriginOS auto-start remains enabled.
3. Reopen Elatura.
4. Run another small ChatGPT completion.

Use **Reset sensor identity and all app state** only when a clean reinstall-style diagnostic is required. It deletes the local HMAC key and all local evidence.
