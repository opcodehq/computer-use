import { LinuxVision } from '../linux/vision.js';
const model = process.argv[2];
if (!model) throw new Error('Model path required.');
const chunks: Buffer[] = []; let size = 0;
for await (const chunk of process.stdin) { size += chunk.length; if (size > 30_000_000) throw new Error('Image too large.'); chunks.push(Buffer.from(chunk)); }
const vision = new LinuxVision();
try { console.log(JSON.stringify(await vision.analyze(Buffer.concat(chunks), 'image', model))); }
finally { await vision.close(); }
