import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'crash') { process.exit(1); return; }
  if (request.method === 'error') {
    console.log(JSON.stringify({ id: request.id, ok: false, error: { code: 'StaleTarget', message: 'Target changed', delivery: 'notDispatched' } }));
    return;
  }
  console.log(JSON.stringify({ id: request.id, ok: true, data: { method: request.method } }));
});
