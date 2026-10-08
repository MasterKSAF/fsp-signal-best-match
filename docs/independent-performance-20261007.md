# Отдельная проверка производительности 07.10.2026

Это локальная синтетическая проверка на прежнем профиле. Лимиты1500мс JSON /2000мс PDF (p95),5000мс p99,0ошибок и1GiB native working set не являются официальным SLA ФСП или оценкой промышленной ёмкости. Прежние отчёты, данные и метки сохранены.

## Стенд и контроль до изменения

Новая собственная БД `signal_independent_load_20261007` (OID243376), отдельный API4369, PostgreSQL127.0.0.1:55435. Общая stage/рабочая БД и процессы не используются. Лаунчер проверяет точное имя контейнера, loopback binding, OID, PID/StartTime/command entry, полный набор11dist-файлов, собственные harness-исходники и неизменный payload. Останавливает только принадлежащий manifest процесс. Cleanup проверяет все свои ID и exact prefix перед удалением. `seed/reset` не выполняется.

До изменения фактически измерена копия **штатного** исторического `index.mjs` e72fc99a9c9177461c10d0c853b3148d78440d90a08e4424ffeec04724ac5793 и10adjacent assets. Это не текущий tsx-сервер и не пересборка прежней версии. Associated sources относятся к историческому бинарнику; совпадение всех этих исходников с сегодняшней рабочей копией не заявляется.

Сценарий:5000людей, по одному неизменному attempt и одному CV, затем те же люди/attempts с пятью CV;16работодателей+16кандидатов/32сессии; по30с прогрева и180с измерения каждой фазы; think100мс/timeout10с. Чтение полного ответа входит в latency. Тот же deterministic seed, распределение направлений/грейдов, потребность и условия. Для обеих версий применяется **один** private payload шести старых форм из frozen ZIP9258, SHA826e82559cd5972a0b03d5d7fae8c8d2e9fa31313b9336642eca81e7fa4b1109. Текущий изменённый банк v7/v3 не подменяет старые фикстуры. Oracle-based synthetic construction — не прохождение экзамена человеком и не проверка обучения.

Actual before: `outputs/verification/independent-performance-20261007/load-comparison-500446377eb1.json`, SHA c57590b9f33862d51d90f7767d916a8be7a26b0a37eca163430c80881d2150e3. Обе фазы PASS:8908/5883запроса,0ошибок,181.08/181.02с,38валидных samples каждой фазы. Expanded explanation p95/p99=1462.43/2238.49мс; peak706195456bytes. Exact cleanup5016→0. Inspector/profiler/preload отсутствовали в acceptance runtime.

## Измеренная причина и узкое изменение

Отдельное диагностическое профилирование выполнялось на прежнем binary с тем же expanded-пулом и32workers. Его15с measured-phase **не** объявлена acceptance. Raw CPU profile хранится приватно. Public summaries: `cpu-expanded-71645c9f29ac.json` и `cpu-expanded-5b40c35ced92.json` в той же verification-папке. Первое окно CPU25.647с охватывает прогрев и служебные границы фазы, но исключает seed/cleanup.

Независимое source-map чтение первого профиля выявило3202.8мс inclusive в ranking-cache module, в том числе повторные candidate Map и freshness bands;1525.8мс self UTF8 encoding большого `/matches` body. Inclusive семейства пересекаются, их нельзя складывать как отдельные доли. Raw builds/enrichment наблюдались в начале окна и отсутствовали после15с; счётчики второго окна сохраняли два raw entries/126055304estimated bytes в прежнем128MiB budget. Постоянный raw-cache thrash этим не доказан; raw query/cache budget не менялись.

Изменены только вычислительные/transport участки:

- При exact factory-owned immutable array сохраняются числовые offsets, а не кандидатские объекты; weak source и private default-owner index позволяют восстановить одно выбранное default CV без полного результата. Для другого CV, неизвестного владельца или другого массива сохраняется прежний full fallback. Позиция остаётся порядком полного пула.
- Один weak age-band memo действителен только до ближайшей точной границы30/90/180дней. Возврат часов назад/другой источник пересчитываются. Хеш ключа байтово соответствует исходному tuple; нынешние pool/evidence/scope/need/override fingerprints остаются обязательными.
- Private UTF8 buffer заменяет строковый `/matches` facet. Сам buffer не имеет публичного getter; Express send сохраняет JSON bytes, Content-Length, ETag, HEAD и conditional behavior. Роли, owned need и текущие SQL-права проверяются до использования body.

