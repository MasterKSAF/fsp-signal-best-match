# Банк v6 · редакционная ревизия correction01-v2

08.10.2026. Продуктовая версия остаётся `signal-skills-2026-10-v6`; конкретную редакцию фиксируют SHA256 и неизменяемые квитанции. SHA256 `skill-junior-protocol-choices-v6.ts`: `20e4f3d157676b34eb4bc97bb864f3aca29d620a0efe798de0c307c6940fe2f7`.

Изменены только альтернативы `frontend-engineering:state-model:s2` и `frontend-engineering:integration:s1`. Первый набор сравнивает владельца draft/URL, Back и ключ cache; второй — snapshot/revision, draft, feedback/focus и identity позднего ответа. Ошибочные альтернативы описывают конкретное неправильное владение, область кеша, обновление revision или действие после stale success. Добавления текста ради длины нет. Правильные инженерные решения и исходные условия сохранены. В Middle те же альтернативы используются в части A; требование части B не менялось.

Это редакция существующего содержания. Идентификаторы template, templateVersion, contentFamily, disabled aliases, история показов и попыток сохраняются. Новая material lineage не создаётся. Порог83 и critical gates не менялись. Полная матрица прежних bans/history остаётся предметом сохранённого A05; новые focused проверки подтверждают сохранение old disabled/exposure aliases именно изменённой пары.

Новое доказательство находится в `outputs/verification/correction-01-20261008/bank`. Финальные файлы имеют суффикс v2; v1, FAIL и прежние доказательства сохранены. Для B4 `primarySemanticStatement` хранится отдельно от `primaryWireResponse`; Middle choice A кодируется номером1–4, Junior choice — option id, текстовая трасса остаётся трассой. Полные semantic mistakes, labels и mandatory-матрицы заморожены до scorer отдельным процессом.

Результаты ограничены синтетическими процедурами: новый фикс снимает универсальный rank двух конкретных critical семейств; он не означает отсутствие всех текстовых cues или доказанную сложность на людях. B4 проверяет обработку заранее описанных содержательных ошибок при корректном формате и проекцию категории. Он не калибрует пороги и не измеряет профессиональное качество человеческой выборки.

Последующее C04 изменение двух SQL-выборок `skill-module-service.ts` оформлено отдельным `bank-source-revision-c04-v1.json`:29 остальных bank hashes сохранены. Один stateless replay использует исходные v2 vectors/models/labels и явный новый ledger, результат — `b4-results-c04-binding-v1.json`; старые v2 доказательства не перезаписаны. Это source binding, а не проверка выполнения SQL или latency. Финальные документальные hashes отражены в append-only `b4-c04-binding-linkage-v1.json`.
