# Самостоятельные Senior-программы Signal v4

Техническая реализация U12 и модульной части U13, 8 октября 2026. Это оригинальный банк команды; профессиональная точность грейда и эквивалентность сложности на людях не измерены. Успех на синтетических примерах и проверка ключей не заменяют независимую человеческую калибровку.

## Версии и граница истории

- Банк новых выдач: `signal-skills-2026-10-v4`.
- Senior rubric: `six-competencies-critical-5of6-senior-outcomes-v1`, templateVersion=1.
- Новая обычная rubric: `six-competencies-critical-5of6-middle-outcomes-v4`; Junior/Middle content и outcome requirements прежние, Frontend Middle state-model:s1 сохраняет templateVersion=3.
- Матрица новых категорий: `signal-category-competency-matrix-v2`.
- Форма хранит immutable snapshot cases/oracles/policy/programVersion. Saved v1–v3 формы оцениваются своей сохранённой rubric; исторические grades/dates/keys не переписываются и не превращаются в Senior.

Senior — самостоятельные 108 семейства: 6 навыков × 6 компетенций × 3 разных сценария. Это 324 версионированных шаблона вместе с 216 Junior/Middle шаблонами, но 216 стабильных content families всего: 108 общих lower-level и 108 независимых Senior. Число/ветка/перестановка вариантов не считаются новым семейством.

| Навык | Практические Senior-семейства | Обязательные критические компетенции |
| --- | --- | --- |
| Python | ownership/циклы/hashable keys; groupby/tee/ресурсный stream; contextvars/tenant cache/shared-task cancellation; ExceptionGroup/CancelledError/chaining; partial enter/generator close/cleanup transfer; duplicate-key parse/pickle/resource budget | collections, exceptions, data-boundary |
| SQL | fanout/зерно/temporal intervals; weighted merge/correction dedupe/grouping levels; composite nullable anti-join/CHECK/identity; write skew/CAS outcome/deadlock retry; partitioned bounded frame/keyset/ties; concurrent DAG/expand-contract/receipt hash | joins, transactions, constraints |
| TypeScript | versioned decoder/state-machine/conditional distribution; microtask snapshots/receiver/wire-loss; function variance/correlated mapped union/assertion soundness; conflict provenance/PATCH presence/prototype paths; sibling effects/stale cleanup/global retry budget; sharing/freeze cycles/transfer ownership | narrowing, async, immutability |
| React | чистые reducers/abandoned render/optimistic-log rebase; captured entity/live command/queued event; stable external snapshot/late resource cleanup/SSR scope; reorder/ancestor type/stable component type; versioned draft/scoped rollback/IME; error boundaries/session fence/Suspense resource lifetime | state, effects, composition |
| Backend engineering | receipt lifetime/If-Match origin/semantic API version; escrow bounds/authoritative revoke/DB-index recovery; multiplied retries/backpressure/fence boundary; SLO cohort/queue causality/unknown outcomes; document scope/signedURL revocation/webhook replay; migration gates/saga compensation/disaster ledger reconciliation | api, data, security, integration |
| Frontend engineering | normalized draft/optimistic rebase/account lifetime; portal focus fallback/virtual focus/reduced-motion result; INP path/code splitting/zoom reflow; intent guards/download event/offline conflict; projection ACL/server-browser boundary/domain ownership; SSR data scope/navigation outcome/SW rollout | state-model, accessibility, integration |

В каждой форме шесть задач. Каждая задача содержит обязательный практический результат и отдельный выбор достаточного плана/инварианта; обе части должны совпасть. Нельзя пройти компетенцию лишь одной частью. 45 минут, 5/6 компетенций (83 после округления) и **все** критические компетенции данного навыка. Backend имеет четыре критические, остальные три. Одна ошибка в некритической области допускается; такая настоящая 5/6 попытка сохраняет Senior skill proof и закрывает соответствующий matrix slot. Критическая ошибка при83 не проходит.

