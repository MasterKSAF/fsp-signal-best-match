#18 programme and competency matrix

Current bank: signal-skills-2026-10-v6. Each programme samples6 competencies from3 authored scenarios each. Five n-values/two flags are finite parameter variants, not new questions. Criteria below describe the contract; answer texts stay in private operator verification worksheets.

Pass: at least5/6 and every critical competency; Middle/Senior require both parts. Role category additionally requires the versioned mandatory engineering/declared-stack matrix. No numeric professional Grade is invented.

## Python / Junior

basic executable result or concrete contract decision

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| collections | Коллекции и ссылки | yes | alias/deep-copy/context ownership | primary standalone execution/state worksheet |
| iteration | Итераторы и границы | no | iterator exhaustion/partition/cancellation boundary | primary standalone execution/state worksheet |
| functions | Функции и область видимости | no | default/closure/descriptor binding | primary standalone execution/state worksheet |
| exceptions | Исключения и finally | no | primary error overwritten by cleanup | primary standalone execution/state worksheet |
| resources | Ресурсы и генераторы | no | resource lifetime/await cancellation | primary standalone execution/state worksheet |
| data-boundary | Проверка внешних данных | yes | bool-as-int/schema-version and external fields | primary standalone execution/state worksheet |

## Python / Middle

basic result plus applied independent requirement, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| collections | Разделить вложенное состояние, сохранив намеренные общие ссылки внутри новой копии | yes | alias/deep-copy/context ownership | primary execution/state worksheet + independent Middle V2 worksheet |
| iteration | Проследить частичное потребление потокового итератора и ограниченный look-ahead | no | iterator exhaustion/partition/cancellation boundary | primary execution/state worksheet + independent Middle V2 worksheet |
| functions | Отличить состояние замыкания фабрики от default аргумента и независимость экземпляров | no | default/closure/descriptor binding | primary execution/state worksheet + independent Middle V2 worksheet |
| exceptions | Сохранить исходную ошибку и атомарность при сбое rollback/cleanup | no | primary error overwritten by cleanup | primary execution/state worksheet + independent Middle V2 worksheet |
| resources | Предсказать LIFO освобождение и изменение исключения во вложенных context managers | no | resource lifetime/await cancellation | primary execution/state worksheet + independent Middle V2 worksheet |
| data-boundary | Проверить несколько runtime-инвариантов до атомарной записи пакета | yes | bool-as-int/schema-version and external fields | primary execution/state worksheet + independent Middle V2 worksheet |

## Python / Senior

independent Senior operational result plus engineering invariant, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| collections | Контролировать ownership и инварианты графа Python-объектов | yes | alias/deep-copy/context ownership | independent Senior operational state model + Senior108 semantic worksheet |
| iteration | Проектировать ограниченное потребление ленивых потоков | no | iterator exhaustion/partition/cancellation boundary | independent Senior operational state model + Senior108 semantic worksheet |
| functions | Согласовывать callable-контракты, контекст и асинхронное владение | no | default/closure/descriptor binding | independent Senior operational state model + Senior108 semantic worksheet |
| exceptions | Сохранять семантику исключений и отмены при восстановлении | yes | primary error overwritten by cleanup | independent Senior operational state model + Senior108 semantic worksheet |
| resources | Обеспечивать детерминированное освобождение частично созданных ресурсов | no | resource lifetime/await cancellation | independent Senior operational state model + Senior108 semantic worksheet |
| data-boundary | Защищать границы Python-десериализации без скрытой потери данных | yes | bool-as-int/schema-version and external fields | independent Senior operational state model + Senior108 semantic worksheet |

## SQL / Junior

