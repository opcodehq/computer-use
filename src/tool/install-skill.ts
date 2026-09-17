import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export async function installHarnessSkill(client: string, runtime: string, entry: string) {
  if (!['codex', 'claude'].includes(client)) throw new Error('Choose codex or claude.');
  const source = join(dirname(entry), '../.agents/skills/jev-desktop/SKILL.md');
  const content = await readFile(source, 'utf8');
  const destination = join(homedir(), client === 'codex' ? '.agents' : '.claude', 'skills/jev-desktop');
  try {
    const existing = await readFile(join(destination, 'SKILL.md'), 'utf8');
    if (!existing.includes('Use your existing shell tool to call `scripts/jev.py`')) throw new Error('A different jev-desktop skill already exists; leaving it untouched.');
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  await mkdir(join(destination, 'scripts'), { recursive: true });
  await writeFile(join(destination, 'SKILL.md'), content);
  const script = `#!/usr/bin/env python3\n# Installed by Jev Desktop; calls the CLI directly, not another coding agent.\nimport subprocess, sys\nraise SystemExit(subprocess.run(${JSON.stringify([runtime, entry])} + sys.argv[1:]).returncode)\n`;
  await writeFile(join(destination, 'scripts/jev.py'), script, { mode: 0o755 });
  return { skill: join(destination, 'SKILL.md'), launcher: join(destination, 'scripts/jev.py'), client };
}
