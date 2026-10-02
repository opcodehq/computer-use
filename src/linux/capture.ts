import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
const exec = promisify(execFile);
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, data: Buffer) {
  const type = Buffer.from(kind);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  type.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  return result;
}
export function ppmToPNG(raw: Buffer) {
  const header = /^P6\n(\d+) (\d+)\n255\n/.exec(raw.toString("ascii", 0, 80));
  if (!header) throw new Error("Invalid native frame.");
  const width = Number(header[1]),
    height = Number(header[2]);
  if (
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    raw.length - header[0].length !== width * height * 3
  )
    throw new Error("Invalid frame dimensions.");
  const pixels = raw.subarray(header[0].length),
    rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++)
    pixels.copy(
      rows,
      y * (width * 3 + 1) + 1,
      y * width * 3,
      (y + 1) * width * 3,
    );
  const info = Buffer.alloc(13);
  info.writeUInt32BE(width);
  info.writeUInt32BE(height, 4);
  info[8] = 8;
  info[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", info),
    chunk("IDAT", deflateSync(rows, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export async function captureWindow(helper: string, windowId: number) {
  const { stdout } = await exec(helper, ["capture", String(windowId)], {
    encoding: "buffer",
    timeout: 5000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return ppmToPNG(stdout);
}
