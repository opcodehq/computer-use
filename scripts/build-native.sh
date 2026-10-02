#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" == Linux ]]; then
  exec bun scripts/build-linux.mjs
fi
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'The native driver must be compiled on macOS with Xcode Command Line Tools.' >&2
  exit 1
fi
cu_native_output="${CU_NATIVE_DIR:-native/macos/build}"
mkdir -p "$cu_native_output"
xcrun swiftc -swift-version 5 -parse-as-library -O \
  -framework AppKit -framework ApplicationServices -framework ScreenCaptureKit -framework Vision -framework CoreML -framework CryptoKit \
  native/macos/Driver.swift native/macos/BackgroundInput.swift native/macos/VisualDetector.swift -o "$cu_native_output/desktop-driver"
echo "Built $cu_native_output/desktop-driver"

xcrun swiftc -swift-version 5 -parse-as-library -O -framework AppKit \
  native/macos/TaskPreview.swift -o "$cu_native_output/task-preview"
echo "Built $cu_native_output/task-preview"

xcrun swiftc -swift-version 5 -parse-as-library -O -D CU_HELPER \
  -framework AppKit -framework ApplicationServices -framework ScreenCaptureKit -framework Vision -framework CoreML -framework CryptoKit \
  native/macos/Driver.swift native/macos/BackgroundInput.swift native/macos/VisualDetector.swift native/macos/Helper.swift -o "$cu_native_output/cu-helper"
echo "Built $cu_native_output/cu-helper"
