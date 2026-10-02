import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const testOnly = process.argv.includes('--test-only');
if (process.platform !== 'darwin' && !testOnly) throw new Error('Build Mac releases on macOS. --test-only builds a host CLI without a native driver for packaging tests.');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be a stable semantic version.');
const name = `jev-${version}-${process.platform}-${process.arch}${testOnly ? '-test' : ''}`;
const output = resolve(root, 'release', name);
await rm(output, { recursive: true, force: true }); // Only this validated generated release directory.
await mkdir(`${output}/bin`, { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Build failed: ${command} (exit ${result.status})`);
}
run(process.execPath, ['build', '--compile', '--define', 'JEV_COMPILED=true', '--outfile', `${output}/bin/jev`, 'src/tool/cli.ts']);
await cp(`${root}/node_modules/playwright-core`, `${output}/libexec/node_modules/playwright-core`, { recursive: true });
await cp(`${root}/.agents/skills/jev-desktop`, `${output}/share/jev/skill`, { recursive: true });
if (!testOnly) {
  run('bash', ['scripts/build-native.sh']);
  await mkdir(`${output}/libexec`, { recursive: true });
  for (const binary of ['desktop-driver', 'task-preview']) await cp(`${root}/native/macos/build/${binary}`, `${output}/libexec/${binary}`);
}
await cp(`${root}/scripts/install-cli.sh`, `${output}/install.sh`);
await cp(`${root}/scripts/download-cli.sh`, `${output}/download.sh`);
await writeFile(`${output}/BUILD`, `${name}\n`);
if (!testOnly) {
  run('tar', ['-czf', `${output}.tar.gz`, '-C', `${root}/release`, name]);
  const digest = createHash('sha256').update(await readFile(`${output}.tar.gz`)).digest('hex');
  await writeFile(`${output}.tar.gz.sha256`, `${digest}  ${name}.tar.gz\n`);
  const asset = `cu-darwin-${process.arch}.tar.gz`;
  await cp(`${output}.tar.gz`, `${root}/release/${asset}`);
  await writeFile(`${root}/release/${asset}.sha256`, `${digest}  ${asset}\n`);
}
console.log(`CLI bundle: ${output}`);
