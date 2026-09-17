#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'The native driver must be compiled on macOS with Xcode Command Line Tools.' >&2
  exit 1
fi
mkdir -p native/macos/build
xcrun swiftc -swift-version 5 -parse-as-library -O \
  -framework AppKit -framework ApplicationServices -framework ScreenCaptureKit \
  native/macos/Driver.swift native/macos/BackgroundInput.swift -o native/macos/build/desktop-driver
echo 'Built native/macos/build/desktop-driver'
