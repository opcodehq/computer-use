import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'cu-npm-test-'));
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: temp, stdio: 'inherit', ...options,
});
const packed = JSON.parse(execFileSync('npm', ['pack', '--pack-destination', temp, '--json'], {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
}))[0];
for (const entry of packed.files) {
  assert(!/^(node_modules|\.context|\.repos|\.models|release)\//.test(entry.path), entry.path);
  assert(!/\.(p8|pem)$/.test(entry.path), entry.path);
}
for (const required of ['bin/cu.mjs', 'dist/cli.mjs', 'src/linux/driver.ts', 'native/linux/x11.c', 'native/macos/Driver.swift', '.agents/skills/jev-desktop/SKILL.md']) {
  assert(packed.files.some(file => file.path === required), `Missing ${required}`);
}
const tarball = join(temp, packed.filename);
run('npm', ['install', '--no-audit', '--no-fund', '--prefix', temp, tarball], {
  env: { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip' },
});
const cli = join(temp, 'node_modules/.bin/cu');
const native = join(temp, 'native-runtime');
mkdirSync(native);
const env = { ...process.env, CU_NATIVE_DIR: native };
delete env.JEV_DRIVER_PATH;
delete env.CU_X11_HELPER;
delete env.CU_YOLO_MODEL_PATH;
run(cli, ['--help'], { env });
run(cli, ['instructions'], { env, stdio: 'ignore' });
const config = JSON.parse(run(cli, ['config', 'generic'], { env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }));
assert(config.server.args[0].endsWith('/bin/cu.mjs'), 'MCP must use the package launcher');
run(config.server.command, [config.server.args[0], '--help'], { env, stdio: 'ignore' });
run(cli, ['skill', 'generic', '--dir', join(temp, 'agent-skills')], { env });
if (process.platform === 'linux') {
  copyFileSync(join(root, '.models/ui-detector.onnx'), join(native, 'ui-detector.onnx'));
  run(cli, ['install'], { env });
  run(cli, ['desktop', '--', 'bun', resolve(root, 'scripts/test-workspace.mjs')], {
    cwd: root, env: { ...env, CU_TEST_CLI: cli },
  });
}
copyFileSync(tarball, join(root, '.context', packed.filename));
console.log(`Package verified: ${tarball}`);
console.log(`Publish artifact: ${join(root, '.context', packed.filename)}`);
