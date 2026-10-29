"""Native regression: focused transient editors outside AXChildren remain scoped.
Run: CU_NATIVE_DIR=/absolute/build python3 scripts/mac-focused-editor-smoke.py
No app activation, global input, cursor movement, or existing document mutation.
"""
import json, os, pathlib, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[1]
driver_path = pathlib.Path(os.environ.get('CU_NATIVE_DIR', root / 'native/macos/build')) / 'desktop-driver'
with tempfile.TemporaryDirectory(prefix='cu-editor-') as temp:
    binary = pathlib.Path(temp) / 'target'
    subprocess.run(['xcrun', 'swiftc', str(root / 'tests/fixtures/macos/FocusedEditorTarget.swift'), '-o', str(binary)], check=True)
    for secure in [False, True]:
        output = pathlib.Path(temp) / ('secure' if secure else 'normal')
        visible = os.environ.get('CU_EDITOR_VISIBLE') == '1'
        target = subprocess.Popen([str(binary), str(output)] + (['--secure'] if secure else []) + (['--visible'] if visible else []))
        driver = subprocess.Popen([str(driver_path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        def call(method, **args):
            driver.stdin.write(json.dumps(dict(id=method, method=method, **args)) + '\n'); driver.stdin.flush()
            return json.loads(driver.stdout.readline())
        try:
            time.sleep(.5)
            before = call('inputState')['data']
            deadline = time.monotonic() + 5
            reply = call('snapshot', pid=target.pid)
            while not reply['ok'] and target.poll() is None and time.monotonic() < deadline and reply['error']['code'] in ['AppClosed', 'UnsupportedSurface', 'ObservationFailed']:
                time.sleep(.05)
                reply = call('snapshot', pid=target.pid)
            assert reply['ok'], reply
            snapshot = reply['data']
            field = next((n for n in snapshot['nodes'] if n['name'] == 'Transient editor'), None)
            assert field, 'Focused transient editor omitted from snapshot'
            assert field['focused'] and (visible or field['depth'] == 1), field
            if secure:
                assert field['value'] == '[secure]' and field['actions'] == [], field
                refused = call('execute', snapshotId=snapshot['id'], action=dict(kind='backgroundText', ref=field['ref'], text='must not type'))
                assert not refused['ok'] and refused['error']['delivery'] == 'notDispatched', refused
                refused_key = call('execute', snapshotId=snapshot['id'], action=dict(kind='backgroundKey', ref=field['ref'], text='Meta+A'))
                assert not refused_key['ok'] and refused_key['error']['delivery'] == 'notDispatched', refused_key
                for kind in ['select', 'confirm', 'showMenu']:
                    refused = call('execute', snapshotId=snapshot['id'], action=dict(kind=kind, ref=field['ref']))
                    assert not refused['ok'] and refused['error']['delivery'] == 'notDispatched', refused
                assert not output.exists()
            else:
                row = next(n for n in snapshot['nodes'] if n['name'] == 'Selectable row')
                assert 'AXShowMenu' in row['actions'], row
                shown = call('execute', snapshotId=snapshot['id'], action=dict(kind='showMenu', ref=row['ref']))
                assert shown['ok'], shown
                assert pathlib.Path(str(output) + '-menu').read_text() == 'shown', 'App did not confirm exact semantic menu action'
                snapshot = call('snapshot', pid=target.pid)['data']
                row = next(n for n in snapshot['nodes'] if n['name'] == 'Selectable row')
                assert 'select' in row['actions'], row
                selected = call('execute', snapshotId=snapshot['id'], action=dict(kind='select', ref=row['ref']))
                assert selected['ok'], selected
                assert pathlib.Path(str(output) + '-selection').read_text() == 'true', 'App did not confirm exact-row selection'
                snapshot = call('snapshot', pid=target.pid)['data']
                field = next(n for n in snapshot['nodes'] if n['name'] == 'Transient editor')
                stale = snapshot
                snapshot = call('snapshot', pid=target.pid)['data']
                refused = call('execute', snapshotId=stale['id'], action=dict(kind='backgroundText', ref=field['ref'], text='stale'))
                assert not refused['ok'] and refused['error']['delivery'] == 'notDispatched', refused
                field = next(n for n in snapshot['nodes'] if n['name'] == 'Transient editor')
                sent = call('execute', snapshotId=snapshot['id'], action=dict(kind='backgroundText', ref=field['ref'], text='scoped editor'))
                assert sent['ok'], sent
                snapshot = call('snapshot', pid=target.pid)['data']
                field = next(n for n in snapshot['nodes'] if n['name'] == 'Transient editor')
                assert field['value'] == 'scoped editor', field
                assert 'AXConfirm' in field['actions'], field
                confirmed = call('execute', snapshotId=snapshot['id'], action=dict(kind='confirm', ref=field['ref']))
                assert confirmed['ok'], confirmed
                assert output.read_text() == 'scoped editor', 'App did not independently confirm AXConfirm'
                snapshot = call('snapshot', pid=target.pid)['data']
                field = next(n for n in snapshot['nodes'] if n['name'] == 'Transient editor')
                sent = call('execute', snapshotId=snapshot['id'], action=dict(kind='backgroundKey', ref=field['ref'], text='Meta+Shift+N'))
                assert sent['ok'], sent
                assert pathlib.Path(str(output) + '-shortcut').exists(), 'Background chord reached window but did not invoke app menu command'
                snapshot = call('snapshot', pid=target.pid)['data']
                field = next(n for n in snapshot['nodes'] if n['name'] == 'Transient editor')
                sent = call('execute', snapshotId=snapshot['id'], action=dict(kind='backgroundKey', ref=field['ref'], text='Enter'))
                assert sent['ok'], sent
                assert output.read_text() == 'scoped editor', 'App did not independently confirm text + Enter'
            after = call('inputState')['data']
            assert before['foregroundPID'] == after['foregroundPID'], 'Foreground application changed'
            if before['hardwareMouseMoves'] == after['hardwareMouseMoves']:
                assert before['cursor'] == after['cursor'], 'Cursor moved without hardware activity'
                cursor = 'cursor preserved'
            else:
                cursor = 'cursor check inconclusive: concurrent hardware mouse activity'
            print('PASS:', 'secure text/key refusal' if secure else 'omitted focused editor, exact text, AXConfirm, selection, semantic menu, modifier chord, Enter, stale-ref refusal', '; foreground preserved;', cursor)
        finally:
            driver.stdin.close(); driver.wait(timeout=5)
            target.terminate(); target.wait(timeout=5)
