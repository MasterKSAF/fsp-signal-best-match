# Signal — исправления C01–C05

08.10.2026. Пять адресных P2 из `outputs/signal-ui-refinement-control-2026-10-08/correction-01.md` исправлены в изолированной копии `signal-ui-refinement-workspace-20261008`. Новые проверки выполнены на финальной iteration04. Общая регрессия — **443/443 PASS**. Независимые проверки содержания C04 и реализации C01/C02/C03/C05 — PASS, новых P2 в этом объёме не найдено. Независимая приёмка контролирующим чатом ещё не заявляется завершённой.

Все новые свидетельства лежат в `outputs/verification/ui-refinement-correction01-20261008` (далее E). Старые отчёты и контрольные артефакты не заменены. Работа не включает commit/push, публикацию, презентацию, ролик или архив.

## Что изменено и проверено

| Пункт | Изменение | Новые доказательства |
|---|---|---|
| C01 | Дедуплицированный навык сохраняет отдельные contexts каждого CV: уровень, состояние и причину. Явный фильтр выбирает отображаемый уровень и resumeId вместе; «Все резюме» связывает максимальную цель с соответствующим CV. Account proofs остаются общими. | 10 focused regressions; E/context/http-prepare-iteration04.json — PASS2; http-issue-iteration04.json — PASS2 фактические выдачи. Root browser проверил оба противоположных active/filter контекста и настоящий диалог. |
| C02 | Стабильная projectionVersion охватывает разрешённое имя/alias и весь состав документа. Viewer key/cleanup используют эту версию и проверяют X-Signal-Document-Version. | Ordinary PATCH владельца при смонтированном employer PDF586/587: alias и имя обновились автоматически без reload/переключения PDF. CV rows/revision не менялись. JSON, свежие PDF/DOCX и canvas согласованы. |
| C03 | Версия учитывает точный skill evidence, уровень, программу, дату, evidence/attempt ID и источник квалификации. После async render сервер заново читает разрешённую проекцию; устаревшие bytes отклоняются. | Python Junior→Middle через обычную выдачу/submit и named correction только собственных fixture proofs; прежние агрегаты/revision точные. Уже открытый PDF обновился в обоих случаях. 6 controlled races с настоящими PDF/DOCX renderer отказали при изменении источника. |
| C04 | Пять повторявшихся Senior-семейств получили существенные новые условия и отрицательные случаи, content-v2/templateVersion2; банк v5. Остальные103 Senior families и Junior/Middle сохранены. | 55 focused tests; paired comparison2160 lower +1030 unchanged Senior exact +50 новых вариантов. Live5/5: SQL/TypeScript/React pass и две критические SQL ошибки fail без proof. Independent4979 assertions +47 SQLite checks PASS. |
| C05 | GET матрицы, POST выдачи и builder используют один персональный pool predicate. Исчерпанный новый пул показывает «Нет новых форм» и отключает старт. Сохранённый active, включая v4, можно продолжить. | 7 focused regressions; live5 групп для всех6 навыков: available→false, POST503 без новых записей, active continuation и точная v4 lineage. Root UI подтвердил шесть disabled Senior-кнопок. |

### C01: реальные контексты

Новый собственный actor1106 имеет CV606 Backend/Middle и CV607 Backend/Senior. Цели выставлены обычным API; заявленный stack посеян только в этих synthetic fixtures и это явно отмечено в receipt. При противоположном активном CV:

- Фильтр606 → Python/Middle/CV606, настоящий диалог30min, фактически созданная попытка166/CV606.
- Фильтр607 → Python/Senior/CV607, настоящий диалог45min, фактически созданная попытка167/CV607.
- «Все резюме» при active606 → максимальная цельSenior сCV607.

React Junior account proof и исходная попытка165 с исходным удалённым CV608 сохранены; фильтр их не перепривязывает. Скриншоты: E/visual/context-{middle,senior}-{filter,dialog}.png и context-all-max.png. Состояние без CV проверено отдельно на существующем actor1042: Python/React Junior и оригинальные links56/57, без пустого блока CV. Актуальный снимок E/visual/no-cv-passport-final.png снят после всех продуктовых правок.

### C02/C03: файлы и живой PDF

