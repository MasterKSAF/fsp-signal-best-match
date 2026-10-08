# Signal — срез коррекции C01–C06, 8 октября 2026

Подготовлен новый проверяемый срез после независимой приёмки c19. Точечные изменения завершены; **общий независимый PASS и готовность конкурсного выпуска не заявлены**. Сборка и проверки функций проходят. Единственный разрешённый новый нагрузочный прогон сохраняет FAIL по времени подбора/объяснения, а C03 сохраняет одну ошибку заранее замороженной авторской метки. Старые результаты и отрицательные квитанции не перезаписываются.

Рабочая копия: `C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008`. Новый [каталог доказательств](../../outputs/verification/correction-01-20261008/). Предыдущий [отчёт A01–A11](../full-audit-a01-a11-20261008/report.md) относится к c19 и остаётся историческим.

## Что исправлено и фактически проверено

| Коррекция | Результат | Доказательство и граница |
|---|---|---|
| C01: два поверхностных ключа Frontend Junior | У двух семейств убран универсальный второй ранг длины. Смысл, пороги, lineage/exposures и история сохранены. | 20 параметрических вариантов и 11 focused tests; один финальный ограниченный контроль банка. Остатки SQL/TypeScript/shortest раскрыты в [bank/report.md](../../outputs/verification/correction-01-20261008/bank/report.md). Это не гарантия отсутствия всех подсказок. |
| C02: содержательно ошибочные ответы в допустимом формате | Semantic statement отделён от wire response; 44 Middle A encoding исправлены. Семь замороженных моделей ошибок проверены через штатные rubric/critical/category gates. | 324 ключа, 504 module / 252 category decisions, 0 расхождений с замороженными метками. 24 валидно оформленных неверных ответа отклонены rubric, 15 из них critical. Старые omission-профили честно названы format-control. |
| C03: qualification → целое CV → matching | Проверены реальная проекция, обязательный стек, trusted Demo-FSP, ID-only/revoked/other-category и сравнимость legacy scores. Веса и старый corpus сохранены. | 0 admission/selected-CV/catalog ошибок, ordering 5/5, FSP ablation 2/2; **frozen verdict FAIL** из-за одной авторской метки. [Отчёт](../../outputs/verification/correction-01-20261008/matching/report.md), [final receipt](../../outputs/verification/correction-01-20261008/matching/final-receipt.json). |
| C04: измеряемое сокращение повторной работы | Request-local projection, reuse одинаковых derived arrays, page enrichment без повторной qualification SQL, свежие ANY(int[]) loaders. | 41 focused tests, полный current core и один новый bounded load. Catalog p95 PASS; matching/explanation p95 FAIL. [Профиль](../../outputs/verification/correction-01-20261008/performance/report.md), [нагрузка](../../outputs/verification/correction-01-20261008/performance/single-retest-report.json). Дальнейшей настройки/нагрузки не было. |
| C05: честный и компактный интерфейс | Объяснения работодателю перенесены в disclosure + i. Необязательный опрос рекомендует стартовый уровень; CTA «Проверить навыки». Язык CV выбирается явно. | [7 targeted UI checks](../../outputs/verification/correction-01-20261008/ui/targeted-ui-checks.json), реальные обычные QA-аккаунты. Панель требований в свёрнутом виде 75 px; coverage при раскрытии сохранено, tooltip/Escape/outside click проверены. |
| C06: фактические инструменты, сборка и provenance | Декларируемый и реально используемый pnpm11.25.0 совпадают; чистая установка, полный build и новые отдельные manifests. | [Install](../../outputs/verification/correction-01-20261008/package-manager-install.json), [outer/nested execution](../../outputs/verification/correction-01-20261008/package-manager-execution.json), [build](../../outputs/verification/correction-01-20261008/clean-build-final.log), manifests ниже. Docker и конкурсные медиа сюда не входят. |

## Банк и B4: версии, ошибки и пределы

Текущий банк — `signal-skills-2026-10-v6`, редакция `correction01-v2`. Это редакционная коррекция двух существующих семейств, а не новая материальная lineage. Ответы старых попыток, corrections, disabled aliases и thresholds не переписывались. Первая редакция v1 и её отрицательные surface результаты сохранены отдельно; v2 устраняет конкретные наблюдавшиеся ключи, не заявляет слепой выбор дизайна.

В ограниченном контроле Frontend Junior rank2 дал21/240 против random27; historical same-seed control48/240 против31. Остаточное shortest35/240 против27, SQL Junior rank3 39/120 против32, SQL Middle20 против8, TypeScript Junior longest65 против62 раскрыты. Результаты независимого holdout и этих controls используют разные выборки и не подменяют друг друга. Это условные синтетические атаки, где открытые ответы могут быть заранее верны, а не доля реальных участников без знаний.

