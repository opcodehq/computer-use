# Build and distribute the CLI

The CLI is TypeScript/Effect compiled with Bun into a standalone executable.
The macOS driver remains Swift (Accessibility, ScreenCaptureKit, Vision, CoreML).
There is no Python in the production CLI path. Python is retained only in developer
smoke-test scripts and offline model export, which uses ultralytics, PyTorch,
coremltools, and NumPy. Inference on exported models runs natively in Swift.

## Build on a Mac

```sh
bun install --frozen-lockfile
bun run build:cli
```

The manual GitHub Actions workflow `Build Mac CLI bundle` also builds and uploads
an archive plus SHA-256 checksum for both Apple Silicon and Intel Macs; it does not publish
a release.

Requires Bun and Xcode Command Line Tools on the build machine. Produces a bundle
for that Mac's architecture and a matching `.tar.gz` under `release/`:

```text
jev-VERSION-darwin-ARCH/
  bin/jev
  libexec/desktop-driver
  libexec/task-preview
  share/jev/skill/
  BUILD
  install.sh
  download.sh
```

Bun embeds the imported CLI dependencies and runtime. Electron is not bundled.
The native driver and skill files resolve relative to the real executable,
including when `jev` is reached through a symlink. Session helpers re-execute
`jev _serve`; MCP registration invokes `jev mcp`. Neither requires a JS entry file.
See [Bun executable documentation](https://bun.sh/docs/bundler/executables).

## Install a bundle

Transfer/extract the matching archive on the receiving Mac and run `sh install.sh`
inside it. The installer verifies platform, architecture, and required binaries,
copies to a new directory under `~/.local/share/jev`, and links `~/.local/bin/cu` and the compatible `jev` alias.
It preserves previous installations and refuses to replace an unrelated command.
It does not edit shell profiles. `JEV_INSTALL_DIR` and `JEV_BIN_DIR` override those
destinations. The source checkout and extracted download may then be removed.

Run `jev auth`, `jev permission`, and `jev setup both`. The installed skill records
the exact CLI path for shells that do not inherit PATH. After a bundle update,
`jev skill both` updates that fallback path; use a fresh helper session.

The release builder does not sign/notarize releases or publish them. Public
release signing and hosting remain distribution work; there is no download URL
or Homebrew formula advertised yet. Do not bypass macOS security prompts.

## Packaging checks

```sh
bun run build:cli --test-only
bun scripts/test-cli-bundle.mjs
```

The test bundle targets the current host, omits the native driver, and cannot be
installed as a Mac release. Smoke checks exercise the compiled CLI outside the
checkout, including auth storage, MCP arguments, resource lookup, and persistent
helper startup against a fixture. They do not validate live macOS input.

## Public release assets

The builder also emits `cu-darwin-arm64.tar.gz` or `cu-darwin-x64.tar.gz`, each
with a `.sha256` file. Publish both architecture pairs under a stable `cu-vVERSION`
release tag only after validation/signing. The downloader uses the repository's
latest release or `CU_VERSION` to select a pinned tag. It fails if the asset,
checksum, platform, or archive layout is invalid. `cu update` invokes that same
bundled downloader. Download checks run on Linux with simulated platform and HTTP
commands; they never install a real remote release during tests.

The workflow only creates CI artifacts. It does not publish, sign, or notarize a
release. This distinction is intentional; do not advertise a working public
installer before those release assets exist.
