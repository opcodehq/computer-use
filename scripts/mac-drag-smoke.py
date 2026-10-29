"""Require a real inactive-Space drag destination callback, not dispatch acknowledgement.

This is an opt-in live regression. A missing drop fails; it is never skipped or
reported as supported merely because the event sequence was delivered.
"""
import argparse
import json
import os
import pathlib
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
report = {'passed': False, 'route': 'PID/window-scoped inactive-Space drag'}
calls = []
with tempfile.TemporaryDirectory(prefix='cu-drag-') as directory:
    directory = pathlib.Path(directory)
    binary, output = directory / 'target', directory / 'drop'
    subprocess.run(['xcrun', 'swiftc', str(root / 'tests/fixtures/macos/DragTarget.swift'), '-o', str(binary)], check=True)
    driver = subprocess.Popen([str(pathlib.Path(os.environ.get('CU_NATIVE_DIR', root / 'native/macos/build')) / 'desktop-driver')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

    def call(method, **payload):
        request = dict(id=str(len(calls)), method=method, **payload)
        driver.stdin.write(json.dumps(request) + '\n')
        driver.stdin.flush()
        reply = json.loads(driver.stdout.readline())
        calls.append({'request': request, 'reply': reply})
        assert reply.get('ok'), reply
        return reply['data']

    app = subprocess.Popen([str(binary), str(output), '--inactive-space'])
    try:
        deadline = time.monotonic() + 5
        setup_path = pathlib.Path(str(output) + '-setup.json')
        while not setup_path.exists() and app.poll() is None and time.monotonic() < deadline:
            time.sleep(.05)
        setup = json.loads(setup_path.read_text())
        report['setup'] = setup
        before = call('inputState')
        snapshot = call('snapshot', pid=app.pid, windowId=setup['windowId'])
        assert snapshot['windowOnScreen'] is False, snapshot
        source = next(n for n in snapshot['nodes'] if n['name'] == 'Drag source')
        destination = next(n for n in snapshot['nodes'] if n['name'] == 'Drop destination')
        report['dispatch'] = call('execute', snapshotId=snapshot['id'], action=dict(kind='drag', ref=source['ref'], targetRef=destination['ref']))
        deadline = time.monotonic() + 2
        while not output.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        after = call('inputState')
        report['inputBefore'], report['inputAfter'] = before, after
        report['events'] = [json.loads(line) for line in pathlib.Path(str(output) + '-drag.jsonl').read_text().splitlines()]
        report['dropProduced'] = output.exists() and output.read_text() == 'owned-drag-payload'
        report['destinationCallback'] = any(e['event'] == 'performDrop' and e.get('payload') == 'owned-drag-payload' for e in report['events'])
        state = json.loads(pathlib.Path(str(output) + '-state.json').read_text())
        report['invariants'] = {
            'foreground': before['foregroundPID'] == after['foregroundPID'],
            'cursor': before['cursor'] == after['cursor'],
            'hardwareMouseMoves': before['hardwareMouseMoves'] == after['hardwareMouseMoves'],
            'activeSpace': setup['spaceBefore'] == setup['spaceAfter'] == state['activeSpace'],
        }
        assert report['dropProduced'] and report['destinationCallback'], 'No independently verified destination drop'
        assert all(report['invariants'].values()), 'Input isolation was not established'
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
    finally:
        driver.stdin.close()
        driver.wait(timeout=5)
        app.terminate()
        app.wait(timeout=5)
        report['calls'] = calls
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key: report.get(key) for key in ['passed', 'error', 'dropProduced', 'destinationCallback', 'invariants']}))
raise SystemExit(0 if report['passed'] else 1)
