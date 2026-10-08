# Signal: итоговый срез исправлений A01–A11

Дата: 08.10.2026. Рабочее дерево: `signal-ui-refinement-workspace-20261008`.

Последние пользовательские правки выполнены. Итоговые 486 тестов, полный typecheck, сборки frontend/API и текущие функциональные HTTP сценарии прошли. **Безусловного общего PASS нет:** A04 сохраняет преимущества отдельных поверхностных стратегий выбора ответа; A10 превышает собственные latency пороги команды. Ограничения передаются на независимую проверку вместе с доказательствами.

Презентация, видео, архив, публикация, Git commit/push и Docker-поставка отложены пользователем и не входят в эту приёмку.

## Последние изменения интерфейса

- «Сохранить изменения» слева от «Создать резюме»; обе кнопки закреплены сверху. Без изменений сохранение отключено, лимит пяти резюме учитывается независимо. Реальное сохранение из нижней части редактора проверено при scrollY4262: обе кнопки на Y72.
- Видимая фраза «Исторический итог без полной связи с критериями. Новые подтверждения и даты не приписываются» убрана. Сохранённые результаты и история не подменяются новыми подтверждениями.
- Короткие фильтры вакансий «Без отклика» и «Не заблокированы» согласованы с поиском, totals и выгрузками.
- Светлые иконки, состояния и акценты усилены. В тёмных темах рабочая область глубже верхней и левой панелей.
- Обнаруженные при реальном проходе цикл анонимной сессии и восстановление предпочтений между вкладками исправлены. Конфликт сохраняет локальный ввод; повторное сохранение отправляет только редактируемые поля.

Доказательства: [две вкладки и sticky save](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/work-preferences-two-tabs-final.json), [1440×900](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/sticky-actions-final-1440x900.json), [обновлённый пользовательский веб](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/user-updated-resumes-graphite.png), [реализация и UI квитанции](ui-implementation.md).

## Итог по пунктам аудита

| Пункт | Результат и изменение | Доказательство и границы |
|---|---|---|
| A01 | PASS в проверенном локальном протоколе. UUID заявки связывает неизменяемые пароль/роль/имя/согласие. Конкурирующая регистрация не активирует чужой пароль; подтверждённые аккаунты и сессии сохранены. | [Auth report](../../outputs/verification/full-audit-a01-a11-20261008/auth/report.md):10 групп реальных HTTP/PG,67 запросов,13 собственных акторов,18 локальных писем;3 focused tests. Внешний SMTP и полный pentest не проверены. |
| A02 | PASS в проверенных сценариях. Fresh/no-store снимок, revision/CAS и query cache согласованы. Конфликт не стирает ввод; явная загрузка обновляет выбранный раздел; восстановленный draft снова сохраняется. | [Живые две вкладки](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/work-preferences-two-tabs-final.json), [UI](ui-implementation.md). В финальном browser случае конфликт выявлен клиентом свежим GET до PATCH, не назван HTTP409. Server CAS покрыт отдельно. Все неудачные UI итерации сохранены. |
| A03 | PASS в проверенном search/export и browser recovery. Нормализация до рендера. Все собственные CV/статусы учитываются для «Без отклика»; блокировки только активные. | [24 группы/80 HTTP/34 CSV-XLSX](../../outputs/verification/full-audit-a01-a11-20261008/job-filters/report.md), отдельная PG квитанция после unblock; [malformed URL](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/jobs-malformed-personal-filters.json). Изоляция другого кандидата и totals/page/export согласованы. |
| A04 | PARTIAL. Содержательные варианты и синтетическая согласованность проверены, сильные целевые подсказки ослаблены. Остаточные public-selector преимущества остаются. | [Банк и 11 фиксированных стратегий](../../outputs/verification/full-audit-a01-a11-20261008/bank/bank-report.md), [provenance](bank-validation-provenance.md). SQL Junior rank3:101/300 против random72; TypeScript Junior longest170 против133; Frontend Junior rank2:63 против34. Порог принятия после результатов не придуман. |
| A05 | PASS в проверенных GET/start/CLI/history/research. Senior React identity содержит дополнительные invariant/ACK/schema решения. Stable bans/exposure сохраняются; новая legacy выдача закрыта, frozen история доступна. | [Live summary](../../outputs/verification/full-audit-a01-a11-20261008/bank/bank-live-final-summary.json):on6/off3 групп PASS. Удалены только временные собственные строки A05, off API остановлен; append-only audit сохранён. Это не очистка core/load fixtures. |
| A06 | PASS в проверенных действиях. Помощник ведёт к актуальным CV, модулям, частному запросу/вакансии; auth-вопросы отвечают про вход. | [UI](ui-implementation.md):focused tests, живой auth-ответ работодателя/маршруты. Локальный информационный помощник, без передачи ПД внешней модели. |
| A07 | PASS в проверенных подсказках. Повторные пояснения перенесены в i; статусы, ошибки, согласия и последствия действий видимы. | Hover/focus/touch/Escape/outside реализация и живой tooltip/Escape в [UI](ui-implementation.md). Обязательные сведения не скрываются глобальным CSS. |
| A08 | PASS в проверенных layout/editing. Sticky toolbar, переход к редактированию, единые заголовки. Помощник скрыт при вводе, диалоге и экзамене. | 72 случая:18 ролевых страниц×4 темы при1280×720, mobile390×844, reflow640×360 DPR2. [Активная попытка](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/active-module-attempt-current.json):6 TypeScript Junior задач/таймер/сохранение, помощник отсутствует; ответов не отправляли. |
| A09 | PASS в проверенных palettes/preferences. Жемчуг/Кашемир/Графит/Полночь, system Жемчуг/Графит. Старые light/dark preferences мигрируют; manual выбор сохраняется. | [Контрасты](../../outputs/verification/full-audit-a01-a11-20261008/ui/palette-contrast-receipts.json), четыре темы/system/reload в [UI](ui-implementation.md). Это целевые checks, не полная WCAG сертификация. |
| A10 | Источники, чистая native установка/сборка, B4, matching/core PASS в указанном объёме. Нагрузка FAIL по собственным latency порогам, итоговые HTTP ошибки0. | [R01–R32](organizer-requirements-current.md), [ресурсы](../../outputs/verification/full-audit-a01-a11-20261008/resources/report.md), [core](../../outputs/verification/full-audit-a01-a11-20261008/integration/after-performance-fix/current-core-http.json). Docker не запускался. |
| A11 | PASS по критической сохранности и выбранной user DB миграции. Исторические формы/immutable API сохранены, документы/контакты проверены. | [898 checks/0 critical failures](../../outputs/verification/full-audit-a01-a11-20261008/preservation.json);2 прежних mutable FE dist различия раскрыты. [До](../../outputs/verification/full-audit-a01-a11-20261008/ui-migration-before.json)/[после](../../outputs/verification/full-audit-a01-a11-20261008/ui-migration-after.json):14→15 миграций/45 signal таблиц; изменилась только signal_verification_tokens. |

