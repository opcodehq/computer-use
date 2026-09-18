import { Schema } from 'effect';
import type { Event, Snapshot } from '../shared/contracts.js';
const CaptureSchema = Schema.Struct({
  base64: Schema.String, width: Schema.Number, height: Schema.Number,
  origin: Schema.Struct({ x: Schema.Number, y: Schema.Number }),
});
/** A display-only capture must not wait for OCR/YOLO or create actionable refs. */
export async function capturePreview(snapshot: Snapshot, request: (method: string, args?: Record<string, unknown>) => Promise<unknown>): Promise<Event> {
  const capture = Schema.decodeUnknownSync(CaptureSchema)(await request('screenshot', { snapshotId: snapshot.id }));
  if (!capture.base64 || ![capture.width, capture.height].every(n => Number.isFinite(n) && n > 0) ||
      ![capture.origin.x, capture.origin.y].every(Number.isFinite)) throw new Error('Invalid preview capture geometry.');
  return { state: 'preview', message: 'Captured window frame. Detection was not requested.', snapshot,
    image: capture.base64, imageFrame: { ...capture.origin, width: capture.width, height: capture.height } };
}