Содержательные ошибки выводятся из заранее описанных моделей: например, локальный фильтр вместо владения состоянием, replacement batching, row-CAS вместо межстрочного инварианта, прежняя validation при новой schema/generation. Из21 затронутой работы15 FAIL и6 разрешённых noncritical PASS; единственная noncritical ошибка не обязана проваливать категорию. Повторные168 module /84 category groups согласованы. Одна фиксированная ветка n5 для error models не доказывает все параметрические ветки или человеческую калибровку.

C04 позже изменил только две SQL-выборки в `skill-module-service.ts`. Поэтому старый bank source ledger v2b не переименован в current: отдельный [C04 binding ledger](../../outputs/verification/correction-01-20261008/bank/bank-source-revision-c04-v1.json) сохраняет29 остальных hashes, [один stateless replay](../../outputs/verification/correction-01-20261008/bank/b4-results-c04-binding-v1.json) подтверждает полное равенство decisions/scores/coverage с v2. [Clarification](../../outputs/verification/correction-01-20261008/bank/b4-c04-binding-clarification-v2.json) отличает неиспользуемый корневой dist45e2 от реально запущенных clean/user204583. SQL/HTTP не проверяются stateless B4.

## Matching: сохранённое расхождение метки

Синтетический supplement содержит23 владельца,24 CV,66 modular receipts,4 полных экзамена,4 запроса и92 pointwise labels. Метки заморожены до первого evaluator. Использованы штатные `getSkillQualification`, `withResumeSkillEvidence`, modular projection и ranker; arbitrary numeric Grade не назначался.

Авторская метка CV10240 ожидала null после отзыва Middle-экзамена. Действующие Junior-модули независимо дают Junior; штатные qualification-функции согласованы. Отозванный Middle не возвращён, в Middle-подбор CV не допускается. Ошибка прогноза сохранена, labels не подогнаны после результата. Итоговый frozen verdict остаётся FAIL и отделён от 0 фактических ошибок допуска/выбора CV.

Trusted синтетический Demo-FSP даёт bonus3, ablation меняет порядок в обеих специализациях внутри категории. ID-only и revoked источники bonus не дают; Senior category block сохранён. Legacy scores100/83 сравниваются только в общей v6 программе/рубрике; другая версия уходит в отдельную очередь. Модульной категории общий сравнимый score не присваивается. Это не реальное подключение ФСП, человеческий пилот или измеренная точность найма.

## Единственная нагрузочная перепроверка C04

Профиль подтвердил сокращение repeated derivation: legacy qualification1500→500, одинаковые modular arrays1500→500, extra whole-row copies1500→0, qualification SQL для page2→0. Before counts следуют сохранённому per-CV loop, after — измеренным counters. Нового межзапросного cache/TTL и кэширования ACL нет. Девять последовательных samples не доказывают p95 под конкуренцией; в representative pool нет submitted legacy attempts/фото, поэтому их стоимость не объявлена найденной причиной исторической задержки.

После новой сборки и current core выполнен **ровно один** прогон: те же500 собственных QA-кандидатов,1500 CV,750 modular attempts,32 работодателя/запроса;32 sessions,10s warmup +30s measure,250ms think, прежний mix и thresholds. Старые sessions истекли: добавлены32 sessions тем же актёрам, права/длительность1h не расширены; новых пользователей/CV/attempts/needs нет. Данные остаются только в отдельной audit DB.

| Маршрут | c19 p95, ms | Новый p95, ms | Неизменный внутренний порог | Итог |
|---|---:|---:|---:|---|
| Matching list |2666 |2004 |1500 |FAIL |
| Explanation |2702 |2059 |2000 |FAIL |
| Catalog |2420 |1336 |1500 |PASS |

568 измеренных запросов,0 HTTP/timeout ошибок; peak working set633438208 bytes (около604MiB), ниже1.5GiB. Общий latency verdict **FAIL**. Это собственные критерии данного сценария, не официальный SLA ФСП. Старые FAIL, первый after-profile без заметного улучшения, preflight errors и текущая отрицательная квитанция сохранены. После нового прогона оптимизация и повтор нагрузки остановлены.

## Сборка, current core и UI

