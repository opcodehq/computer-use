#!/bin/sh
set -eu
# Download a release bundle, verify it, then use the bundled offline installer.
[ "$(uname -s)" = Darwin ] || { echo 'CU currently supports macOS 14+.' >&2; exit 1; }
case "$(uname -m)" in arm64) cu_arch=arm64 ;; x86_64) cu_arch=x64 ;; *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;; esac
cu_asset="cu-darwin-$cu_arch.tar.gz"
if [ -n "${CU_VERSION:-}" ]; then
  case "$CU_VERSION" in *[!0-9.]*|.*|*..*|*.) echo 'CU_VERSION must be a stable numeric version.' >&2; exit 1 ;; esac
  cu_base="https://github.com/opcodehq/computer-use/releases/download/cu-v$CU_VERSION"
else
  cu_base='https://github.com/opcodehq/computer-use/releases/latest/download'
fi
cu_temp=$(mktemp -d)
trap 'rm -rf "$cu_temp"' EXIT HUP INT TERM
if ! curl --retry 2 --connect-timeout 10 --max-time 180 --proto '=https' --tlsv1.2 -fLsS "$cu_base/$cu_asset" -o "$cu_temp/$cu_asset"; then
  echo 'No matching CU release could be downloaded. Check the release version and architecture. Source builds: bun run build:cli on a Mac.' >&2
  exit 1
fi
curl --retry 2 --connect-timeout 10 --max-time 180 --proto '=https' --tlsv1.2 -fLsS "$cu_base/$cu_asset.sha256" -o "$cu_temp/checksum"
cu_expected=$(awk 'NR==1 {print $1}' "$cu_temp/checksum")
[ "${#cu_expected}" = 64 ] || { echo 'Missing or invalid release checksum.' >&2; exit 1; }
case "$cu_expected" in *[!0-9a-f]*) echo 'Invalid release checksum.' >&2; exit 1 ;; esac
cu_actual=$(shasum -a 256 "$cu_temp/$cu_asset" | awk '{print $1}')
[ "$cu_actual" = "$cu_expected" ] || { echo 'Checksum mismatch; nothing installed.' >&2; exit 1; }
tar -tzf "$cu_temp/$cu_asset" > "$cu_temp/entries"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$cu_temp/entries"; then echo 'Invalid archive paths.' >&2; exit 1; fi
mkdir "$cu_temp/extracted"
tar -xzf "$cu_temp/$cu_asset" -C "$cu_temp/extracted"
set -- "$cu_temp"/extracted/*/install.sh
[ "$#" = 1 ] && [ -f "$1" ] || { echo 'Invalid release layout.' >&2; exit 1; }
sh "$1"
