# Кабинет работодателя E01–E16: контексты и отобранные

Статус: реализовано; изолированная миграция с сохранением истории и адресные HTTP-сценарии проверены. Независимая UI/API-приёмка нового полного пакета выполняется отдельно. Это не повторный PASS старых C01–C06.

## Общий контекст

`{type:'need'|'job',id:number}` всегда различает два типа, даже при одинаковом числовом ID. Каталог имеет `context=null`. Сервер никогда не создаёт запрос из вакансии.

`GET /api/employer/selection/contexts` → `{contexts:ContextDto[]}`.

ContextDto: `type,id,version,title,specialization,grade,requiredSkills,requiredSkillLevels,desirableSkills,description,workFormat,salaryMin,salaryMax,salaryPeriod,salaryType,status,updatedAt,shortlistCount`; для вакансии также `applicationCount`. `version` запроса = `revision`; `version` вакансии = её версия. Архивы и удалённые контексты не входят в selector. Закрытая вакансия остаётся доступной для просмотра, но новые отбор/приглашение запрещены.

`loadOwnedSelectionContext(companyId,ref,reader=db,{lock?:boolean})` возвращает `{context,matchNeed,active}` либо null. Reader принадлежит текущему запросу/транзакции. `job.skills` проецируются в обязательные требования, отдельные уровни берутся из `signal_job_requirements`; отсутствующий уровень не выдумывается, desirableSkills=[].

## Изменение и безопасное удаление

- `GET /api/employer/needs`: существующий массив + `revision,status,updatedAt,shortlistCount`.
- `PUT /api/employer/needs/:id`: `{revision,...только_переданные_изменения}`. Допустим `status:'active'|'archived'`. Отсутствующие поля сохраняются; удалённые обязательные навыки убирают только их требования к уровню. Итоговая зарплатная вилка валидируется после объединения.
- `DELETE /api/employer/needs/:id`: `{revision}`; soft-delete + архив + очистка только своего typed shortlist.
- `GET /api/employer/jobs`: существующий массив + `updatedAt,shortlistCount,applicationCount`.
- `PUT /api/employer/jobs/:id`: `{version,...только_переданные_изменения}`. location/skillRequirements также partial. Архивная/удалённая вакансия не редактируется.
- `POST /api/employer/jobs/:id/status`: `{status:'published'|'closed'|'archived',version?:number}`. Новый UI передаёт version. Старый статусный вызов совместим; фактическое изменение увеличивает version.
- `DELETE /api/employer/jobs/:id`: `{version}`; мягкое удаление, истории откликов и приглашений сохраняются.

Конфликт редакции возвращает 409 `VERSION_CONFLICT`. Изменение требований сохраняет отобранных и инвалидирует оценку по прежней версии. Архивирование очищает только активные связи своего shortlist; восстановление контекста не восстанавливает очищенный отбор. Повторное удаление своего уже удалённого контекста идемпотентно.

## Постоянный отбор

`GET /api/employer/shortlist?contextType=need|job&contextId=N` → `{context,items,total}`. Item: `candidateId,resumeId,contextVersion,available,needsReview,candidate,match`. При исчезнувшем доступе candidate/match=null; только нейтральные собственные ссылки, без имени, фото и контактов. `needsReview` учитывает новую версию и текущую eligibility. Счётчик считает сохранённые уникальные связи, включая нейтральные недоступные записи; выдача явно сообщает недоступность.

`PUT /api/employer/shortlist` body `{context:{type,id},candidateId,resumeId,contextVersion?}` → `{item,shortlistCount}`. Уникальность `(company_id,context_type,context_id,candidate_user_id)`. Повтор заменяет выбранное доступное целое CV существующего человека и не увеличивает число людей. Проверяются matching consent, exact owner/CV, visibility/deletion, pool, company restrictions/blocks; подтверждённая квалификация не требуется для ручного сохранения. Доступ каталога не расширяется через OR.

`DELETE /api/employer/shortlist` body `{context:{type,id},candidateId}` → `{shortlistCount}`. Повтор безопасен. Другие контексты/компании не затрагиваются. Отбор не создаёт отклик, приглашение, контактное согласие или snapshot персональных данных.

Shared helper `loadOwnedShortlistLinks`, `loadAccessibleShortlistCandidates` выполняют ограниченную пакетную актуальную проверку. `safeShortlistCandidate` не возвращает контакты/вопросы экзамена.

