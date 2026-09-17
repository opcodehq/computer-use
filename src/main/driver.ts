import { NodeServices } from '@effect/platform-node';
import { Context, Deferred, Effect, Layer, Queue, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { randomUUID } from 'node:crypto';

export class DriverError extends Schema.TaggedErrorClass<DriverError>()('DriverError', {
  code: Schema.String, message: Schema.String, delivery: Schema.String,
}) {}

const Envelope = Schema.Struct({
  id: Schema.String, ok: Schema.Boolean, data: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.String, message: Schema.String, delivery: Schema.String })),
});

export class DesktopDriver extends Context.Service<DesktopDriver, {
  request(method: string, args?: Record<string, unknown>): Effect.Effect<unknown, DriverError>;
}>()('jev/DesktopDriver') {}

export const driverLayer = (binary: string, args: readonly string[] = []) => Layer.effect(DesktopDriver, Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const input = yield* Queue.unbounded<Uint8Array>();
  const pending = new Map<string, Deferred.Deferred<unknown, DriverError>>();
  let disconnected = false;
  const handle = yield* spawner.spawn(ChildProcess.make(binary, args, {
    stdin: Stream.fromQueue(input), stderr: 'ignore',
  })).pipe(Effect.mapError(() => new DriverError({ code: 'DriverUnavailable', message: 'Build the native driver on macOS first: bun run build:native', delivery: 'notDispatched' })));

  const disconnect = Effect.fn('DesktopDriver.disconnect')(function*() {
    disconnected = true;
    for (const deferred of pending.values()) {
      yield* Deferred.fail(deferred, new DriverError({ code: 'DriverDisconnected', message: 'The native driver stopped. Restart the app; do not replay the last action.', delivery: 'unknown' }));
    }
    pending.clear();
  });

  yield* handle.stdout.pipe(
    Stream.decodeText(), Stream.splitLines,
    Stream.runForEach(Effect.fn('DesktopDriver.receive')(function*(line) {
      if (line.length > 9_000_000) return yield* new DriverError({ code: 'ProtocolError', message: 'Driver output exceeds limit.', delivery: 'unknown' });
      const reply = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(Envelope)(JSON.parse(line)),
        catch: () => new DriverError({ code: 'ProtocolError', message: 'Invalid driver response.', delivery: 'unknown' }),
      });
      const deferred = pending.get(reply.id);
      if (!deferred) return;
      pending.delete(reply.id);
      if (reply.ok) yield* Deferred.succeed(deferred, reply.data);
      else yield* Deferred.fail(deferred, new DriverError(reply.error ?? { code: 'DriverError', message: 'Unknown driver failure', delivery: 'unknown' }));
    })),
    Effect.catch(() => Effect.void), Effect.ensuring(disconnect()), Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() => disconnect());

  const request = Effect.fn('DesktopDriver.request')(function*(method: string, args: Record<string, unknown> = {}) {
    if (disconnected) return yield* new DriverError({ code: 'DriverDisconnected', message: 'Restart the app to reconnect the driver.', delivery: 'notDispatched' });
    const id = randomUUID();
    const deferred = yield* Deferred.make<unknown, DriverError>();
    const wire = JSON.stringify({ ...args, id, method });
    if (wire.length > 120_000) return yield* new DriverError({ code: 'InvalidRequest', message: 'Driver input exceeds limit.', delivery: 'notDispatched' });
    pending.set(id, deferred);
    return yield* Effect.gen(function*() {
      yield* Queue.offer(input, new TextEncoder().encode(wire + '\n'));
      return yield* Deferred.await(deferred);
    }).pipe(
      Effect.timeout('12 seconds'),
      Effect.catchTag('TimeoutError', () => Effect.fail(new DriverError({ code: 'DriverTimeout', message: 'Driver timed out; the last action may have been delivered.', delivery: method === 'execute' ? 'unknown' : 'notDispatched' }))),
      Effect.ensuring(Effect.sync(() => { pending.delete(id); })),
    );
  });
  return DesktopDriver.of({ request });
})).pipe(Layer.provide(NodeServices.layer));
