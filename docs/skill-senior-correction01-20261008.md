# C04 — пять адресных исправлений Senior

Рабочая копия: `signal-ui-refinement-workspace-20261008`. Защищённые `fsp-signal`, API4313/UI4314, чужие аккаунты и сохранённая история не изменялись. Commit/push не выполнялись.

Новая программа — **`signal-skills-2026-10-v5`**. Изменены только пять указанных в `correction-01.md` семейств. Новые задачи находятся в `artifacts/api-server/src/lib/skill-senior-corrections-v5.ts`. Остальные 103 Senior-сценария, включая тексты, ключи и варианты всех десяти комбинаций n/flag, сохранены точно. Junior/Middle сохранены: 2160 полных JSON-задач совпали с защищённым accepted v3 source.

## Новое решающее содержание

| Семейство | Middle / прежний Senior v4 | Существенное новое условие v5 | Независимый ключ и отрицательные случаи |
|---|---|---|---|
| SQL transactions:s1 | Write skew двух дежурных; общий guard/SERIALIZABLE+повтор проверки | Локальная SQL-транзакция не атомарна с внешним эффектом. Два окна: COMMIT→падение до send; receive→потерянный ACK→новый lease→повтор receive. | Модель транзакции/доставки независимо даёт `1|1|2`; rollback отменяет order+outbox. Atomic outbox с recipient stable-key dedupe даёт один effect. Post-commit callback теряет event; delivered-before-send теряет event; outbox без recipient dedupe даёт два effects. |
| SQL constraints:s3 | Receipt tenant/event/hash/result, replay/конфликт payload | Partial unique активного email не превращает обычный FK в ссылку только на active parent. Restore конфликтует с active ключом; concurrent order/deactivate требует единой границы целостности. | Реальная SQLite in-memory проверка partial unique+FK: order к soft-deleted parent принимается, restore результат `1|0` при active collision и `1|1` без него. Canonical active membership+live FK отвергает отсутствующий ключ и удаление referenced ключа. Нельзя независимо изменять deleted_at или удалять history каскадом. |
| TypeScript generics:s1 | Узкий callback требует admin при широком producer | Union generic параметр теряет корреляцию key/value: `K=keyof Fields` допускает age+string/name+number. Различие произведения unions и union отдельных discriminated пар; unknown boundary остаётся runtime-задачей. | Настоящий TS5.9 strict compiler принимает оба generic counterexamples, отвергает оба неправильных mapped-tuple calls и принимает правильные пары/narrowed implementation. Runtime запись даёт неправильный тип. `as Command` и документация вместо decoding не решают проблему. |
| React closures:s1 | Поздний success A после выбора B; entity/operation/revision fencing | Speculative concurrent render B публикует target через mutable ref, затем abandoned без commit. Видимая кнопка A отправляет B, хотя late response ещё вообще не поступал. | Независимый явный schedule: write-in-render→`B|A`, commit-only update без commit B→`A|A`. useMemo не является commit barrier; публикация ref в discarded render не откатывается. Committed handler/pure render либо commit-bound layout lifecycle сохраняют target; late-result fencing остаётся отдельным условием. |
| React forms:s1 | Success отправленного snapshot при более новом local draft |409 с remote row deletion против local row edit и независимым remote изменением другой строки. Keyed three-way merge, tombstones, reorder и conflict intent вместо нового If-Match как разрешения на overwrite. | Независимый keyed merge: `conflict|Ufa|1` при edit/delete и `Moscow|Ufa|0` при одинаковом edit с обеих сторон. Проверены также local delete/remote edit и untouched-local/remote-delete. Blind whole-draft retry теряет Ufa и resurrect a; overwrite remote теряет local intent; index merge меняет identity. |

Формулировки явно задают предпосылки вычисления. Доказательством исправления служат новые требования и контрпримеры к прежнему достаточному решению, а не длина текста или смена ID.

## Версии, lineage и история

- Только эти пять новых семейств получают `skill-senior-content-v2` и `templateVersion=2`. Остальные 103 сохраняют `skill-senior-content-v1`/1.
- Template ID v4 всегда резолвится в старую v1 lineage. Переименование programme не обнуляет exposure неизменённого содержания; полностью исчерпанная v4 программа не получает новую полную форму v5, поскольку в остальных обязательных competency pools свободных семейств нет.
- Senior rubric остаётся **`six-competencies-critical-5of6-senior-outcomes-v1`**: scoring и competency outcomes не менялись. Матрица остаётся **`signal-category-competency-matrix-v2`**. Программная версия v5 и отдельная content revision различают новые тексты и ключи.
- Qualification принимает сохранённые Senior proofs v4 и новые v5; v1–v3 не становятся Senior. Old evidence не переинтерпретируется по текущему builder.
- Старые v4 builders и reviewed choices сохранены для приватного stateless historical fixture. Read/submit настоящей попытки используют её сохранённые cases/oracles/policy; этот fixture не является API и не регенерирует историю.
- У обеих изменённых SQL competencies сохраняется critical-флаг. Неверный practical result или новый обязательный invariant part даёт competency fail и весь Senior fail при83/5-of-6. Для изменённых noncritical TS/React competencies ошибка также проваливает competency; общий законный5/6 pass остаётся pass.
- Personal availability и issuance пользуются одним C05 pool helper. После трёх новых неповторяющихся форм четвёртая запрещена; old exposures не сбрасываются.