Индексы, offsets, bands, compact data и body учитываются в прежнем48MiB estimate. Raw128MiB/metadata14MiB и native1GiB критерий не увеличены. Это оценка retention, не вся память SQL, HTTP, V8 и активных запросов.

Actual targeted:28PASS,0fail, включая boundaries/rollback/nonowned mutable Date, current-owner fallback, full-pool ordinal/alternatives, foreign/default/evicted-key и actual Express UTF8/ETag/HEAD/no-store. Initial failure маленькой budget-фикстуры сохранён отдельно; её граница вычислена из фактически учитываемого compact footprint. Два первоначальных startup-only FAIL также сохранены; фикстуры/HTTP-нагрузка в них не запускались.

## Текущая сборка и HTTP-контроль

Новый штатный binary 0.6.1 имеет SHA78b798efdcf9c130655eebb7c1d65a05cd9f0c73913db6ccca7162109b95021d; root build/typecheck и327unit PASS. На отдельном API4369 фактически выполнены17коротких HTTP-проверок свежести/ACL с exact cleanup3→0: `cache-http-f89fc6345eab.json`. Проверены полный JSON, default winner и full-pool position, role/session/owned need, title без изменения revision, hide/restore/optout, score/date/verification/correction и block-action. Это короткая проверка нынешнего банка, отдельная от неизменного сравнительного perf payload.

На окончательно зафиксированном процессе повторно выполнены те же17проверок: [cache-http-3e64e2ac7242.json](../outputs/verification/independent-performance-20261007/cache-http-3e64e2ac7242.json), SHA09162e769e57a1d5d2476860d3aaad01f517d984975c07d1ffcbca6065766076; cleanup3→0. Их непосредственный HTTP-охват — matching JSON/default DTO, каталог и перечисленные проверки доступа/инвалидации. Explanation, границы age bands и альтернативные CV дополнительно проверялись отдельными targeted unit controls; их нельзя приписывать этим17HTTP-assertions.

## Завершённые полные замеры

После root GO выполнены два полных прогона текущего **штатного** binary78b, каждый с исходными5000людей,1→5CV,32сессиями и30/180секундами на каждую фазу. Профайлер/inspector отсутствовали. Второй прогон — единственный заранее ограниченный повтор: первый explanation p95≥1200мс и выигрыш≤20% активировали описательный критерий разброса. Третьего прогона, изменения профиля или подбора порогов не было.

| Expanded маршрут | Before p95 / p99, мс | Current1 p95 / p99, мс | Current2 p95 / p99, мс |
|---|---:|---:|---:|
| Каталог |1323,94 /2169,89|1128,87 /1384,06|1075,70 /1512,63|
| Matching |1196,99 /1550,93|1009,54 /1384,58|999,77 /1234,61|
| Explanation |1462,43 /2238,49|1245,09 /1593,27|1133,35 /1458,83|
| Профиль |1018,13 /1326,53|755,15 /993,41|707,67 /886,93|
| PDF |1867,53 /2792,21|1390,68 /1684,21|1313,88 /1784,91|

Оба current-прогона прошли неизменные локальные критерии, ошибок0. Expanded:5883before-запроса против7144/7301current. Это рост пропускной способности закрытого цикла32сессий, а не уменьшение количества работников или исключение медленного маршрута. Для explanation наблюдаемый выигрыш p95=14,86–22,50%; диапазон двух current p95=1133,35–1245,09мс, p99=1458,83–1593,27мс. **Худший измеренный запас255мс** (254,91мс/16,99% от1500), против37,57мс в новом before и14,82мс в исходном историческом контроле. Это заметный наблюдаемый запас на данном стенде, без гарантии промышленного SLA или статистического доверительного интервала.

