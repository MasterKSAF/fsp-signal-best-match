# Независимая проверка кэша подбора 0.5.0

Первичный срез проверен чтением исходников 06.10.2026, 20:46 UTC. Рецензент не автор проверяемых pool/ranking/evidence-оптимизаций. На этом шаге product-код, БД и процессы не менялись. Позднейшие независимые проверки ABA и миграции 0008 описаны отдельными checkpoints ниже; они уточняют этот ранний срез. Полный source snapshot и HTTP/SLA после freeze ещё нужны.

## Что покрывает свежий ключ

`loadResumeCandidates` строит JSON-проекцию и fingerprint из одной явной whitelist. Каждая текущая SQL-строка сериализуется типизированным `ROW(... )::text`, получает SHA256; 32-байтовые commitments объединяются строго по уникальному resume ID и снова хешируются. Это не shortcut по revision. Отсутствие/появление строки тоже меняет digest. Fixed-size aggregate уменьшает размер сортируемых значений, но не отменяет чтение и проверку каждой строки.

| Влияние | Проверенное покрытие |
| --- | --- |
| Владелец и точное резюме | userId, resumeId, revision, title; запрос кандидатов только с role=candidate. |
| Доступ | Точный server scope, reviewScopeId, soft-delete, private, отдельные consentMatching/consentCatalog; purpose и scope входят в контекст кэша. |
| Условия и квалификация | Специализация, grade, score, verifiedSkills, stack/statedSkills, формат, зарплатный диапазон/период/база, дата и legacyQualification. |
| Представление и ФСП | Alias, hasFspHistory, годы опыта, readyForOffers и publicName только при public. |
| Фото | В пуле лишь visibility-aware наличие. Байты не кэшируются в полном пуле; выбранное фото перечитывается. Изменение непустого фото на другое непустое поэтому не требует raw-pool miss. |
| Текущие попытки | На каждом запросе свежие id/user/program/version/purpose/grade/score/submittedAt; status=submitted, verified=true и Signal purpose проверяются SQL-предикатом. Отзывы перечитываются отдельно. |

Обычные адресные/owned чтения не используют целый pool cache. Cache miss читает содержимое и его собственный hash одним SQL-снимком, а не сохраняет содержимое под более ранним preflight hash. На cache hit всё равно выполняется новый SQL fingerprint. Допуска по TTL нет.

Даты хранятся в encoded snapshot строками. Внешний top-level объект и `Date` создаются заново при чтении; вложенные encoded JSON/массивы заморожены. `mutateLocalProjection` включён лишь у двух pool callers для этих локальных top-level объектов; он не изменяет encoded snapshot. Остальные callers сохраняют non-mutating контракт. Общий объект proof одной попытки используется только внутри текущего запроса.

## Расчёт и порядок

Ranking memo включает полное значение потребности, точный scope, отсортированные overrides, pool digest, текущий attempt/correction digest и freshness bands. Сверено с оценщиком: до 30 дней включительно, до 90 включительно, менее 180; неизвестная/невалидная дата — последний диапазон. Переход через каждую границу меняет ключ. Внутри диапазона формула давности постоянна.

Хранятся ID и замороженные производные evaluation, а не прежние candidate bodies или Date. На hit возвращаются текущие candidate/alternative объекты; отсутствие сохранённого выбранного ID приводит к пересчёту. Need ownership и возможность действия проверяются маршрутами вне memo. Неизменная рубрика опирается на реальные UPDATE-триггеры миграции 0006; score/status/correction не считаются неизменными.

Само сопоставление и допуск не заменены кэшем. Reviewer scope не сводится к demoMode; company purpose не попадает в выборку квалификационных попыток; отозванная linked attempt остаётся revoked и не допускается. Частные контакты/answers/oracle bodies не входят в raw pool или ranking memo. Ограниченный whitelist рубрики нужен только серверному валидатору и не выдаётся клиенту.

## Независимые поведенческие контроли

[Пять первоначальных контролей](../outputs/verification/assessment-purpose/history/cache-review-deffb145b9da.json) — PASS; запуск `node --import tsx scripts/performance-cache-independent-review.ts`. Скрипт не соединяется с БД/API и не создаёт нагрузочный пул. Первоначальный запуск проверял:

1. Задержавшееся завершение старого miss не заменяет более новый пустой разрешённый пул под его ключом.
2. Content-own hash при изменении между preflight и снимком; невозможность изменить вложенный cached массив.
3. Восемь одновременных distinct-key loads при capacity=1 и byteBudget=1 — положительное воспроизведение ограничения retention-only.
4. Присоединение свежих candidate/Date объектов, защита nested evaluation и отсутствие возврата пропавшего selected ID.
5. Разделение ключей для correction, reviewer cohort и точных границ 30/90/180 дней.

Это проверки наблюдаемого поведения, включая out-of-order scheduling и отрицательные случаи. Они не заменяют PostgreSQL-приёмку новых fingerprints или сверку прежней формулы на большом пуле. Standalone SQL-протокол автора дополнительно сопоставляет ORM/JSON и проверяет изменения доступа/квалификации; новый прогон после последних изменений ещё должен быть приложен отдельно.

## Ограничения и документация