Собственные disposable owner1088/employer1089, CV586 pseudonymous и CV587 public. Исторический Middle/score88/01.10.2026 — явно синтетический imported fixture. Python Junior и затем Middle получены реальными ordinary issue/submit; приватный oracle использован только для механической проверки scoring, активный DTO не содержит ответов.

Последовательность live receipts в E/documents/live:

| Receipt | Итог |
|---|---|
| http-resume-prepare.json | PASS3; исходный partial Junior + исторический Middle, безопасные конечные файлы |
| http-alias.json | PASS2; обычный account alias PATCH, точные CV rows, новая версия только анонимного документа |
| http-name.json | PASS2; обычный displayName PATCH, точные CV rows, новая версия только разрешённой личности |
| http-middle.json | PASS4; новый реальный Middle proof, оба документа изменились при прежних агрегатах/revision |
| http-correction.json | PASS3; named correction двух собственных proofs, оба документа без прежнего подтверждения |
| http-inspect.json | PASS3; PDF/DOCX content, headers, no-store, metadata/links и deduplicated download counters |
| http-cleanup.json | PASS1; оба fixture actor удалены, protected history exact |

Файлы PDF/DOCX/JSON каждого этапа сохранены в той же папке. В конечных файлах проверены разрешённое имя, совпадение текста секций, отсутствие закрытых контактов/private links, PDF Author=Signal, отсутствие URL annotations, сохранение семизначной годовой зарплаты и года. Повторные inline preview не увеличивали views/downloads; внешние скачивания дедуплицировались до одного события на employer/CV.

Root оставлял PDF смонтированным при alias, отдельно при name, затем непрерывно при Middle и correction. Canvas автоматически показал новое имя, Python Middle и после correction «Python · заявлен»; исторический грейд/дата сохранились. После последнего обновления HTML «Документ» совпал с PDF. Это обновление на очередном успешном JSON poll5s/focus, без обещания push или измеренной задержки.

Снимки E/visual/pdf-before-alias.png, pdf-after-alias-auto.png, pdf-before-name.png, pdf-after-name-auto.png, pdf-after-middle-auto.png, pdf-after-correction-auto.png, html-after-correction.png. Структурированная ручная UI запись — E/visual/ui-receipt.json; screenshots проверены по реальному canvas, а не только по именам файлов.

Focused document suite23/23 включает stable scoped version, unchanged-CV identity и partial-proof transitions, точные provenance даты, реальные renderer races и ACL/counters. Отдельная receipt E/documents/freshness/projection-races.json содержит6 controlled real PDF/DOCX races. Гонки управляемые stateless, production route не получал искусственных задержек. Независимый reviewer повторил14 изменений разрешённых зависимостей,6 renderer races, unchanged/revoked cases. Старый defect probe с exit0 не засчитан как исправление.

Первые harness-прогоны содержат сохранённые FAIL: process-path assumption, serialization PDF metadata, Date baseline normalization и alias с частью скрытого имени, которую redaction правомерно убрала. Они не засчитаны как PASS. Исправлен только QA harness/значение собственной fixture; итоговые успешные receipts перечислены выше. Первые failed context fixtures также очищены; корректная подготовка использует обычный target API и явно обозначенный собственный stack seed.

### C04: новое решающее содержание

| Семейство | Новое Senior-условие |
|---|---|
| SQL transactions:s1 | Атомарный outbox, rollback/crash/lost ACK, стабильный ключ и idempotency получателя |
| SQL constraints:s3 | Частичный unique для active email, недостаточность FK для active parent, soft-delete concurrency и сохранение истории |
| TypeScript generics:s1 | Корреляция key/value при union inference, mapped discriminated tuples и проверка unknown на границе |
| React closures:s1 | Публикация ref из abandoned concurrent render и принадлежность операции committed UI |
| React forms:s1 | Three-way merge со stable IDs, edit против remote deletion, tombstones и precondition |

Пять семейств имеют новую содержательную lineagev2;103 неизменённых сохраняютv1. Исторические v4 snapshots/answer keys/scoring доступны для прежних попыток, не переписаны. Senior rubric и matrix не менялись. Подробности: docs/skill-senior-correction01-20261008.md, E/senior/paired-comparison.json, http-correction01.json, all-fixtures-cleanup.json, final-source-fingerprints.json. Все live Senior actors/sessions очищены до0.

