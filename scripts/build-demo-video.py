"""Build a labelled montage from captured, unretouched browser PNG screenshots.

Edit docs/demo-video-scenes.json for captions, order and duration. Every source
must exist before encoding. --validate-only checks inventory without generating
video. Actual encoding requires ffmpeg/ffprobe. No network requests are made.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import shutil
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'outputs' / 'video'
OUT = ROOT / 'outputs' / 'submission'
FONT = Path('C:/Windows/Fonts/segoeui.ttf')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_config(path):
    config = json.loads(path.read_text(encoding='utf-8-sig'))
    if config.get('schemaVersion') != 'signal-demo-montage-v2':
        raise ValueError('Expected schemaVersion signal-demo-montage-v2')
    frames = (ROOT / config['frameDirectory']).resolve()
    if not frames.is_relative_to((ROOT / 'outputs' / 'video').resolve()):
        raise ValueError('Frame directory must be inside outputs/video')
    scenes = config.get('scenes', [])
    if not scenes or len(scenes) > 60:
        raise ValueError('Expected 1–60 real screenshot scenes')
    names, missing = set(), []
    for scene in scenes:
        name = scene.get('frame', '')
        if Path(name).name != name or Path(name).suffix.lower() != '.png' or name in names:
            raise ValueError(f'Expected unique PNG filename without path components: {name!r}')
        names.add(name)
        duration = scene.get('durationSeconds')
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 1 <= duration <= 90:
            raise ValueError(f'Invalid duration for {name}; expected 1–90 seconds')
        for key, limit in [('title', 80), ('caption', 115)]:
            value = scene.get(key)
            if not isinstance(value, str) or not value.strip() or len(value) > limit or '\n' in value:
                raise ValueError(f'{name}: {key} must be one nonempty line up to {limit} characters')
        source = frames / name
        if not source.is_file():
            missing.append(str(source))
        elif source.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
            raise ValueError(f'Not a PNG screenshot: {source}')
    if missing:
        raise FileNotFoundError('Capture all genuine UI states before building:\n' + '\n'.join(missing))
    if not config.get('bankVersions') or not config.get('disclosure'):
        raise ValueError('Bank versions and explicit montage disclosure are required')
    return config, frames, scenes


def main():
    global WORK, OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'docs' / 'demo-video-scenes.json')
    parser.add_argument('--validate-only', action='store_true')
    parser.add_argument('--output-dir', type=Path, default=OUT)
    parser.add_argument('--work-dir', type=Path, default=WORK)
    args = parser.parse_args()
    OUT, WORK = args.output_dir.resolve(), args.work_dir.resolve()
    if not OUT.is_relative_to((ROOT / 'outputs').resolve()) or not WORK.is_relative_to((ROOT / 'outputs/video').resolve()):
        raise ValueError('Video output/work paths must remain inside their owned outputs roots')
    config, frames, scenes = load_config(args.config.resolve())
    conversion = None
    if config.get('conversionReceipt'):
        receipt_path = (ROOT / config['conversionReceipt']).resolve()
        if not receipt_path.is_relative_to((ROOT / 'outputs' / 'verification').resolve()):
            raise ValueError('Conversion receipt must be inside outputs/verification')
        conversion = json.loads(receipt_path.read_text(encoding='utf-8'))
        if not conversion.get('passed') or not conversion.get('decodedPixelEquality'):
            raise ValueError('Lossless screenshot conversion must have passed')
        by_path = {record['destinationPng']: record for record in conversion['frames']}
        for scene in scenes:
            relative = (frames / scene['frame']).relative_to(ROOT).as_posix()
            record = by_path.get(relative)
            if not record or not record.get('decodedPixelEquality') or digest(frames / scene['frame']) != record['destinationPngSha256']:
                raise ValueError(f'PNG screenshot no longer matches conversion receipt: {relative}')
    total = sum(scene['durationSeconds'] for scene in scenes)
    if args.validate_only:
        print(json.dumps({'validated': True, 'scenes': len(scenes), 'seconds': total, 'encodingPerformed': False}))
        return
    ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        raise RuntimeError('ffmpeg and ffprobe must be installed and on PATH')
    if not FONT.is_file():
        raise RuntimeError('Cyrillic Segoe UI font was not found')
    WORK.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(FONT, WORK / 'font.ttf')
    (WORK / 'brand.txt').write_text(config.get('brand', 'Signal'), encoding='utf-8')
    (WORK / 'disclosure.txt').write_text(config['disclosure'], encoding='utf-8')
    records, clips, offset = [], [], 0
    for index, scene in enumerate(scenes, 1):
        source = frames / scene['frame']
        (WORK / 'scene.txt').write_text(scene['title'], encoding='utf-8')
        (WORK / 'caption.txt').write_text(scene['caption'], encoding='utf-8')
        filters = (
            'scale=1280:720:force_original_aspect_ratio=decrease,'
            'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x111827,'
            'pad=1440:900:80:90:color=0x080E1D,'
            'drawtext=expansion=none:fontfile=font.ttf:textfile=brand.txt:fontcolor=0xBCA8F2:fontsize=28:x=80:y=19,'
            'drawtext=expansion=none:fontfile=font.ttf:textfile=disclosure.txt:fontcolor=0xB3BFCE:fontsize=18:x=80:y=57,'
            'drawtext=expansion=none:fontfile=font.ttf:textfile=scene.txt:fontcolor=white:fontsize=23:x=80:y=826,'
            'drawtext=expansion=none:fontfile=font.ttf:textfile=caption.txt:fontcolor=0xC6D0DE:fontsize=20:x=80:y=862'
        )
        clip = WORK / f'final-scene-{index:03}.mp4'
        subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', str(source), '-t', str(scene['durationSeconds']), '-vf', filters, '-r', '25', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(clip)], cwd=WORK, check=True)
        clips.append(clip.name)
        records.append({**scene, 'frame': source.relative_to(ROOT).as_posix(), 'sha256': digest(source), 'startSeconds': offset})
        offset += scene['durationSeconds']
    (WORK / 'final-concat.txt').write_text(''.join(f"file '{name}'\n" for name in clips), encoding='utf-8')
    temporary = OUT / 'Signal-Demo.next.mp4'
    destination = OUT / 'Signal-Demo.mp4'
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'final-concat.txt', '-c', 'copy', '-movflags', '+faststart', str(temporary)], cwd=WORK, check=True)
    metadata = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(temporary)], text=True))
    duration = float(metadata['format']['duration'])
    video = next(stream for stream in metadata['streams'] if stream['codec_type'] == 'video')
    no_audio = not any(stream['codec_type'] == 'audio' for stream in metadata['streams'])
    if abs(duration - total) >= .2 or (video['width'], video['height'], video['codec_name']) != (1440, 900, 'h264') or not no_audio or video['r_frame_rate'] != '25/1':
        raise RuntimeError('Output failed duration/dimension/codec verification')
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(temporary), '-f', 'null', '-'], check=True)
    temporary.replace(destination)
    audit = {'schemaVersion': config['schemaVersion'], 'generatedAt': datetime.now(timezone.utc).isoformat(), 'kind': 'captioned montage of genuine unretouched UI screenshots; not a continuous screen recording', 'site': config.get('site'), 'syntheticData': True, 'noVoiceover': True, 'durationSeconds': duration, 'dimensions': '1440x900', 'frameRate': '25', 'bankVersions': config['bankVersions'], 'configSha256': digest(args.config.resolve()), 'scriptSha256': digest(Path(__file__)), 'scenes': records, 'videoSha256': digest(destination), 'technicalVerification': {'ffprobe': True, 'fullDecode': True}, 'visualReview': 'Required separately; successful encoding does not verify screenshots or captions.'}
    audit.update({'matchingVersion': config.get('matchingVersion'), 'currentImage': config.get('currentImage'), 'captureWindowUtc': config.get('captureWindowUtc'), 'captureProvenance': config.get('captureProvenance'), 'ordinaryAccounts': config.get('ordinaryAccounts'), 'demoAccounts': config.get('demoAccounts')})
    audit['technicalVerification'].update({'noAudioTracks': no_audio, 'ffprobeMetadata': metadata})
    if conversion is not None:
        audit['conversion'] = {'receipt': config['conversionReceipt'], 'receiptSha256': digest(receipt_path), 'decodedPixelEquality': True, 'frameCount': len(conversion['frames'])}
    (OUT / 'Signal-Demo-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'video': str(destination), 'seconds': duration, 'scenes': len(scenes), 'bytes': destination.stat().st_size}, ensure_ascii=False))


if __name__ == '__main__':
    main()