Expanded working set:706195456bytes before,641118208/613711872bytes current; приблизительно673,5MiB против611,4/585,3MiB. Средний процессный CPU:118,84% одного логического ядра before против100,02/102,08% current; host-normalized значения делятся на12логических CPU. Это native Windows WorkingSet64 с пробами раз в5секунд, не Docker RAM и не непрерывное измерение пика.

Ухудшения сохранены. В фазе1CV первый current p95 превышал before по всем пяти маршрутам; второй был быстрее. Порядок catalogue/matching/explanation/profile/PDF:

|1CV p95, мс|Каталог|Matching|Explanation|Профиль|PDF|
|---|---:|---:|---:|---:|---:|
|Before|720,49|755,91|847,50|665,33|1175,23|
|Current1|836,35|835,70|996,41|705,88|1346,47|
|Current2|638,65|664,01|765,74|553,21|1005,12|

Фаза1CV:8908before-запросов против8749/10234current; peak414224384bytes против373837824/381743104bytes. Разброс первой фазы не позволяет утверждать универсальное ускорение любого размера пула. Более строгий ориентир1000мс не выполнен для expanded explanation/каталога в обоих current-прогонах; он не подменён обязательными локальными порогами1500/2000.

## Доказательства и границы

- Before: [load-comparison-500446377eb1.json](../outputs/verification/independent-performance-20261007/load-comparison-500446377eb1.json), SHAc57590b9f33862d51d90f7767d916a8be7a26b0a37eca163430c80881d2150e3.
- Current1: [load-comparison-e02ea6048f80.json](../outputs/verification/independent-performance-20261007/load-comparison-e02ea6048f80.json), SHA2bb03c1b39566aebbc55a9aa8ecb0065c25d901a36518c9714fa8986b38d5a3e.
- Current2: [load-comparison-e2d54d4c5302.json](../outputs/verification/independent-performance-20261007/load-comparison-e2d54d4c5302.json), SHAac0c77e38c1b0faaf43bde648659469e1649bde598da607f55c8cc0519cb9614.
- Actual validators: [comparison-after-first-validated.json](../outputs/verification/independent-performance-20261007/comparison-after-first-validated.json), SHA8ad5b2226a3eccc838b8e6fff4cae9a125865c7b82dd8d28fd5236f165eaf583; [comparison-after-repeat.json](../outputs/verification/independent-performance-20261007/comparison-after-repeat.json), SHAb0368229eb5305eb922679a7758ab7b42038796abd6c7b7ef4a3f9613c7340ba.
- Measured source association: [current-build-candidate.json](../outputs/verification/independent-performance-20261007/current-build-candidate.json), SHA059546fd7f51c5ff59cb4d409f810353ca6e6172a0e91ce9de9b5b27b46574fd:946canonical non-MD sources,11normal assets,78actual embedded project inputs byte-verified. Все946исходников повторно совпали после обоих замеров до освобождения окна.
- Predeclared bounded repeat: [after-measurement-plan.json](../outputs/verification/independent-performance-20261007/after-measurement-plan.json), создан14:46:28UTC до current-результатов.

Actual validators подтвердили одинаковые формы/scenario/limits/machine;5000людей в каталоге,3250matching и2500advanced-filter результатов в обеих фазах каждого прогона. По38finite positive/monotonic проб на фазу соответствуют exact owned PID/StartTime; coverage≈181с. Выборочные поля qualification/ACL/identity и source hashes неизменны в каждой измеренной фазе. Это контроль указанного набора полей, а не хеш всех байтов БД. ID-based order hashes сравниваются только внутри каждого прогона: новые serial IDs между версиями не доказывают идентичный порядок. Current-версия содержит отдельные функциональные исправления; сравнение не является причинной абляцией только трёх оптимизированных файлов.

Каждый полный прогон завершился exact cleanup5016→0, error=null; driver дополнительно прочитал нулевой owned-prefix count. Последний собственный API PID30188 остановлен guarded helper с проверкой PID/StartTime/entry/assets; порт4369 освобождён. Общая stage/рабочая БД не использовалась. Все именованные before/current отчёты, первоначальные ошибки и прежние метки сохранены. Архивирование, clean launch и публичная подача в этот этап не входили. Повторные нагрузки завершены.
