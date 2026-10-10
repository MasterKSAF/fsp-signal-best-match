# Signal

**Осознанный выбор — лучшее начало!**

Signal — сервис подбора ИТ-специалистов и подходящих предложений. Кандидат показывает навыки, выбирает резюме и решает, кому открыть контакты. Компания видит, какие требования подтверждены, и может ждать отклики на вакансию либо самостоятельно искать специалистов через приватный запрос и каталог.

Решение команды **Best Match** для специального трека Федерации спортивного программирования, ЛЦТ 2026.

## Что можно проверить

- Несколько резюме, паспорт навыков, проверки Junior / Middle / Senior, экспорт PDF и Word.
- Раздельные требования к заявленным и подтверждённым навыкам; объяснение соответствия конкретного резюме.
- Вакансии и отклики с историей у обеих сторон; приватные запросы со своим списком отобранных кандидатов.
- Приглашение по вакансии или запросу, согласие кандидата на контакты, задания компании по её вакансии.

## Запуск через Docker

Нужен запущенный **Docker Desktop в режиме Linux containers** либо Docker Engine с Compose. Для первой сборки нужен интернет. Порты `4450`, `55450` и `8050` должны быть свободны; Node.js и PostgreSQL на компьютер устанавливать не нужно.

Скачайте [исходники ZIP с Google Drive](https://drive.google.com/file/d/1SgEiJjwBc_sOsU3xDT83kRO0z_8_tMRb/view?usp=drivesdk) и распакуйте архив. Альтернатива — [GitHub](https://github.com/MasterKSAF/fsp-signal-best-match/tree/codex/signal-delivery-20261009), но репозиторий пока приватный; без доступа используйте ZIP. В Windows выберите короткий путь, например `C:\Signal`. Откройте терминал в папке с `compose.yaml` и `Dockerfile`.

В **Windows, PowerShell 7** выполните по порядку:

```powershell
docker run --rm -v "${PWD}:/app" -w /app node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 node scripts/setup-env.mjs
docker compose -p signal-release-n-final --profile full up -d --build --wait --wait-timeout 180
```

В **Linux, Bash** используйте владельца текущего пользователя для создаваемой `.env`:

```bash
signalNodeImage='node:24-bookworm-slim@sha256:'
signalNodeImage+='0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6'
docker run --rm --user "$(id -u):$(id -g)" \
  -v "${PWD}:/app" -w /app "$signalNodeImage" \
  node scripts/setup-env.mjs
docker compose -p signal-release-n-final --profile full \
  up -d --build --wait --wait-timeout 180
```

Первая команда создаёт локальную `.env` со случайным секретом. Существующая `.env` сохраняется. Вторая собирает приложение, запускает базу и почтовый просмотрщик, автоматически применяет миграции **0000–0019** и подготавливает демонстрационные данные.

Откройте **[Signal — localhost:4450](http://localhost:4450)**. Нажмите **«Войти»**, включите **Demo** и выберите **«Я кандидат»** или **«Я работодатель»**. Демонстрационные профили вымышленные.

Обычную регистрацию можно проверить отдельно: код подтверждения приходит в локальный **[Mailpit — localhost:8050](http://localhost:8050)**. Письмо не отправляется на внешнюю почту. Для сквозного сценария используйте обе роли в одном режиме: Demo с Demo или два обычных аккаунта. [Последовательность действий двух ролей](docs/expert-guide.md#4-сквозной-сценарий-двух-ролей) начинается с публикации вакансии.

## Остановка и повторный запуск

```sh
docker compose -p signal-release-n-final --profile full stop
docker compose -p signal-release-n-final --profile full up -d --wait
```

Резюме, отклики, попытки и приглашения сохраняются в томе PostgreSQL. Сохраняйте `.env` и используйте то же имя проекта. Не добавляйте `--volumes` к команде удаления контейнеров, если нужны данные стенда.

## Документация

- [Видео, презентация PDF/PPTX и инструкция PDF](https://drive.google.com/drive/folders/1fCgfQIBzSvpCtiURdJdpXMRml3Wmxqgg).
- [Инструкция эксперту: скачивание, запуск и сценарии двух ролей](docs/expert-guide.md).
- [Технический паспорт: полный каталог, установка, архитектура, сценарии и материалы](docs/technical-passport.md).
- [Отчёт проверки воспроизводимости 10 октября](docs/verification-2026-10-10.md) · [PDF](https://drive.google.com/file/d/1PfO3DjuY7mzxyf_L5DVE14uLGXPTqWLo/view?usp=drivesdk).
- [Возможности Signal: подробный обзор функций кандидата и работодателя](docs/features.md).
- [Техническое описание: архитектура, проверки, подбор, валидация, ФСП и версии](docs/technical-overview.md).
- [OpenAPI 3.1 — запросы, ответы и ошибки](lib/api-spec/openapi.yaml); [спецификация работающего стенда](http://localhost:4450/api/openapi.yaml).

Если запуск не завершился, выполните `docker compose -p signal-release-n-final --profile full logs --tail 80 app`. Разбор частых причин приведён в инструкции эксперту.
