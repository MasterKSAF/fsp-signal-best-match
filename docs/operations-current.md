# Signal — запуск и эксплуатация текущего кода

Документ относится к рабочим доработкам S01–S16 на 28 октября 2026. Статус проверки и исторические материалы: [технический паспорт](technical-passport.md). Команды выполняются из корня текущих исходников. В Windows используйте PowerShell 7, не Windows PowerShell 5.1 для бинарных данных.

## Базовая конфигурация

Чистая установка, обновление 0000–0019 → 0035, повтор seed/migrate, перезапуск на прежнем volume и работа базовых функций при флагах OFF проверены в D: [результаты](verification-2026-10-28.md). Проверялся отдельный локальный проект; это не проверка производственного SLA или полного восстановления из backup.

Полный контейнерный путь описан в [README](../README.md). `node scripts/setup-env.mjs` создаёт `.env`, если её нет, и сохраняет существующую. Новый пароль БД — 32 случайных байта в hex, он одинаков в `POSTGRES_PASSWORD` и native `DATABASE_URL`; секрет verification — отдельные 32 байта. Смена файла не меняет пароль уже существующей PostgreSQL. Для прежнего volume сохраняйте его пароль и проект Compose.

| Параметр | Шаблон / поведение без параметра в коде |
|---|---|
| `DATABASE_URL` | Native: localhost:55450/signal; обязателен для БД. Compose переопределяет на db:5432 с тем же паролем |
| `POSTGRES_PASSWORD` | Генерируется setup-env; Compose требует значение. Для существующей установки взять прежний пароль, не создавать новый |
| `PORT`, `API_PORT`, `WEB_PORT`, `HOST` | Native 4312/4312/4310/127.0.0.1; Vite proxy использует API_PORT. При разных PORT/API_PORT dev прекращает запуск с объяснением |
| `SIGNAL_HTTP_PORT`, `SIGNAL_DB_PORT`, `SIGNAL_MAIL_PORT` | Compose 4450/55450/8050, привязка к loopback |
| `PUBLIC_URL` | Native http://127.0.0.1:4310, задаёт публичный origin/ссылки/cookies; Compose вычисляет localhost:HTTP_PORT |
| `SIGNAL_PUBLIC_URL` | Необязательное переопределение PUBLIC_URL только в Compose, например внешний HTTPS origin |
| `MAIL_TRANSPORT`, `MAILPIT_URL` | mailpit и native http://127.0.0.1:8050; Compose mail:8025. Внешний SMTP не включается автоматически |
| `NODE_ENV` | development в dev.mjs; production в полном контейнере. Для `pnpm start` задать явно |
| `DEMO_MODE` | В шаблоне/Compose true; в коде ON только точное true. Synthetic Demo отделён от обычных аккаунтов |
| `SIGNAL_WORKSPACE_ENABLED`, `SIGNAL_SKILL_MODULES_ENABLED` | В шаблоне/Compose true; в коде ON только точное true |
| `SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED` | false; код ON только при true. Инженерный эксперимент, не квалификация |
| `SIGNAL_CODE_RUNNER_ENABLED` | false; true работает только вне production. Compose оставляет false независимо от окружения хоста |
| `SIGNAL_ATS_WORKER_ENABLED` | false; при true разрешает внешнюю доставку только настроенных событий |
| `SIGNAL_COMPUTATION_RECOVERY_ENABLED` | true; только точное false останавливает recovery |
| `SIGNAL_SELECTION_WATCH_SCHEDULER_ENABLED` | true; только точное false останавливает scheduler |
| `SIGNAL_INVITATIONS_PER_24H` | 20; допустим integer 1–1000. Общий rolling-бюджет компании, подтверждение почты его не увеличивает |
| `EXPOSE_DEMO_VERIFICATION_CODE` | false; раскрытие кода требует одновременно true и DEMO_MODE=true. В Compose принудительно false |
| `SIGNAL_RESEARCH_OPERATOR_IDS` | Пусто; отдельный список ID исследовательских операторов. Это не экспертный grant |