- Raw pool cache имеет две retained entries и оценочный бюджет 128 MiB; ranking — две и 62 MiB; rubric — до 10 000 записей. Оценки размера JSON/структур не являются доказанной верхней границей heap/native working set.
- Same-key in-flight loads объединяются. Число разных in-flight keys отдельным semaphore/byte cap не ограничено. Параллельные miss, decoded projections, SQL results, временная сериализация и отправка JSON живут сверх retained budgets. Actual memory/error/latency thresholds полного 32-session сценария остаются обязательными.
- После любого fingerprint hit SQL-работа остаётся O(N). `/matches` отдаёт весь допустимый пул; пагинация каталога не превращает этот маршрут в ограниченную выборку.
- Freshness относится к текущему отдельному SQL statement. Вся цепочка raw pool → attempts → corrections → выбранное фото не завернута в единый serializable/read snapshot. Отсутствие stale-key shortcut подтверждено; атомарный глобальный снимок всех таблиц этим review не заявлен.
- Техническое описание честно отделяет Signal qualification/company task, прошлое unrecorded подтверждение и reviewer/overview; человеческий пилот и настоящее подключение ФСП не заявлены. Для PDF гарантия точнее: аккаунтные contact fields не добавляются, свободный текст/ссылки кандидата остаются его содержимым и могут включать контакты. Текущий проверенный PDF отдельно действительно не содержит email/телефона.
- Шаблон `technical-description-0.5.0.md` ещё содержит места для verification/dependencies/release summary. Публикуемая версия должна заполняться фактическими frozen receipts; прежние PASS на другом исходнике не доказывают последний snapshot.

## SHA256 проверенного исходника

| Файл | SHA256 |
| --- | --- |
| signal-resume-matching.ts | 350eb0fda3947c0b81a2f438ea68489bd5f795306cd1cfe7bdc035a661400b6c |
| signal-fresh-pool-cache.ts | ed82c1c36234eee57f7832cd39888ed2f538dd44bde9f5805611cfa21bafa768 |
| signal-fresh-ranking-cache.ts | b305d4bd243914dddcc0e65fc205c8b59437675d6af8726a3f8b3012880b3f8f |
| signal-resume-evaluation.ts | 41ac162817c1f55d8df39c60936e00f13c621bc6ad9e9227f94b295699f4e668 |
| assessment-ranking-evidence.ts | be1bc53dab7122624069ba32ad8c54e2f032b60111a8f5c3644d7db5116bffd6 |
| signal-pool-scope.ts | cdcceffbec0fce1a60d5b211d91f47ab81a3b85ea0d99006676e35a24ae0be74 |
| matching-pool-admission.ts | e359c638ca538b8035b3c9f0329dcbe9fbe6fdc831508cdde55b3ff31ced9e65 |
| 0006_assessment_purpose.sql | 9bd0ba0fd77fc819211df2995ffcc9175e73d50070f8d005564b4a4b56430474 |
| technical-description-0.5.0.md (до уточнения PDF) | 96c01b914e80d794d2745433ccc48e9a1c26caeca894f09ab2bbbcb49d0a9140 |

Изменение исходника после этого момента требует новой сверки. Этот документ не объявляет итоговую SLA-приёмку, чистый запуск архивного комплекта или человеческую валидность грейда.

## Checkpoint ABA и 0008 — 20:58–21:01 UTC

После первого среза выявлен дополнительный межзапросный случай: первый caller проверил A, его более поздний SQL-снимок прочитал B, пул вернулся в A, а второй caller после своего свежего A присоединился к pending обещанию первого. Вернуть этому второму caller B без повторного чтения нельзя: B мог содержать уже скрытые строки и был прочитан до его preflight. Исправление владельца модуля сравнивает фактический fingerprint завершённого pending со свежим fingerprint присоединившегося caller; несовпадение вызывает его собственное чтение снимка. Исторический первый срез не покрывал ABA.

[Шесть независимых pure-контролей](../outputs/verification/assessment-purpose/performance-cache-independent-review.json) проходят на исправленном модуле, включая управляемую задержку B и обязательный собственный A-read второго caller. Предыдущие receipts сохранены по SHA в history. Эта проверка не делает предположений о производительности SQL.

0008 переносит полный content commitment в PostgreSQL. SQL-функция подписывает `to_jsonb(NEW)` **всей** строки за исключением самого `pool_content_digest`, включая ID, owner, приватность, legacy JSON, содержимое и revision. Все пять текущих timestamptz заменены epoch numeric, чтобы timezone/DateStyle не создавали разные подписи одного instant; микросекунды сохраняются. Unconditional BEFORE INSERT OR UPDATE пересчитывает подпись даже при direct SQL, неизменной revision и попытке вручную записать digest. 32-byte constraint/NOT NULL проверяют результат; backfill UPDATE не создаёт новые резюме. Сейчас другой résumé trigger проверяет только владельца/лимит и не меняет подписываемые поля. При появлении нового mutating BEFORE trigger его порядок и покрытие должны быть пересмотрены.

Свежая pool SQL теперь агрегирует сохранённые полные résumé signatures вместе с текущим joined ID/role/demoMode/reviewScopeId/alias/FSP/publicName/photoPresence. Точные ACL predicates выполняются в том же текущем SELECT. Это не основание по revision или TTL. SHA всех полей вычисляется один раз при записи, а не повторно сериализуется каждым pool reader. Непустое фото заменённое на другое непустое не влияет на presence key; выбранные байты по-прежнему читаются отдельно и не сохраняются в raw pool.

