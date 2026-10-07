"""Prepare lossless formats of actual CUA captures; preserve the previous media."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
V = ROOT / 'outputs/verification'
FRAMES = ROOT / 'outputs/video/qa-cycle-02'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p, value): p.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
history=ROOT/'outputs/history/video-before-qa-cycle-02'
history.mkdir(parents=True,exist_ok=True)
for relative in ['docs/demo-video-scenes.json','outputs/submission/Signal-Demo.mp4','outputs/submission/Signal-Demo-audit.json']:
    source=ROOT/relative
    if source.exists():
        target=history/source.name
        if not target.exists(): shutil.copyfile(source,target)
captures=json.loads((V/'qa-cycle-02-video-captures.json').read_text(encoding='utf-8-sig'))
records=[]
for capture in captures['records']:
    source=FRAMES/capture['filename']
    assert sha(source)==capture['sha256']
    destination=source.with_suffix('.png')
    original=Image.open(source).convert('RGB'); original.save(destination)
    converted=Image.open(destination).convert('RGB')
    assert original.size==converted.size and original.tobytes()==converted.tobytes()
    records.append({'sourceJpeg':source.relative_to(ROOT).as_posix(),'sourceJpegSha256':sha(source),'destinationPng':destination.relative_to(ROOT).as_posix(),'destinationPngSha256':sha(destination),'dimensions':list(original.size),'decodedPixelEquality':True})
receipt=V/'qa-cycle-02-video-conversion.json'
save(receipt,{'schemaVersion':'signal-lossless-screenshot-conversion-v1','generatedAt':datetime.now(timezone.utc).isoformat(),'passed':True,'decodedPixelEquality':True,'captureProofSha256':sha(V/'qa-cycle-02-video-captures.json'),'frames':records})
rows=[
 ('11-entry',6,'Signal · нужные люди и подходящая работа','Монтаж реальных экранов. Вымышленные аккаунты; текущая версия 0.4.1.'),
 ('02-candidate-registration',7,'Обычная регистрация кандидата','Регистрация через интерфейс; отдельные согласия. Это личный аккаунт, Demo выключен.'),
 ('03-email-confirmation',5,'Подтверждение электронной почты','Код действительно получен локальной почтой и введён через интерфейс.'),
 ('04-email-verified-profile',5,'Новый личный аккаунт','Почта подтверждена; профиль начинает работу без вымышленных результатов.'),
 ('05-profile-preferences',7,'Профиль, условия и приватность','Кандидат сохраняет стек, зарплату, псевдоним и разрешение на поиск.'),
 ('06-questionnaire-saved',7,'Шесть вопросов перед проверкой','Опрос рекомендует Middle. Самооценка ещё не является подтверждённой категорией.'),
 ('07-assessment-start',5,'Практические задания под роль','Backend / Python v6; категория Middle и направление «Разработчик API».'),
 ('08-practical-cases',7,'Версионные инженерные кейсы','API, SQL, диагностика, повторы и архитектура. Ответы для демонстрации сконструированы.'),
 ('09-answers-saved',5,'Сохранение и продолжение','Ответы сохранены настоящим сервером; итоговый результат ещё не выставлен.'),
 ('10-verified-middle',7,'Серверный разбор и категория','Middle подтверждён по рубрике. Этот сконструированный пример не доказывает точность оценки людей.'),
 ('12-employer-registration',5,'Обычная регистрация компании','Работодатель также подтверждает почту; вход отдельный от кандидата.'),
 ('15-matching',8,'Подбор по подтверждённым навыкам','API и SQL, категория, формат и зарплата. Основной путь работает без истории ФСП.'),
 ('16-matching-explanation',8,'Почему кандидат подходит','Общее соответствие потребности и сопоставимые проверки; сырой балл разных программ не смешивается.'),
 ('17-salary-invitation',7,'Персональное предложение с зарплатой','Работодатель объясняет интерес и отправляет приглашение с конкретными условиями.'),
 ('18-candidate-offer',7,'Решение остаётся у кандидата','До принятия видны условия и контакт компании; доступ к своим контактам адресный.'),
 ('23-contacts-after-consent',7,'Контакты после согласия','Компания получает контакт только после принятия своего приглашения.'),
 ('20-job-published',6,'Открытая вакансия','Публикация — отдельное действие. Условия сохраняют версию для будущих откликов.'),
 ('21-job-application-consent',8,'Самостоятельный отклик','Кандидат отправляет письмо и явно разрешает передачу данных выбранной компании.'),
 ('24-application-contacts',7,'Работа работодателя с откликом','Статус «В рассмотрении», исходные условия и контакты по отдельному согласию.'),
 ('27-candidate-application-status',6,'Кандидат видит статус и доступ','Снимок исходных условий, решение компании и возможность отозвать отклик.'),
 ('26-quality-current',8,'Прозрачная методика','Оба контроля, версии и ограничения. Синтетические проверки не подменяют исследование людей.'),
]
scenes=[{'frame':name+'.png','durationSeconds':seconds,'title':title,'caption':caption,'sourceJpeg':'outputs/video/qa-cycle-02/'+name+'.jpg','captureGroup':'ordinary-live-55a5'} for name,seconds,title,caption in rows]
config={'schemaVersion':'signal-demo-montage-v2','site':'http://127.0.0.1:4310','frameDirectory':'outputs/video/qa-cycle-02','brand':'Signal','disclosure':'Монтаж реальных экранов · вымышленные аккаунты · без озвучки','bankVersions':['signal-backend-python-v6','signal-frontend-typescript-v2'],'matchingVersion':'fsp-signal-match-v5','currentImage':captures['records'][0]['imageId'],'conversionReceipt':'outputs/verification/qa-cycle-02-video-conversion.json','captureWindowUtc':[min(r['capturedAt'] for r in captures['records']),max(r['capturedAt'] for r in captures['records'])],'captureProvenance':{'proof':'outputs/verification/qa-cycle-02-video-captures.json','proofSha256':sha(V/'qa-cycle-02-video-captures.json'),'workflow':'Registration, actual local email confirmation, profile/questionnaire/test/save/submit, matching/invitation/consent/contacts and voluntary job application all performed through the real UI on accepted image55a5.','answers':'Owned-attempt oracle answers used as constructed demonstration inputs; no mocked scores; no human performance claim.','excludedFrames':['01-candidate-registration.jpg: earlier unsubmitted form','13-employer-need.jpg: initial unsupported SQL label request','14-unsupported-requirement.jpg: correctly blocked historical request','19-contacts-after-consent.jpg: transient loading state','22-employer-application.jpg: list before opening','25-candidate-application-status.jpg: before refreshing cross-account update']},'ordinaryAccounts':'Two locally created synthetic ordinary accounts; email confirmed through real UI. Exact owned fixtures removed after capture; protected independent audit accounts retained.','demoAccounts':'No Demo session used in this montage.','scenes':scenes}
save(ROOT/'docs/demo-video-scenes.json',config)
proof_path=V/'qa-cycle-02-ordinary-ui-workflow.json';proof=json.loads(proof_path.read_text(encoding='utf-8'));proof['captureProofSha256']=sha(V/'qa-cycle-02-video-captures.json');save(proof_path,proof)
# QA contact sheets only. Source UI pixels remain unretouched.
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',19)
for start in range(0,len(scenes),4):
    sheet=Image.new('RGB',(1440,1010),'#171e2b');draw=ImageDraw.Draw(sheet)
    for n,scene in enumerate(scenes[start:start+4]):
        x=(n%2)*720;y=(n//2)*505
        frame=Image.open(FRAMES/scene['frame']).convert('RGB');frame.thumbnail((700,435))
        sheet.paste(frame,(x+10,y+35));draw.text((x+10,y+6),f"{start+n+1:02}: {scene['title']}",font=font,fill='white')
    sheet.save(FRAMES/f'review-sheet-{start//4+1:02}.png')
print(json.dumps({'prepared':True,'sourceFrames':len(records),'scenes':len(scenes),'seconds':sum(s['durationSeconds'] for s in scenes)}))
