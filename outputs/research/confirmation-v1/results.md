# Уточняющая попытка: синтетическое исследование v1

Протокол SHA-256: 278fdc8ef232dd2e2bc65c82c246535b5dfca85a8f2c55f6c420754fed12651c. Зафиксирован до запуска, параметры после результатов не менялись. Людей: 0. DB/API/сеть: не используются. Исходные объекты неизменны.

17 сценариев; сопоставимых 9, исключено 8. Назначено 5 дополнительных попыток / 30 заданий. Исходы: согласованный 2, неопределённость 2, недействительный 1.

Среди сопоставимых сценариев TP 4, FP 1, FN 1, TN 3. Precision/recall относятся только к заранее указанным синтетическим меткам. Законное обучение получило лишнюю форму (6 заданий), пограничная нестабильность пропущена. Это ограничения выбранного правила, а не обвинения людей.

Банк: 72 шаблонов; **2 на каждую компетенцию/программу/грейд**. У третьих форм непоказанных template IDs 0/30; новых case IDs 30/30; изменённых текстов 30/30. Новый seed не даёт третью непоказанную инженерную задачу.

Один результат в пяти резюме: пять представлений, одно наблюдение. Повторное назначение с другим resumeId отклонено 5/5 раз. Рабочие грейды, consent, matching и cooldown не меняются.

| Сценарий | Сопоставим | Доп. форма | Исход | Основание |
|---|---|---|---|---|
| stable-high | да | нет | — | rule_not_triggered |
| stable-limited | да | нет | — | rule_not_triggered |
| stable-mixed | да | нет | — | rule_not_triggered |
| borderline | да | нет | — | rule_not_triggered |
| documented-training | да | да | consistent | decision_disagreement_with_score_or_critical_difference |
| persistent-change | да | да | consistent | decision_disagreement_with_score_or_critical_difference |
| fluctuating | да | да | uncertain | decision_disagreement_with_score_or_critical_difference |
| critical-with-equal-totals | да | да | uncertain | decision_disagreement_with_score_or_critical_difference |
| invalid-confirmation | да | да | invalid | decision_disagreement_with_score_or_critical_difference |
| different-programs | нет | нет | — | different_programs |
| different-grades | нет | нет | — | different_grades |
| different-versions | нет | нет | — | different_saved_version_or_rubric |
| known-defective-form | нет | нет | — | invalid_source:known_defect |
| scoring-failure | нет | нет | — | invalid_source:scoring_failure |
| long-gap | нет | нет | — | outside_declared_interval |
| one-proof-five-resumes | нет | нет | — | two_distinct_attempts_required |
| revoked-source | нет | нет | — | invalid_source:revoked |

**Вывод:** Данных недостаточно для рабочей политики или утверждения эффективности на людях. Нужны непоказанные содержательные формы и измеренная сопоставимость; допускается обсуждение отдельного добровольного исследовательского пилота после подготовки этих условий.

Реального пилота, измеренной человеческой сложности и доказанной защиты от списывания нет. Нейтральное приглашение и согласие для возможного будущего пилота описаны в протоколе; участие/отказ/прерывание не влияют на рабочую квалификацию.

Повтор: `node --import tsx scripts/confirmation-research-v1.ts`. Полные фактические данные: `results.json`; исходный протокол и hash сохранены рядом.
