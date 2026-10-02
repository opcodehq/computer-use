import sharp from "sharp";
import { InferenceSession, Tensor } from "onnxruntime-node";
import { createWorker, type Worker } from "tesseract.js";
import { createRequire } from "node:module";
import type { VisualObservation } from "../vision/observation.js";
const require = createRequire(import.meta.url);
type Region = {
  -readonly [K in keyof VisualObservation["regions"][number]]: VisualObservation["regions"][number][K];
};
export function suppress(regions: Region[], threshold = 0.5): Region[] {
  const result: Region[] = [];
  for (const r of [...regions].sort((a, b) => b.confidence - a.confidence)) {
    if (
      result.some((other) => {
        const a = r.bounds,
          b = other.bounds;
        const intersection =
          Math.max(
            0,
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
          ) *
          Math.max(
            0,
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
          );
        return (
          intersection /
            (a.width * a.height + b.width * b.height - intersection) >
          threshold
        );
      })
    )
      continue;
    result.push(r);
    if (result.length === 150) break;
  }
  return result;
}
export class LinuxVision {
  private session?: InferenceSession;
  private worker?: Worker;
  private model?: string;
  async analyze(
    png: Buffer,
    id: string,
    modelPath: string,
  ): Promise<{ regions: Region[]; width: number; height: number }> {
    const meta = await sharp(png).metadata();
    const width = meta.width!,
      height = meta.height!;
    if (!width || !height || width * height > 24_000_000) throw new Error('Image must contain 1–24 million pixels.');
    if (!this.session || this.model !== modelPath) {
      await this.session?.release();
      this.session = await InferenceSession.create(modelPath, {
        executionProviders: ["cpu"],
        intraOpNumThreads: 2,
      });
      this.model = modelPath;
    }
    const size = 640,
      scale = Math.min(size / width, size / height),
      w = Math.round(width * scale),
      h = Math.round(height * scale);
    const pixels = await sharp(png)
      .resize(w, h)
      .extend({
        top: 0,
        left: 0,
        right: size - w,
        bottom: size - h,
        background: { r: 114, g: 114, b: 114 },
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    const input = new Float32Array(3 * size * size);
    for (let i = 0; i < size * size; i++)
      for (let c = 0; c < 3; c++)
        input[c * size * size + i] = pixels[i * 3 + c]! / 255;
    const output = await this.session.run({
      [this.session.inputNames[0]!]: new Tensor("float32", input, [
        1,
        3,
        size,
        size,
      ]),
    });
    const tensor = output[this.session.outputNames[0]!]!;
    if (tensor.dims.length !== 3 || tensor.dims[1] !== 5)
      throw new Error("Expected UI YOLO output [1,5,N].");
    const data = tensor.data as Float32Array,
      count = tensor.dims[2]!;
    const regions: Region[] = [];
    for (let i = 0; i < count; i++) {
      const confidence = data[4 * count + i]!;
      if (!Number.isFinite(confidence) || confidence < 0.35) continue;
      const cx = data[i]! / scale,
        cy = data[count + i]! / scale,
        rw = data[2 * count + i]! / scale,
        rh = data[3 * count + i]! / scale;
      const x = Math.max(0, cx - rw / 2),
        y = Math.max(0, cy - rh / 2),
        right = Math.min(width, cx + rw / 2),
        bottom = Math.min(height, cy + rh / 2);
      if (
        ![x, y, right, bottom].every(Number.isFinite) ||
        right <= x ||
        bottom <= y
      )
        continue;
      regions.push({
        ref: "",
        label: "UI control",
        confidence,
        source: "yolo",
        bounds: { x, y, width: right - x, height: bottom - y },
      });
    }
    this.worker ??= await createWorker("eng", 1, {
      langPath: require("@tesseract.js-data/eng").langPath,
      cacheMethod: "none",
      logger: () => {},
    });
    const { data: ocr } = await this.worker.recognize(png, {}, { tsv: true });
    const words = (ocr.tsv ?? "")
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.split("\t"))
      .filter((c) => c[0] === "5" && Number(c[10]) >= 50 && c[11]?.trim())
      .map((c) => ({
        text: c.slice(11).join("\t").trim(),
        confidence: Number(c[10]) / 100,
        x: Number(c[6]),
        y: Number(c[7]),
        width: Number(c[8]),
        height: Number(c[9]),
      }));
    const boxes = suppress(regions);
    for (const box of boxes) {
      const b = box.bounds;
      const labels = words.filter(
        (word) =>
          word.x + word.width / 2 >= b.x &&
          word.x + word.width / 2 <= b.x + b.width &&
          word.y + word.height / 2 >= b.y &&
          word.y + word.height / 2 <= b.y + b.height,
      );
      if (labels.length) box.label = labels.map((word) => word.text).join(" ");
    }
    for (const word of words)
      boxes.push({
        ref: "",
        label: word.text,
        confidence: word.confidence,
        source: "ocr",
        bounds: {
          x: word.x,
          y: word.y,
          width: word.width,
          height: word.height,
        },
      });
    return {
      width,
      height,
      regions: boxes
        .slice(0, 240)
        .map((region, i) => ({ ...region, ref: `${id}:visual:${i}` })),
    };
  }
  async close() {
    await this.worker?.terminate();
    await this.session?.release();
  }
}