## Финальная сборка и функциональная проверка

Fresh install:frozen-lockfile/offline,557 пакетов; Node24.14.1. Фактический pnpm11.19.0 отличается от declared11.25.0.

- [486/486 tests PASS](../../outputs/verification/full-audit-a01-a11-20261008/full-test-final-frontend-and-performance.log),0fail/cancel/skip/todo,21.527s.
- [Полный typecheck и frontend build PASS](../../outputs/verification/full-audit-a01-a11-20261008/clean-frontend-final-complete.log),21.49s/1891 модуль. Vendor sourcemap и chunk>500kB предупреждения сохранены. Assets:index-ByXUgihj.js/index-rH61apqJ.css; PDF viewer загружается отдельно.
- [API typecheck/build PASS](../../outputs/verification/full-audit-a01-a11-20261008/clean-api-after-performance-build.log),3.747s; SHA256:`c19afa3d2f9b29f6153431171658303c82f992fd7e2b5ad09fbafbd9566aee60`.
- [Финальный core:12 групп PASS](../../outputs/verification/full-audit-a01-a11-20261008/integration/after-performance-fix/current-core-http.json),4 новых обычных собственных акторов/7 файлов. HTTP submissions трёх Junior модулей → category matrix-v2 → целый CV/matching → invitation → адресный grant/revoke. Изоляция компаний, PDF/DOCX/JSON после revoke, redaction XML/metadata, no-store/HEAD, preview без stats, download dedup,5CV/selectedCV проверены. Mechanical oracle submissions не подменяют смысловой B4.
- [PDF render](../../outputs/verification/full-audit-a01-a11-20261008/integration/pdf-render-current.json):до согласия/адресный/после revoke по1 странице, кириллица читается, обрезки/наложения не обнаружены. Текущий DOCX проверен по всем XML/metadata; layout заново не рендерился. [Владелец/PDF viewer](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/owner-document-preview-current.json) проверен отдельно.
- [Matching after](../../outputs/verification/full-audit-a01-a11-20261008/matching/after/report.json):nDCG@3=.8993684083,@5=.9504364091;P@3=.7222222222,@5=.7;eligibility/selectedCV/permutation errors0. 24 человека/32CV/12 потребностей/144 labels. До/после одинаковы, ranker/веса не менялись. Прежнее снижение v6 против old rule baseline сохранено как история.
- [B4v5](../../outputs/verification/full-audit-a01-a11-20261008/bank/b4-modular-results-v5-final.json):324 независимых key/vector сравнений,378 synthetic decisions,126 категорий,126 repeat групп/378 пар;TP162/TN216/FP0/FN0. Это согласованность frozen synthetic profiles, не human hiring accuracy/grade calibration.

