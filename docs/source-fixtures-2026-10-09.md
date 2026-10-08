# Исходники и воспроизводимые тесты — 9 октября 2026

Продуктовые файлы этой копии соответствуют рабочей версии поставки. В архив не входят `node_modules`, собранные `dist`, рабочие `.env`, ключи, сессии, private ledger, дампы БД, временные API runtimes и прежние медиаматериалы. `.env.example` содержит только пример локальных настроек. Инструкции запуска находятся в README и `docs/delivery-2026-10-09.md`.

Для установки нужны Node.js 24 и pnpm 11.25.0. Установите зависимости командой `pnpm install --frozen-lockfile`; при наличии локального pnpm store можно добавить `--offline`. Полная автоматическая проверка запускается из корня: `pnpm test`. Проверки исполнения учебных Python/SQL сценариев используют Python 3 со стандартной библиотекой `sqlite3`. Эта команда не создаёт боевой стенд и не выполняет нагрузочный сценарий.

Небольшие сохранённые входы под `outputs/` входят в исходники как явные зависимости тестов. Это исключение из общего правила исключения генерируемого каталога `outputs`. Их исторические байты нельзя пересоздавать текущим алгоритмом, чтобы получить зелёную проверку.

| Сохранённый вход | Проверка |
| --- | --- |
| `outputs/quality/assessment-validation-after.json` и `outputs/quality/assessment-audit-2026-10-07/historical-inputs.json` | Исторические решения и их зафиксированный SHA256 в `assessment-equivalence-audit.test.ts` |
| `outputs/verification/correction-01-20261008/bank/b4-v6-editorial-c01-vectors-and-labels-v2-frozen.json` и `public-input-v2-frozen.json` | Заранее сохранённые учебные входы и границы исправленного банка в `correction01-bank-content.test.ts` |
| `outputs/verification/full-audit-a01-a11-20261008/matching/{before,after}/first-use.json`, `report.json` и `before/evaluator-source.ts` | Пять точных исторических зависимостей `correction01-matching-supplement.test.ts`: контроль SHA256 из `docs/validation/correction-01-matching-supplement-20261008/freeze.json`; синтетические агрегаты без credentials |
| `outputs/quality/0.6.0/fsp-category/before-policy.json` и `history/*.ts` | Категории ФСП и сравнение с сохранённым алгоритмом |
| `outputs/quality/matching-competitive-freeze.json` и `matching-competitive-v1-report.json` | Независимые сохранённые ожидания ранжирования |
| `outputs/quality/qa-cycle-01/*` | Контроль межгруппового допуска, источников и границ качества; сохранены прежние tracked входы и их manifests |
| `outputs/verification/history/multi-resume-before-rank-append/**` и `qa-cycle-01-before-traceability/**` | Исторические версии алгоритмов и их контрольные суммы |
| `outputs/verification/multi-resume/load-comparison-cf5f76e84655.json` | Чтение ранее зафиксированного результата; новый нагрузочный прогон не запускается |
| `outputs/research/confirmation-v1/*` | Прежний tracked обезличенный протокол и агрегированный результат исследования |

Дополнительные обычные fixtures находятся в `tests/fixtures`, `docs/validation` и продуктовых модулях. Их тоже сохраняют в поставке. Сценарии HTTP, подготовки синтетических пользователей и интеграционных проверок из `scripts/` выполняются отдельно: они требуют собственного настроенного стенда и могут создавать данные. Некоторые локальные вспомогательные сценарии ссылаются на отсутствующие приватные файлы оператора; сами credentials и ledger в поставку не включены, обычный `pnpm test` их не читает.

Проверка пакета перед передачей записывается отдельно от продуктовых исходников. Полный список файлов, размеры и SHA256 содержит сопроводительный manifest. Сохранённые исторические fixtures не означают новый performance PASS или доказанную точность найма на реальных людях.
