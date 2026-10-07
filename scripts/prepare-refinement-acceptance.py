"""Summarize completed current verification for document generators, pre-seal."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[1]
names = ['release-current-build.json', 'mobile-refinement.json', 'load-scale.json',
         'backup-restore.json', 'final-tests-local-refinement.json', 'final-http-refinement.json']
reports = {name: json.loads((root / 'outputs/verification' / name).read_text(encoding='utf-8-sig')) for name in names}
assert all(report['passed'] for report in reports.values())
image = reports['release-current-build.json']['image']
assert reports['load-scale.json']['imageId'] == reports['mobile-refinement.json']['image'] == image
assert reports['load-scale.json']['cleanup'] == 'complete'
assert reports['backup-restore.json']['workingDataPreserved']
facts = {
    'generatedAt': datetime.now(timezone.utc).isoformat(), 'passed': True, 'image': image,
    'checks': [
        ['Тесты и сборка', '72 unit + typecheck/API/Vite PASS;50 Docker HTTP +7 отдельного research.4 production isolation и4 pilot CLI отдельно.57 API runtime input SHA совпали с tested image; binary bundle equality не измерена.'],
        ['Браузер обеих ролей', 'Полный ordinary synthetic mobile workflow; final entry/compare/PDF retests.36 настоящих снимков,215 settled contrast samples без failures;capture provenance разделён.'],
        ['Восстановление БД', '28 таблиц и4 миграции: schema/count/hash/constraints/sequences и HTTP права/история/PDF/отзыв.Рабочая БД сохранена,изолированные фикстуры очищены.'],
        ['Расширенная нагрузка', '1000 профилей,16 потребностей,32 сессии,180,81s steady:8123 запроса,0 ошибок.JSON max p95 1397,60ms,PDF p95 1014,24ms;RAM peak470,4MiB.Dataset/image stable,fixture cleanup complete.']
    ],
    'releaseSummary': 'Signal0.4.0;matching v4;Backend v6/Frontend v2.Current types/build,unit/HTTP,браузер,restore иload подтверждены companion протоколами.Новый sourceZIP clean launch и package privacy выполняются после запечатывания;их PASS этим документом заранее не заявляется.Human difficulty/time/usability не измерены.',
    'screenshots': {
        'entry': 'outputs/verification/mobile-refinement/28-home-current-desktop.jpg',
        'matching': 'outputs/verification/mobile-refinement/25-desktop-matching-current.jpg',
        'assessment': 'outputs/verification/mobile-refinement/24-desktop-assessment-current.jpg'
    },
    'captureProvenance': 'Entry captured on final fd500;matching/assessment on intermediate22ee with final form CSS and zero-FSP score.Final change separated displayed FSP bonus;comparison final31 verifies this.All raw photos unretouched.',
    'proofHashes': {name: hashlib.sha256((root / 'outputs/verification' / name).read_bytes()).hexdigest() for name in names},
    'postSeal': 'Clean source launch,privacy,finalization/package are separate later companion reports;this acceptance does not assert them complete.'
}
target = root / 'outputs/verification/refinement-artifact-acceptance.json'
target.write_text(json.dumps(facts, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed': True, 'image': image, 'file': target.relative_to(root).as_posix()}))
