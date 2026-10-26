#!/usr/bin/env node
let buffered = Buffer.alloc(0);
process.stdin.on("data", (data) => {
  buffered = Buffer.concat([buffered, data]);
  while (
    buffered.length >= 4 &&
    buffered.length >= 4 + buffered.readUInt32BE(0)
  ) {
    const size = buffered.readUInt32BE(0),
      id = buffered.readUInt32BE(4),
      count = buffered.readUInt32BE(8),
      args = [];
    let offset = 12;
    for (let i = 0; i < count; i++) {
      const n = buffered.readUInt32BE(offset);
      offset += 4;
      args.push(buffered.subarray(offset, offset + n).toString());
      offset += n;
    }
    buffered = buffered.subarray(4 + size);
    if (args[0] === "wait") continue;
    const payload = Buffer.from(JSON.stringify(args)),
      header = Buffer.alloc(12);
    header.writeUInt32BE(args[0] === "bad" ? id + 1 : id);
    header.writeUInt32BE(payload.length, 8);
    const result = Buffer.concat([header, payload]);
    process.stdout.write(result.subarray(0, 5));
    setTimeout(() => process.stdout.write(result.subarray(5)), 2);
  }
});