basic executable result or concrete contract decision

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| joins | Соединения и кардинальность | yes | join multiplicity/pagination identity | primary standalone execution/state worksheet |
| aggregation | Группировки и фильтры | no | WHERE/HAVING/window ordering | primary standalone execution/state worksheet |
| nulls | NULL и трёхзначная логика | no | NULL/UNKNOWN predicate assumptions | primary standalone execution/state worksheet |
| transactions | Транзакции и конкурентность | no | lost update/write skew/commit versus delivery | primary standalone execution/state worksheet |
| windows | Порядок и оконные функции | no | non-total ordering/tie selection | primary standalone execution/state worksheet |
| constraints | Ограничения и целостность | yes | wrong unique scope/NULL/FK/receipt atomicity | primary standalone execution/state worksheet |

## SQL / Middle

basic result plus applied independent requirement, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| joins | Сохранить гранулярность агрегата при JOIN двух связей один-ко-многим | yes | join multiplicity/pagination identity | primary execution/state worksheet + independent Middle V2 worksheet |
| aggregation | Собрать общий средний показатель из частичных сумм и знаменателей | no | WHERE/HAVING/window ordering | primary execution/state worksheet + independent Middle V2 worksheet |
| nulls | Исправить anti-join при NULL справа без потери семантики NULL слева | no | NULL/UNKNOWN predicate assumptions | primary execution/state worksheet + independent Middle V2 worksheet |
| transactions | Предотвратить write skew для инварианта нескольких строк | no | lost update/write skew/commit versus delivery | primary execution/state worksheet + independent Middle V2 worksheet |
| windows | Различить окно ROWS/RANGE для одинаковых sort keys | no | non-total ordering/tie selection | primary execution/state worksheet + independent Middle V2 worksheet |
| constraints | Различить повтор события и конфликт payload при атомарной записи результата | yes | wrong unique scope/NULL/FK/receipt atomicity | primary execution/state worksheet + independent Middle V2 worksheet |

## SQL / Senior

independent Senior operational result plus engineering invariant, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| joins | Сохранять зерно многосвязного запроса и доказывать кардинальность | yes | join multiplicity/pagination identity | independent Senior operational state model + Senior108 semantic worksheet |
| aggregation | Проектировать точные агрегаты и инкрементальные пересчёты | no | WHERE/HAVING/window ordering | independent Senior operational state model + Senior108 semantic worksheet |
| nulls | Явно контролировать неизвестные значения и антисоединения | no | NULL/UNKNOWN predicate assumptions | independent Senior operational state model + Senior108 semantic worksheet |
| transactions | Доказывать конкурентные инварианты и пределы изоляции | yes | lost update/write skew/commit versus delivery | independent Senior operational state model + Senior108 semantic worksheet |
| windows | Согласовывать полный порядок, оконную рамку и пагинацию | no | non-total ordering/tie selection | independent Senior operational state model + Senior108 semantic worksheet |
| constraints | Проектировать SQL-целостность и совместимые переходы схемы | yes | wrong unique scope/NULL/FK/receipt atomicity | independent Senior operational state model + Senior108 semantic worksheet |

## TypeScript / Junior

basic executable result or concrete contract decision

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| narrowing | Сужение типов | yes | compile-time union versus untrusted runtime | primary standalone execution/state worksheet |
| runtime | Runtime-границы | no | assertion used as validation/scheduling snapshot | primary standalone execution/state worksheet |
| generics | Generics и контракт функции | no | constraint preserves shape but not correlation | primary standalone execution/state worksheet |
| mapping | Преобразование структур | no | mutating map/sort and unchecked external values | primary standalone execution/state worksheet |
| async | Асинхронные результаты | no | fail-fast versus per-item result/cancellation ownership | primary standalone execution/state worksheet |
| immutability | Неизменяемые обновления | yes | readonly type versus original mutable nested reference | primary standalone execution/state worksheet |

## TypeScript / Middle