Эталонное решение детерминировано сохранённым snapshot. Концептуальные варианты — предметные инженерные планы: ошибочные решения теряют конкретную гарантию, иногда сохраняя полезные diagnostics/validation/rollout шаги. Итоговые варианты заданы статически; их объём не рассчитывается из skill/q/family/seed. Прежний дефект «правильный вариант всегда самый длинный» устранён и независимо проверяется. Это снижает один измеренный shortcut, но не обещает полного отсутствия угадывания или внешней помощи.

## Повтор, версии и выдача

Клиент/API выбирают точный skill ID + Senior + v4. Неподдержанный навык или несовпавшая версия не запускает Junior/Middle. Активная попытка восстанавливается из своего snapshot и первоначального context, не создаёт новую exposure и не перепривязывает resume.

Один уровень навыка повторяется не раньше24 часов после submission. Не больше8 новых forms аккаунта и2 forms одного навыка за скользящие24 часа, включая разные уровни и abandoned forms. Senior выбирает только **не виденные лично** stable families; global frequency дополнительно распределяет выдачи. Семейство имеет lineage `skill-senior-content-v1:<skill>:<competency>:sN`, не зависит от bank-version. Три полных forms расходуют pool одного навыка; после этого отказ bank_unavailable с сохранением истории, а не запрещённый повтор ради запуска. Cooldown сам не возвращает исчерпанные семейства.

API до submission не выдаёт oracles/expected/rubric answer keys. Registry публикует только outcomes, critical metadata, version и policy. Публикация самого backend source раскрывает authored bank; withholding в браузере не скрывает открытый исходный код. Не используются обвинения/автоотзыв по подозрению в помощи.

## Категория и доказательства

Категория не является числовым Grade. Уровни: Junior/Middle/Senior; балл отдельной попытки, coverage и match конкретной вакансии — разные показатели. `verifiedScore` новой категории остаётся null.

| Специализация | Три неизменных обязательных слота |
| --- | --- |
| Backend / Python | объявленный поддержанный Python или TypeScript; SQL; Backend engineering |
| Frontend / TypeScript | TypeScript; объявленный React; Frontend engineering |

Для Senior каждый slot требует valid Senior proof соответствующего skill, с исходной Senior v4 rubric, всеми outcome coverage records и критическими условиями. 5/6 допускается ровно по указанной policy, без скрытого требования6/6 при выборе evidence. Уровень категории — наибольшая закрытая строка до выбранной цели. Middle в одном обязательном slot даёт максимум Middle; отсутствие одного slot не даёт общей категории. Optional/recommended tags не меняют знаменатель. SQL не подтверждает PostgreSQL, Python не подтверждает FastAPI. Proof принадлежит аккаунту; удаление CV не удаляет его. Revocation/чужой owner/подмена старой версии Senior отвергаются. Старые действительные комплексные grades сохраняются с прежним источником, без фиктивных отдельных proofs.

## Проверки и ограничения

Focused tests: `tests/skill-senior-v4.test.ts`, регрессии `skill-modules`, `skill-middle-v2`, `skill-frontend-state-v3`. Проверяются108 независимых hand-calculated primary fixtures,1080 параметрических content fixtures, complete/partial/critical/noncritical decisions всех6 программ, retained5/6 proofs, lineage rotation/exhaustion, scope/revocation/category и saved v3 replay.

Независимый content/runtime review: `outputs/verification/ui-refinement-20261008/independent-senior-review.md` и соседние JSON. Reviewer отдельно исполняет Python/SQL/JS и strict TypeScript, проверяет metadata/history/rank shortcuts. SQL-memory probes не доказывают конкретную production СУБД/изоляцию; чистые React/state модели не заменяют mounted concurrent renderer или AT. Live HTTP/ACL/cooldown/exposure receipts снимаются на отдельном стенде и перечислены в общем отчёте; профессиональная/человеческая валидация Senior остаётся отдельным исследованием.