## Приглашения и документы

Существующий `POST /api/employer/invitations` принимает **ровно один** `needId` или `jobId`. Дополнительно `contextVersion` (обязателен для job, optional для старого need), `resumeRevision?`; остальные ранее существовавшие поля и Idempotency-Key сохранены. Новый UI передаёт обе редакции. Сохранены quota/cooldown, company lock, текущая оценка eligibility/ACL, receipt и защита повторного ключа.

Ответ сохраняет nullable needId/jobId и добавляет `context:{type,id,version},contextVersion,contextSnapshot`. Snapshot включает исходные требования и отдельно реально отправленные условия; последующее редактирование не переписывает его. Повтор исходного receipt не создаёт новое приглашение после закрытия/удаления контекста.

Разрешение документа выбранного CV для matching-only кандидата учитывает текущую собственную активную вакансию или запрос и его eligibility. Соседние CV, закрытый контекст, shortlist или прежний snapshot не предоставляют новых разрешений. Каталоговое согласие остаётся самостоятельным режимом.

## Миграция и проверки

Добавлена 16-я миграция `0015_employer_selection_workspace.sql`, journal idx=15. Старые 15 файлов не изменены. Новые колонки needs revision/status/update/delete, job deletedAt, invitation nullable needId + jobId XOR + version/snapshot; need→invitation теперь RESTRICT. Исторические приглашения backfill только из собственных отправленных условий (legacyConditionsOnly), не из сегодняшних требований. Отобранные — новая таблица ссылок без копирования ПД.

На отдельной DB `signal_employer_e_20261008:55435` создано 4 синтетических аккаунта/3 CV и исторические fixtures перед миграцией. Сравнение исходных колонок по 22 таблицам до/после — точное совпадение SHA256/count. Синтетические assessment/module fixtures не выдаются за реальные экзамены и не дают текущую квалификацию. Private fixture ledger находится вне проекта; секреты в evidence отсутствуют.

Focused `employer-context-workspace-E.test.ts`: 10 тестов прошли; API typecheck прошёл после сборки деклараций libs. Финальные логи: `outputs/verification/employer-workspace-E01-E16-20261008/backend/focused-tests-final.log`, `typecheck-final.log`.

Live API03, 4413/PID 33880: 10 адресных HTTP-проверок прошли в `backend/http-de9d2537-1ac6-45a1-bff1-082205deca20.json`. Выполнены 6 настоящих механических HTTP-проверок модулей с oracle только собственных тестовых аккаунтов (Python/SQL/Backend Engineering Junior для двух аккаунтов); они отдельно маркированы как oracle-assisted. Проверены concurrent CAS (один 200, другой 409), сохранение/смена CV/разделение shortlist, отправка от вакансии с receipt/snapshot, разрешение matching-only документов через единственный job, настоящий цикл практики offer→accept→submit→evaluate по первоначальной rubric после изменения шаблона, отзыв доступа и сохранность истории после мягкого удаления исходного контекста.

Unified selection Live API03: 8 адресных проверок прошли в `backend/selection-http-d7fae22a-1654-481c-8df8-277f494d8aae.json`: 11 фильтров, целое CV, отдельные purpose, search разрешённого имени, compare 2–4 людей, тот же пользователь/чужой контекст deny, pinned shortlist при смене требований, пять сортировок в двух направлениях с двумя страницами, public/pseudonymous фото и dual revoke. В 62 адресных запросах median=21.3 ms, max=83.2 ms на маленьком собственном наборе. Это не нагрузочный тест и не закрывает прежний performance gate.

SQL provisioning первоначально сохранил заглавную E в адресах собственного тестового набора; штатный login нормализует их в lowercase. Исправлены только эти 7 own fixture email и private ledgers, password hashes не менялись. Обычный login через API проверен: 200 и ожидаемый ID для всех 7. Доказательство `backend/fixture-login-repair.json`; продуктовая авторизация не изменена.

После этих live проверок standalone shortlist-read дополнительно сокращён до безопасных skill/level/sourceType и повторной проверки текущей identity/revision перед ответом. Финальный build/restart и краткая проверка этого уточнения — часть общего финального runtime. Полная визуальная и независимая приёмка остаётся у контролёра.
