"""Regression for the inherited AX timeout. Creates a disposable 400 ms button."""
import json
import subprocess
import tempfile
import time
from pathlib import Path
root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='jev-ax-test-') as temp:
    binary = str(Path(temp) / 'slow-button')
    subprocess.run(['swiftc', str(root / 'tests/fixtures/macos/SlowButton.swift'), '-o', binary], check=True)
    app = subprocess.Popen([binary])
    driver = subprocess.Popen([str(root / 'native/macos/build/desktop-driver')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    def call(method, **args):
        driver.stdin.write(json.dumps(dict(id=method, method=method, **args)) + '\n')
        driver.stdin.flush()
        return json.loads(driver.stdout.readline())
    try:
        time.sleep(1)
        snapshot = call('snapshot', pid=app.pid)['data']
        node = next(n for n in snapshot['nodes'] if n['name'] == 'Slow press')
        result = call('execute', snapshotId=snapshot['id'], action=dict(kind='press', ref=node['ref']), animate=True)
        assert result['ok'], result
        print('PASS: 400 ms AX callback completes with pointer animation.')
    finally:
        driver.stdin.close()
        driver.wait(timeout=5)
        app.terminate()
        app.wait(timeout=5)