## Выполненные проверки

1. `node --import tsx --test tests/skill-senior-correction01.test.ts tests/skill-senior-v4.test.ts tests/skill-middle-v2.test.ts tests/skill-frontend-state-v3.test.ts tests/skill-modules.test.ts tests/skill-category-ranking.test.ts tests/resume-qualification.test.ts tests/skill-bank-availability-correction01.test.ts` — **55/55 PASS**. Лог: `outputs/verification/ui-refinement-correction01-20261008/senior/focused-tests.log`.
2. `node --import tsx scripts/audit-senior-correction01.ts` — **PASS**. 50 изменённых вариантов пяти семейств, 1030 точных неизменённых Senior variants, 2160 точных lower-level JSON variants. Historical builder body сохранён точно после нормализации CRLF; reviewed-choice file SHA остался прежним. Полные пары Middle/v4/v5 и source hashes: `senior/paired-comparison.json`.
3. Frozen v4 cases/oracles остаются score-compatible; у всех шести сохранённый v4 Senior proof проходит selection; новые issuance/score вызовы не изменяют эти stateless snapshots. Новые positive/critical/invariant-part negative и three-form rotation/exhaustion регрессии прошли.

4. `scripts/skill-senior-http-correction01.ts` на финальном runtime — **5/5 PASS**, настоящие HTTP выдачи/сдачи всех пяти изменённых семейств. SQL/TS/React100-pass создают правильный v5 proof. Неверный новый invariant отдельно SQL transactions и SQL constraints даёт83-critical-fail и ноль proofs. Cases/oracles/policy/programVersion остаются frozen при save/submit; start v4 получает409 без выдачи нового snapshot. Public active body не содержит private key/объяснений; после submit feedback закономерно открывает explanation. Все пять actors удалены: **remainingActors=0, remainingSessions=0**. Receipt: `senior/http-correction01.json`, SHA256 `4fe8d4cbbf472289c2e1f1c9b34bbbddc04341f5ab331e5bfe700935890bccee`.

Bounded live harness принимает абсолютный путь immutable iteration04 bundle, SHA и PID; строго проверяет loopback API4371/UI4372/DB55435 `signal_ui_refinement_20261008`. Для гарантированного выбора ровно пяти новых семейств он явно создаёт по две **синтетические expired fixtures**, экспонирующие только остальные альтернативы48 часов назад. Подготовка не является реальной пользовательской историей. Новые попытки выдаются обычным POST; existing пользователи/attempts/proofs не меняются. Это пять реальных submissions, а не нагрузочный прогон.

До финального pass обнаружена только ошибка самого harness: cleanup count запрашивал отсутствующую колонку `sessions.id` уже после удаления disposable users и блокировал запись receipt. Query исправлен на `sessions.userId`, PS progress отключён, выполнен финальный bounded rerun с новыми пятью fixtures. Production-код из-за этой ошибки не менялся; предыдущие неуспешные отчётные вызовы не засчитываются как отдельные pass.

Runtime: API4371 **PID45204**, UI4372, отдельная БД **signal_ui_refinement_20261008**. Immutable bundle: `outputs/runtime/ui-refinement-correction01-iteration04/dist/index.mjs`, SHA256 **`45e2c38d4cb2650c0ab6800dbb6f225ee333e63113b59d2b7df690fb74f64985`**. Root проверил полный suite **443/443**, API/UI typechecks и build после source freeze; отдельный55/55 focused log остаётся адресным доказательством C04/C05.

Полное paired stateless receipt SHA256: `f1182bbb2f0e20c2bc20391b81b946aa2ba27286bf479d4a115f75fe2cade025`. Source freeze ниже совпадает с live receipt.

## Source freeze

| Файл | SHA256 |
|---|---|
| skill-senior-corrections-v5.ts | `cd92628f36a877201c823c8240a8cba25657c8d8174d111de3d2cb50e26c4bdd` |
| skill-module-bank.ts | `db571c5f7e8d5d66828b1aeb1f38fa803bdf795698a1adb5b40603fa75ecf48d` |
| skill-senior-outcomes.ts | `2041ea4e0400f55878dc178944ca531cf6841b4629aa70a0c35ea24ee2b52c38` |
| skill-module-qualification.ts | `c421d8ebe15b00b9873046b3bd64d51e74471b8811b5b53f0de7d17997723764` |

Эти hashes фиксируют реализацию до независимой повторной приёмки. Reviewer-required правки, если появятся, требуют свежих hashes/receipt.

## Практические пределы

Это адресное исправление пяти содержательных повторов. Профессиональная калибровка на людях и равенство сложности форм не проводились. SQLite in-memory подтверждает явно заданные partial unique/FK semantics, не deployment конкретного PostgreSQL кластера. React-тест — явная независимая scheduling/state модель, не доказательство всех возможных interleavings runtime. Oracle-assisted live submissions проверяют routing/scoring/persistence, не профессиональную компетентность человека.