[52 независимых actual SQL-контроля](../outputs/verification/assessment-purpose/performance-cache-digest-independent-review.json) — PASS; запуск `node --import tsx scripts/performance-cache-digest-independent-review.ts`. Только ранее созданная рецензентом `signal_resume_migration_check` в QA-контейнере/55435. Миграция 0008 сохранилась **только там**. Все синтетические строки, их direct updates и временная prerequisite 0007 откачены. Stage/live/load БД, API, restore и настройки нагрузки не менялись.

Rollback не обещает возврат serial sequences: PostgreSQL nextval может продвинуть их в этой отдельной тестовой БД. Подтверждены неизменные business rows/counts/hashes; reset последовательностей не выполнялся.

- Все 221 существующие строки получили корректные подписи; исходных tombstones в этой БД сейчас 0, поэтому это число указано явно. Отдельный rollback-сценарий эмулирует две неподписанные legacy записи — live и tombstone — и реальным backfill 0008 восстанавливает подписи обеих без изменения business hashes и без resurrection. Trigger отключался только локальным администратором внутри этого подготовительного rollback-сценария; это не обход, доступный API.
- 37 столбцов résumé независимо изменены прямыми UPDATE. Каждый меняет подпись; кроме отдельного revision-контроля revision остаётся прежней. Включены owner/ID/JSON/даты/условия/согласия и soft-delete.
- Попытки установить digest в NULL или 32 байта FF при включённом trigger не меняют корректную подпись. UTC/Tokyo/Los_Angeles и SQL DateStyle дают ту же подпись; изменение даты на микросекунду меняет её.
- Проверяется **actual exported production SQL fingerprint expression**, а не альтернативная формула. Изменение joined alias/FSP/public name/photo presence меняет pool key при неизменной résumé signature. Текущие consent/private/deleted/role/reviewer-cohort исключают строку независимо от предыдущего состояния.
- Два полных исполнения 0008 сохраняют business hashes/counts всех public tables и подписи уже существовавших строк. Контроли не выгружают строки/контакты в публичный report.

| Актуальный файл | SHA256 |
| --- | --- |
| 0008_resume_pool_digest.sql | 7bd28ea0003eba03e459a73b2763a5a2a8c4efc57612ee9c9d99a181da93e5e5 |
| signal-resume-matching.ts | 97da4381c7fba0d53a88a479960e4fee15f756288de485413b96d3c0a5ac4ed6 |
| signal-fresh-pool-cache.ts | 79eae6a5c8bbfbc5bf1d9c85994a655478d0bb0502f8e901f780a51c4c9af8e7 |

При проверке нового server-only поля найден отдельный DTO-дефект: owned résumé `responsePayload` распространял всю DB-строку, включая internal digest. Он исправлен явным исключением `poolContentDigest`; чужих записей этот маршрут не выдавал. Добавлена meaningful HTTP-группа, проверяющая наличие реальной 32-byte подписи в БД и отсутствие поля в GET/list/create/copy/content PUT/metadata PATCH. На момент этого checkpoint её прогон после 0008/freeze ещё ожидается; SQL52 не является подтверждением исправления HTTP DTO.

Ограничение distinct-key in-flight остаётся прежним: retained budgets не являются общим ограничителем памяти активных запросов. Новая миграция и эти 52/6 контролей не доказывают SLA полного 32-session прогона. Подтверждение scope/qualification/ACL относится к указанным source hashes, а final HTTP/clean ZIP/load должны ссылаться на согласованный frozen snapshot.

## Checkpoint metadata и JSON facet — 21:10 UTC

Последующий source дополнительно повторно использует encoded assessment metadata после свежего fingerprint SELECT. Текущие id/user/program/version/purpose/grade/score/epoch date и correlated correction state подписываются одним SQL statement; status/verified/Signal-purpose остаются текущими WHERE predicates. Присоединившийся caller использует тот же исправленный ABA guard. Полное содержимое oracle не нужно для каждого hit: рубрика защищена 0006, а изменяемые score/date/correction не разрешают reuse по одному immutable attempt ID.

Теперь `preparedMetadata` удерживает derived grouped Maps/Dates/замороженные safe proofs за weak reference к retained encoded snapshot. Следовательно, прежнее утверждение о sharing **только внутри запроса** относится к первому срезу, а не к этой версии. Повторное использование между запросами защищено текущим полным metadata fingerprint, но размер этих derived структур находится сверх encoded budget и должен учитываться в actual heap. Подписи рубрики предполагают, что operator не удаляет и не вставляет вручную другой oracle под тем же attempt ID/immutable identity при продолжающем работать процессе; обычный API этого не делает, а restore требует согласованного перезапуска.

`/matches` сохраняет ровно исходный профессиональный JSON после Zod parse/явного расширения DTO. Его facet привязан weak map к полному ключу returned ranking array. Need values, scope, exact overrides, свежий résumé pool digest, свежий metadata/correction digest и age bands входят в ключ. Session/role/owned need и адресные requested IDs проверяются до serializer на каждом HTTP запросе. В этом body отсутствуют account contacts, avatar bytes, oracle/ответы и action permissions; явная available-resume projection тоже содержит лишь профессиональные поля. Каталог с query/page и explanation с выбранным proof этим JSON memo не пользуются.

