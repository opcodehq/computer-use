import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const modelSHA256 = '199626646b896fc40be49f30185f8c03a7ad066c24cb9ab73c17d0c6f3521f2c';
export async function installModel(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, 'ui-detector.onnx');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  if (hash(await readFile(target).catch(() => Buffer.alloc(0))) === modelSHA256) return target;
  const response = await fetch('https://huggingface.co/onnx-community/OmniParser-icon_detect/resolve/c85c12777c40d51f22246579d37eef1126f3c311/onnx/model.onnx', { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== modelSHA256) throw new Error('Model checksum mismatch. Existing installation was preserved.');
  const temporary = target + '.' + randomUUID();
  try { await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' }); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
  return target;
}
