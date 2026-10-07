# Исходники Signal 0.6.0: отдельная приёмка

Состояние подготовки: **не запечатано, чистый запуск не выполнен**. Предыдущие архивы 0.4 и 0.5, их проверки и неудачные попытки сохраняются как история. Успех прежнего комплекта не является приёмкой 0.6.0.

## Порядок после разрешённой заморозки

1. Завершить актуальные браузерные и API-проверки и полную нагрузку именно штатного `artifacts/api-server/dist/index.mjs`; зафиксировать реальные SHA всех принятых runtime sources и соседних assets. Никаких изменений runtime во время измерений.
2. Создать `outputs/release-0.6.0/release-freeze.json` со статусом `frozen-for-source-seal`, временем UTC, `acceptedRuntime`, хешами критических исходников и явным списком до 64 публичных текстовых протоколов. `offlineBaselines.policyQuality` и `.traceabilityDelta` должны ссылаться на точные текущие 0.6-протоколы из того же `publicProofInputs`.
3. `python scripts/package-source-v060.py --check-only` проверяет отбор и freeze без ZIP. `python scripts/package-source-v060.py` разрешён лишь после окончательной стабилизации исходников, документов и протоколов.
4. Проверить точный SHA созданного ZIP: `python scripts/audit-source-privacy-v060.py --expected-sha256 <actual-source-sha> --private-manifest <external-private-json>`. Приватные манифесты остаются вне исходников; значения, пути и совпавший текст в публичный протокол не попадают. Это проверка известных значений и шаблонов, а не универсальная гарантия отсутствия любых секретов.
5. `pwsh -NoProfile -File scripts/clean-source-launch-v060.ps1 -ExpectedSha256 <actual-source-sha> -FreezeReleased` создаёт только новый собственный Compose-проект: API **4334**, PostgreSQL **55441**, Mailpit **8034**, отдельную случайную базу `signal_clean_v060_<8hex>`. Занятый порт приводит к отказу; чужие процессы и базы не останавливаются.

## Что проверяет новый clean

- Точные bytes, CRC, уникальные пути и весь SHA-манифест распакованного ZIP; schema и миграции, включая `0009_microtask_resume.sql`. Timestamp ZIP выводится из текущего freeze. Metadata-only refresh собственных распакованных файлов перед Docker сохраняет их bytes и проверяет SHA до и после.
- Реальную установку по frozen lockfile, полную unit suite, чистые Python/PowerShell guards с количеством из фактического вывода. Никакого переноса прежних чисел проверок.
- Новую offline-воспроизводимость v6 по неизменным синтетическим данным и точным текущим baseline-отчётам. Все потери качества и исторические `false` сохраняются; старая v5-очередь не объявляется новой политикой.
- No-cache сборку из этого ZIP, собственную первоначально пустую базу, штатные миграции и обзорный Demo seed. Seed не заменяет реальный экзамен reviewer-аккаунтов.
- Обычную регистрацию с реальной локальной доставкой через Mailpit REST, обязательные Signal qualification purpose/подтверждение уровня/анкету, два независимых reviewer cohort, точное удаление собственных временных аккаунтов, каталог/дедупликацию пяти резюме и owner PDF.
- Реальный SHA скомпилированного API и каждого принятого canonical source внутри контейнера; они должны совпасть с замороженным runtime и ZIP без newline-нормализации и других подмен байтов.
- Очистку только собственного случайного проекта. Защищённые listener/container identities до и после включают рабочий и stage runtime, а также отдельные 4363/4364/4365. Эти identity witnesses не доказывают отсутствие любых параллельных изменений строк чужой базы.

Host Node/pnpm/Python/PowerShell записываются по фактическому `--version`. `package.json.packageManager` и Dockerfile CLI pin фиксируются отдельно: версия host pnpm не приписывается контейнеру. Критерии native нагрузки и clean Docker проверки имеют разный scope; clean не повторяет полный нагрузочный тест и не заявляет production SLA, production SMTP либо подтверждение уровней людьми.

## Точные frozen зависимости

`source_qa_inputs.validate_qa_source_inputs_v060` сохраняет прежние exact inputs и добавляет только три листа: `before-policy.json`, исторические `fsp-category/history/signal-matching.ts` и `skill-catalog.ts`. Соседние outputs/TS не получают разрешения по префиксу. Прежние два golden source 0.5 остаются обязательными для исторического regression replay. Пять исследовательских confirmation-v1 файлов сохраняют прежние exact SHA и синтетический scope.

После фактической приёмки публикуются `source-seal.json`, `source-privacy-audit.json`, `clean-source-launch.json`, `clean-runtime.json`, `clean-http.json`, `clean-reviewer-http.json` и `offline/reproduction.json` рядом с новым ZIP. Эти постзаморозочные companion receipts не входят в саму заморозку.