Matching оптимизирован группировкой свежих доказательств по владельцу и qualification reuse только внутри одного запроса с полным ключом CV/цели. Межзапросного TTL/cache нет. 43 scoped tests и финальный core подтвердили изоляцию и свежесть revoke. Scorer, веса и банк не менялись из-за latency измерений.

## Нагрузка и открытые ограничения

[Заранее зафиксированный план](../../outputs/verification/full-audit-a01-a11-20261008/resources/plan.json):500 synthetic кандидатов/1500CV,32 работодателя/сессии,750 явных клонов собственных module proofs;10s warmup+30s measurement,250ms think. У организаторов нет числового SLA/RAM.

[Финальный повтор](../../outputs/verification/full-audit-a01-a11-20261008/resources/load-report-after-fix.json):416 measured HTTP/0 ошибок; p95 matching2666.08ms, explanation2701.76ms, catalog2420.11ms. Собственные лимиты1500/2000/1500ms не соблюдены. Peak API working set578179072 bytes ≤1.5GiB. Повтор использовал прежние fixtures/сессии, новых строк не создал. Третьего прогона не было.

Первый FAIL и отдельный failed preflight сохранены. Catalog400 происходил из-за неверного harness маршрута /employer/candidates/search, попадавшего в numeric-id handler; финальный маршрут исправлен. Ноль HTTP ошибок не закрывает latency FAIL. Клоны proof не являются человеческими экзаменами, RSS процесса не измеряет всю машину.

Банк v6 сохраняет lineage/exposure/frozen историю. Предварительные exposures, ошибки reference, редакторские итерации и provenance gap точного overwrittenV1 dump раскрыты в [provenance](bank-validation-provenance.md). Не заявлены полностью слепая проверка, полная защита от ИИ/запоминания, human Senior calibration или гарантия победы. A04 остаётся PARTIAL.

FSP PUT принимает только непроверенный ID; отдельный импорт с согласием отвечает503 registry_not_configured. ID/ошибка не создают подтверждения/бонусы. Реестр ФСП, внешний SMTP/ATS, официальная верификация компании и человеческая рыночная калибровка этим пакетом не подтверждены.

При200% проверялась эквивалентная CSS область640×360 DPR2. Native IAB zoom горячими клавишами не изменился; это reflow test, не native zoom proof во всех браузерах.

## Runtime, сохранность и воспроизведение

User веб:http://localhost:4372/candidate/resumes; API4371; DB signal_ui_refinement_20261008. API:`outputs/runtime/ui-refinement-correction01-iteration07/dist/index.mjs`.
Clean веб:http://signal-full-audit.localhost:4384; API4383; DB signal_full_audit_a10_20261008; PG127.0.0.1:55435;15 миграций. User/clean API имеют одинаковый c19…ee60 SHA. Credentials/passwords только в private env/ledgers.

После измерений, при возобновлении финализации прежние native listener процессы отсутствовали, браузерная сессия имела одну недоступную вкладку; файлы и PG оставались. Восстановлены только два собственных stands из тех же immutable bytes, без новых миграций, тестов или нагрузки. Текущие API PIDs:user35280/clean38632; UI17556/29576. Защищённые4313/4314 сейчас свободны, в этой финализации они не запускались и не останавливались. Прежние guard/preservation receipts являются историческими. [Квитанция восстановления](../../outputs/verification/full-audit-a01-a11-20261008/runtime-recovery-final.json).

Прежний clean c64 сохранён до замены в outputs/runtime/full-audit-native-before-performance-20261008/dist/index.mjs; [mapping](../../outputs/verification/full-audit-a01-a11-20261008/integration/core-before-performance-runtime-preservation.json) связывает старые квитанции с точными bytes. Два прежних mutable FE dist расхождения не реконструировались. Core/load fixtures оставлены для независимой проверки; A05 cleanup касается только своих временных строк. Одна собственная активная TypeScript Junior UI попытка создана после нагрузки без отправки ответов/изменения грейда.

Финальные [source](../../outputs/verification/full-audit-a01-a11-20261008/source-manifest.json), [runtime](../../outputs/verification/full-audit-a01-a11-20261008/runtime-manifest.json), [evidence](../../outputs/verification/full-audit-a01-a11-20261008/evidence-manifest.json) manifests закрепляют source,15 миграций, bundles,frontend assets и evidence. [Clean-copy manifest](../../outputs/verification/full-audit-a01-a11-20261008/clean-source-manifest.json) подтверждает byte-for-byte copy; после фиксации общий sync не повторяется.

Полностью прочитаны ТЗ,17 письменных официальных ответов и ASR1317 строк/655 сегментов. Повторное прослушивание всей записи не заявляется. Guarded helpers описаны в тематических отчётах; нагрузочный helper не запускать автоматически по живой базе с сохранёнными fixtures. Следующий шаг — независимая проверка в «Решения ФСП», без презентации/архива/видео, с отдельным prompt на необходимые исправления.
