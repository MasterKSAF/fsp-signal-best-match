"""Lossless encoding conversion of owned CUA JPEG captures for video, no edits."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'outputs/release-0.5.0/media'
DEST = ROOT / 'outputs/video/release-0.5.0/frames'
REPORT = ROOT / 'outputs/verification/release-0.5.0-media-conversion.json'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
DEST.mkdir(parents=True, exist_ok=True)
records = []
for source in sorted(SOURCE.glob('*.jpg')):
    if source.is_symlink() or not source.resolve().is_relative_to(SOURCE.resolve()):
        raise ValueError('Capture escapes owned directory')
    with Image.open(source) as image:
        if image.format != 'JPEG':
            raise ValueError('Expected actual CUA JPEG')
        decoded = image.convert('RGB')
        target = DEST / (source.stem + '.png')
        decoded.save(target, format='PNG')
        with Image.open(target) as check:
            if check.size != decoded.size or check.convert('RGB').tobytes() != decoded.tobytes():
                raise ValueError('Decoded pixel equality failed')
        records.append({'source':source.relative_to(ROOT).as_posix(), 'sourceSha256':sha(source),
                        'actualSourceFormat':'JPEG', 'dimensions':list(decoded.size),
                        'destinationPng':target.relative_to(ROOT).as_posix(), 'destinationPngSha256':sha(target),
                        'decodedPixelEquality':True})
if not records:
    raise ValueError('No captured UI frames')
REPORT.write_text(json.dumps({'schemaVersion':1,'passed':True,'decodedPixelEquality':True,
                 'convertedAt':datetime.now(timezone.utc).isoformat(),'kind':'encoding conversion only; no retouch/crop/resize',
                 'frames':records},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':True,'frameCount':len(records),'report':REPORT.relative_to(ROOT).as_posix()}))
