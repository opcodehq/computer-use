import { randomUUID } from "node:crypto";
export type Span = {
  id: string;
  parentId?: string;
  stage: string;
  durationMs: number;
  status: "passed" | "failed";
  bytes?: number;
};
/** Trace only metadata. Never serialize inputs, page text, credentials or provider errors. */
export class Trace {
  readonly id = randomUUID();
  readonly spans: Span[] = [];
  async measure<T>(
    stage: string,
    run: () => Promise<T>,
    parentId = this.id,
  ): Promise<T> {
    const started = performance.now(),
      span: Span = {
        id: randomUUID(),
        parentId,
        stage,
        durationMs: 0,
        status: "failed",
      };
    try {
      const value = await run();
      span.status = "passed";
      return value;
    } finally {
      span.durationMs = performance.now() - started;
      this.spans.push(span);
    }
  }
}
