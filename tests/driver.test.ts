import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManagedRuntime } from 'effect';
import { DesktopDriver, driverLayer } from '../src/main/driver.js';

test('scoped driver process handles repeated requests and preserves structured errors', async () => {
  const runtime = ManagedRuntime.make(driverLayer(process.execPath, ['tests/fixtures/driver-stub.mjs']));
  try {
    assert.deepEqual(await runtime.runPromise(DesktopDriver.use(d => d.request('first'))), { method: 'first' });
    assert.deepEqual(await runtime.runPromise(DesktopDriver.use(d => d.request('second'))), { method: 'second' });
    await assert.rejects(runtime.runPromise(DesktopDriver.use(d => d.request('error'))), /Target changed/);
  } finally { await runtime.dispose(); }
});

test('helper death rejects pending requests instead of waiting for an action replay', async () => {
  const runtime = ManagedRuntime.make(driverLayer(process.execPath, ['tests/fixtures/driver-stub.mjs']));
  try {
    await assert.rejects(runtime.runPromise(DesktopDriver.use(d => d.request('crash'))), /native driver stopped/);
    await assert.rejects(runtime.runPromise(DesktopDriver.use(d => d.request('after'))), /Restart the app/);
  } finally { await runtime.dispose(); }
});