basic result plus applied independent requirement, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| narrowing | Проверить исчерпываемость union и неизвестный вход на runtime-границе | yes | compile-time union versus untrusted runtime | primary execution/state worksheet + independent Middle V2 worksheet |
| runtime | Предсказать различие копии ссылки и значения перед microtask | no | assertion used as validation/scheduling snapshot | primary execution/state worksheet + independent Middle V2 worksheet |
| generics | Проверить безопасную границу callback для более широкого входа | no | constraint preserves shape but not correlation | primary execution/state worksheet + independent Middle V2 worksheet |
| mapping | Различить идентичность, порядок и фильтрацию при нормализации внешних данных | no | mutating map/sort and unchecked external values | primary execution/state worksheet + independent Middle V2 worksheet |
| async | Проследить ошибку агрегированной async-операции и независимое завершение sibling | no | fail-fast versus per-item result/cancellation ownership | primary execution/state worksheet + independent Middle V2 worksheet |
| immutability | Обеспечить structural sharing с изоляцией вложенного изменённого узла | yes | readonly type versus original mutable nested reference | primary execution/state worksheet + independent Middle V2 worksheet |

## TypeScript / Senior

independent Senior operational result plus engineering invariant, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| narrowing | Обеспечивать исчерпываемые протоколы на runtime-границах | yes | compile-time union versus untrusted runtime | independent Senior operational state model + Senior108 semantic worksheet |
| runtime | Различать статическую типизацию и наблюдаемую JavaScript-семантику | no | assertion used as validation/scheduling snapshot | independent Senior operational state model + Senior108 semantic worksheet |
| generics | Сохранять soundness generic и variance контрактов | no | constraint preserves shape but not correlation | independent Senior operational state model + Senior108 semantic worksheet |
| mapping | Строить lossless-преобразования с явной identity и provenance | no | mutating map/sort and unchecked external values | independent Senior operational state model + Senior108 semantic worksheet |
| async | Управлять жизненным циклом асинхронных результатов и отмены | yes | fail-fast versus per-item result/cancellation ownership | independent Senior operational state model + Senior108 semantic worksheet |
| immutability | Доказывать ownership и неизменяемость вложенных снимков | yes | readonly type versus original mutable nested reference | independent Senior operational state model + Senior108 semantic worksheet |

## React / Junior

basic executable result or concrete contract decision

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| state | Очередь state-обновлений | yes | snapshot queue/delta/durable ownership | primary standalone execution/state worksheet |
| closures | Замыкания обработчиков | no | stale closure and abandoned render publication | primary standalone execution/state worksheet |
| effects | Эффекты и очистка | no | listener/resource cleanup and request generation | primary standalone execution/state worksheet |
| identity | Идентичность и key | no | position/server id versus durable client/plugin identity | primary standalone execution/state worksheet |
| forms | Управляемые формы | no | baseline/draft merge and submit revision | primary standalone execution/state worksheet |
| composition | Композиция и состояние | yes | reset boundary/async error/durable state separation | primary standalone execution/state worksheet |

## React / Middle

basic result plus applied independent requirement, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| state | Проследить очередь functional/replacement updates и устаревший async callback | yes | snapshot queue/delta/durable ownership | primary execution/state worksheet + independent Middle V2 worksheet |
| closures | Согласовать closure и identity асинхронного действия при переключении сущности | no | stale closure and abandoned render publication | primary execution/state worksheet + independent Middle V2 worksheet |
| effects | Разобрать StrictMode setup/cleanup и предотвращение устаревшей подписки | no | listener/resource cleanup and request generation | primary execution/state worksheet + independent Middle V2 worksheet |
| identity | Определить сохранение вложенного state по совокупности типа и key границ | no | position/server id versus durable client/plugin identity | primary execution/state worksheet + independent Middle V2 worksheet |
| forms | Согласовать асинхронное сохранение формы с более поздним локальным изменением | no | baseline/draft merge and submit revision | primary execution/state worksheet + independent Middle V2 worksheet |
| composition | Разделить render/async failure и восстановление без потери draft или ложного успеха | yes | reset boundary/async error/durable state separation | primary execution/state worksheet + independent Middle V2 worksheet |

