import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const source = resolve(`release/jev-${version}-${process.platform}-${process.arch}-test`);
const directory = await mkdtemp(join(tmpdir(), 'jev-bundle-'));
const bundle = join(directory, 'moved bundle');
const session = `bundle-${process.pid}`;
let cli, env;
try {
  await cp(source, bundle, { recursive: true });
  await mkdir(join(bundle, 'libexec'), { recursive: true });
  // Independent protocol fixture; the real driver requires a Mac.
  const fixture = join(directory, 'fixture.js');
  await writeFile(fixture, `import {createInterface} from 'node:readline';\ncreateInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line); console.log(JSON.stringify({id:r.id,ok:true,data:{accessibility:true,screenRecording:false,platform:'fixture'}}));});`);
  execFileSync(process.execPath, ['build', '--compile', '--outfile', join(bundle, 'libexec/desktop-driver'), fixture], { stdio: 'pipe' });
  cli = join(directory, 'jev');
  await symlink(join(bundle, 'bin/jev'), cli);
  // No language runtimes on PATH, no repo cwd, no model calls.
  env = { ...process.env, PATH: '/nonexistent', JEV_SETTINGS_PATH: join(directory, 'config/settings.json') };
  delete env.TYPESAFE_API_KEY;
  delete env.JEV_DRIVER_PATH;
  delete env.JEV_ALLOWED_APP;
  const call = (args, input) => execFileSync(cli, args, { cwd: directory, env, encoding: 'utf8', input, timeout: 15000 });
  assert.match(call(['--help']), /cu —/);
  for (const client of ['codex', 'claude']) {
    const config = JSON.parse(call(['config', client]));
    assert.deepEqual(config.server.args, ['mcp']);
    assert.ok(!JSON.stringify(config).includes('$bunfs'));
  }
  const key = 'fixture-key-not-a-real-credential';
  assert.ok(!call(['auth', '--stdin'], key).includes(key));
  const path = env.JEV_SETTINGS_PATH;
  assert.equal(JSON.parse(await readFile(path, 'utf8')).typesafeKey, key);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.throws(() => call(['auth', '--stdin'], ''));
  assert.equal(JSON.parse(await readFile(path, 'utf8')).typesafeKey, key);
  const status = JSON.parse(call(['status', '--session', session]));
  assert.equal(status.permissions.platform, 'fixture');
  assert.equal(status.typesafeConfigured, true);
  const again = JSON.parse(call(['status', '--session', session]));
  assert.equal(again.permissions.accessibility, true);
  call(['stop', '--session', session]);
  // Exercise installer filesystem behavior under a simulated Mac identity.
  const fakeBin = join(directory, 'fake-bin');
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Darwin ;; -m) echo arm64 ;; esac\n');
  await chmod(join(fakeBin, 'uname'), 0o755);
  await cp(join(bundle, 'libexec/desktop-driver'), join(bundle, 'libexec/task-preview'));
  await writeFile(join(bundle, 'BUILD'), 'jev-0.1.0-darwin-arm64\n');
  const installEnv = { ...env, PATH: fakeBin + ':/usr/bin:/bin', JEV_INSTALL_DIR: join(directory, 'installed-data'), JEV_BIN_DIR: join(directory, 'installed-bin') };
  const install = () => execFileSync('/bin/sh', [join(bundle, 'install.sh')], { env: installEnv, encoding: 'utf8', stdio: 'pipe' });
  assert.match(install(), /Installed:/);
  assert.match(install(), /Installed:/);
  const installedCLI = join(installEnv.JEV_BIN_DIR, 'jev');
  assert.match(execFileSync(installedCLI, ['--help'], { env, encoding: 'utf8' }), /cu —/);
  await rm(installedCLI);
  await writeFile(installedCLI, 'unrelated command');
  assert.throws(install);
  assert.equal(await readFile(installedCLI, 'utf8'), 'unrelated command');
  // Test the public downloader without network access, including fail-closed checksums.
  const downloadSource = join(directory, 'download-source', 'fixture');
  await mkdir(join(downloadSource,'bin'),{recursive:true}); await mkdir(join(downloadSource,'libexec'));
  for (const file of ['bin/jev','libexec/desktop-driver','libexec/task-preview']) { await writeFile(join(downloadSource,file),'#!/bin/sh\nexit 0\n'); await chmod(join(downloadSource,file),0o755); }
  await cp(join(bundle,'install.sh'),join(downloadSource,'install.sh'));
  await writeFile(join(downloadSource,'BUILD'),'jev-0.1.0-darwin-arm64\n');
  const archive = join(directory, 'download.tar.gz');
  execFileSync('/usr/bin/tar', ['-czf',archive,'-C',join(directory,'download-source'),'fixture']);
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  const checksum = join(directory, 'download.sha256');
  await writeFile(checksum,digest+'  cu-darwin-arm64.tar.gz\n');
  await writeFile(join(fakeBin,'curl'), `#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in https:*) url="$1" ;; -o) shift; output="$1" ;; esac
  shift
done
case "$url" in *.sha256) cp "$CU_TEST_CHECKSUM" "$output" ;; *) cp "$CU_TEST_ARCHIVE" "$output" ;; esac
`);
  await chmod(join(fakeBin,'curl'),0o755);
  if(process.platform !== 'darwin') { await writeFile(join(fakeBin,'shasum'),'#!/bin/sh\nexec /usr/bin/sha256sum "$3"\n'); await chmod(join(fakeBin,'shasum'),0o755); }
  const downloaderEnv={...installEnv,CU_TEST_CHECKSUM:checksum,CU_TEST_ARCHIVE:archive,JEV_INSTALL_DIR:join(directory,'downloaded-data'),JEV_BIN_DIR:join(directory,'downloaded-bin')};
  const download=()=>execFileSync('/bin/sh',[resolve('scripts/download-cli.sh')],{env:downloaderEnv,encoding:'utf8',stdio:'pipe'});
  assert.match(download(),/Installed:/);
  await writeFile(checksum,'0'.repeat(64)+'  cu-darwin-arm64.tar.gz\n');
  assert.throws(download,/Checksum mismatch/);
  await writeFile(checksum,'');assert.throws(download,/invalid release checksum/);
  console.log('Standalone CLI passed: moved bundle/symlink, no runtime on PATH, auth, MCP config, native resource lookup, persistent session startup and stop; installer updates and conflict preservation (simulated Mac identity).');
} finally {
  if (cli && env) { try { execFileSync(cli, ['stop', '--session', session], { env, stdio: 'pipe', timeout: 3000 }); } catch {} }
  await rm(directory, { recursive: true, force: true });
}
