# Signal — карточки резюме, грейд и состав документов

Рабочая копия: `C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008`.

Это отчёт об изменениях U04/U05/U06/U07/U08/U09 и части U13. Общую браузерную приёмку обеих тем U16, обновление демозаписей и единообразие employer UI проводит основной агент. Этот отчёт не подменяет их приёмку.

| Пункт | Изменение | Проверка и доказательство | Остаток |
|---|---|---|---|
| U04 | Один заголовок должности; нет повторного Backend / Python. Создание использует справочник, включая AI/ML, и свободный ввод. Пользовательский title не переписывается. | HTTP: копия авторского title сохраняет его; создание ML-инженера не меняет программу. `documents-http/http.json`. | Браузер и адресный demo seed — общий U16. |
| U05 | Общий SkillChips; canonical aliases, раскрываемые +N. Обязательные рекомендации берутся только из матрицы роли; действительный Junior остаётся зелёным, действие ведёт на Middle с captured resume ID. Не приписываются PostgreSQL из SQL или FastAPI из Python. | `resume-progress.test.ts`, `resume-document-composition.test.ts`: уровни, aliases, независимые навыки, source сохранены. | Согласованные цвета и живые ссылки — общий U16. |
| U06 | `Грейд: Middle · по экзамену` отдельно от `Отдельные навыки: 0 из N`. Для результата без связанного экзамена — `по сохранённому результату`; новый профиль — `Грейд не подтверждён`. Источник/дата/версия компактно в i. Пустая дорожка имеет видимый нейтральный фон, value остаётся 0. | Unit: действительный комплексный Middle с пустыми proofs не обнуляется и не создаёт новых proofs; fingerprint входа не меняется. | Общие исторические DB fingerprints и визуальная дорожка — основной отчёт. |
| U07 | Radix menu закрывает outside/Escape/выбор; название `Создать копию резюме`. Удаление открывается после возврата фокуса к trigger; отмена возвращает фокус, после удаления фокус у создания. Максимум пять остаётся в API и UI. | HTTP: копия и создание шестого получают 409; видимость и согласия копии отключены. | Живой keyboard/outside/focus — общий U16. |
| U08 | Компактный `Состав файла`, 10 optional sections. HTML/локальный PDF.js/скачанные PDF/DOCX берут один серверный projection. Контакты исключаются из всех текстов и ссылок даже владельцем. Исходный CV не изменяется. Один список навыков. | 1024 комбинации состава; HTTP CV hash до/после одинаков. Конечные файлы, текст, XML/relationships/metadata и PDF annotations проверены. | Native DOCX renderer недоступен; структура и реальный PDF проверены. |
| U09 | Whitelist запроса; разрешённые поля ∩ выбранные. Exact resume ACL; поля не открывают sibling/B. После async render права и source проверяются повторно, changed bytes отбрасываются. Preview/HEAD/owner не записывают events; download dedup сохраняется при смене состава/формата. | HTTP: чужие/анонимные denied, revoke закрывает GET/HEAD четырёх routes для всех старых составов; views 0/downloads 1. Race: real DOCX rendering + mid-render revoke/source change возвращает null output. | Открытый employer preview проверяет ACL каждые 5 секунд и при window focus; real-time push отсутствует. |
| U13 | `qualificationGradeLabel` и source-labelled file header отделяют грейд от балла попытки, количества навыков и matching. Не вводится числовой Grade. | Комплексный Middle/модульный Junior показаны одновременно с разным scope; исходные данные не меняются. | Employer/filter consistency — основная реализация и U16. |

## Состав документа и API

Запрос `fields` поддерживается у `/resumes/:id/document-preview`, `/preview.pdf`, `/document.pdf`, `/document.docx`.

Канонический whitelist: `contacts,salary,conditions,summary,skills,experience,projects,education,portfolio,softSkills`.

Отсутствующий параметр включает все разрешённые optional sections. `fields=` исключает все optional sections, оставляя идентичность/должность и честный профессиональный грейд. Неизвестные значения и массив из повторённых параметров отвергаются с 400; дубликаты внутри допустимого списка канонически удаляются. `contacts` охватывает email, телефон и личные ссылки во всех произвольных строках. Портфолио зависит от разрешения на контакты и выбранного contacts. Зарплата вынесена в отдельный структурированный раздел, поэтому суммы 7+ цифр не принимаются за телефон.

Возвращаемые `composition` — эффективный набор после пересечения прав, `contactsPermitted` — действующее право, `contactsAllowed` — право вместе с выбором. Это позволяет владельцу снова включить контакты после собственного исключения; работодатель не может включить их без разрешения.

Cache key preview содержит actor ID/role, resume ID и canonical fields. PDF worker связан с actor/audience/contacts/revision/fields; при смене состава создаётся новый viewer. Abort/destroy сохраняются; iframe и cached bytes отсутствуют. При ACL error старый viewer размонтируется.

`guardResumeDocumentProjection` повторно получает exact ACL после завершения рендера. Сравниваются resume ID/revision, контакты, публичная идентичность и общий identity revision. Потеря exact доступа — 404; изменение разрешения/источника — 409 `RESUME_DOCUMENT_CHANGED`. Старые bytes не отправляются и не получают download event. JSON preview использует тот же guard.

## Выполненные проверки

- `node --import tsx --test tests/resume-document.test.ts tests/resume-document-composition.test.ts tests/resume-progress.test.ts`: **22/22 PASS** после последнего изменения, включая original privacy regressions, 1024 compositions и асинхронный race.
- Frontend и API typecheck: **PASS** после сборки библиотек. Проверки выполнялись в отдельной рабочей копии.
- `scripts/ui-refinement-export-http.ts`: **PASS**, 5 содержательных групп на изолированном API 4371 / БД `signal_ui_refinement_20261008` на 55435; четыре собственных UUID actors, cleanup 0. Итерация 01 проверяла основные экспорты; окончательная проверка после guard фиксируется в том же receipt.
- `scripts/inspect-resume-composition.py`: конечные unit specimens PDF/DOCX — PASS, 2 файла, 1 PDF page. PDF страница визуально проверена.
- `scripts/inspect-ui-refinement-http-files.py`: реальные файлы из API — PASS, 7 файлов, 7 PDF pages; все PDF страницы визуально проверены. Полные OOXML/relationships и PDF text/link/metadata проверены. Native Word/LibreOffice rendering не объявляется выполненным.

Артефакты: `outputs/verification/ui-refinement-20261008/documents-composition/`, `documents-http/`, `exports-owned-source.json`. Runtime/build fingerprint фиксирует основной агент отдельно для окончательного bundle, а не приписывает результат итерации 01 следующей сборке.

Грейды, попытки, ответы и доказательства в HTTP fixtures не создавались и не менялись. Адресное разрешение представлялось собственной accepted-invitation fixture; обычный revoke API проверен. Это проверка границ экспортов, а не новая приёмка всей механики matching/invite. Пользовательские данные и принятый стенд 4313/4314 не использовались.
