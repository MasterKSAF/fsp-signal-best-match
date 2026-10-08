# C03 matching supplement

Frozen `dataset.json`, `labels.json`, `rubric.json`, `freeze.json` были записаны до первого вызова evaluator. Labels SHA256: `5494c474687ae55ccf6fb4e3c95f39488708889c080deaba7ab3afe3bb92127f`. Эти файлы create-only и не изменялись после результатов.

Генератор: `scripts/freeze-correction01-matching-supplement.mjs`; evaluator: `scripts/evaluate-correction01-matching-supplement.ts`. Все fixtures локальны для этого workspace. Повторять generator поверх данной папки нельзя; evaluator пишет только в новую output-папку.

Отчёт: [C03 evidence](../../../outputs/verification/correction-01-20261008/matching/report.md). Текущий итоговый receipt: [run05](../../../outputs/verification/correction-01-20261008/matching/run05/report.json), выполненный после C04 source freeze. Продуктовые admission/selection/order/FSP/catalog checks прошли; frozen forecast grade одного revoked full-exam профиля расходится (null → Junior из действующих модулей). Общий preregistered verdict поэтому FAIL; mismatch и все старые результаты сохранены.

Это disclosed preregistered synthetic procedure. Автор читал аудит и контракты; ни blind holdout, ни human hiring validation не заявлены. Дополнение не заменяет исходный корпус и не меняет его метрики.