Текущая личная company block запрещает приглашения/контакты и не скрывает профессиональный matching DTO. Поэтому employer-specific block list не является входом этого serializer сейчас. При добавлении скрытых/исключённых для компании строк новая политика обязана применяться свежей после facet либо включать company ID и полный актуальный excluded-set digest в ключ. Повторное использование JSON не может заменять проверку действия.

Новые retention оценки: raw pool две entries/128 MiB; encoded metadata две/14 MiB; ranking **вместе с JSON** две/48 MiB; rubric 10 000 entries. Отдельного бесконтрольного presentation cache нет. Это 190 MiB оценочных encoded/compact budgets, не верхняя граница heap. Derived maps, строки/буферы ответа, decoded rows, rubric и активные miss находятся дополнительно.

[Семь независимых pure-контролей](../outputs/verification/assessment-purpose/performance-cache-independent-review.json) — PASS. Новый контроль использует **actual evaluateMatch и actual составной freshRankingKey**, а не строку вроде «changed-key»: warm JSON совпадает; новое title появляется; свежая пустая разрешённая выборка и revoked proof исключают кандидата; reviewer cohort вызывает отдельную сериализацию. Значения pool/metadata fingerprints здесь вычисляются независимо из маленькой синтетической фикстуры; настоящий SQL отдельно проверен контролями 0008. Прогон не соединяется с БД/API и не доказывает нагрузочный критерий. Actual HTTP cold/warm/ACL протокол владельца на момент checkpoint ещё готовился; PASS ему здесь не присваивается.

| Последующий файл | SHA256 |
| --- | --- |
| signal-fresh-pool-cache.ts | 080c1f7d0f0fa7f8e7f2646cafd009b0e6a1ddc3d2d3882e0a83c449038c0d42 |
| signal-fresh-ranking-cache.ts | e15494390099a87c4d9a25762525a171f3792eb2489114bf00a5415177c13021 |
| signal-resume-matching.ts | b23ed5ca228f7e1d991153db499f493e1d30fa610656e7e68de4b6adfdf1d3bd |
| assessment-ranking-evidence.ts | f7f6407b2d8a9fe9996207a24be2f6524aae63e7dd4241bfafe17ae7fe80b1f4 |
| signal-employer-matching.ts | f1d3924b05af1ef0bd975a62a1013b410f60b34ccb134e0aa200caa047e9859c |

## Checkpoint readonly projections — 21:18 UTC

Последняя оптимизация добавляет `immutableProjection` только двум internal whole-pool callers — подбору и каталогу. Она не является semantic/ACL option и поэтому не меняет cache context. Содержимое после собственного SQL hash read преобразуется в deep-frozen view: числовое время захвачено primitive, каждый доступ к `latestAssessmentAt`/`deletedAt` создаёт новый Date. У Date можно изменить internal slot даже после Object.freeze, поэтому хранить один «замороженный Date» было бы недостаточно; здесь общего Date нет. Default и bounded/owned/explicit reads сохраняют новые top-level копии/Date, а injected reader не получает shared whole-pool memo.

Admission weak memo привязан к неизменной raw array и точному need/scope. Raw view не содержит linked assessmentEvidence, а исходный admission helper не проверяет давность: time-sensitive/revocation решения остаются в последующем authoritative evaluator. Enrichment weak memo привязан к той же неизменной source array и **только после** нового complete metadata fingerprint read может вернуть прежний enriched frozen view. При исправлении/изменении score/date/status/verified/purpose snapshot ключ отличается. Age bands ранжирования продолжают считаться от текущего времени, даже когда immutable views повторно используются.

Проверены все пять текущих callers enrichment: shared whole-pool opt-in лишь у подбора/каталога; адресные сравнение/деталь и invitation transaction не включают shared raw view. В frozen branch `mutateLocalProjection` не меняет candidate, а создаёт immutable enriched projection. Изменяемых candidate bodies/Date в JSON facet нет; профессиональный JSON по-прежнему связан с полным fresh ranking key.

[Восемь независимых pure-контролей](../outputs/verification/assessment-purpose/performance-cache-independent-review.json) — PASS. Восьмой проходит через **реальный warm FreshJsonPoolCache**, пытается изменить полученный Date через Date.prototype, исходный Date до projection, поле и nested массив; следующая warm выдача и JSON сохраняют исходное значение и выдают отдельные Date instances. Это межзапросная проверка отравления снимка, а не утверждение о heap или DB isolation.

Оценка raw structural overhead увеличена с 512 до 768 bytes/row. Бюджеты 128/14/48 MiB не изменились; weak admitted/enriched views и prepared metadata остаются дополнительными derived structures, а активные запросы — вне retention limit. Latest SQL/HTTP и полный load подтверждаются отдельными receipts владельца и final freeze, не этими восемью pure-контролями.

| Readonly checkpoint файл | SHA256 |
| --- | --- |
| signal-readonly-resume.ts | 34a7dd3bc0a2a107dbe63c3221d7e12da5997843159f105e950714e495164969 |
| signal-resume-matching.ts | b576d2772704d40dbffa8b09bea45e7080bcf35ef1e6e85ce3c57e15ff6acb6e |
| assessment-ranking-evidence.ts | 0e79002939d0be94ea54341e3e39a3beb5f57024a7c497e1241cbf7c8e383885 |
| signal-fresh-pool-cache.ts | 3b0546dd3f940e21ecb911705c33d10db2680f46c516702cde2e668c70b33e40 |