## React / Senior

independent Senior operational result plus engineering invariant, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| state | Согласовывать concurrent rendering и атомарность состояния | yes | snapshot queue/delta/durable ownership | independent Senior operational state model + Senior108 semantic worksheet |
| closures | Отделять event-замыкания от актуальной сущности и версии | no | stale closure and abandoned render publication | independent Senior operational state model + Senior108 semantic worksheet |
| effects | Делать effects обратимыми и external store согласованным | yes | listener/resource cleanup and request generation | independent Senior operational state model + Senior108 semantic worksheet |
| identity | Проектировать границы identity без потери чужого состояния | no | position/server id versus durable client/plugin identity | independent Senior operational state model + Senior108 semantic worksheet |
| forms | Согласовывать оптимистическую форму с конкурентным сохранением | no | baseline/draft merge and submit revision | independent Senior operational state model + Senior108 semantic worksheet |
| composition | Восстанавливать React-subtree с корректными границами ошибок | yes | reset boundary/async error/durable state separation | independent Senior operational state model + Senior108 semantic worksheet |

## Backend engineering / Junior

basic executable result or concrete contract decision

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| api | Контракты API | yes | principal/action/key scope and replay hash | primary standalone execution/state worksheet |
| data | Согласованность данных | no | local CAS mistaken for global bound/outbox split | primary standalone execution/state worksheet |
| reliability | Повторы и сбои | no | unknown provider outcome/retry/fencing recipient | primary standalone execution/state worksheet |
| diagnostics | Диагностика | no | denominator/trace cause versus apparent improvement | primary standalone execution/state worksheet |
| security | Авторизация и границы | no | UI/cache permission mistaken for authoritative ACL | primary standalone execution/state worksheet |
| integration | Связанные инженерные решения | yes | migration/command receipt/compensation ordering | primary standalone execution/state worksheet |

## Backend engineering / Middle

basic result plus applied independent requirement, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| api | Разделить scope receipt между авторизованными клиентами и типами действий при общем key | yes | principal/action/key scope and replay hash | primary execution/state worksheet + independent Middle V2 worksheet |
| data | Защитить инвариант множества строк от конкурентного write skew | no | local CAS mistaken for global bound/outbox split | primary execution/state worksheet + independent Middle V2 worksheet |
| reliability | Определить предел гарантий outbox при потерянном подтверждении внешнего действия | no | unknown provider outcome/retry/fencing recipient | primary execution/state worksheet + independent Middle V2 worksheet |
| diagnostics | Проверить причинную гипотезу по границам trace, а не корреляции одного графика | no | denominator/trace cause versus apparent improvement | primary execution/state worksheet + independent Middle V2 worksheet |
| security | Определить линейную точку авторизации экспорта относительно отзыва grant | no | UI/cache permission mistaken for authoritative ACL | primary execution/state worksheet + independent Middle V2 worksheet |
| integration | Согласовать транзакционный intent, crash/retry и подтверждённое состояние процесса | yes | migration/command receipt/compensation ordering | primary execution/state worksheet + independent Middle V2 worksheet |

## Backend engineering / Senior

independent Senior operational result plus engineering invariant, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| api | Формализовать контракты API, retry и совместимость | yes | principal/action/key scope and replay hash | independent Senior operational state model + Senior108 semantic worksheet |
| data | Доказывать межресурсные инварианты распределённых данных | yes | local CAS mistaken for global bound/outbox split | independent Senior operational state model + Senior108 semantic worksheet |
| reliability | Контролировать отказ, backpressure и неопределённый исход | no | unknown provider outcome/retry/fencing recipient | independent Senior operational state model + Senior108 semantic worksheet |
| diagnostics | Сопоставлять SLO, наблюдаемость и причинные гипотезы | no | denominator/trace cause versus apparent improvement | independent Senior operational state model + Senior108 semantic worksheet |
| security | Сохранять объектную авторизацию и границы доверия | yes | UI/cache permission mistaken for authoritative ACL | independent Senior operational state model + Senior108 semantic worksheet |
| integration | Планировать связные миграции и восстановление после частичного сбоя | yes | migration/command receipt/compensation ordering | independent Senior operational state model + Senior108 semantic worksheet |

