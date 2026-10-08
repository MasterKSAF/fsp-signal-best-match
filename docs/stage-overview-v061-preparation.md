# Обзорные Demo-данные: stage helper 0.6.1

Фактическое выполнение завершено 07.10.2026. Все 1608 прежних business rows сохранены, overview-only добавления подтверждены, повтор дал 0 добавлений/0 изменений. Новый guarded restart и browser Demo-каталог проверены. [Текущий отчёт и receipts](independent-fixes-20261007.md). Ниже сохранено описание исходного этапа подготовки.

Подготовлен [apply-owned-overview-demo-v061.cjs](../scripts/apply-owned-overview-demo-v061.cjs). На этапе подготовки helper, CheckOnly, тесты и сборка **не запускались**. Private runner/env, actual stage DB и процессы не читались. Это не receipt применения и не разрешение на перезапуск.

`node scripts/apply-owned-overview-demo-v061.cjs --check-only` возвращает preparation-only до любых source/private/DB/process/Docker reads. Default режим такой же. Root выполняет проверки и фактическое применение отдельно после окончания performance run.

Для actual mode нужны `SIGNAL_STAGE_OVERVIEW_V061_RELEASE=1`, `--apply-owned-stage` и все десять точных аргументов:

- `--expected-pid`, `--expected-started-at` — актуальный stage API процесс/Win32 CreationDate UTC, single loopback listener 127.0.0.1:4313.
- `--expected-runner-sha256` — фактический private runner SHA. Runner не execute/eval/import; проверяется только SHA, exact process argument и literal `@127.0.0.1:55435/signal_resume_stage`.
- `--expected-container-id`, `--expected-database-oid` — актуальная identity контейнера `signal-qa-cycle-01-db-1` и exact database `signal_resume_stage` на 127.0.0.1:55435.
- `--expected-helper-sha256`, `--expected-seeder-sha256`, `--expected-child-sha256`, `--expected-avatar-sha256` — SHA нового helper, `scripts/src/seed-overview-demo.ts`, dedicated `scripts/seed-overview-demo.ts` и synthetic avatar.
- `--historical-0009-proof-sha256` — неизменный actual receipt `outputs/verification/release-0.6.0/stage-upgrade-0009.json`. Его version0.6.0 остаётся историческим; он не переименовывается в0.6.1.

DB credential берётся только из проверенного Docker Config.Env и используется для жёстко собранного exact-target URL. Credential/private runner contents не печатаются. Helper проверяет actual applied0009, immutable origin trigger и digests всех live/deleted CV; не выполняет migrations.

Перед seed сохраняются commitments **всех полных public business rows** с row identity/hash и отдельные commitments прежних ordinary/reviewer/generalDemo ownership groups. Нет excluded columns; попытки, cooldowns, сессии и неявно связанные audit/history rows защищены общим commitment. В read-only repeatable-read transaction экспортируется PostgreSQL snapshot. Whole DB custom `pg_dump` пишет собственный `/tmp/signal-overview-v061-<GUID>.dump`; `docker cp` копирует binary dump вне Git, проверяются PGDMP header/bytes/SHA. Удаляется только этот конкретный temporary файл. Pipeline/shell archive не используется.

Перед любой DB mutation повторяются runtime/source/identity guards и проверяется отсутствие stage изменений после backup. Запускается только dedicated insert-once overview seeder. Затем все прежние строки должны сохранить полные bytes и identity, не только число строк. Допустимы ровно 6 users, 6 profiles, 8 CV, 6 preferences, по1 template/subscription/offer/marker; все новые users — reserved generalDemo, result company_task8/10 связан с новым secondary CV и не выдаёт Signal grade. Если content marker существовал, разрешено **0** additions и **0** repairs.

Новый private receipt: `~/.codex/private/signal-v061-stage-overview/signal-overview-stage-preservation-v061-<GUID>.json`. SchemaVersion1/type `signal-overview-stage-preservation-v061`; успех `status=PRESERVED`, `passed/noUnexpectedRows/noChangedPreexistingRows=true`; exact target/container/OID; `application{version:'0.6.1',apiOrigin,runnerSha256,pid,startTimeUtc}` связывает **прежний** процесс с target workspace version. `backup{path,sha256,bytes,private:true,sameExportedSnapshotAsBeforeHash:true}`; `before/after{preexistingBusinessRowsSha256,preexistingBusinessRows,commitment,protectedGroups}`; `historical0009ProofSha256`, `sourceHashes`, `addedByTable`.

NEW restart helper потребляет private `PreservationProofPath` и точный `PreservationProofSha256` вместе с историческим0009 proof. Сам overview helper не останавливает/перезапускает API, не запускает all-seed/reset/repair и не восстанавливает backup автоматически. Concurrent activity или неожиданное изменение дают FAIL receipt: это не основание стирать пользовательские действия. PostgreSQL sequence counters не являются business rows. Browser/load/current API-version acceptance выполняется отдельно root.