## HTTP DTO-контроль после stage 0008 — 21:29 UTC

После реальной миграции и перезапуска API [core/trust 20](../outputs/verification/multi-resume-core-trust-http-coretrust-7f3c37d5.json) — PASS. В частности, настоящий PostgreSQL digest длиной 32 bytes существует, но не попадает в owned GET/list/create/copy/content PUT/metadata PATCH. Ранее отмеченное ожидание HTTP относится к предыдущему checkpoint. [Сводный функциональный контроль](../outputs/verification/assessment-purpose/stage-final-functional-0008.json) подтверждает 53 группы и совпадение 559 текущих runtime-source hashes с загруженным исходником. Это не подтверждение нагрузочного SLA или верхней границы памяти.

## Независимый контроль retention и diagnostics — 21:33 UTC

[Три tiny-контроля](../outputs/verification/assessment-purpose/performance-cache-retention-independent-review.json) — PASS через реальные cache classes: recently used raw snapshot сохраняется, вытеснённый читается заново; oversized snapshot возвращается frozen, но не удерживается; professional JSON в общем ranking budget вытесняет другую компактную запись, а старый result-array weak-key после вытеснения строит свою строку и не заимствует JSON другой записи. Предзаданные маленькие budgets — механическая проверка поведения, не оценка production heap.

В текущем source raw `128 MiB`, metadata `14 MiB` и ranking с JSON `48 MiB` имеют по две **максимальные** retained entries. Если две оценки размера не помещаются, останется одна; добавление JSON может вытеснить второй ranking даже без изменения числа пользователей. Если одна запись вместе с JSON не помещается, compact computation может быть warm, а построение DTO/JSON — повторяться. Это корректное поведение данных, но возможный источник затрат при чередовании ключей. Raw purpose/spec/scope и metadata sorted eligible-owner IDs также меняют context, даже при совпадающей подписи содержимого.

LRU Map содержит сильные ссылки на retained snapshots. Weak admitted/enriched/prepared metadata Maps не удерживают свой ключ самостоятельно; их значения и readonly getter closures добавляют память, пока ключ доступен через retained entry или активный запрос. Weak result-array → key не является отдельным presentation retention. Synchronous ranking read/serialize не имеет await внутри собственного store/eviction; cache hit восстанавливает кандидатов из текущего массива. Межзапросный ABA guard для асинхронного raw/metadata загрузчика сохраняется.

Добавленные private diagnostics регистрируются только при `SIGNAL_LOAD_PROFILE_DIAGNOSTICS=1`, не имеют HTTP endpoint и не попадают в DTO. Их `retainedEstimatedBytes` — та же приблизительная оценка retained entries, не общий WorkingSet. `peakInflight` считает только первичные miss-promises, помещённые в inflight Map: собственные загрузки после ABA mismatch и предварительные fresh fingerprint SELECT в эту цифру не входят. Он не измеряет всю конкурентную работу SQL, активные ответы или верхнюю границу памяти. Публичные счётчики не заменяют отдельный actual profile/SLA владельца stand.

## Shared accessors checkpoint — 21:36 UTC

После actual CPU profile владелец заменил отдельные getter closures каждой строки двумя общими accessors. Каждый frozen view теперь хранит две primitive millis в собственных non-enumerable, non-writable, non-configurable Symbol properties. Shared getter читает scalar своего receiver и создаёт новый Date; scalar отсутствует в JSON. Быстрый spread заменяет создание descriptor object для каждого обычного поля. Nested массивы/JSON продолжают замораживаться, а traversal freeze пропускает два date-поля и не создаёт временные Date ради обхода.

[Девять независимых tiny-контролей](../outputs/verification/assessment-purpose/performance-cache-independent-review.json) — PASS, 21:36:39 UTC; readonly source hash до/после исполнения совпал. Новый девятый проверяет разные даты двух строк и NULL третьей через настоящий warm pool cache: изменение исходных Date и Date первой строки не меняет вторую, следующая выдача первой остаётся исходной, JSON точно содержит только публичные даты и NULL. Предыдущий eight-check receipt сохранён в history. Это проверка semantics accessor reuse; снижение CPU/heap и новый нагрузочный прогон подтверждаются владельцем отдельно.

| Shared-accessor checkpoint файл | SHA256 |
| --- | --- |
| signal-readonly-resume.ts | 55e28a7bac3fb1799af6fd1b7c36053032618db56d1aca9dff14d5ff8495cddb |
| signal-fresh-ranking-cache.ts, включая private entrySizes counters | 096ec848629b45752ee20a6ed5607a3648ccc0d1b5f9bd0c79689ad30c836e72 |

Функциональные stage/fresh результаты разделов выше относятся к их прежним source snapshots. После этой оптимизации нужны согласованный freeze, новый runtime и повтор функциональной/архивной/нагрузочной приёмки; девять pure-контролей их не заменяют.

## FIFO, UTF16 и owned timestamps — 21:47–21:48 UTC

