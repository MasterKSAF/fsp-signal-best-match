"""Decode each final scene midpoint for explicit visual acceptance."""
from pathlib import Path
import hashlib,json,subprocess,shutil
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
delivery=ROOT/'outputs/submission'
video=delivery/'Signal-Demo.mp4'
audit=json.loads((delivery/'Signal-Demo-audit.json').read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(video)==audit['videoSha256']
work=ROOT/'outputs/video/qa-cycle-02/midpoints';work.mkdir(parents=True,exist_ok=True)
records=[]
for n,scene in enumerate(audit['scenes'],1):
    at=scene['startSeconds']+scene['durationSeconds']/2
    target=work/f'scene-{n:02}.png'
    subprocess.run([shutil.which('ffmpeg'),'-hide_banner','-loglevel','error','-y','-ss',str(at),'-i',str(video),'-frames:v','1',str(target)],check=True)
    assert Image.open(target).size==(1440,900)
    records.append({'scene':n,'source':scene['frame'],'sourceSha256':scene['sha256'],'atSeconds':at,'path':target.relative_to(ROOT).as_posix(),'sha256':sha(target),'title':scene['title'],'caption':scene['caption']})
for start in range(0,len(records),4):
    sheet=Image.new('RGB',(1440,900),'#080e1d')
    for n,row in enumerate(records[start:start+4]):
        frame=Image.open(ROOT/row['path']);frame=frame.resize((720,450))
        sheet.paste(frame,((n%2)*720,(n//2)*450))
    sheet.save(work/f'sheet-{start//4+1:02}.png')
proof={'passed':True,'scope':'Actual encoded final-video scene midpoints decoded; visual acceptance recorded separately.','videoSha256':sha(video),'sceneCount':len(records),'frames':records}
(ROOT/'outputs/verification/qa-cycle-02-video-midpoints.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':True,'decodedSceneMidpoints':len(records)}))
