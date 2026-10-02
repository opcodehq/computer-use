#!/bin/bash
set -euo pipefail
: "${CU_NOTARY_PROFILE:?Set CU_NOTARY_PROFILE to an existing notarytool credentials profile}"
cu_helper_app="${CU_HELPER_APP:-$HOME/Library/Application Support/Opcode/CU Driver.app}"
cu_release_dir="${CU_RELEASE_DIR:-release}"
mkdir -p "$cu_release_dir"
codesign --verify --strict "$cu_helper_app"
if ! codesign -dv --verbose=2 "$cu_helper_app" 2>&1 | rg -q 'Authority=Developer ID Application:'; then
  echo 'Rebuild with CU_CODESIGN_IDENTITY set to your Developer ID Application identity before notarizing.' >&2
  exit 1
fi
cu_upload="$cu_release_dir/cu-mac-helper-submit.zip"
ditto -c -k --sequesterRsrc --keepParent "$cu_helper_app" "$cu_upload"
xcrun notarytool submit "$cu_upload" --keychain-profile "$CU_NOTARY_PROFILE" --wait
xcrun stapler staple "$cu_helper_app"
spctl --assess --type execute "$cu_helper_app"
ditto -c -k --sequesterRsrc --keepParent "$cu_helper_app" "$cu_release_dir/cu-mac-helper-notarized.zip"
shasum -a 256 "$cu_release_dir/cu-mac-helper-notarized.zip" > "$cu_release_dir/cu-mac-helper-notarized.zip.sha256"
echo "Notarized helper: $cu_release_dir/cu-mac-helper-notarized.zip"