Теперь actual load/decode/freeze/store сериализованы FIFO gate **внутри каждого** FreshJsonPoolCache. Raw и metadata — разные instances, поэтому это не один общий builder на весь процесс. Если caller ожидал либо увидел ABA mismatch, production raw/metadata callbacks выполняют его собственный complete current fingerprint SQL с теми же predicates/context. Только точное совпадение с retained содержимым разрешает reuse. В отсутствие callback builder выполняет собственный snapshot load; старый preflight не применяется для повторного разрешения доступа после ожидания. Permit освобождается в finally при load/refresh ошибке. Первоначальные fingerprint SELECT, активные callers, returned rows, ranking и response buffers не входят в этот ограничитель; общий heap всё ещё не ограничен 190 MiB.

Professional JSON и временная compact serialization теперь оцениваются `UTF16.length × 2 + 64`; compact по-прежнему добавляет 256 bytes/person, cap ranking остаётся 48 MiB. Worst-case two bytes/code unit относится к payload **строки**, включая Cyrillic/surrogate pairs. Compact nested object graph остаётся приближённой оценкой, не строгой верхней границей heap. Raw/metadata estimates не изменены.

Eligible owner IDs повторно используются только у frozen array factory-owned readonly views, с default DB/immutable rubric cache. Private WeakSet marker отличает такой view от произвольного Object.freeze(Date), whose internal slot остаётся изменяемым. Enrichment reuse тоже требует ownedSource. Injected reader и nonowned/default inputs сохраняют fresh route; age bands читают captured primitive только у маркированных views и всё равно сравнивают с текущим временем каждого вызова.

[12 независимых pure-контролей](../outputs/verification/assessment-purpose/performance-cache-independent-review.json) — PASS, 21:48:45 UTC; [retention 3](../outputs/verification/assessment-purpose/performance-cache-retention-independent-review.json) повторно PASS после UTF16/FIFO. Новые проверки показывают 8 pending callers / 7 waiting / 1 actual FIFO builder в одной cache instance, собственный queued current hash при исчезновении/смене reviewer context, собственный ABA refresh и snapshot C вместо старого B. Отдельный actual freshRankingKey-контроль наблюдает изменение internal slot произвольного frozen Date, сохраняет factory-owned scalar и заново вычисляет 30-day boundary.

Первый прогон после FIFO имел [FAIL устаревшего scheduling тестовой фикстуры](../outputs/verification/assessment-purpose/cache-fifo-obsolete-fixture-failure.json): он ожидал B до освобождения A, что конфликтует с FIFO. Исправлен порядок fixture await; assertion пустого нового пула и остальные privacy/ABA условия сохранены. БД/HTTP/runtime этим pure-прогоном не менялись, предшествующий PASS сохранён. При review первоначально обсуждён early nonowned-enrichment риск; повторное чтение current `c5276f…` подтвердило, что ownedSource guard уже исправлен владельцем. Актуального blocker по этому случаю нет.

| FIFO/owned checkpoint файл | SHA256 |
| --- | --- |
| signal-fresh-pool-cache.ts | 7b74a17e0f28f026f8f893c291c12c7054e701d03e5c1390e30e98adeb2826fc |
| signal-fresh-ranking-cache.ts | dfb9cc959cbdbd594dbba956b7f942ac049116334ed9838dc26227156ca9422a |
| signal-readonly-resume.ts | c6d77671ce5694e71f98e70eb55b3da76f1c88f097a101ca50c3f3ca999a8de8 |
| assessment-ranking-evidence.ts | c5276f284ff75c1b83cf40c499a2051a3a681df90b57c2b2a35eaa08e12583fa |

Следующие catalogue/override memo изменения, полная нагрузка и финальная HTTP/clean ZIP приёмка — отдельный ещё не подтверждённый этим checkpoint срез.

## Catalogue и equivalent-default checkpoint — 21:55 UTC

Новый pure catalogue memo допускается только для frozen array factory-owned enriched views, без `checkedWithinDays` и без need-mode. Key фиксирует exact filters и scope; page и need ID удалены из filter context на маршруте, пагинация выполняется после вычисления. Need-mode обходит memo и neutral sort, затем использует текущую собственную потребность и исходную role-fit формулу. Photo bytes, page proof, текущие badges/контакты/доступ к потребности в memo не сохраняются. Коррекции дают новую enriched array/fingerprint, поэтому прежде сохранённое вычисление не подставляется в новый snapshot.

Memo имеет одну context entry на weak source-array key. Он удерживает массивы ссылок, ordering/wrappers и безопасные очищенные projections revoked доказательств. Порог estimated derived size 2 MiB и добавочные 96 structural bytes/raw-row внутри прежнего 128-MiB budget — **оценки**, не strict heap limit; активные snapshots и nested projection overhead проверяются actual WorkingSet отдельно. Сам WeakMap не удерживает свой ключ без внешней сильной ссылки.

[Независимый catalogue контроль](../outputs/verification/assessment-purpose/performance-catalog-independent-review.json) — 5 tiny-групп и 13 independently curated фильтров, PASS. Expected IDs заданы отдельно от implementation: целое резюме, SQL + TypeScript не складываются между двумя резюме владельца, unconfirmed/revoked, private/consent, FSP/стаж/формат/photo/ready/salary period+type/search. Exact one-day cutoff и +1 ms, need-mode bypass, different scope, новый correction/opt-out snapshot, изменяемый default input и защита frozen результата проверены отдельно. Это не доказательство SQL membership ACL: оно получено отдельными real SQL/HTTP receipts.

