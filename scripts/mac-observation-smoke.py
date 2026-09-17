"""Read-only renderer coverage check; reports counts, never application content."""
import argparse
import json
import subprocess
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('--app', default='Granola')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
process = subprocess.Popen([str(root / 'native/macos/build/desktop-driver')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
def call(method, **params):
    process.stdin.write(json.dumps(dict(id=method, method=method, **params)) + '\n')
    process.stdin.flush()
    reply = json.loads(process.stdout.readline())
    assert reply['ok'], reply.get('error')
    return reply['data']
try:
    matches = [a for a in call('apps') if a['name'] == args.app]
    assert len(matches) == 1, 'Open exactly one matching application'
    for _ in range(2):
        snapshot = call('snapshot', pid=matches[0]['pid'])
        nodes = snapshot['nodes']
        counts = dict(nodes=len(nodes), webAreas=sum(n['role'] == 'AXWebArea' for n in nodes), namedPressControls=sum(bool(n['name']) and 'AXPress' in n['actions'] for n in nodes), truncated=snapshot['truncated'])
        print(json.dumps(counts))
        assert counts['webAreas'] > 0 and counts['namedPressControls'] > 1, 'Renderer is not exposing its controls'
finally:
    process.stdin.close()
    process.wait(timeout=5)
