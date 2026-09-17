import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

/** One process owns refs across JSONL requests. Errors do not erase the connection. */
export async function runSession(input: Readable, write: (line: string) => Promise<void>, call: (method: string, args: Record<string, unknown>) => Promise<unknown>) {
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let id: string | number | null = null;
    try {
      if (line.length > 1_000_000) throw new Error('Request exceeds 1 MB.');
      const request = JSON.parse(line);
      if (!request || typeof request !== 'object' || !['string', 'number'].includes(typeof request.id) || typeof request.method !== 'string') throw new Error('Expected {id, method, args?}.');
      id = request.id;
      if (request.args !== undefined && (!request.args || typeof request.args !== 'object' || Array.isArray(request.args))) throw new Error('args must be an object.');
      const result = await call(request.method, request.args ?? {});
      await write(JSON.stringify({ id, ok: true, result }) + '\n');
    } catch (error) {
      await write(JSON.stringify({ id, ok: false, error: {
        code: error instanceof Error && 'code' in error ? String(error.code) : 'ToolError',
        message: error instanceof Error ? error.message : 'Request failed',
        delivery: error instanceof Error && 'delivery' in error ? String(error.delivery) : 'notDispatched',
      } }) + '\n');
    }
  }
}