Equivalent default ranking используется только после fresh raw+metadata+age key и сравнения **каждого** requested owner → résumé ID с actual default winners. Любая другая альтернатива, неизвестный/чужой owner или отсутствующий ID остаётся на своём input key/вычислении. [Независимый actual matcher контроль](../outputs/verification/assessment-purpose/performance-cache-independent-review.json) — 13 групп PASS: default winner сохраняет весь ranking/alternatives и exact JSON; другая альтернатива, чужой/отсутствующий owner, текущая correction и age-band переход не используют прежний default. Trial default-cache probe увеличивает private lookup-hit счётчик даже при последующем отказе equivalence; `hits` поэтому не всегда означает served reuse.

| Catalogue/equivalent checkpoint файл | SHA256 |
| --- | --- |
| signal-catalog-computation.ts | 64f2fc6b7c14e73d93b3ab166ce8b1eef6fd346f3cbb8b1bc9777c689a25b10a |
| signal-candidate-bank.ts | 0e04b091ce99067781ee5592b42f3b3dc627bb3ff9f3540a25cd1aade23770e2 |
| signal-fresh-ranking-cache.ts | 6a2ddfa0a22931a13c07623b09343026201a2f9719d8441d8bfa49156c0ed35f |
| signal-resume-matching.ts | cf3ca26e48d813785030eb60d7e7cafaf96dba56006117404ce565d46ed1303a |

Актуального semantic/ACL blocker по этим pure helpers не найдено. Конечный SLA, runtime restart, полный функциональный прогон и clean ZIP по этому source snapshot по-прежнему выполняются отдельно.

## Функциональный freeze после оптимизаций, 22:08–22:14 UTC

[53 API-группы stage и 23 отдельной fresh-БД](../outputs/verification/assessment-purpose/api-functional-final-53-plus23.json) реально повторены после перечисленных cache-оптимизаций и PDF-правки: PASS. Проверены квалификация/immutable purpose, все целевые CRUD/PDF/DTO, общий отзыв доказательств, управляемый банк, reviewer scope, профессиональный каталог/matching, приглашение и согласие на контакт, модерация/блоки/апелляции и серверная авторизация. Новые пять audit-участников trust-проверки сохранены с отключёнными правами и закрытыми резюме; остальные точные собственные фикстуры удалены. Старые браузерные состояния не сбрасывались. Это функциональное подтверждение, не нагрузочное измерение.

Реальные PID HTTP: stage `29628`, fresh `30068`. Дополнительный fresh API после проверки закрыт, БД сохранена. [Связь с окончательным candidate](../outputs/verification/assessment-purpose/api-functional-caption-association-v050.json) сравнивает все 464 файла вне frontend: старый реальный runtime и новый native `9040` идентичны; compiled API SHA256 `b778188f7e249fd65b75e42deb05d82c8d7d0ceee6d69aafdc236fd2a57ac54b`. Текущие 567 candidate-файлов соответствуют записи сборки. Единственная frontend-разница — правдивая подпись под PDF-кнопкой, подтверждённая отдельным браузерным протоколом. Отчёт не переименовывает старые PID/время в якобы HTTP-прогон нового runtime.

[Собственный PDF-контроль](../outputs/verification/assessment-purpose/resume-pdf-source-final-v050.json) дополнительно подтверждает по одному фактическому открытию Regular и SemiBold **в каждом** из двух новых `PDFDocument`, 1+4 страницы, Unicode/геометрию/ссылки/раздельное содержимое и просмотр всех пяти PNG. Новый renderer использует только штатные document-local font paths, глобально изменяемого parsed font/subset/PDF кеша нет. Эта проверка не измеряет выигрыш по времени или p95; full warm30+measure180 и clean ZIP остаются отдельными результатами владельцев стендов.

## Полная отдельная нагрузочная приёмка, 22:16–22:26 UTC

Владелец отдельного стенда выполнил [реальный FULL-прогон](../outputs/verification/multi-resume/load-comparison-3ec97baaf321.json) — **PASS обеих фаз**; SHA256 отчёта `4c4d65c8da3e8ef6d25e4c8412c07f0c5a3dfca36965a8212781bd855801eba2`. [Заключительный контроль исходников, сборки, телеметрии и очистки](../outputs/verification/multi-resume/load-final-acceptance-3ec97baaf321.json) — PASS, SHA256 `c21fa66fc5ab658397775c335d030a2384d8087e1eb9e19dc3c7c22b7ba6daf7`. Содержимое и оба хэша прочитаны при независимом review. Это измерение штатного compiled bundle `b778188f…` / candidate `ed894ab4…` на отдельном **native Windows API PID 29468**, PostgreSQL `signal_resume_load_check`, порт API `4315`. Наш stage `9040` в этой нагрузке не участвовал; результат не является измерением Docker-memory, production capacity или официального качества ФСП.

Каждая фаза: те же 5 000 синтетических людей и по одной исходной попытке, сначала одно, затем пять резюме; 16 работодателей, 32 сессии; 30 секунд прогрева, 180 секунд измерения (реально 181,278 / 181,215 с). Выполнено 8 142 / 5 740 запросов, ошибок 0 / 0. В обеих фазах сохранены исходные попытки, дата/порядок/дедупликация выдачи и data/source hashes. Все маршруты выполнили минимум 50 запросов, p99 ≤5 000 мс; получено по 38 валидных native samples. Оценочные бюджеты кешей остаются оценками удержания; фактический native peak расширенной фазы — 704 311 296 bytes (671,7 MiB, или 704,3 MB), ниже заранее установленного 1 GiB. Это не превращает оценку кешей в общий жёсткий лимит памяти процесса.

