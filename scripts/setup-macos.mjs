import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile, cp, rename, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { installModel } from './setup-model.mjs';
if (process.platform !== 'darwin') throw new Error('macOS required.');
const nodeRuntime = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();
const root = fileURLToPath(new URL('..', import.meta.url));
const native = process.env.CU_NATIVE_DIR ?? resolve(root, 'native/macos/build');
const owner = join(homedir(), 'Library/Application Support/Opcode');
const app = join(owner, 'CU Driver.app');
const staged = join(owner, 'CU Driver.staging.app');
await mkdir(owner, { recursive: true, mode: 0o700 });
const model = await installModel(join(owner, 'models'));
execFileSync('bash', ['scripts/build-native.sh'], { cwd: root, env: { ...process.env, CU_NATIVE_DIR: native }, stdio: 'inherit' });
await mkdir(join(staged, 'Contents/MacOS'), { recursive: true });
await mkdir(join(staged, 'Contents/Resources'), { recursive: true });
await cp(join(native, 'cu-helper'), join(staged, 'Contents/MacOS/cu-helper'));
await cp(join(native, 'permission-guide'), join(staged, 'Contents/MacOS/permission-guide'));
await cp(join(native, 'Opcode.icns'), join(staged, 'Contents/Resources/Opcode.icns'));
await writeFile(join(staged, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.opcodehq.cu.driver</string><key>CFBundleName</key><string>Opcode</string><key>CFBundleDisplayName</key><string>Opcode</string><key>CFBundleIconFile</key><string>Opcode.icns</string><key>CFBundleExecutable</key><string>cu-helper</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>`);
await writeFile(join(staged, 'Contents/Resources/vision.json'), JSON.stringify({ runtime: nodeRuntime, script: join(root, 'dist/vision-worker.mjs'), model }), { mode: 0o600 });
const identity = process.env.CU_CODESIGN_IDENTITY ?? '-';
execFileSync('codesign', ['--force', '--sign', identity, ...(identity === '-' ? [] : ['--options', 'runtime', '--timestamp']), join(staged, 'Contents/MacOS/permission-guide')], { stdio: 'inherit' });
execFileSync('codesign', ['--force', '--sign', identity, '--identifier', 'com.opcodehq.cu.driver', ...(identity === '-' ? ['--requirements', '=designated => identifier "com.opcodehq.cu.driver"'] : ['--options', 'runtime', '--timestamp']), staged], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--strict', staged], { stdio: 'inherit' });
// Stop only our helper, after a complete replacement is ready; no native app is touched.
const stopped = spawnSync(nodeRuntime, [join(root, 'dist/helper-proxy.mjs'), '--shutdown'], { timeout: 10000, stdio: 'ignore' });
if (stopped.status !== 0) throw new Error('Could not stop the previous helper. Finish active CU sessions, then retry cu install.');
const previous = app + '.previous';
await rm(previous, { recursive: true, force: true });
let existed = false;
try { await access(app); existed = true; await rename(app, previous); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { await rename(staged, app); } catch (error) { if (existed) await rename(previous, app); throw error; }
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
await writeFile(join(native, 'desktop-driver'), `#!/bin/sh\nexec ${quote(nodeRuntime)} ${quote(join(root, 'dist/helper-proxy.mjs'))}\n`, { mode: 0o755 });
console.log('Mac helper and checksum-pinned YOLO model installed. Run cu permission, then cu capture-permission. Grant access to Opcode.');
if (identity === '-') console.log('Development ad-hoc signature: a Developer ID signed/notarized distribution is still needed for production delivery; macOS may request permission again.');