- **501/501 tests PASS**,0 fail/cancel/skip/todo: [full-tests-final.log](../../outputs/verification/correction-01-20261008/full-tests-final.log). Полный typecheck libraries/API/frontend/scripts и оба builds PASS. Старые486 tests относятся к c19 и не переписаны.
- pnpm фактически11.25.0 через `corepack pnpm`, в outer и вложенном запуске. Первая offline установка получила `ERR_PNPM_NO_OFFLINE_META`; её [отрицательная квитанция](../../outputs/verification/correction-01-20261008/package-manager-offline-failure.json) сохранена. Следующая online frozen-lockfile установка прошла с638 supply-chain policy entries; lockfile hash и policy configuration сохранены. Host fallback pnpm11.19 не назван фактическим инструментом новой сборки.
- Новый [current core HTTP](../../outputs/verification/correction-01-20261008/integration/current-core-http.json):12 групп PASS,4 собственных QA-актора и7 экспортов. Реальные module submissions→Junior matrix→целое CV→matching→invitation→grant/revoke→documents/privacy/stats/5-CV. Oracle-assisted механическая сдача не объявлена человеческим экзаменом.
- Остались прежние build warnings: два sourcemap warnings tooltip/dropdown и chunk>500kB. Exit0; размер chunk не выдан за runtime failure или performance PASS.
- Пять пользовательских UI-правок проверены на обновлённом user4372: [receipt](../../outputs/verification/correction-01-20261008/ui/latest-user-ui-checks.json). «Сохранить изменения» слева от «Создать резюме», обе кнопки y72 при scroll3139; без редактора/dirty state сохранение честно disabled. Удалён editorial comment. «Без отклика» уменьшает выдачу6→5; «Не заблокированы» применяет текущую account block фильтрацию. Иконки Pearl получили заметные цветные strokes. В Graphite основное поле rgb(17,19,24), header/sidebar rgb(34,37,43).
- [Скриншот плавающих действий](../../outputs/verification/correction-01-20261008/ui/updated-user-sticky-save.png), [светлые фильтры](../../outputs/verification/correction-01-20261008/ui/updated-user-light-vacancy-filters.png). Предыдущая широкая 4-theme/mobile матрица сохранена; её72 страниц не перепроверяли заново. Targeted UI на новой4394 дополняет её. Тестовые фильтры и исходная Graphite тема user восстановлены; лишняя QA-вкладка закрыта.

## Точная версия и передача

Обе реально запущенные API используют SHA256 **204583be673763bbe494a8634b7991518a7b1980f8f5c5f2ef712285a40a3f40**:

- clean API4393, восстановленный PID36488: `outputs/verification/correction-01-20261008/clean-workspace/artifacts/api-server/dist/index.mjs`; clean UI4394, PID45748. Core/load были выполнены на PID12732 с этими же immutable bytes, не на восстановленном PID.
- user API4371, восстановленный PID20696: `outputs/runtime/ui-refinement-correction02-iteration01/dist/index.mjs`; user UI4372, PID43352. Первое переключение было на PID38720, UI17556. Проверяемый веб: [Мои резюме](http://localhost:4372/candidate/resumes).
- Историческая clean c19 API4383/UI4384 сохранена отдельно, старые immutable bundles/manifest bytes не заменены. Защищённые4313/4314 не запускались и не останавливались. [Guarded user upgrade](../../outputs/verification/correction-01-20261008/user-runtime-upgrade.json) заменил только собственную API4371; пользовательскую DB/миграции он не менял.

При финальном manifest preflight после границы сеанса отсутствовали все шесть собственных native listeners. [Отрицательная квитанция](../../outputs/verification/correction-01-20261008/manifest-preflight-runtime-loss.json) сохранена; точная внешняя причина остановки не установлена. Восстановлены только те же собственные stand paths/env/bundle bytes. [Recovery receipt](../../outputs/verification/correction-01-20261008/runtime-recovery-final.json) проверяет новые PID/path/SHA, health200 всех трёх API, exact-owned `/me`200, SELECT-only audit DB и15 миграций. Новый core/load/миграции не выполнялись. Исторические4383/4384 восстановлены как c19 PID11668/18600; прежние test/load/UI квитанции относятся ко времени до восстановления и не объявлены новым прогоном. Ошибка literal UI guard из-за кавычек Windows shim также сохранена отдельно. Повторное открытие локальной вкладки после восстановления отклонено URL-политикой инструмента браузера; прежние UI receipts/screenshots сохранены, нового browser verification не заявлено.

Отдельные [source manifest](../../outputs/verification/correction-01-20261008/source-manifest.json), [runtime manifest](../../outputs/verification/correction-01-20261008/runtime-manifest.json), [evidence manifest](../../outputs/verification/correction-01-20261008/evidence-manifest.json), [clean source manifest](../../outputs/verification/correction-01-20261008/clean-source-manifest.json) закрепляют final copy, actual pnpm,15 миграций и runtime/build hashes. Точный состав и counts читаются из них; чувствительные private env/actor/session ledgers в пакет не копируются. Финальный sync precedes manifests, далее manifests копируются в clean evidence напрямую.

Этот срез готов для следующей независимой проверки с раскрытыми ограничениями. Релиз/commit/push/облако/Docker/презентация/ролик/архив здесь не выполнялись. Гарантия первого места, реальная калибровка, external ФСП/SMTP/ATS и official numeric SLA не заявляются.
