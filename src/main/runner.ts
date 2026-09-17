import { Context, Effect, Layer, Schema } from 'effect';
import { SnapshotSchema, type Event, type Start } from '../shared/contracts.js';
import { BrowserDriver } from './browser.js';
import { DesktopDriver, DriverError } from './driver.js';
import { DecisionModel, ModelError } from './models.js';
import { PolicyError, RunGate, validateCandidate } from './policy.js';

export class TaskRunner extends Context.Service<TaskRunner, {
  run(input: Start): Effect.Effect<void, DriverError | ModelError | PolicyError>;
  revoke(): void;
  approve(): void;
}>()('jev/TaskRunner') {}

export const runnerLayer = (emit: (event: Event) => void) => Layer.effect(TaskRunner, Effect.gen(function*() {
  const driver = yield* DesktopDriver;
  const model = yield* DecisionModel;
  const browser = new BrowserDriver();
  const gate = new RunGate();
  let approvePending: (() => void) | undefined;
  yield* Effect.addFinalizer(() => Effect.promise(() => browser.close()));
  const external = <T>(f: (signal: AbortSignal) => Promise<T>) => Effect.tryPromise({ try: f, catch: e => new DriverError({ code: 'BrowserError', message: e instanceof Error ? e.message : 'Browser operation failed.', delivery: 'unknown' }) });
  const run = Effect.fn('TaskRunner.run')(function*(input: Start) {
    const token = yield* Effect.try({ try: () => gate.begin(), catch: () => new PolicyError({ message: 'A task is already running.' }) });
    const check = () => Effect.try({ try: () => gate.assert(token), catch: () => new PolicyError({ message: 'Task stopped.' }) });
    const history: string[] = [];
    const observe = () => input.mode === 'browser'
      ? external(() => browser.snapshot())
      : driver.request('snapshot', { pid: input.pid }).pipe(Effect.flatMap(data => Effect.try({
          try: () => Schema.decodeUnknownSync(SnapshotSchema)(data),
          catch: () => new DriverError({ code: 'ProtocolError', message: 'Invalid accessibility snapshot.', delivery: 'notDispatched' }),
        })));

    return yield* Effect.gen(function*() {
      for (let step = 0; ; step++) {
        yield* check();
        emit({ state: 'observing', message: `Reading current state · step ${step + 1}` });
        const snapshot = yield* observe();
        yield* check();
        emit({ state: 'deciding', message: `Read ${snapshot.nodes.length} controls and labels${snapshot.truncated ? ' (partial tree)' : ''}.`, snapshot });
        const state = { goal: input.goal, snapshot, history: history.slice(-10) };
        let proposal = yield* model.propose(state);
        yield* check();
        let image: string | undefined;
        if (proposal.status === 'vision') {
          if (!input.vision || input.mode !== 'desktop') {
            emit({ state: 'blocked', message: `${proposal.explanation} Visual fallback is disabled or unavailable for this route.` });
            return;
          }
          const capture = yield* driver.request('screenshot', { snapshotId: snapshot.id }).pipe(Effect.flatMap(data => Effect.try({
            try: () => Schema.decodeUnknownSync(Schema.Struct({ base64: Schema.String, width: Schema.Number, height: Schema.Number, origin: Schema.Struct({ x: Schema.Number, y: Schema.Number }) }))(data),
            catch: () => new DriverError({ code: 'ProtocolError', message: 'Invalid image response.', delivery: 'notDispatched' }),
          })));
          image = capture.base64;
          emit({ state: 'deciding', message: 'Using optional vision. This image is sent to Claude only.', image, imageFrame: { ...capture.origin, width: capture.width, height: capture.height } });
          proposal = yield* model.propose(state, image);
          yield* check();
        }
        if (proposal.status === 'done') {
          const probability = yield* model.verify(state);
          yield* check();
          emit({ state: probability >= 0.9 ? 'succeeded' : 'blocked', message: probability >= 0.9 ? `Observed completion: ${proposal.explanation}` : `Completion could not be verified from semantic evidence. ${proposal.explanation}` });
          return;
        }
        if (proposal.status !== 'act' || !proposal.candidates.length) {
          emit({ state: 'blocked', message: proposal.explanation }); return;
        }
        if (proposal.candidates.length > 4 || new Set(proposal.candidates.map(c => c.id)).size !== proposal.candidates.length) {
          return yield* new PolicyError({ message: 'Planner returned invalid candidate options.' });
        }
        for (const candidate of proposal.candidates) {
          yield* Effect.try({ try: () => validateCandidate(candidate, snapshot, !!image), catch: e => e instanceof PolicyError ? e : new PolicyError({ message: 'Candidate validation failed.' }) });
        }
        // Vision supplies a grounded proposal; Jev only evaluates the textual candidates/state.
        const selected = yield* model.choose(state, proposal.candidates);
        yield* check();
        const candidate = proposal.candidates.find(c => c.id === selected);
        if (!candidate) { emit({ state: 'blocked', message: 'Jev did not select a sufficiently clear next action.' }); return; }
        if (!input.autoActions || candidate.action.kind === 'click') {
          emit({ state: 'approval', message: candidate.description, candidate });
          yield* Effect.tryPromise({
            try: signal => new Promise<void>((resolve, reject) => {
              const cancel = () => { approvePending = undefined; reject(new Error('Stopped')); };
              signal.addEventListener('abort', cancel, { once: true });
              approvePending = () => { signal.removeEventListener('abort', cancel); approvePending = undefined; resolve(); };
              if (signal.aborted) cancel();
            }),
            catch: () => new PolicyError({ message: 'Approval cancelled.' }),
          });
        }
        yield* check();
        emit({ state: 'acting', message: candidate.description, candidate });
        if (input.mode === 'browser') yield* external(signal => browser.execute(candidate.action, snapshot.id, signal));
        else yield* driver.request('execute', { snapshotId: snapshot.id, action: candidate.action, foregroundApproved: candidate.action.kind === 'click' });
        history.push(`Dispatched, requires fresh verification: ${candidate.description}`);
        emit({ state: 'verifying', message: 'Action dispatched; reading the actual result next.' });
        yield* Effect.sleep('300 millis');
      }
    }).pipe(
      Effect.ensuring(Effect.sync(() => { gate.finish(token); approvePending = undefined; })),
    );
  });
  return TaskRunner.of({ run, revoke: () => gate.stop(), approve: () => approvePending?.() });
}));
