# Stable private signing for Elatura Companion

This setup creates an updateable Android test line without committing a private key to the repository.

The private signing key is long-lived identity material. Losing it prevents future APKs from updating existing installs. Exposing it allows someone else to sign an APK that Android treats as the same application. Keep an encrypted offline backup and do not place the keystore or passwords in Git, issue comments, pull requests, chat messages, build logs, or ordinary cloud folders.

## 1. Generate the signing key on a trusted computer

Use the JDK `keytool` installed on the owner-controlled Mac or another trusted machine:

```sh
umask 077
keytool -genkeypair \
  -keystore elatura-android-signing.p12 \
  -storetype PKCS12 \
  -alias elatura-android \
  -keyalg RSA \
  -keysize 3072 \
  -validity 10000
chmod 600 elatura-android-signing.p12
```

Use unique high-entropy store and key passwords. Record the alias and passwords in the owner's password manager. Store at least one encrypted offline backup of the keystore.

## 2. Record the certificate SHA-256 fingerprint

```sh
keytool -list -v \
  -keystore elatura-android-signing.p12 \
  -storetype PKCS12 \
  -alias elatura-android
```

Copy the `SHA256` certificate fingerprint. The workflow normalizes uppercase, lowercase, colons, and whitespace before comparing it.

The fingerprint is public identity information, but this workflow stores it beside the protected signing inputs so a partial or incorrect setup fails closed.

## 3. Create the protected GitHub environment

Create a repository environment named exactly:

```text
android-signing
```

Recommended environment rules:

- require the repository owner to approve each deployment;
- restrict deployment to the intended protected branch;
- do not allow untrusted fork pull requests to access the environment;
- keep environment administrators minimal.

Add these environment secrets:

```text
ELATURA_ANDROID_KEYSTORE_BASE64
ELATURA_ANDROID_KEYSTORE_PASSWORD
ELATURA_ANDROID_KEY_ALIAS
ELATURA_ANDROID_KEY_PASSWORD
ELATURA_ANDROID_CERT_SHA256
```

Create the single-line base64 value locally:

```sh
base64 < elatura-android-signing.p12 | tr -d '\n'
```

Paste that value into `ELATURA_ANDROID_KEYSTORE_BASE64`. Do not save the encoded value in the repository; base64 is encoding, not encryption.

## 4. Run the owner-controlled workflow

The workflow `Android notification companion stable build` uses `workflow_dispatch` only. It is intentionally unavailable to ordinary pull-request execution and must exist on the default branch before GitHub exposes its manual Run workflow control.

On each run it:

1. checks out the exact selected revision;
2. materializes the keystore in the runner's private temporary directory;
3. runs unit tests and builds the release APK with `ELATURA_SIGNING_MODE=stable-private`;
4. verifies the APK signature with Android `apksigner`;
5. compares the signer certificate against `ELATURA_ANDROID_CERT_SHA256`;
6. extracts the actual version code and version name from the APK;
7. writes SHA-256, certificate, commit, workflow, version, and signing provenance;
8. uploads the stable artifact only after verification succeeds;
9. removes the temporary keystore even after failure.

A missing secret, missing keystore, build failure, signature failure, empty fingerprint, or fingerprint mismatch stops the workflow before the stable artifact upload.

## 5. Validate in-place updates

Before using the stable line for the continuing notification test:

1. install stable build A;
2. complete setup and capture at least one local hint;
3. record one guided test case;
4. produce stable build B with a larger version code and the same certificate;
5. install B over A without uninstalling;
6. confirm setup state, HMAC identity, captured hints, and guided totals remain present;
7. confirm Android rejects an older version unless developer tooling explicitly permits a downgrade.

Do not label the download ready until this two-build update test passes on the iQOO phone.

## Recovery and rotation

There is no transparent certificate rotation for directly distributed APKs without planning an Android-supported lineage and testing it against the target OS behavior. For this test app, treat key loss or compromise as a new application identity:

- revoke the affected workflow environment secrets;
- stop publishing artifacts under the old certificate;
- create a new key and record a new fingerprint;
- require uninstall/reinstall and clearly state that local app data will be lost;
- never claim compatibility with installs signed by the old key.

## Local signing fallback

The Gradle build accepts the same environment variables outside GitHub:

```text
ELATURA_SIGNING_MODE=stable-private
ELATURA_ANDROID_KEYSTORE_PATH=/absolute/path/to/elatura-android-signing.p12
ELATURA_ANDROID_KEYSTORE_PASSWORD=...
ELATURA_ANDROID_KEY_ALIAS=elatura-android
ELATURA_ANDROID_KEY_PASSWORD=...
```

Run the build only on an owner-controlled machine, avoid shell history exposure, and verify the resulting APK with `apksigner` before distribution.
