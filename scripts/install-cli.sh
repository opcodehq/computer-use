#!/bin/sh
set -eu
# Install an extracted release, not source code. No network, sudo, or language runtime.
jev_bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$(uname -s)" != Darwin ]; then
  echo 'Install this bundle on the Mac being controlled.' >&2
  exit 1
fi
case "$(uname -m)" in arm64) jev_arch=arm64 ;; x86_64) jev_arch=x64 ;; *) exit 1 ;; esac
jev_build=$(cat "$jev_bundle/BUILD")
case "$jev_build" in jev-*-darwin-"$jev_arch") ;; *) echo 'This bundle does not match your Mac architecture.' >&2; exit 1 ;; esac
[ -x "$jev_bundle/bin/jev" ] && [ -x "$jev_bundle/libexec/desktop-driver" ] && [ -x "$jev_bundle/libexec/task-preview" ] || { echo 'Incomplete release bundle.' >&2; exit 1; }
jev_data="${JEV_INSTALL_DIR:-$HOME/.local/share/jev}"
jev_bin="${JEV_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$jev_data" "$jev_bin"
jev_data=$(CDPATH= cd -- "$jev_data" && pwd)
jev_bin=$(CDPATH= cd -- "$jev_bin" && pwd)
for cu_command in cu jev; do
  if [ -e "$jev_bin/$cu_command" ] || [ -L "$jev_bin/$cu_command" ]; then
    case "$(readlink "$jev_bin/$cu_command" || true)" in "$jev_data"/*/bin/jev) ;; *) echo "An unrelated $cu_command command already exists; leaving it untouched." >&2; exit 1 ;; esac
  fi
done
jev_destination=$(mktemp -d "$jev_data/$jev_build.XXXXXX")
cp -R "$jev_bundle/." "$jev_destination/"
ln -sfn "$jev_destination/bin/jev" "$jev_bin/jev"
ln -sfn "$jev_destination/bin/jev" "$jev_bin/cu"
printf 'Installed: %s/cu (jev alias also available)\n' "$jev_bin"
printf 'Next: "%s/cu" auth\nThen: "%s/cu" setup both\n' "$jev_bin" "$jev_bin"
case ":$PATH:" in *":$jev_bin:"*) ;; *) printf 'Add %s to PATH in your shell profile.\n' "$jev_bin" ;; esac