Дополнительные параметры: `SESSION_COOKIE_SECURE` и `CORS_ORIGIN` для origin/cookies, `LOG_LEVEL` для журналов. На внешнем production HTTP нельзя отключить Secure cookies; используйте HTTPS. Для нативного SMTP нужны `MAIL_TRANSPORT=smtp`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` (по умолчанию 587), `SMTP_USER`, `SMTP_PASSWORD`; Compose по умолчанию остаётся на Mailpit, SMTP требует собственного deployment override. Секреты передаются приватным окружением. Тестовые `SMTP_LOCAL_TEST`, `SIGNAL_ATS_LOCAL_TEST` и `SIGNAL_ATS_LOCAL_TEST_PORT` не относятся к обычной установке и не включаются здесь.

## Нативная разработка

Нужны Node.js 24, pnpm 11.25.0 и Docker с Linux containers для PostgreSQL/Mailpit. Используется только этот репозиторий и lockfile; платные модели и внешние fixtures не нужны.

Одинаковые команды в PowerShell 7 и sh:

```text
corepack enable
corepack prepare pnpm@11.25.0 --activate
node scripts/setup-env.mjs
docker compose -p signal-local config --quiet
docker compose -p signal-local up -d --wait db mail
pnpm install --frozen-lockfile
pnpm run db:migrate
pnpm run db:seed
pnpm dev
```

Seed нужен для локального Demo. Если `.env` содержит `DEMO_MODE=false`, пропустите `db:seed` и зарегистрируйте собственные аккаунты; контейнер пропустит seed автоматически. Веб — http://127.0.0.1:4310, API health — http://127.0.0.1:4312/api/healthz, почта — http://127.0.0.1:8050. Ctrl+C останавливает dev. `scripts/dev.mjs` загружает `.env`; явно заданное окружение сохраняет приоритет. Если порты заняты, меняйте оба API-параметра согласованно, WEB_PORT и PUBLIC_URL — вместе.

Для готовой нативной сборки: `pnpm run build`, затем `pnpm run db:migrate`. В PowerShell: `$env:NODE_ENV='production'`, затем `pnpm start`. В sh: `NODE_ENV=production pnpm start`. `start` не делает миграции/seed; `container-start.mjs` делает их перед запуском. API и статика готовой сборки идут с одного PORT, поэтому PUBLIC_URL нужно изменить на его origin. Не запускайте параллельно два сервера на одном порту.

Полные чистые проверки установки выполняются отдельным этапом D. Этот документ не утверждает, что описанный путь уже прошёл независимый повтор после последних изменений.

## Банк заданий и происхождение

Выпуск содержит manifest, точное замыкание локальных исходников, checker hash и attestation. Готовый проверенный JSON находится в `artifacts/api-server/src/data/skill-bank-attestation.json`; build вызывает pack и отказывает при несовпадении. После изменения банка/проверяющего кода оператор повторяет проверку на доверенном хосте. Для неё дополнительно нужен Python 3; путь можно задать `SIGNAL_AUDIT_PYTHON`. Это выполнение авторских контрольных примеров, не sandbox для программ кандидата.

```text
node --import tsx scripts/attest-skill-bank.ts
node --import tsx scripts/pack-skill-bank.ts
node --env-file-if-exists=.env --import tsx scripts/manage-assessment-bank.ts inventory
node --env-file-if-exists=.env --import tsx scripts/observe-assessment-bank.ts 28
```

`pack` выводит полный bundle с содержимым заданий: хранить его как внутренний артефакт, не отправлять в публичный лог. На первой новой выдаче attested release атомарно сохраняется в `signal_skill_bank_releases` вместе с формой попытки; отдельного публичного HTTP import или обязательного pre-import нет. Нельзя вручную править attestation, удалять архивы банка или подменять сохранённые ответы. Наблюдения допускают окна 7/28/90 дней и скрывают малые rates; повтор семейства — сигнал для разбора, не доказательство нечестности.

Карантин/возврат семейства и корректировка (замените ID и конкретное основание):

```text
node --env-file-if-exists=.env --import tsx scripts/manage-assessment-bank.ts disable --template FAMILY_ID --operator operator-name --reason "Confirmed content defect requires quarantine"
node --env-file-if-exists=.env --import tsx scripts/manage-assessment-bank.ts enable --template FAMILY_ID --operator operator-name --reason "Reviewed correction and validated current release"
node --env-file-if-exists=.env --import tsx scripts/manage-assessment-bank.ts annul-skill --evidence EVIDENCE_ID --operator operator-name --reason "Confirmed invalid evidence with recorded review"
node --env-file-if-exists=.env --import tsx scripts/manage-assessment-bank.ts annul --attempt LEGACY_ATTEMPT_ID --operator operator-name --reason "Confirmed legacy result defect with recorded review"
```

Новые выдачи прекращаются; выданные формы не переписываются. Оператор 1–120 символов, основание 12–1000. Используйте ID фактического семейства из inventory. Аннулирование доказательства пересчитывает текущее состояние, сохраняя исходную оценку и основание.

## Экспертные полномочия

Доступ к CLI означает доверенный доступ к хосту/БД. Сначала зарегистрировать отдельный аккаунт, получить его настоящий ID. Grant действует 1–30 дней, по умолчанию 7; разрешение `assessment_review` не выдаётся всем работодателям или Demo автоматически.

```text
node --env-file-if-exists=.env --import tsx scripts/grant-assessment-expert.ts --user USER_ID --operator operator-name --days 7
node --env-file-if-exists=.env --import tsx scripts/grant-assessment-expert.ts --user USER_ID --operator operator-name --days 7 --revoke GRANT_UUID
```

Для отзыва берите UUID из результата выдачи, не чужой grant. Назначение не заменяет явное решение в обращении. Сообщения/решения/источники остаются историей после истечения доступа; приватные заметки эксперта не выдаются кандидату.

## Опциональный PDF-импорт

Доступен при нативном API на хосте с разрешённым Docker CLI. Обычный app-контейнер не имеет docker binary/socket: установка не добавляет ему полномочия управления хостом. Поддерживаемый локальный путь:

```text
docker build -t signal-pdf-import:1 ops/pdf-import
```

Для нативного API задайте `SIGNAL_PDF_IMAGE=signal-pdf-import:1` (это и есть default); `SIGNAL_DOCKER_BIN` — путь к docker при необходимости. Отдельного `PDF_ENABLED` флага нет. Перезапустите обычный API после изменения окружения. Образ Python 3.11.14 и зависимости находятся в `ops/pdf-import`; для воспроизводимой поставки дополнительно фиксируйте фактический image ID/digest. Base image здесь имеет tag, а не доказанно неизменный digest.

Лимиты: PDF ≤5 242 880 байт после base64, JSON ≤7 МБ; до 12 страниц, 15 с на обработку, 256 МБ RAM, 1 CPU, 32 процесса, read-only, без сети, без capabilities, непривилегированный UID и временный tmpfs 16 МБ. Одновременно до двух извлечений на процесс; не более 10 принятых работ пользователя в час, повреждённые документы тоже расходуют work budget. Это разные ограничения, не общий распределённый semaphore.

Исходный PDF не сохраняется. Черновик/фрагменты/review живут 24 ч, ручная проверка и выбор полей обязательны; при конфликте версии нужно обновить diff. Скан без текста не распознаётся OCR. Истёкшие фрагменты/review token очищаются планировщиком; минимальная запись статуса может остаться для истории/идемпотентности. Недоступность Docker/образа даёт ошибку, а не автоматическое заполнение навыков.

## Опциональный публичный паспорт и ключи

Используется Ed25519. Приватный ключ должен лежать **вне репозитория** и быть доступен только сервисному пользователю. Следующая команда одинакова в PowerShell 7/sh, создаёт новую пару рядом с source и не печатает секрет. `wx` запрещает перезапись существующих ключей:

```text
node -e "const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');const kid=process.argv[1],dir=p.resolve('../signal-private');fs.mkdirSync(dir,{recursive:true,mode:448});const k=c.generateKeyPairSync('ed25519');fs.writeFileSync(p.join(dir,kid+'-private.pem'),k.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:384});fs.writeFileSync(p.join(dir,kid+'-public.pem'),k.publicKey.export({type:'spki',format:'pem'}),{flag:'wx',mode:384});" passport-20261028
node --env-file-if-exists=.env --import tsx scripts/configure-passport-key.ts --kid passport-20261028 --issuer https://signal.example.org --state active --public-key ../signal-private/passport-20261028-public.pem
```

Замените example issuer на свой реальный HTTPS origin **без path/query/credentials** и укажите в приватном окружении `SIGNAL_PASSPORT_ISSUER` точно такой же origin, `SIGNAL_PASSPORT_SIGNING_KEY_FILE` — абсолютный путь к `passport-20261028-private.pem`. Затем перезапустите API. В Windows права файла задаются ACL каталога; POSIX mode сам по себе не заменяет проверку Windows ACL. В контейнерной установке нужен собственный read-only mount из внешнего защищённого каталога, с путём вне app cwd и переменными окружения; приватный ключ не копируется в image или Compose-репозиторий. HTTP issuer на localhost/127.0.0.1 допускается только для явного Demo вне production.

Ротация: повторить генерацию с новым kid/именем файла, зарегистрировать новый публичный ключ `--state active` и переключить путь приватного ключа API на новую пару. Операторский CLI переводит прежний active key этого issuer в retired. Не заменяйте PEM у существующего kid. Для компрометации:

```text
node --env-file-if-exists=.env --import tsx scripts/configure-passport-key.ts --kid passport-20261028 --issuer https://signal.example.org --state compromised
```

`retired` не выпускает новые документы; `compromised` не считается доверенным. Проверка криптографической целостности не заменяет онлайн-проверку активного документа/согласия/срока и актуальных claims. Preview — 10 мин; публикация — явное согласие и 1–90 дней. Подписываются только выбранные подтверждения, не резюме, ФИО или контакты. Замена/отзыв — отдельные события, документ не переписывается. Утрата ключа не исправляется выдуманной подписью.

## Опциональный ATS / outbox

По умолчанию отправка OFF, локальная установка не обращается к чужому ATS. Для подготовленной интеграции оператор один раз создаёт ключ шифрования в приватной `.env` (команда не печатает значение и отказывается заменить существующее):

```text
node -e "const fs=require('node:fs'),u=require('node:util'),c=require('node:crypto');const t=fs.readFileSync('.env','utf8');if(u.parseEnv(t).SIGNAL_ATS_ENCRYPTION_KEY)throw Error('Preserve existing ATS encryption key');fs.appendFileSync('.env','\nSIGNAL_ATS_ENCRYPTION_KEY='+c.randomBytes(32).toString('base64')+'\n',{mode:384});"
```

`SIGNAL_ATS_ENCRYPTION_KEY` — base64 ровно 32 байт для AES-256-GCM. Этот master key не является webhook secret. Без него регистрация endpoint недоступна (`ats_key_missing`). Для полного Compose параметр передаётся из приватной `.env`; разрешение доставки — отдельное `SIGNAL_ATS_WORKER_ENABLED=true` и перезапуск app. Не меняйте master key без управляемого повторного шифрования: готового CLI миграции ciphertext нет, потеря старого ключа делает его нечитаемым.

Владелец компании открывает настройки ATS. Поддерживаются `GET/PUT /api/employer/ats`, `POST /api/employer/ats/{id}/disable` с revision и `POST /api/employer/ats/deliveries/{id}/retry` только для dead delivery. Повтор PUT с текущей revision ротирует secret, возвращаемый **один раз**. Передавать его получателю нужно приватно, не в issue/log. Изменение revision или disable подавляет старую доставку. Пользователь другой компании/роль не получает доступ.

Endpoint: HTTPS:443, без credentials/query/fragment; DNS проверяется при регистрации и каждой отправке. Запрещены loopback/private/link-local/reserved адреса, проверяются все ответы DNS, соединение закреплено за проверенным адресом. Redirect не выполняется. Timeout 5 с, ответ ≤4096 байт. Локальный test exception требует NODE_ENV=test и отдельные test-параметры; его нельзя включить в обычном runtime.

События `application.status_changed`, `invitation.status_changed`, `cv.access_revoked` записываются в транзакции бизнес-действия. Payload содержит routing/status references, не CV/имя/контакты/приватные заметки/описание need. Перед отправкой перепроверяются endpoint, lease, зависимости и текущий доступ. Lease 30 с, fence; до 5 попыток с exponential backoff+jitter, затем dead; ручной retry начинает новую серию. Это at-least-once: получатель обязан дедуплицировать UUID события и применять entity version последовательно.

Заголовки: `X-Signal-Id`, `X-Signal-Timestamp`, `X-Signal-Signature`. Подпись HMAC-SHA256 от `timestamp + '.' + eventId + '.' + rawBody`, окно ±300 с. Пример внутреннего `receiveWebhook` проверяет raw body ≤16000 байт, tenant, схему, UUID/bodyHash и version; это библиотечный пример, не опубликованный inbound HTTP endpoint. Старый `scripts/ats-contract-example.ts` — отдельный исторический синтетический контракт, не wire schema S14. Актуальный wire — `signal-ats-event-v1` в OpenAPI и `ats-outbox.ts`.

## Эксперименты и локальные workers

S10 включается только явным `SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED=true` на отдельной экспериментальной среде. Сохранённые результаты не выдаются за квалификацию. Независимых данных человеческой валидности/эквивалентности нет; обычная поставка оставляет false.

S11: `docker build -t signal-code-runner:1 ops/code-runner`, затем на отдельном нативном непроизводственном API `SIGNAL_CODE_RUNNER_ENABLED=true`. При необходимости `SIGNAL_CODE_RUNNER_IMAGE`/`SIGNAL_DOCKER_BIN`. Production блокирует исполнение независимо от флага. Не добавляйте Docker socket в обычный app ради обхода ограничения. Путь Docker — привилегия оператора; контейнерная изоляция не является доказательством защиты произвольного общего production-хоста.

Python 3.11.14; 192 МБ, 1 CPU, pids16, tmpfs16 МБ, read-only/no-network/no capabilities/non-root. Максимум две running lease и очередь 50; до трёх новых проверок пользователя за 24 ч, deadline 30 мин. Статусы distinguish wrong_answer/compile_error/runtime_error/time_limit/memory_limit/infrastructure_error/cancelled; сбой инфраструктуры не подтверждает и не опровергает квалификацию. Receipt содержит версию тестов/runtime/image digest. Условия таймера/fence/отмены проверяются сервером.

S15 прогноз отключён функцией `acceptancePredictionEnabled()=>false`, переменной для включения нет. Явные совпадения условий доступны независимо. S16 исторически не показал выигрыш latency; исходный путь расчёта сохранён, повтор после исправления старого reuse необходим в D.

Обычный `index.ts` запускает локальные microtask/research/PDF/invitation планировщики, watch/recovery и gated code/ATS workers. Их периоды/условия — [в паспорте](technical-passport.md#штатный-запуск-и-фоновые-задачи). Выключение watch/recovery параметром false не удаляет очереди; после включения они проверяют зависимости и отзывают устаревшие результаты. Восстановление не выполняет auto-apply preview и не отправляет приглашение вместо пользователя. Для локального старта MAIL_TRANSPORT должен оставаться mailpit.

## Хранение и отзыв

PDF исходник не хранится; фрагменты/review token очищаются после 24 ч, receipts удаляются после 24 ч. Вычисления старше 7 дней теряют disposable result с отметкой `calculation_retention_expired`; источники/версии/принятые действия сохраняются. Для исследования retention 1–90 дней (default30) и отдельный отзыв; это другой контур данных.

Отозванная гостевая ссылка/разрешение, закрытая потребность, изменённое CV или согласие перепроверяются при чтении, экспорте и доставке. Отзыв не восстанавливается перезапуском. История попыток, corrections/review, опубликованных документов/событий, приглашений и budget consumption не удаляется массовой «очисткой». Для append-only таблиц действуют DB guards. Автоматического бессрочного удаления всех outbox/history строк нет; доступ ограничен, срок дальнейшего архивирования должен определять оператор с сохранением аудита и dedup.

В `.gitignore` исключены `.env*` (кроме `.env.example`), outputs/local-backup, ключи, cookies/sessions/dumps/logs. Приватный ключ дополнительно обязан быть вне репозитория, даже если расширение игнорируется. Проверяйте состав выдачи отдельно: gitignore не очищает архив, а `.playwright-cli` и ручные QA exports нельзя включать в пакет. `.dockerignore` исключает секреты/QA-каталоги из build context. Закрытые snapshots/raw traces могут содержать персональные данные; в отчётах оставляйте агрегаты и хеши.

## Обновление и откат

1. Зафиксировать revision/версии образов и настройки, остановить записи в обновляемый экземпляр. Не менять Compose project/volume у существующей установки. Сохранить прежние POSTGRES_PASSWORD/VERIFICATION_TOKEN_SECRET, ключи и issuer; setup-env их не перезаписывает. Старый `.env` без POSTGRES_PASSWORD нужно дополнить **прежним** паролем его БД перед новым Compose.
2. Сделать backup вне репозитория. В PowerShell/sh одинаково (каталог `../signal-private` заранее создать с ограниченными правами):

```text
docker compose -p signal-local exec -T db pg_dump -U signal -d signal -Fc -f /tmp/signal-before-update.dump
docker compose -p signal-local cp db:/tmp/signal-before-update.dump ../signal-private/signal-before-update.dump
```

3. Пробное восстановление делать в **отдельную** БД, не поверх рабочей. Например, в собственной тестовой инстанции после копирования dump:

```text
docker compose -p signal-local exec -T db createdb -U signal signal_restore_check
docker compose -p signal-local exec -T db pg_restore -U signal --no-owner --exit-on-error -d signal_restore_check /tmp/signal-before-update.dump
```

4. Применить `pnpm run db:migrate` либо штатный container-start к контролируемой копии, затем проверить health, миграции 0000–0035, историю/согласия/отзывы и повторный запуск. Новый clean/upgrade/restart/persistence прогон фиксируется в D; старый отчёт 10 октября его не заменяет.
5. Безопасное функциональное выключение: adaptive/code/ATS false, при необходимости watch/recovery false, остановить свой app. Историю не удалять. Старый binary не обязан понимать новую схему: не запускать его наугад на рабочей БД и не удалять migrations journal. Для возврата к старому binary сначала отдельная совместимая копия/восстановление и проверка; записи, принятые после backup, требуют отдельной сверки и переноса, не теряются «откатом» молча.

`down -v`, reset-demo, ручное удаление источников/ревью/согласий и изменение чужих контейнеров не являются миграцией или откатом. Реальный DR для рабочей эксплуатации требует отдельной проверки; C2 не заявляет его выполненным.
