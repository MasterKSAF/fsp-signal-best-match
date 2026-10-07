"""Prepare source-grounded artifact facts. Final acceptance is supplied explicitly.

This script never upgrades historical PASS reports into current acceptance.
Without --acceptance, all media stays draft and generation is blocked.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--acceptance',type=Path)
parser.add_argument('--screenshot-input',type=Path,default=ROOT/'docs/artifact-screenshot-input.json')
parser.add_argument('--acceptance-display',type=Path,default=ROOT/'docs/artifact-acceptance-display.json')
args=parser.parse_args()
load=lambda path:json.loads((ROOT/path).read_text(encoding='utf-8'))
sha=lambda path:hashlib.sha256((ROOT/path).read_bytes()).hexdigest()
matching=load('outputs/quality/matching-competitive-v1-report.json')
grades=load('outputs/quality/assessment-validation-after.json')
before=load('outputs/quality/assessment-validation-before.json')
acceptance=json.loads(args.acceptance.read_text(encoding='utf-8')) if args.acceptance else None
display=json.loads(args.acceptance_display.read_text(encoding='utf-8')) if acceptance and args.acceptance_display.exists() else None
if display and display['acceptanceSha256']!=hashlib.sha256(args.acceptance.read_bytes()).hexdigest():
    raise ValueError('Readable acceptance copy does not match the original fixed acceptance SHA')
if acceptance and (not acceptance.get('passed') or not acceptance.get('checks') or not acceptance.get('image')):
    raise ValueError('Explicit final acceptance must have passed=true, image and factual checks')
if acceptance:
    if not acceptance.get('releaseSummary') or not {'entry','matching','assessment'} <= set(acceptance.get('screenshots',{})):
        raise ValueError('Final acceptance must include releaseSummary and all three current screenshots')
    for screenshot in acceptance['screenshots'].values():
        if not (ROOT / screenshot).is_file():
            raise ValueError(f'Current screenshot is missing: {screenshot}')
compet=next(s for s in matching['strata']['poolKind'] if s['value']=='competitive')
m=compet['methods']['signal']; old=compet['methods']['old-v3']
f=lambda value:f'{value:.3f}'.replace('.',',')
source_hashes={path:sha(path) for path in [
    'artifacts/api-server/src/lib/signal-matching.ts','artifacts/api-server/src/lib/assessment-managed.ts',
    'artifacts/api-server/src/lib/assessment-bank.ts','outputs/quality/matching-competitive-v1-report.json',
    'outputs/quality/assessment-validation-after.json','outputs/quality/assessment-validation-before.json',
]}
if matching['algorithmSha256']!=source_hashes['artifacts/api-server/src/lib/signal-matching.ts']:
    raise ValueError('Matcher changed since quality run. Re-run fixed control before refreshing facts.')
for path in ['artifacts/api-server/src/lib/assessment-managed.ts','artifacts/api-server/src/lib/assessment-bank.ts']:
    if grades['sourceHashes'][path]!=source_hashes[path]:
        raise ValueError('Assessment changed since validation. Re-run independent reference without altering labels.')
checks=[
    ['Конкурентный подбор','9 сценариев, 128 пар, 87 допустимых. Исключения 0/87, допуски 0/21, приватность 0/20. matching-competitive-v1-report.json.'],
    ['Содержательная валидация работ','468 синтетических работ, 216 независимо разобранных ответов. Расхождения 12/468 до и 0/468 после. assessment-validation-after.json.'],
    ['Сопоставление A/B','216/234 совпавших решений; 18 намеренных переходов сохранены. Люди: not_measured.'],
]
checks += display['checks'] if display else acceptance['checks'] if acceptance else [['Финальная сборка и эксплуатация','Текущие unit/HTTP/build, полные мобильные пути, backup restore и расширенная нагрузка ожидают итоговых протоколов. Прежние PASS относятся к истории.']]
facts={
    'schemaVersion':'signal-refinement-artifact-facts-v1','generatedAt':datetime.now(timezone.utc).isoformat(),
    'sliceDate':'06.10.2026','draft':not bool(acceptance),'matchingVersion':matching['algorithmVersion'],
    'bankVersions':grades['programVersions'],'checks':checks,
    'releaseSummary':display['releaseSummary'] if display else acceptance['releaseSummary'] if acceptance else 'Финальный протокол новой сборки ещё не предоставлен. Этот проектный текст не переносит прежние результаты нагрузки/чистого ZIP как текущий PASS.',
    'provenance':{'sourceHashes':source_hashes,'finalAcceptance':str(args.acceptance) if args.acceptance else None,
                  'finalAcceptanceSha256':hashlib.sha256(args.acceptance.read_bytes()).hexdigest() if args.acceptance else None,
                  'proofHashes':acceptance.get('proofHashes',{}) if acceptance else {},
                  'acceptanceDisplaySha256':hashlib.sha256(args.acceptance_display.read_bytes()).hexdigest() if display else None,
                  'image':acceptance['image'] if acceptance else None,'humanMeasures':'not_measured'},
}
old_config=load('docs/presentation-content.json')
screenshot_input=json.loads(args.screenshot_input.read_text(encoding='utf-8')) if args.screenshot_input.exists() else None
screenshots=acceptance['screenshots'] if acceptance else screenshot_input['screenshots'] if screenshot_input else old_config['screenshots']
screenshot_provenance=acceptance.get('screenshotProvenance') if acceptance else None
if screenshot_provenance is None and screenshot_input:
    if screenshots!=screenshot_input['screenshots']:
        raise ValueError('Screenshot paths changed; supply matching screenshotProvenance instead of reusing previous metadata')
    screenshot_provenance=screenshot_input['provenance']
if not screenshot_provenance or not set(screenshots)<=set(screenshot_provenance):
    raise ValueError('Every artifact screenshot needs explicit capture provenance')
screenshot_verification=acceptance.get('screenshotVerification',{}) if acceptance and 'screenshotVerification' in acceptance else screenshot_input.get('verification',{}) if screenshot_input else {}
for key,filename in screenshots.items():
    screenshot_provenance[key]['path']=filename
    screenshot_provenance[key]['sha256']=sha(filename)
facts['provenance']['screenshots']=screenshot_provenance
facts['provenance']['screenshotVerification']=screenshot_verification
facts['provenance']['screenshotInputSha256']=hashlib.sha256(args.screenshot_input.read_bytes()).hexdigest() if screenshot_input else None
notes=[
    '0:00-0:10. Best Match, Казань. Signal подбирает ИТ-специалистов по подтверждённым навыкам. Тема и лого из официального шаблона ФСП. Данные демонстрации синтетические.',
    '0:10-0:30. Компания задаёт навыки, уровень и зарплату. Кандидат видит условия и адресно открывает контакт. Источники: technical-description.md, architecture.md. Экран: screenshots.entry.',
    '0:30-0:40. Сергей Калеев, капитан/разработчик, @sergeikaleev; Оксана Калеева, маркетолог, kaleevaoksana7@gmail.com. Казань. Сведения подтвердил пользователь 05.10.2026.',
    '0:40-1:00. От прототипов Replit/Google AI Studio до серверного допуска и immutable evidence. Повторный аудит обнаружил игнорирование сопоставимого результата в v3. Мы исправили порядок и проверили новым frozen-контролем. Источники: matching-v3.md, matching-competitive-control.md.',
    '1:00-1:20. Резюме/PDF, вакансии/отклики и практика с серверным расписанием. Исследование отделено от рабочей категории, имеет согласие, сроки и отзыв. ATS/антифейк архитектурно проработаны. Источники: research-protocol.md, trust-and-ats.md.',
    '1:20-1:55. Matching v4. Сервер сначала проверяет допуск. В одной категории, программе, версии и структуре рубрики 100 стоит выше 83. Несопоставимые группы следуют в техническом порядке: точный минимальный грейд, затем более высокие по возрастанию; установленное качество перед неизвестным; ключ группы. Этот порядок не доказывает квалификационное превосходство. Неизвестное качество имеет значение null, а не ноль. ФСП добавляет 3 балла внутри группы. Веса внутри группы: покрытие 50%, качество попытки 30%, формат 15%, свежесть 5%. Production и контроль используют общий comparator, дробный score и NFC-псевдоним/ID. Человеческая эквивалентность форм не измерена. Источники: signal-matching.ts, matching-v3.md; screenshots.matching.',
    '1:55-2:25. Backend v6, Frontend v2, 72 смысловых шаблона. В форме 6 заданий на 45 минут. Порог Junior - 67; Middle и Senior - 83. Senior требует полного решения архитектуры наряду с критичной основой. Новая рубрика устранила 12 из 468 расхождений на синтетических эталонах, сохраняя старые попытки. Независимый набор: 36 форм, 216 ответов, 468 работ, 234 пары. A/B: 216/234 = 92,31%; 18 намеренных расхождений сохранены. Это сконструированные профили, надёжность результатов людей ещё не измерена. Источники: assessment-validation.md, assessment-validation-after.json; screenshots.assessment.',
    f'2:25-3:00. Зафиксированный конкурентный контроль: 128 пар, 87 допустимых, 6 пулов по 12-16 допустимых. На конкурентных сценариях P@5: {f(m["precisionAt5"]["value"])} против {f(old["precisionAt5"]["value"])} у v3; nDCG: {f(m["ndcgAt5"]["value"])} против {f(old["ndcgAt5"]["value"])}. По всем 9 сценариям P@5 = 0,778; nDCG = 0,988 по 8 определённым, пустой сценарий имеет null. Без качества конкурентная nDCG = 0,783. Проигрыш короткого PostgreSQL: 0,987 против 1,000, сохранён. Ledger: 0,916, показывает цену технического приоритета групп. Метки синтетические, созданы с помощью ИИ; они не измеряют рынок труда. Пилот с 36 добровольцами ещё не проведён. Источники: matching-competitive-v1-report.json, assessment-validation-after.json, docs/pilot/operator-guide.md. Финальная техническая приёмка: отдельные актуальные протоколы; image и факты в technical-release-input.json.',
]
for index,key in [(1,'entry'),(5,'matching'),(6,'assessment')]:
    notes[index]+=' Происхождение снимка: '+screenshot_provenance[key]['description']
config={
    'draft':not bool(acceptance),'generatedAt':facts['generatedAt'],'sliceDate':'06.10.2026',
    'matchingVersion':matching['algorithmVersion'],'bankVersions':grades['programVersions'],
    'screenshots':screenshots,'screenshotProvenance':screenshot_provenance,'screenshotVerification':screenshot_verification,
    'sourceHashes':source_hashes,'finalAcceptance':facts['provenance']['finalAcceptance'],
    'matchingHeading':'Результат внутри сопоставимой категории',
    'matchingBody':'Обязательные навыки и согласие определяют допуск.\n\n100 выше 83 одной программы и версии.\n\nРазные группы следуют в техническом порядке.\n\nИсторическое качество без протокола остаётся неизвестным.',
    'matchingFooter':'Matching v4. Синтетический контроль. Равная человеческая сложность форм ещё не измерена.',
    'assessmentText':'Backend / Python v6\nFrontend / TypeScript v2\nJunior, Middle, Senior\n\n72 смысловых шаблона\n6 заданий за 45 минут\n\nТри критичных критерия.\nДля Senior обязательна также архитектура.\n\nJunior от 67 баллов\nMiddle и Senior от 83\n\nИстория старых версий сохранена.',
    'assessmentCaption':'Синтетические эталоны: 12/468 расхождений до, 0/468 после.\nЧеловеческая сложность ещё не измерена.',
    'validationBody':'Независимо разобранные ответы, работы с ошибками и перенос изученного метода.\n\nФормы A/B: 216/234 решения совпали. 18 содержательных различий сохранены.\n\nСледующий этап: добровольцы с заранее зафиксированной исходной оценкой.',
    'verificationTiles':[
        {'value':'128','title':'Контрольных пар','body':'9 потребностей. Шесть конкурентных пулов по 12-16 допустимых.'},
        {'value':f(m['precisionAt5']['value']),'title':'Precision@5','body':f'Шесть конкурентных сценариев. Старый v3: {f(old["precisionAt5"]["value"])}. Метки синтетические.'},
        {'value':f(m['ndcgAt5']['value']),'title':'nDCG@5','body':f'Шесть конкурентных сценариев. Старый v3: {f(old["ndcgAt5"]["value"])}. Все проигрыши сохранены.'},
        {'value':'468','title':'Эталонных работ','body':f'Расхождения с рубрикой: {before["counts"]["teamLabelDisagreements"]}/468 до, {grades["counts"]["teamLabelDisagreements"]}/468 после. Происхождение: синтетика с ИИ.'},
        {'value':'A/B','title':'Граница измерений','body':'216/234 решения совпали на сконструированных работах. Реальные участники: не измерено.'},
        {'value':'ФСП','title':'Внешний контур','body':'Официальный реестр ещё не подключён. Demo-история обозначена.'},
    ],
    'metrics':acceptance.get('metrics',{}) if acceptance else {},'notes':notes,
}
(ROOT/'docs/presentation-content.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'docs/technical-release-input.json').write_text(json.dumps(facts,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'draft':facts['draft'],'matchingVersion':matching['algorithmVersion'],'bankVersions':grades['programVersions'],'sourceGrounded':True},ensure_ascii=False))
