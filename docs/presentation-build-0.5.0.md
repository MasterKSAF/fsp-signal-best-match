# Презентация Signal 0.5.0

Новая презентация содержит 10 слайдов. Структура: продукт, ценность для обеих ролей, несколько резюме, квалификация, отличие задачи компании, каталог/подбор, контакты, доверие, самостоятельная проверка, команда и развитие. Старые PPTX/PDF 0.4.1 не изменяются.

`docs/presentation-content-0.5.0.json` содержит короткие тексты и источники в notes. Восемь исходных JPEG в `outputs/release-0.5.0/media` используются по одному разу, без ретуши, обрезания доказательств и изменения пропорций. Среди них новый каталог, сравнение полного пула и принятая апелляция. Названия первых файлов исправлены владельцем media с `.png` на `.jpg` без изменения байтов. Скриншоты фиксируют синтетический stage UI4314/API4313. Они не приписываются будущему финальному runtime без отдельной проверки.

Сборщик `scripts/build-pitch-v050.mjs` использует официальный исходный ФСП template: обложку, master/layout, Montserrat и исходную цветовую схему. Остальные слайды имеют плоскую композицию с редактируемым текстом. Реальные screenshots являются растровой иллюстрацией, логотипы и исходное оформление сохраняются. Источник template находится в родительском `reference`, font asset — в сохранённом конкурсном каталоге. Сборка приложения от них не зависит.

## Подготовка

```powershell
C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe scripts/build-pitch-v050.mjs --check-only
```

Check-only проверяет version/content/eight source JPEG SHA и пути. Он не импортирует PPTX, не рендерит и не создаёт выходные PPTX/PDF.

## Рендер после освобождения CPU

Не выполнять во время полной нагрузки. Перед первым фактическим созданием презентации ровно один раз выполнить штатный `mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format pptx` из каталога skill Presentations. Для выполнения используется bundled Node, не изменяем зависимости.

После этой команды и явного разрешения владельца нагрузки:

```powershell
C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe scripts/build-pitch-v050.mjs --render-approved
```

Исходный draft имеет явно незавершённые load/clean факты. Builder создаёт новую private build-папку `outputs/internal/pitch-0.5.0/<id>`, экспортирует candidate, выполняет PPTX integrity/layout/font/import checks, импортирует именно сохранённый итоговый PPTX и рендерит каждый слайд. PDF строится из этих точных рендеров. ReportLab размещает готовые рендеры, не рисует новые иллюстрации.

Финальные строки приёмки можно взять из отдельного `outputs/release-0.5.0/presentation-facts.json` через `--facts`. Такой post-seal overlay не изменяет замороженные исходники и не создаёт повторный seal из-за записи результата clean. Файл facts не является самостоятельным доказательством.

Overlay содержит `schemaVersion: 1`, `applicationVersion: "0.5.0"` и четыре записи `{path, sha256}`: `load` (actual combined full two-phase report), `clean` (новый clean-source-launch.json), `sourceSeal` и `mediaAgreement`. Builder читает именно байты этих отчётов по SHA и проверяет их содержимое:

- Full load: оригинальные 5000/1/5/32/30/180 и пороги, обе реальные phase execution, все пять маршрутов, zero errors, valid12+ sampling/identity/RAM, неизменный порядок и успешная own cleanup. Source hashes двух фаз должны совпасть с текущими файлами.
- Clean: exact new seal, новая версия, fresh dependencies/empty DB, unit PASS, реальные PDF и reviewer own cleanup, все три offline outcomes, тот же accepted API bundle и protected runtime.
- `mediaAgreement`: `passed: true`, `sameVisibleUI: true`, SHA текущего browser MD в `browserSourceSha256`, непустые `currentUIHashes` текущих UI source файлов и `originalMediaHashes` с восемью screenshot keys из content JSON. Этот реальный owner-protocol должен подтвердить совместимость stage-снимков с финальными исходниками, а не переименовать прошлый capture в новый.

Просмотреть все 10 полных `final-slide-N.png`, проверить PDF по страницам и сверить состав речи. Только после этого копировать неизменённые просмотренные файлы в `outputs/release-0.5.0/Signal-Pitch.pptx` и `outputs/release-0.5.0/Signal-Pitch.pdf` с отдельным visual/media proof в том же новом каталоге. Автоматические validators не являются визуальной или нативной PowerPoint-приёмкой. Пока draft=true, файл не является финальным конкурсным комплектом.

Для final overlay нужны actual load двух исходных полных фаз, actual new-source clean PASS и согласованные browser/source facts. Нельзя использовать unit count155, старую нагрузку1000, старый source seal или чужие screenshot/runtime hashes как результат0.5.0. Windows WorkingSet новой native API нагрузки описывается как native Windows память, а не Docker memory.
