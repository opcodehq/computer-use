"""Regression for explicitly observed native editor surfaces outside AXWindows.
Uses disposable background NSPanel surfaces; never activates an app or Space.
"""
import json, os, pathlib, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[1]
driver_path = pathlib.Path(os.environ.get('CU_NATIVE_DIR', root / 'native/macos/build')) / 'desktop-driver'
with tempfile.TemporaryDirectory(prefix='cu-surface-') as temp:
    binary = pathlib.Path(temp) / 'target'
    subprocess.run(['xcrun', 'swiftc', str(root / 'tests/fixtures/macos/TransientPanelTarget.swift'), '-o', str(binary)], check=True)
    for secure in [False, True]:
        output = pathlib.Path(temp) / ('secure' if secure else 'normal')
        target = subprocess.Popen([str(binary), str(output)] + (['--secure'] if secure else []))
        driver = subprocess.Popen([str(driver_path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        def call(method, **args):
            driver.stdin.write(json.dumps(dict(id=method, method=method, **args)) + '\n'); driver.stdin.flush()
            return json.loads(driver.stdout.readline())
        def good(method, **args):
            r = call(method, **args); assert r['ok'], r; return r['data']
        try:
            time.sleep(.5)
            before = good('inputState')
            r = call('snapshot', pid=target.pid)
            deadline = time.monotonic() + 5
            while not r['ok'] and target.poll() is None and time.monotonic() < deadline and r['error']['code'] in ['AppClosed', 'UnsupportedSurface', 'ObservationFailed']:
                time.sleep(.05); r = call('snapshot', pid=target.pid)
            assert r['ok'], r
            origin = r['data']; origin_id = origin['windowId']
            view = next(n for n in origin['nodes'] if n['name'] == 'Origin outline')
            good('execute', snapshotId=origin['id'], action=dict(kind='backgroundKey', ref=view['ref'], text='Enter'))
            origin = good('snapshot', pid=target.pid, windowId=origin_id)
            panel_id = int(pathlib.Path(str(output) + '-surface').read_text())
            assert panel_id != origin_id, 'Fixture did not create a genuine separate NSPanel'
            if secure:
                assert 'focusedSurface' not in origin, 'Secure editor leaked a discoverable capability'
                r = call('snapshot', pid=target.pid, windowId=panel_id)
                assert not r['ok'] and r['error']['delivery'] == 'notDispatched', r
                assert not output.exists()
            else:
                assert origin.get('focusedSurface', {}).get('windowId') == panel_id, origin
                assert not any(n['name'] == 'Transient panel editor' for n in origin['nodes']), 'Main window gained rights to unrelated surface'
                r = call('snapshot', pid=target.pid, windowId=4294967295)
                assert not r['ok'] and r['error']['delivery'] == 'notDispatched', r
                surface = good('snapshot', pid=target.pid, windowId=panel_id)
                assert surface['controlSurface'] and surface['nodes'][0]['role'] == 'AXTextField', surface
                field = surface['nodes'][0]
                good('execute', snapshotId=surface['id'], action=dict(kind='setValue', ref=field['ref'], text='explicit surface'))
                surface = good('snapshot', pid=target.pid, windowId=panel_id)
                field = surface['nodes'][0]
                pathlib.Path(str(output) + '-control').write_text('drift')
                time.sleep(.1)
                r = call('execute', snapshotId=surface['id'], action=dict(kind='setValue', ref=field['ref'], text='must refuse drift'))
                assert not r['ok'] and r['error']['code'] == 'StaleTarget' and r['error']['delivery'] == 'notDispatched', r
                pathlib.Path(str(output) + '-control').write_text('restore')
                time.sleep(.1)
                surface = good('snapshot', pid=target.pid, windowId=panel_id)
                assert surface['nodes'][0]['value'] == 'explicit surface', surface['nodes'][0]
                good('execute', snapshotId=surface['id'], action=dict(kind='backgroundKey', ref=surface['nodes'][0]['ref'], text='Enter'))
                assert output.read_text() == 'explicit surface', 'App did not confirm overlay text and Enter'
            after = good('inputState')
            assert before['foregroundPID'] == after['foregroundPID'], 'Foreground application changed'
            if before['hardwareMouseMoves'] == after['hardwareMouseMoves']:
                assert before['cursor'] == after['cursor'], 'Cursor moved without hardware activity'
                cursor = 'cursor preserved'
            else: cursor = 'cursor check inconclusive: hardware activity'
            print('PASS:', 'secure orphan surface rejected' if secure else 'real NSPanel discovery, explicit scope, wrong ID, focus drift, text + Enter', '; foreground preserved;', cursor)
        finally:
            driver.stdin.close(); driver.wait(timeout=5)
            target.terminate(); target.wait(timeout=5)
