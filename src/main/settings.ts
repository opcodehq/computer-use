import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Schema } from 'effect';

const Stored = Schema.Struct({ typesafeKey: Schema.String });
/** Testing-only plaintext storage. Never return the saved key to the renderer. */
export class SettingsStore {
  constructor(readonly path: string) {}
  async load(): Promise<string> {
    try { return Schema.decodeUnknownSync(Stored)(JSON.parse(await readFile(this.path, 'utf8'))).typesafeKey; }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
      throw new Error('Saved settings could not be read. Save your TypeSafe key again to replace them.');
    }
  }
  async save(typesafeKey: string): Promise<void> {
    if (!typesafeKey.trim() || typesafeKey.length > 16000) throw new Error('Enter a valid nonempty API key.');
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.path), 0o700);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ typesafeKey: typesafeKey.trim() }) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async forget(): Promise<void> {
    try { await unlink(this.path); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
}
