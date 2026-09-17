"""Offline Mac acceptance: real OCR/CoreML, no live screenshots or input.
Usage: python3 scripts/vision-smoke.py /path/to/screenshot.png [model.mlpackage]
"""
import base64
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
image = Path(sys.argv[1]).resolve()
args = {'id': 'fixture', 'method': 'detectImage', 'imagePath': str(image), 'overlay': True}
if len(sys.argv) > 2:
    args['modelPath'] = str(Path(sys.argv[2]).resolve())
result = subprocess.run([str(root / 'native/macos/build/desktop-driver')],
    input=json.dumps(args) + '\n', text=True, capture_output=True, timeout=120, check=True)
reply = json.loads(result.stdout.strip())
if not reply.get('ok'):
    raise SystemExit(json.dumps(reply.get('error')))
data = reply['data']
assert data['actionable'] is False
assert data['regions'], 'No regions found in the fixture'
for region in data['regions']:
    b = region['bounds']
    assert 0 <= b['x'] < data['width'] and 0 <= b['y'] < data['height']
    assert b['width'] > 0 and b['height'] > 0
    assert 0 <= region['confidence'] <= 1
sources = sorted(set(r['source'] for r in data['regions']))
if len(sys.argv) > 2:
    assert 'yolo' in sources, data.get('warning', 'Detector returned no YOLO regions')
assert 'overlay' in data, 'Missing annotated preview'
out = root / '.context/vision'
out.mkdir(parents=True, exist_ok=True)
(out / 'mac-overlay.png').write_bytes(base64.b64decode(data['overlay']))
print(json.dumps({'model': data['model'], 'regions': len(data['regions']),
    'sources': sources, 'durationMs': data['durationMs'], 'warning': data.get('warning'),
    'overlayPath': str(out / 'mac-overlay.png')}))
