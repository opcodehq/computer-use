import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { compiled, resourcePaths, shellQuote } from './runtime.js';

export async function installHarnessSkill(client: string, runtime: string, entry: string, home = homedir(), directory?: string) {
  if (!['codex', 'claude', 'generic'].includes(client)) throw new Error('Choose codex, claude, or generic.');
  if (client === 'generic' && !directory) throw new Error('Generic skill installation requires --dir PATH.');
  if (directory && client !== 'generic') throw new Error('--dir applies to generic skill installation.');
  runtime = resolve(runtime);
  entry = resolve(entry);
  await access(runtime);
  if (!compiled) await access(entry);
  const source = join(resourcePaths(entry).skill, 'SKILL.md');
  const content = await readFile(source, 'utf8');
  const destination = directory ? resolve(directory) : join(home, client === 'codex' ? '.agents' : '.claude', 'skills/jev-desktop');
  try {
    const existing = await readFile(join(destination, 'SKILL.md'), 'utf8');
    if (!existing.includes('<!-- jev-desktop:managed -->') && !existing.includes('Use your existing shell tool to call `scripts/jev.py`')) throw new Error('A different jev-desktop skill already exists; leaving it untouched.');
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  // Read every bundled reference before writing an installation.
  const references = join(dirname(source), 'references');
  const files = await Promise.all((await readdir(references)).filter(name => name.endsWith('.md')).map(async name => ({ name, content: await readFile(join(references, name), 'utf8') })));
  await mkdir(join(destination, 'scripts'), { recursive: true });
  await mkdir(join(destination, 'references'), { recursive: true });
  for (const file of files) await writeFile(join(destination, 'references', file.name), file.content);
  const command = [runtime, ...(!compiled ? [entry] : [])].map(shellQuote).join(' ');
  await writeFile(join(destination, 'SKILL.md'), content + `\nInstalled CLI (use if jev is absent from PATH): \`${command}\`\n`);
  const legacy = join(destination, 'scripts/jev.py');
  try {
    if ((await readFile(legacy, 'utf8')).includes('# Installed by Jev Desktop;')) await unlink(legacy);
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  return { skill: join(destination, 'SKILL.md'), command, client };
}
