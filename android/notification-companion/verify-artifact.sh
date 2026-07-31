#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: verify-artifact.sh [--require-stable] [--expected-commit SHA] [--expected-cert SHA256] ARTIFACT.zip

Checks the artifact ZIP, APK SHA-256, and BUILD-PROVENANCE.txt. Stable mode also
requires Android apksigner, a stable-private provenance record, a verified APK
signature, and certificate agreement.
USAGE
  exit 2
}

require_stable=false
expected_commit=""
expected_cert=""
archive=""

while (($# > 0)); do
  case "$1" in
    --require-stable)
      require_stable=true
      shift
      ;;
    --expected-commit)
      (($# >= 2)) || usage
      expected_commit="$2"
      shift 2
      ;;
    --expected-cert)
      (($# >= 2)) || usage
      expected_cert="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage
      ;;
    *)
      [[ -z "$archive" ]] || usage
      archive="$1"
      shift
      ;;
  esac
done

[[ -n "$archive" ]] || usage
[[ -f "$archive" ]] || {
  echo "Artifact ZIP not found: $archive" >&2
  exit 1
}
command -v unzip >/dev/null 2>&1 || {
  echo "unzip is required" >&2
  exit 1
}

while IFS= read -r entry; do
  [[ -n "$entry" ]] || continue
  if [[ "$entry" == /* || "$entry" == ../* || "$entry" == */../* || "$entry" == */.. || "$entry" == *\\* ]]; then
    echo "Unsafe path in artifact ZIP: $entry" >&2
    exit 1
  fi
done < <(unzip -Z1 "$archive")

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/elatura-artifact.XXXXXX")"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT HUP INT TERM

unzip -q "$archive" -d "$work_dir"

find_one() {
  local name="$1"
  local matches=()
  while IFS= read -r path; do
    matches+=("$path")
  done < <(find "$work_dir" -type f -name "$name" -print)
  [[ ${#matches[@]} -eq 1 ]] || {
    echo "Expected exactly one $name in the artifact; found ${#matches[@]}" >&2
    exit 1
  }
  printf '%s\n' "${matches[0]}"
}

provenance="$(find_one BUILD-PROVENANCE.txt)"
apk_name="$(awk -F= '$1 == "artifact" { print substr($0, index($0, "=") + 1); exit }' "$provenance")"
[[ -n "$apk_name" ]] || {
  echo "Provenance does not name an artifact" >&2
  exit 1
}
[[ "$apk_name" != */* && "$apk_name" != *\\* ]] || {
  echo "Provenance artifact name must be a base filename" >&2
  exit 1
}
apk="$(find_one "$apk_name")"
checksum_file="$(find_one "$apk_name.sha256")"

provenance_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$provenance"
}

normalize_hex() {
  printf '%s' "$1" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]'
}

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha="$(sha256sum "$apk" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual_sha="$(shasum -a 256 "$apk" | awk '{print $1}')"
else
  echo "sha256sum or shasum is required" >&2
  exit 1
fi
actual_sha="$(normalize_hex "$actual_sha")"
file_sha="$(normalize_hex "$(awk 'NR == 1 { print $1 }' "$checksum_file")")"
provenance_sha="$(normalize_hex "$(provenance_value sha256)")"

[[ "$actual_sha" == "$file_sha" ]] || {
  echo "APK checksum does not match $apk_name.sha256" >&2
  exit 1
}
[[ "$actual_sha" == "$provenance_sha" ]] || {
  echo "APK checksum does not match BUILD-PROVENANCE.txt" >&2
  exit 1
}

commit="$(provenance_value commit)"
if [[ -n "$expected_commit" && "$commit" != "$expected_commit" ]]; then
  echo "Artifact commit $commit does not match expected commit $expected_commit" >&2
  exit 1
fi

signing_mode="$(provenance_value signingMode)"
update_compatibility="$(provenance_value updateCompatibility)"
provenance_cert="$(normalize_hex "$(provenance_value certificateSha256)")"

find_apksigner() {
  if command -v apksigner >/dev/null 2>&1; then
    command -v apksigner
    return
  fi
  local root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  [[ -n "$root" && -d "$root/build-tools" ]] || return 1
  find "$root/build-tools" -type f -name apksigner -perm -111 -print | sort | tail -n 1
}

if $require_stable; then
  [[ "$signing_mode" == "stable-private" ]] || {
    echo "Artifact is not marked stable-private" >&2
    exit 1
  }
  [[ "$update_compatibility" == "stable-for-this-certificate" ]] || {
    echo "Artifact is not marked update-compatible for its certificate" >&2
    exit 1
  }
  [[ -n "$provenance_cert" ]] || {
    echo "Stable provenance is missing certificateSha256" >&2
    exit 1
  }
  report="$(find_one APKSIGNER-REPORT.txt)"
  [[ -s "$report" ]] || {
    echo "Stable artifact is missing a non-empty apksigner report" >&2
    exit 1
  }

  apksigner_path="$(find_apksigner || true)"
  [[ -n "$apksigner_path" ]] || {
    echo "Android apksigner is required for --require-stable" >&2
    exit 1
  }
  verification="$work_dir/local-apksigner-verification.txt"
  "$apksigner_path" verify --verbose --print-certs "$apk" | tee "$verification"
  actual_cert="$(
    sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$verification" |
      head -n 1 |
      tr -d ':[:space:]' |
      tr '[:upper:]' '[:lower:]'
  )"
  [[ -n "$actual_cert" ]] || {
    echo "Unable to read the APK signer certificate fingerprint" >&2
    exit 1
  }
  [[ "$actual_cert" == "$provenance_cert" ]] || {
    echo "APK signer certificate does not match provenance" >&2
    exit 1
  }
  if [[ -n "$expected_cert" && "$actual_cert" != "$(normalize_hex "$expected_cert")" ]]; then
    echo "APK signer certificate does not match the expected certificate" >&2
    exit 1
  fi
fi

printf 'Verified artifact: %s\n' "$apk_name"
printf 'SHA-256: %s\n' "$actual_sha"
printf 'Commit: %s\n' "$commit"
printf 'Signing mode: %s\n' "$signing_mode"
printf 'Update compatibility: %s\n' "$update_compatibility"
if [[ -n "$provenance_cert" ]]; then
  printf 'Certificate SHA-256: %s\n' "$provenance_cert"
fi