| p95, мс | 1 резюме | 5 резюме | Заранее установленный предел |
|---|---:|---:|---:|
| Каталог | 794,48 | 1 230,60 | 1 500 |
| Matching | 904,22 | 1 300,46 | 1 500 |
| Объяснение | 990,20 | 1 412,71 | 1 500 |
| Профиль | 726,26 | 1 034,95 | 1 500 |
| PDF | 1 375,80 | 1 829,00 | 2 000 |

Более строгий дополнительный ориентир 1 000 мс для JSON небольшой нагрузки расширенная фаза не выполнила; PASS относится к исходным явно записанным пределам 1 500/2 000/5 000 мс. По точному ownership удалены все 5 016 новых load-участников, remaining 0; проверочный PID `29468` затем остановлен, порт `4315` свободен. Исходник приложения после этого не менялся. Предыдущие FAIL и короткие diagnostics сохранены и не заменяются этим результатом. Чистая сборка/приватность/комплект и Docker-запуск проверяются координатором отдельно: данная ссылка их не объявляет пройденными.

## Последующая переносимая штатная сборка, 22:52–23:02 UTC

Прежние результаты `b778188f…` / PID `29468` сохраняют своё фактическое время и scope. Чистый запуск `c899` затем выявил source-drift/переносимость; его FAIL не удалён и не превращён в PASS. Исправлены только build-слой `build.mjs` и новый `build-portability.mjs`; алгоритм, квалификация, privacy/ACL и PDF-исходник остались побайтно прежними. [Версионированная association](../outputs/verification/assessment-purpose/api-functional-portable-build-association-v050-3ada3096.json), SHA256 `17d2bcb1c5f3960705d650d816f56b2fbdb8f7884c838677f37452d17f99f793`, фиксирует точное совпадение всех 464 прежних backend runtime hashes и текущих 568 candidate-файлов, две явные build-дельты и новое самостоятельное бинарное покрытие. Старые source-runner 53+23 не названы исполнением новой сборки; actual PID `29628` / `30068` и исходные протоколы не менялись.

Штатный compiled API `3ada309626da44b40f545d1f090ada5aed1bd2287361ae16d536d2db6d20aeb3` / candidate `f4bc063b47fa738d4bfc061805d31da26b30cc4e2ace6d963343d5afedb21ca0` получил [7 actual portability/Pino worker проверок](../outputs/verification/multi-resume/build-portability-3ada3096.json), [17 actual HTTP](../outputs/verification/multi-resume/cache-http-899eadc5e263.json) и [34 actual SQL](../outputs/verification/multi-resume/sql-acceptance-2ff072bdc3a2.json) — PASS. [Новый FULL](../outputs/verification/multi-resume/load-comparison-cf5f76e84655.json) — PASS, SHA256 `67086397c7e12f602d5dfe4a2d13879cde3ff4a31310fe463731e01517a16bc0`; [source/telemetry/cleanup/stop контроль](../outputs/verification/multi-resume/load-final-acceptance-cf5f76e84655.json) — PASS, SHA256 `fec35ad248048991114ae3efecca75d2d23a829b159cf3b0edf0e7f19cfe94f8`. Все указанные отчёты прочитаны, их exact SHA сверены перед новой association; это review фактических протоколов владельца, не ещё один самовольно запущенный benchmark.

Native Windows API PID `8856`, отдельная `signal_resume_load_check`, 32 сессии; warm30+measure180 на каждой фазе реально 181,125 / 181,284 с. Запросы 8 525 / 6 446, ошибки 0 / 0, по 38 валидных samples; исходные попытки, данные, source hashes, полный порядок и дедупликация сохранены. Native sampled peak: 404 893 696 / 677 511 168 bytes, оба ниже 1 GiB. Все маршруты имеют ≥50 запросов и p99 ≤5 000 мс. Контроль точного ownership очистил 5 016 новых участников до remaining 0, отдельно подтвердил prefix 0 и остановку PID `8856`/свободный порт `4315`. Stage `9040` не измерялся и не сбрасывался.

| p95, мс | 1 резюме | 5 резюме | Предварительный критерий |
|---|---:|---:|---:|
| Каталог | 722,74 | 1 126,36 | 1 500 |
| Matching | 797,57 | 1 097,55 | 1 500 |
| Объяснение | 899,88 | 1 241,09 | 1 500 |
| Профиль | 682,31 | 855,17 | 1 500 |
| PDF | 1 220,19 | 1 501,87 | 2 000 |

Дополнительный ориентир 1 000 мс для расширенных JSON всё ещё не является выполненным общим критерием: например, каталог/подбор/объяснение выше него. PASS относится к заранее установленным 1 500/2 000/5 000 мс, а не к обещанию защиты памяти кешем или production capacity. Это native working set, не Docker-memory. **Проверка окончательного source ZIP/Docker/privacy/материалов на момент данной pre-seal записи — PENDING**; будущая actual clean-приёмка передаётся отдельным post-seal companion, без переписывания этой включаемой записи. Новая сборка не вводит человеческий пилот и не меняет отдельно обозначенную текущую политику ФСП.
