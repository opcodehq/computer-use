import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
declare const JEV_COMPILED: boolean;
export const compiled = typeof JEV_COMPILED !== 'undefined' && JEV_COMPILED;
export function cliInvocation(entry: string) {
  return { command: process.execPath, args: compiled ? [] : [entry] };
}
export function resourcePaths(entry: string) {
  const root = dirname(dirname(compiled ? realpathSync(process.execPath) : entry));
  return {
    installer: join(root, 'download.sh'),
    preview: join(root, compiled ? 'libexec/task-preview' : 'native/macos/build/task-preview'),
    driver: join(root, compiled ? 'libexec/desktop-driver' : `native/${process.platform === 'linux' ? 'linux' : 'macos'}/build/desktop-driver`),
    skill: join(root, compiled ? 'share/jev/skill' : '.agents/skills/jev-desktop'),
  };
}
export function shellQuote(value: string) { return "'" + value.replaceAll("'", "'\\''") + "'"; }
