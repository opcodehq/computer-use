"""Export the pinned UI detector to a Vision-compatible CoreML package.
Run in a venv with scripts/vision-requirements.txt. Weights retain AGPL-3.0.
"""
import argparse
import hashlib
from pathlib import Path
import urllib.request

REVISION = '6600256cb0f1b07651e3bc86166196307bad7e2d'
SHA256 = 'dab3d4351ad00b035db829909a4db98354d5a90f6990e4ac00222a9a95d4bf57'
parser = argparse.ArgumentParser()
parser.add_argument('--directory', default='.models')
args = parser.parse_args()
folder = Path(args.directory).resolve()
folder.mkdir(parents=True, exist_ok=True)
weights = folder / 'model.pt'
if not weights.exists():
    urllib.request.urlretrieve(f'https://huggingface.co/microsoft/OmniParser-v2.0/resolve/{REVISION}/icon_detect/model.pt', weights)
if hashlib.sha256(weights.read_bytes()).hexdigest() != SHA256:
    raise SystemExit('Model checksum mismatch; remove the file and download again.')
from ultralytics import YOLO
result = YOLO(str(weights)).export(format='coreml', nms=True, imgsz=640, half=True, device='cpu')
print(f'Exported {result}. Set JEV_YOLO_MODEL_PATH to this package or choose it in Settings.')
