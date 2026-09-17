"""Run once after a build batch. Only operates Calculator with explicit --act."""
import argparse
import json
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--act', action='store_true', help='Calculate 6 times 7 in Calculator')
parser.add_argument('--binary', default=str(Path(__file__).resolve().parent.parent / 'native/macos/build/desktop-driver'))
args = parser.parse_args()
process = subprocess.Popen([args.binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

def call(method, **kwargs):
    process.stdin.write(json.dumps(dict(id=method, method=method, **kwargs)) + '\n')
    process.stdin.flush()
    result = json.loads(process.stdout.readline())
    if not result['ok']:
        raise RuntimeError(result['error'])
    return result['data']

try:
    print('Permissions:', json.dumps(call('status')))
    if args.act:
        subprocess.run(['open', '-a', 'Calculator'], check=True)
        time.sleep(0.5)
        apps = call('apps')
        calculator = next(a for a in apps if a['name'] == 'Calculator')
        stale = None
        for label in ['All Clear', '6', 'Multiply', '7', 'Equals']:
            snapshot = call('snapshot', pid=calculator['pid'])
            matches = [n for n in snapshot['nodes'] if n['name'] == label and 'AXPress' in n['actions']]
            assert len(matches) == 1, f'Expected one {label} button'
            action = dict(kind='press', ref=matches[0]['ref'])
            print(label, call('execute', snapshotId=snapshot['id'], action=action)['delivery'])
            stale = (snapshot['id'], action)
            time.sleep(0.15)
        snapshot = call('snapshot', pid=calculator['pid'])
        values = [n['value'].replace('\u200e', '').strip() for n in snapshot['nodes']]
        assert '42' in values, f'Expected 42, got {values}'
        print('PASS: Calculator displays 42 through AX, no screenshot used.')
        try:
            call('execute', snapshotId=stale[0], action=stale[1])
            raise AssertionError('Stale action was accepted')
        except RuntimeError as error:
            assert 'StaleTarget' in str(error)
            print('PASS: Stale action rejected.')
finally:
    process.stdin.close()
    process.wait(timeout=5)