## Frontend engineering / Junior

basic executable result or concrete contract decision

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| state-model | Модель состояния | yes | independent copies of derived state/draft/receipt | primary standalone execution/state worksheet |
| accessibility | Доступность | no | native keyboard/focus/virtualized identity/motion | primary standalone execution/state worksheet |
| performance | Производительность | no | main-thread/network/lazy dependency/geometry | primary standalone execution/state worksheet |
| async-ui | Асинхронный UI | no | late success/catch/rollback changes current owner | primary standalone execution/state worksheet |
| architecture | Границы архитектуры | no | DTO/cache/account permission boundary | primary standalone execution/state worksheet |
| integration | Связанные инженерные решения | yes | save/navigation/export/grant/recovery lifecycle | primary standalone execution/state worksheet |

## Frontend engineering / Middle

basic result plus applied independent requirement, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| state-model | Согласовать серверную ревизию, более новый draft и identity ответа | yes | independent copies of derived state/draft/receipt | primary execution/state worksheet + independent Middle V2 worksheet |
| accessibility | Проследить вложенные диалоги и возврат фокуса после удаления opener | no | native keyboard/focus/virtualized identity/motion | primary execution/state worksheet + independent Middle V2 worksheet |
| performance | Посчитать end-to-end критический путь при зависимости запросов и блокировке main thread | no | main-thread/network/lazy dependency/geometry | primary execution/state worksheet + independent Middle V2 worksheet |
| async-ui | Откатить отдельную optimistic operation без потери успешных следующих изменений | no | late success/catch/rollback changes current owner | primary execution/state worksheet + independent Middle V2 worksheet |
| architecture | Закрыть account-scoped cache и поздний in-flight response после logout | no | DTO/cache/account permission boundary | primary execution/state worksheet + independent Middle V2 worksheet |
| integration | Согласовать защищённый экспорт с отзывом grant и устаревшим UI/cache | yes | save/navigation/export/grant/recovery lifecycle | primary execution/state worksheet + independent Middle V2 worksheet |

## Frontend engineering / Senior

independent Senior operational result plus engineering invariant, both mandatory

| Competency | Level criterion | Critical | Typical semantic error | Reference basis |
| --- | --- | --- | --- | --- |
| state-model | Строить согласованную модель клиентских операций и ревизий | yes | independent copies of derived state/draft/receipt | independent Senior operational state model + Senior108 semantic worksheet |
| accessibility | Сохранять доступность в динамических составных интерфейсах | yes | native keyboard/focus/virtualized identity/motion | independent Senior operational state model + Senior108 semantic worksheet |
| performance | Обосновывать измеряемые performance-решения и бюджеты | no | main-thread/network/lazy dependency/geometry | independent Senior operational state model + Senior108 semantic worksheet |
| async-ui | Управлять независимыми асинхронными процессами и stale data | no | late success/catch/rollback changes current owner | independent Senior operational state model + Senior108 semantic worksheet |
| architecture | Определять границы модулей, cache и владельцев данных | no | DTO/cache/account permission boundary | independent Senior operational state model + Senior108 semantic worksheet |
| integration | Согласовывать SSR, навигацию и восстановление операций | yes | save/navigation/export/grant/recovery lifecycle | independent Senior operational state model + Senior108 semantic worksheet |

The JSON companion records all324 n5true reference keys. Extra independent Middle n9false models are retained separately. This matrix is a content/coverage description, not a human validation certificate.