Независимый C04 reviewer: E/independent-senior/report.md и checks.json. Проверил50 новых вариантов,384 scoring/proof masks,1080 historical probes,2160 exact lower variants, lineage/exhaustion и независимые негативные модели. Это не профессиональная калибровка на людях и не проверка настоящего PostgreSQL lock scheduler/смонтированного concurrent React.

### C05: исчерпание и продолжение

E/availability/http-receipt.json и implementation-report.md фиксируют5 live групп ×6 навыков на финальном API. После исчерпания GETfalse согласован с POST503, attempt count18/exposure108 не увеличиваются. v5 не обнуляет exposures неизменённых v4 families. Сохранённые active v4 snapshots возвращаются без изменения bytes и без расхода нового exposure.

Возраст48h и expiry моделировались только у собственных synthetic fixture snapshots; ожидание настоящего cooldown не заявляется. Actor1087 очищен; actor1086 оставлен для review с6 exhausted Senior pools и без active. Root screenshot E/visual/availability-exhausted-six-senior.png и DOM readback подтверждают шесть disabled «Нет новых форм»; на этом browser проходе новые проверки не запускались. Actor1106 также оставлен для review собственных контекстов166/167. Credentials только в `.codex/private`, не в отчётах.

## Регрессия и независимая проверка

После последних продуктовых изменений выполнены codegen, API/web typecheck, API/web build и полный suite443/443 без fail/skipped/cancelled. Логи E/checks/{codegen,api-typecheck,web-typecheck,api-build,web-build,unit-all}.log. После этого продукт не менялся; поздние правки затрагивали QA/evidence/docs. Нагрузочные тесты не запускались.

Независимая read-only C01/C02/C03/C05 проверка — E/independent-integrity/report.md, checks.json:6 групп PASS, новых P2 нет, шесть backend sources exact по immutable sourcemap. Собственные DB/HTTP/browser действия reviewer отсутствуют; новые live receipts прочитаны отдельно. Независимая evidence-сверка дополнительно подтвердила итоговые suite/live числа и отделила первые FAIL от конечных PASS.

Protected readback E/protected-readback/receipt.json: SELECT-only,5 bounded групп. Исходные774 файла fsp-signal —0 различий; protected4313/4314 не изменены. Семь исходных legacy rows, actor997 и прежние attempt/proof rows1042/1043 точные. Hash1042 `f602336259d54c0c2fdd9629246180d7899ae0f6162593888257eaf73d20ba24`;1043 `c72a1b6ae08b9a8b4fb7af47d11252b40f86010452734109334a2c3a9ef2dc41`. Это проверка сохранности, не переоценка компетенций.

## Финальные исходники и стенд

| Параметр | Зафиксированное значение |
|---|---|
| Taskcopy | C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008 |
| UI | http://localhost:4372; QA host signal-refinement.localhost:4372; Vite PID19520 |
| API | 127.0.0.1:4371, PID45204, immutable correction01 iteration04 |
| DB | signal_ui_refinement_20261008, loopback55435 |
| Bank | signal-skills-2026-10-v5 |
| Senior rubric | six-competencies-critical-5of6-senior-outcomes-v1 |
| Matrix | signal-category-competency-matrix-v2 |
| API bundle SHA256 | 45e2c38d4cb2650c0ab6800dbb6f225ee333e63113b59d2b7df690fb74f64985 |
| Frozen code manifest SHA256 | 714c364f0f86e2b1cdcebab6c4cbe6733d418623298e14ce4d39d929154bb450 |
| Build artifact manifest SHA256 | f20a64c87a80eeb95dc3876fee2df3834d169ff95f9b0fffdf9afe2df0c48039 |

E/final-provenance/frozen-code-manifest.json содержит1234 source/schema/test/config/lock файлов. artifact-manifest.json —11 immutable API dist и17 frontend build файлов.103 embedded API project sources совпадают с текущими исходниками по SHA. Frontend production dist собран и fingerprinted отдельно; живой4372 обслуживает Vite taskcopy source, не эти production bytes. Подробные SHA отдельных изменённых файлов и поздняя привязка docs/scripts — E/final-provenance/provenance.md и final receipts.

Все C01–C05 реализованы и проверены в указанном объёме. Следующий шаг — независимая контрольная приёмка. Внешняя интеграция ФСП и профессиональная human calibration этим пакетом не проверялись; native Word pagination также не заявляется. Сборка конкурсных материалов отложена по указанию пользователя.
