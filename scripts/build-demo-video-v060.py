"""Build a labelled montage from captured, unretouched byte-native PNG/JPEG browser screenshots.

Edit docs/demo-video-scenes-0.6.0.json for captions, order and duration. Every source
must exist before encoding. --validate-only checks inventory without generating
video. Actual encoding requires ffmpeg/ffprobe. No network requests are made.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
from datetime import datetime, timezone
from io import BytesIO

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'outputs' / 'video' / '0.6.0'
OUT = ROOT / 'outputs' / 'release-0.6.0'
FONT = Path('C:/Windows/Fonts/segoeui.ttf')
MAX_FRAME_BYTES = 32 * 1024 * 1024


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def native_format(data):
    """Validate encoded input without changing a single source byte."""
    if not data or len(data) > MAX_FRAME_BYTES:
        raise ValueError('Bounded encoded frame required')
    from PIL import Image
    with Image.open(BytesIO(data)) as image:
        if image.format not in {'PNG', 'JPEG'} or image.width * image.height > 32000000:
            raise ValueError('Expected bounded native PNG/JPEG frame')
        kind = image.format
        image.verify()
    if kind=='JPEG' and (data[:3]!=b'\xff\xd8\xff' or data[-2:]!=b'\xff\xd9'):
        raise ValueError('Complete native JPEG framing required')
    return kind


def load_config(path, prepare_only=False):
    config = json.loads(path.read_text(encoding='utf-8-sig'))
    if config.get('schemaVersion') != 'signal-demo-montage-v060' or config.get('applicationVersion') != '0.6.0':
        raise ValueError('Expected versioned 0.6 montage configuration')
    frames = (ROOT / config['frameDirectory']).resolve()
    if not frames.is_relative_to((ROOT / 'outputs/release-0.6.0/media').resolve()):
        raise ValueError('Only new 0.6 media source paths are permitted')
    scenes = config.get('scenes', [])
    if not scenes or len(scenes) > 60:
        raise ValueError('Expected 1–60 real screenshot scenes')
    names, missing = set(), []
    for scene in scenes:
        name = scene.get('frame', '')
        if (not isinstance(name,str) or Path(name).name != name or Path(name).suffix.lower() not in {'.png','.jpg','.jpeg'}
                or name.casefold() in names or ':' in name or '\\' in name or name.endswith(('.', ' '))):
            raise ValueError('Expected unique native image filename without path components')
        names.add(name.casefold())
        duration = scene.get('durationSeconds')
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 1 <= duration <= 90:
            raise ValueError(f'Invalid duration for {name}; expected 1–90 seconds')
        for key, limit in [('title', 80), ('caption', 115)]:
            value = scene.get(key)
            if not isinstance(value, str) or not value.strip() or len(value) > limit or '\n' in value:
                raise ValueError(f'{name}: {key} must be one nonempty line up to {limit} characters')
        source = frames / name
        if prepare_only:
            continue
        if source.is_symlink() or not source.resolve().is_relative_to(frames):
            raise ValueError('Frame path escaped its exact owned media root')
        if not source.is_file():
            missing.append(str(source))
        else:
            if not re.fullmatch(r'[a-f0-9]{64}',scene.get('sha256') or '') or digest(source)!=scene['sha256']:
                raise ValueError('Original frame hash missing or changed')
            native_format(source.read_bytes())
    if missing:
        raise FileNotFoundError('Capture all genuine UI states before building:\n' + '\n'.join(missing))
    if not config.get('bankVersions') or not config.get('disclosure'):
        raise ValueError('Bank versions and explicit montage disclosure are required')
    if config.get('matchingVersion') != 'fsp-signal-match-v6' or config.get('humanPilot') is not False:
        raise ValueError('Current matching policy and explicit no-human-pilot scope required')
    if config.get('conversionReceipt'):
        raise ValueError('Native input is required; no re-encoding or conversion receipt')
    if sum(scene['durationSeconds'] for scene in scenes)>900:
        raise ValueError('Bounded montage duration required')
    if not prepare_only:
        provenance=config.get('captureProvenance',{})
        proof_path=(ROOT / (provenance.get('proof') or '')).resolve()
        relative=proof_path.relative_to(ROOT) if proof_path.is_relative_to(ROOT) else None
        if (relative is None or not relative.as_posix().startswith(('outputs/verification/','outputs/release-0.6.0/'))
                or any(part.casefold() in {'private','raw','local-backup','clean'} for part in relative.parts) or proof_path.is_symlink()):
            raise ValueError('Bounded public current capture proof required')
        if not re.fullmatch(r'[a-f0-9]{64}',provenance.get('proofSha256') or '') or digest(proof_path)!=provenance['proofSha256']:
            raise ValueError('Current capture proof hash missing or drifted')
        proof=json.loads(proof_path.read_text(encoding='utf-8-sig'))
        if proof.get('passed') is not True or proof.get('applicationVersion')!='0.6.0':
            raise ValueError('Current capture proof must pass independently')
        if any(proof.get('frameHashes',{}).get((frames/scene['frame']).relative_to(ROOT).as_posix())!=scene['sha256'] for scene in scenes):
            raise ValueError('Every raw frame must be named by the current capture proof')
    return config, frames, scenes


def main():
    global WORK, OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'docs' / 'demo-video-scenes-0.6.0.json')
    parser.add_argument('--validate-only', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--encode-approved', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--output-dir', type=Path, default=OUT)
    parser.add_argument('--work-dir', type=Path, default=WORK)
    args = parser.parse_args()
    if args.self_test:
        from PIL import Image
        checks=0
        for kind in ['PNG','JPEG']:
            data=BytesIO();Image.new('RGB',(2,2),(10,20,30)).save(data,format=kind)
            original=data.getvalue();assert native_format(original)==kind and data.getvalue()==original;checks+=1
            try:native_format(original[:10]);raise AssertionError('Truncated image accepted')
            except (ValueError,OSError,SyntaxError):checks+=1
        class Config:
            def __init__(self,data):self.data=data
            def read_text(self,**_):return json.dumps(self.data)
        base={'schemaVersion':'signal-demo-montage-v060','applicationVersion':'0.6.0','frameDirectory':'outputs/release-0.6.0/media',
              'bankVersions':['signal-backend-python-v6'],'matchingVersion':'fsp-signal-match-v6','disclosure':'Synthetic montage','humanPilot':False,
              'scenes':[{'frame':'fabricated-only.jpg','durationSeconds':2,'title':'Title','caption':'Caption','sha256':None}]}
        load_config(Config(base),True);checks+=1
        import copy
        for mutate in [lambda c:c.update(applicationVersion='0.5.0'),lambda c:c.update(frameDirectory='outputs/release-0.5.0/media'),
                       lambda c:c.update(humanPilot=True),lambda c:c.update(conversionReceipt='anything'),lambda c:c['scenes'][0].update(frame='../x.jpg'),
                       lambda c:c['scenes'][0].update(durationSeconds=float('nan'))]:
            config=copy.deepcopy(base);mutate(config)
            try:load_config(Config(config),True);raise AssertionError('Invalid config accepted')
            except ValueError:checks+=1
        print(json.dumps({'passed':True,'selfTestChecks':checks,'scope':'Fabricated in-memory image/config guards only; no real media, encoding, private data, DB or runtime read'}))
        return
    config_path=args.config.resolve()
    if not config_path.is_relative_to(ROOT) or not config_path.relative_to(ROOT).as_posix().startswith(('docs/','outputs/release-0.6.0/')):
        raise ValueError('Versioned public montage config must remain in the project')
    OUT, WORK = args.output_dir.resolve(), args.work_dir.resolve()
    if OUT != (ROOT / 'outputs/release-0.6.0').resolve() or not WORK.is_relative_to((ROOT / 'outputs/video/0.6.0').resolve()):
        raise ValueError('Video output/work paths must remain inside their owned outputs roots')
    config, frames, scenes = load_config(config_path,args.prepare_only)
    total = sum(scene['durationSeconds'] for scene in scenes)
    if args.validate_only or args.prepare_only:
        print(json.dumps({'validated': not args.prepare_only, 'prepared':args.prepare_only,'applicationVersion':'0.6.0','scenes': len(scenes), 'seconds': total, 'encodingPerformed': False,'sourceValidation': 'PENDING' if args.prepare_only else 'actual native bytes and current capture proof'}))
        return
    if not args.encode_approved:
        raise ValueError('Explicit --encode-approved is required after the load window is released')
    if (OUT/'Signal-Demo.mp4').exists() or (OUT/'Signal-Demo-audit.json').exists():
        raise ValueError('Existing reviewed media must never be overwritten')
    ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        raise RuntimeError('ffmpeg and ffprobe must be installed and on PATH')
    if not FONT.is_file():
        raise RuntimeError('Cyrillic Segoe UI font was not found')
    if WORK.exists():
        raise ValueError('Use a new owned work directory for each encoding')
    WORK.mkdir(parents=True, exist_ok=False)
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
        records.append({**scene, 'frame': source.relative_to(ROOT).as_posix(), 'sha256': digest(source), 'nativeFormat':native_format(source.read_bytes()),'startSeconds': offset})
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
    if any(digest(frames/scene['frame'])!=scene['sha256'] for scene in scenes):
        raise ValueError('Raw screenshots changed during video encoding')
    temporary.replace(destination)
    audit = {'schemaVersion': config['schemaVersion'], 'applicationVersion':'0.6.0','generatedAt': datetime.now(timezone.utc).isoformat(), 'kind': 'captioned montage of genuine unretouched UI screenshots; not a continuous screen recording', 'site': config.get('site'), 'syntheticData': True, 'humanPilot':False,'nativeSourceBytesUnchanged':True,'videoLossyScaledEncoding':True,'noVoiceover': True, 'durationSeconds': duration, 'dimensions': '1440x900', 'frameRate': '25', 'bankVersions': config['bankVersions'], 'configSha256': digest(args.config.resolve()), 'scriptSha256': digest(Path(__file__)), 'scenes': records, 'videoSha256': digest(destination), 'technicalVerification': {'ffprobe': True, 'fullDecode': True}, 'visualReview': 'Required separately; successful encoding does not verify screenshots or captions.'}
    audit.update({'matchingVersion': config.get('matchingVersion'), 'currentImage': config.get('currentImage'), 'captureWindowUtc': config.get('captureWindowUtc'), 'captureProvenance': config.get('captureProvenance'), 'ordinaryAccounts': config.get('ordinaryAccounts'), 'demoAccounts': config.get('demoAccounts')})
    audit['technicalVerification'].update({'noAudioTracks': no_audio, 'ffprobeMetadata': metadata})
    (OUT / 'Signal-Demo-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'video': str(destination), 'seconds': duration, 'scenes': len(scenes), 'bytes': destination.stat().st_size}, ensure_ascii=False))


if __name__ == '__main__':
    main()
