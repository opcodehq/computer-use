import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installHarnessSkill } from '../src/tool/install-skill.js';
import { readiness } from '../src/tool/doctor.js';

async function fixture(run: (dir: string, entry: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'jev-install-'));
  const entry = join(dir, 'checkout space $() "quoted"', 'dist/cli.mjs');
  const skill = join(dirname(entry), '../.agents/skills/jev-desktop');
  try {
    await mkdir(dirname(entry), { recursive: true });
    await mkdir(join(skill, 'references'), { recursive: true });
    await writeFile(entry, 'console.log(JSON.stringify(process.argv.slice(2)))');
    await writeFile(join(skill, 'SKILL.md'), '<!-- jev-desktop:managed -->\nRead references/commands.md');
    await writeFile(join(skill, 'references/commands.md'), 'Current instructions');
    await run(dir, entry);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('installs both harness paths with references; direct command works outside checkout with literal arguments', async () => {
  await fixture(async (dir, entry) => {
    for (const client of ['codex', 'claude']) {
      const installed = await installHarnessSkill(client, process.execPath, entry, dir);
      assert.equal(installed.skill, join(dir, client === 'codex' ? '.agents' : '.claude', 'skills/jev-desktop/SKILL.md'));
      assert.equal(await readFile(join(dirname(installed.skill), 'references/commands.md'), 'utf8'), 'Current instructions');
      const result = spawnSync('/bin/sh', ['-c', installed.command + ' "$@"', 'jev-test', 'task', '--instruction', 'literal "$HOME" `echo nope`'], { cwd: tmpdir(), encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), ['task', '--instruction', 'literal "$HOME" `echo nope`']);
      const again = await installHarnessSkill(client, process.execPath, entry, dir);
      assert.equal(again.skill, installed.skill);
    }
  });
});

test('upgrades legacy owned skill, but refuses to overwrite an unrelated skill', async () => {
  await fixture(async (dir, entry) => {
    const target = join(dir, '.agents/skills/jev-desktop');
    await mkdir(target, { recursive: true });
    await mkdir(join(target, 'scripts'));
    await writeFile(join(target, 'scripts/jev.py'), '# Installed by Jev Desktop; old wrapper');
    await writeFile(join(target, 'SKILL.md'), 'Use your existing shell tool to call `scripts/jev.py`');
    await installHarnessSkill('codex', process.execPath, entry, dir);
    assert.match(await readFile(join(target, 'SKILL.md'), 'utf8'), /jev-desktop:managed/);
    await assert.rejects(readFile(join(target, 'scripts/jev.py')), /ENOENT/);
    await writeFile(join(target, 'SKILL.md'), 'My custom skill');
    await assert.rejects(installHarnessSkill('codex', process.execPath, entry, dir), /leaving it untouched/);
    assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'My custom skill');
  });
});

test('installation refuses a missing CLI before creating a skill', async () => {
  await fixture(async (dir, entry) => {
    await rename(entry, entry + '.moved');
    await assert.rejects(installHarnessSkill('claude', process.execPath, entry, dir), /ENOENT/);
  });
});

test('readiness separates model-free driver readiness from optional Jev credentials', () => {
  const input = { platform: 'darwin', executable: true, credential: { source: 'savedFile' }, status: { permissions: { accessibility: true, screenRecording: false } } };
  assert.equal(readiness(input).ready, true);
  assert.equal(readiness(input).checks.find(c => c.name === 'Optional Capture')?.state, 'optional');
  assert.equal(readiness({ ...input, credential: { source: 'missing' } }).ready, true);
  assert.equal(readiness({ ...input, credential: { source: 'missing' } }).jevReady, false);
  assert.equal(readiness(input).jevReady, true);
  assert.equal(readiness({ ...input, status: undefined, error: 'Driver unavailable' }).ready, false);
  assert.equal(readiness({ ...input, platform: 'linux' }).ready, false);
  assert.equal(readiness({ ...input, executable: false }).ready, false);
});

test('generic skill installs to a caller-chosen agent directory and protects unrelated content', async () => {
  await fixture(async (dir, entry) => {
    const destination = join(dir, 'custom agent/skills/computer');
    const installed = await installHarnessSkill('generic', process.execPath, entry, dir, destination);
    assert.equal(installed.skill, join(destination, 'SKILL.md'));
    assert.equal(await readFile(join(destination, 'references/commands.md'), 'utf8'), 'Current instructions');
    await writeFile(installed.skill, 'Unrelated user skill');
    await assert.rejects(installHarnessSkill('generic', process.execPath, entry, dir, destination), /leaving it untouched/);
    await assert.rejects(installHarnessSkill('generic', process.execPath, entry, dir), /requires --dir/);
  });
});
