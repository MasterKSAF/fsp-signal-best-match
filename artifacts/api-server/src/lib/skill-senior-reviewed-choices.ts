/** Reviewed original Senior plans. Each incorrect option loses a specific guarantee despite its supporting steps. */
const choices:Record<string,readonly (readonly string[])[]>={
  "python": [
    [
      "Рекурсивно неизменяемое представление с явной политикой циклов. Изоляция deepcopy/ownership не запрещает мутации самой копии.",
      "Сделать deepcopy и запретить запись только во внешний tuple; получатель сможет изменять вложенные списки копии, но изоляция считается достаточным запретом всех мутаций.",
      "Применить shallow immutable wrapper к внешнему списку и оставить прежние mutable узлы внутри; аннотации Sequence назначить всем public аргументам.",
      "Передать эксклюзивную копию с документированным ownership получателю и считать это техническим запретом append на любые вложенные списки."
    ],
    [
      "Новый внешний C и отдельная копия изменяемого C.data перед append; остальные действительно неизменяемые узлы можно разделять.",
      "Создать ещё одну shallow-копию dict C перед append; изменённый data останется общим, но новый внешний dict считать достаточным snapshot.",
      "Обновить shared data, а затем восстановить A.data из C.data; ожидается, что обратное присваивание разделит вложенные ссылки.",
      "Хранить C как tuple пар ключ/значение без копирования data; неизменяемость внешнего контейнера считать изоляцией изменяемого пути."
    ],
    [
      "Нормализовать допустимые вложенные значения в стабильный hashable key; отвергнуть неподдержанную структуру, не мутировать уже созданный ключ.",
      "Применять только tuple(tags) независимо от вложенных объектов; hash вычислять уже при вставке, любой TypeError считать отсутствием такого business key.",
      "Использовать id вложенных списков в ключе и сохранять такой key между процессами; одинаковое содержимое не проверять.",
      "Включить mutable объект с content-dependent __hash__ в tuple и позволить модулю менять content после вставки, сохранив исходную identity объекта."
    ],
    [
      "Читать по одной группе либо материализовать нужную группу до перехода внешнего iterator, соблюдая заданный memory budget.",
      "Сохранить все groupby group iterators для позднего чтения; materialize только выбранную группу после того, как внешний iterator уже прошёл остальные группы.",
      "Заменить каждый group iterator на tee и обещать постоянную память независимо от количества групп и отставания потребителей.",
      "Прочитать внешний groupby до конца, но оставить только ссылки на группы; считать, что внешний и внутренние iterators имеют независимое положение источника."
    ],
    [
      "Ограничить skew через backpressure или bounded spill; при превышении общего бюджета отказать явно, не терять нужные B элементы.",
      "Задать конечный buffer, но продолжать принимать upstream без backpressure; при заполнении автоматически перемещать read-position B вперед без уведомления.",
      "Использовать tee без admission/backpressure и считать ограничением памяти только размер очередного элемента, игнорируя накопленное отставание.",
      "Перенести backlog в файл без квоты и сохранить обещание конечного общего ресурса при бесконечном отставании B."
    ],
    [
      "Назначенный close/aclose owner, finally/контекстный менеджер на error и раннем stop. Не требовать немедленного GC для освобождения.",
      "Прекратить downstream через break и оставить close upstream для немедленного GC; explicit lifetime в контракте не нужен.",
      "При раннем stop закрывать только локальную оболочку iterator, даже если она не делегирует close/aclose ресурсному источнику.",
      "Закрывать upstream лишь при parse error; успешный досрочный stop считать полным прочтением и пропускать finally. Отдельно измерять задержку каждого consumer и peak memory; предупреждать operator при длительном отставании."
    ],
    [
      "Перед мутацией заменить binding отдельным dict или обеспечить доказанный ownership; copy_context разделяет bindings, не deep-copy значения.",
      "Перед каждой операцией делать copy_context, но изменять прежний dict in-place; новое binding считать доказательством отдельного объекта. Записывать tenant/task correlation ids и latency cache hits, отдельно от пользовательского business результата.",
      "Хранить один dict в ContextVar и reset token после вызова; считать reset откатом всех вложенных мутаций dict. Записывать tenant/task correlation ids и latency cache hits, отдельно от пользовательского business результата.",
      "Использовать thread-local dict для всех async tasks одного thread и изолировать tenants только именем callback. Записывать tenant/task correlation ids и latency cache hits, отдельно от пользовательского business результата."
    ],
    [
      "Cache-key и scope включают tenant-identity вместе с args; lifetime/TTL ограничены. wraps сохраняет метаданные, но не изолирует tenants.",
      "Добавить wraps и cache-clear после каждого переключения текущего tenant; параллельные tasks используют общий cache без tenant-key.",
      "Включить tenant в лог результата, но ключ оставить только по args; совпавшие args считать достаточной функциональной эквивалентностью.",
      "Кэшировать по идентификатору потока и args; несколько async tenants одного thread считают одним cache scope. Записывать tenant/task correlation ids и latency cache hits, отдельно от пользовательского business результата."
    ],
    [
      "Cache владеет shared task, waiters используют shield; failed-entry удаляется по matching task identity, cancel operation — отдельное действие owner.",
      "Shield shared task, но удалять cache entry по key в finally любого waiter, не проверяя, что entry ещё относится к той же task.",
      "Удерживать task в cache и перезапускать её после failure через повторный await того же уже завершённого объекта task. Записывать tenant/task correlation ids и latency cache hits, отдельно от пользовательского business результата.",
      "Делать отдельную task каждого waiter, но оставить общий entry и считать это сохранением coalescing/единственного upstream вызова."
    ],
    [
      "Необработанная RuntimeError-подгруппа распространяется наружу. Частично обработанные ValueError не превращают всю исходную группу в success.",
      "После обработки ValueError объявить всю исходную группу восстановленной, хотя оставшаяся RuntimeError подгруппа не получила обработчика.",
      "Повторить все операции из исходной ExceptionGroup после частичного except* без operation identities, включая уже успешно завершённые шаги.",
      "Преобразовать оставшиеся RuntimeError в список warnings и вернуть success, не согласовав такую политику с вызывающим контрактом. Вести безопасную статистику failures по классу исключения и сохранить correlation-id для разбора повторных вызовов."
    ],
    [
      "Cleanup в finally, CancelledError обычно передаётся дальше; успешный результат не подменяет cancellation/unknown внешний outcome.",
      "Cleanup выполнять, но после него подавить CancelledError и вернуть обычный результат: caller не отличит отмену от успеха.",
      "Поймать BaseException, сделать bounded retry и не передавать cancellation дальше; истечение retry трактовать как подтверждённый rollback внешнего действия.",
      "Выполнить cleanup только при Exception; cancellation делегировать caller без освобождения принадлежащих функции ресурсов."
    ],
    [
      "Явный безопасный публичный DTO и отдельная redacted log policy; from None меняет отображение traceback, но не удаляет context/секреты.",
      "Использовать from None и возвращать serialize(e.__dict__,e.__context__) клиенту: подавление traceback считается достаточной redaction.",
      "Заменить только outer message, но оставлять полный __cause__/__context__ в JSON DTO и в общедоступном diagnostics endpoint. Вести безопасную статистику failures по классу исключения и сохранить correlation-id для разбора повторных вызовов.",
      "Отправлять клиенту redacted message, но безусловно публиковать исходный payload/traceback в tenant-shared log с теми же секретами. Вести безопасную статистику failures по классу исключения и сохранить correlation-id для разбора повторных вызовов."
    ],
    [
      "B.__enter__ сам освобождает частично созданный handle перед raise; внешний ExitStack ещё не зарегистрировал B.__exit__.",
      "Регистрацию B.__exit__ поручить внешнему ExitStack после failed enter; handle B считается автоматически известным stack.",
      "В __enter__ B сохранить handle глобально и повторить создание; cleanup только successful B вызовет exit для последнего handle.",
      "Поднять ошибку __enter__ без cleanup, считая, что последующий выход A.__exit__ должен закрыть и ресурсы B."
    ],
    [
      "Явный closing/finally owner вызывает close после stop; generator не продолжает yield в ответ на GeneratorExit.",
      "Положиться на break consumer и немедленную финализацию generator; explicit closing применять только на exhausted path.",
      "Хранить generator для возможного повторного использования после stop и откладывать finally до process exit, несмотря на требование своевременного close.",
      "После GeneratorExit продолжить yield ещё одного результата, чтобы consumer подтвердил cleanup нормальным чтением."
    ],
    [
      "Назначить нового owner T и явно close по lifetime. pop_all передаёт cleanup, а не выполняет его и не обещает GC-close.",
      "Закрыть старый ExitStack после pop_all и считать resources освобождёнными; новый stack хранить без назначенного close-owner.",
      "Передать callbacks новому stack, но объявить оба stack совладельцами; второй close старого stack должен повторно закрыть resources.",
      "Использовать __del__ holder как единственный гарантированный cleanup после передачи и обещать синхронное освобождение по всем Python runtimes."
    ],
    [
      "Проверять дубли исходных пар при parse, затем type(count) is int и диапазон; готовый dict уже потерял информацию о повторах.",
      "Сначала получить обычный dict, затем проверить уникальность его ключей и type(count) is int; утраченную информацию о дублях считать восстановленной.",
      "Применить object_pairs_hook для дублей, но integer validator оставить isinstance(count,int), принимая bool как допустимое count.",
      "Проверять count type/range, но повтор ключа считать harmless last-write-wins без изменения явного duplicate-key контракта. Вернуть стабильный код ошибки без echo входа и ограничить размер diagnostics; сохранённые данные проверять schema validator."
    ],
    [
      "Недоверенный pickle не исполнять; использовать формат данных со схемой и resource budget, проверяемый до сохранения.",
      "Разрешить pickle.loads в sandbox-функции, затем проверить форму результата; десериализация выполняется до проверки доверия к payload.",
      "Ограничить длину pickle и проверить magic prefix, но исполнять любые reduce-callables; размер считать защитой от произвольного исполнения.",
      "Использовать JSON schema после conversion из pickle; опасную первую фазу считать безопасной, поскольку сохранение данных происходит позже."
    ],
    [
      "Bytes до/во время parse, depth/nodes/time и atomic save; при превышении ошибка без частичной записи, truncation и echo секретного payload.",
      "Ограничить число узлов после полного parse, но не bytes/depth/time; allocation и рекурсия до проверки остаются неограниченными. Вернуть стабильный код ошибки без echo входа и ограничить размер diagnostics; сохранённые данные проверять schema validator.",
      "Ограничить bytes и время, но silently truncate deep ветки и сохранять преобразованный объект как валидный исходный payload. Вернуть стабильный код ошибки без echo входа и ограничить размер diagnostics; сохранённые данные проверять schema validator.",
      "Выполнять validation после частичного сохранения каждой ветки; при превышении лимита возвращать ошибку без rollback прежних записей."
    ]
  ],
  "sql": [
    [
      "EXISTS по каждой связи или уникальные child order_id до JOIN; суммировать один исходный amount на order identity.",
      "Суммировать DISTINCT amount после многосвязного JOIN; разные orders с одинаковой суммой намеренно объединяются как дубликаты.",
      "Сгруппировать joined строки по order_id, но суммировать amount внутри каждой группы после fanout, затем сложить эти групповые суммы.",
      "Заменить JOIN на LEFT JOIN и перенести фильтры children в WHERE; предположить, что число совпадений перестанет умножать amounts."
    ],
    [
      "Предагрегировать items по order_id, LEFT JOIN к orders, COALESCE count0; отсутствие child не становится одной counted item.",
      "Выполнить LEFT JOIN к необработанным items и использовать COUNT(*) для каждого order; NULL-строку отсутствующего child считать item.",
      "Предагрегировать items, но затем INNER JOIN к orders; исчезнувшие orders без items считают корректным нулевым представлением.",
      "Считать DISTINCT amount одним order при любой identity; равные суммы разных orders не включать в итог повторно."
    ],
    [
      "Защитить непересечение интервалов на записи в согласованной transaction boundary; 0/>1 price matches явно диагностировать, не скрывать LIMIT1.",
      "Применить UNIQUE(item,from) и LIMIT1 для любого пересечения; ограничение разных start считают доказательством непересекающихся интервалов.",
      "Проверять overlap отдельным SELECT до INSERT без общей сериализации writers; каждый precheck гарантирует глобальное непересечение.",
      "При multiple matches выбирать минимальный price без диагностики; выбранную запись объявлять единственной исторически корректной. Дополнительно проверить EXPLAIN и оптимизировать индексы foreign keys, сохранив исходную форму query и явный final ORDER BY."
    ],
    [
      "Хранить SUM(amount) и COUNT(amount), явно обработать пустую группу. COUNT(*) и равные веса групп не заменяют количество наблюдений.",
      "Хранить SUM(amount) и COUNT(*) и делить их при слиянии; строки NULL учитываются в count, но не в sum. Ускорить выборку с covering index, сохранять окно и исходные counters в audit table для сравнения повторных запусков.",
      "Хранить AVG каждой группы, усреднять эти averages равным весом; исходные counts считать лишними для объединения.",
      "Нормализовать все NULL в0 до статистики и не объявлять это изменением контракта отсутствующего наблюдения."
    ],
    [
      "Correction-id dedupe и delta в одной транзакции, source-grain/version для пересчёта; каждая отдельная correction имеет свою identity.",
      "Проверять correction-id до транзакции, затем применять delta и записывать id двумя независимыми commits; concurrent duplicate допустим как редкий случай.",
      "Помечать correction processed до обновления aggregate; crash между шагами восстанавливать простым пропуском повторного id. Ускорить выборку с covering index, сохранять окно и исходные counters в audit table для сравнения повторных запусков.",
      "Дедуплицировать по business-row id вместо correction-id, поэтому разные изменения одной строки нельзя применить независимо."
    ],
    [
      "GROUPING(region) или явный уровень aggregation различает subtotal-NULL и data-NULL; detail и subtotal не суммировать повторно вместе.",
      "Определять subtotal по region IS NULL; реальные NULL region трактовать как тот же общий итог без отдельного признака.",
      "Заменить NULL строкой total до группировки без резервирования такого значения; реальный region total объединится с subtotal.",
      "Суммировать все выдаваемые detail/subtotal/grand-total строки для финального итога, не различая уровни aggregation."
    ],
    [
      "Убрать внешний L.id IS NOT NULL, сохранить обе tenant/id equality в NOT EXISTS: NULL L становится unmatched без cross-tenant совпадения.",
      "Удалить внешний id IS NOT NULL, но сравнивать в NOT EXISTS только id; равные ids разных tenants подавят независимые строки. Различать input NULL в diagnostics, применять параметры вместо SQL-конкатенации и ограничить rows одной страницы.",
      "Фильтровать NULL только справа и оставить NOT IN tuple; NULL L остаётся UNKNOWN, хотя контракт требует включить его как unmatched. Различать input NULL в diagnostics, применять параметры вместо SQL-конкатенации и ограничить rows одной страницы.",
      "Использовать null-safe equality для tenant/id и считать два NULL одним identity, хотя контракт задаёт отсутствие совпадения. Различать input NULL в diagnostics, применять параметры вместо SQL-конкатенации и ограничить rows одной страницы."
    ],
    [
      "NOT NULL плюс CHECK(x>0), с совместимыми writers и проверенной миграцией прежних NULL; обязательность и диапазон задаются отдельно.",
      "Добавить CHECK(x>0), сохранив nullable x; UNKNOWN трактовать как нарушение автоматически без отдельного NOT NULL. Различать input NULL в diagnostics, применять параметры вместо SQL-конкатенации и ограничить rows одной страницы.",
      "Добавить NOT NULL, но оставить отрицательные x допустимыми; корректность диапазона делегировать только текущему клиенту.",
      "В backfill заменить каждый NULL на0, затем включить CHECK(x>0); отсутствие значения считать законным нулевым значением. Различать input NULL в diagnostics, применять параметры вместо SQL-конкатенации и ограничить rows одной страницы."
    ],
    [
      "Обычное equality не соединяет NULL; identity задаётся отдельным обязательным ключом, без общей sentinel-коллизии отсутствующих данных.",
      "Применять IS NOT DISTINCT FROM ко всем nullable business keys без отдельной политики identity; два неизвестных объекта объединяются.",
      "Применить COALESCE(key,0) с реальным допустимым key0; коллизии отсутствия и известного значения считать приемлемыми.",
      "Сделать отдельный обязательный id, но JOIN продолжить по nullable business-key с null-safe equality и считать проблему identity решённой."
    ],
    [
      "Общий guard/набор сериализуется либо serializable с retry всей проверки; независимый CAS rows не доказывает multi-row predicate.",
      "Поставить CAS каждой собственной строки, но общий predicate не сериализовать; два разных rows считать независимыми от правила минимум одного on.",
      "Перейти на READ COMMITTED и выполнять тот же SELECT двух rows до UPDATE без locks; обещать защиту write skew только названием isolation.",
      "При serialization failure повторять только последний UPDATE без повторного чтения predicate, оставляя исходное решение выключиться."
    ],
    [
      "Сначала receipt/status выясняет неизвестный outcome; для действительно нового исполнения перечитать version/balance и повторить полную операцию.",
      "После CAS failure повторять прежнее SET balance=old+2 без version predicate; потерянное обновление считать обычным retry. Задать bounded timeout/backoff и логировать transaction-id/isolation-level; отдельно измерять lock waits текущих writers.",
      "Всегда перечитывать version и автоматически выполнять новый increment, даже если прежний outcome неизвестен и receipt не проверен. Задать bounded timeout/backoff и логировать transaction-id/isolation-level; отдельно измерять lock waits текущих writers.",
      "Вернуть success после CAS0 rows, потому что состояние изменилось каким-то writer; источник и выполнение нужной операции не различать."
    ],
    [
      "Rollback и bounded retry всей transaction с повторной проверкой, согласованным lock order и стабильным business-key; external effect отдельно.",
      "После deadlock повторить лишь последний statement в уже aborted transaction; прежние прочтения и business validation не выполнять.",
      "Повторять целую транзакцию без deadline и менять business-key каждого retry, включая уже выполненные external calls.",
      "Commit успешные statements T2 до ошибки отдельно и retry только остаток; такой процесс считать атомарным исходным business transaction."
    ],
    [
      "PARTITION BY team, ROWS1 PRECEDING..CURRENT ROW, полный order(k,id); наружный ORDER BY нужен отдельно от порядка окна.",
      "PARTITION BY team и ROWS1 PRECEDING, но ORDER BY k без уникального tie-break; две peer строки могут поменять последовательность.",
      "Сделать полный order(k,id), но RANGE UNBOUNDED PRECEDING вместо двухстрочной рамки; большой prefix считать скользящей парой.",
      "Задать полный order только в наружном SELECT, а окно оставить unordered; final sort считается влияющим на frame вычисления."
    ],
    [
      "Keyset сохраняет границу прежних следующих rows, но не обещает новые insert до cursor; полный стабильный проход требует snapshot-контракта.",
      "Обещать включение всех будущих insert до cursor при обычном keyset; отдельный snapshot или повторный проход не нужны.",
      "Использовать только created>cursor.created без id tie-break и считать peers уже полностью прочитанными.",
      "Сохранить стабильный cursor, но разрешить in-place изменение sort keys без policy; keyset считать полным consistent snapshot."
    ],
    [
      "ROW_NUMBER по team с order(score DESC,id ASC), rn=1. Tie-break минимальным id является частью выбора ровно одного победителя.",
      "Использовать DENSE_RANK по score и rank1; ties возвращают несколько rows, но контракт ровно одного победителя считаем соблюдённым.",
      "Использовать ROW_NUMBER по score без id tie-break; chosen winner объявить детерминированным при одинаковом score.",
      "Сделать внешний LIMIT1 после sorting всех teams; глобальную строку считать победителем каждой team."
    ],
    [
      "Reachability-check в сериализованной graph-boundary/версии с retry либо эквивалентный доказанный протокол; UNIQUE/FK не исключают циклы.",
      "Проверять parent<>child и все foreign keys; эти локальные условия считать достаточными для DAG любой длины. Проверить runtime форму входа, foreign-key references и права writer; хранить schema version и audit-id каждого commit.",
      "Проверять reachability до insert каждой edge без защищённой graph-version/сериализации; concurrent prechecks считают независимыми. Проверить runtime форму входа, foreign-key references и права writer; хранить schema version и audit-id каждого commit.",
      "Уникальность пары parent/child считать запретом любого направленного цикла, даже если все пары цикла различны. Проверить runtime форму входа, foreign-key references и права writer; хранить schema version и audit-id каждого commit."
    ],
    [
      "Expand field, совместимые/fenced writers, idempotent backfill и invariant-check, затем NOT NULL и contract legacy path.",
      "Завершить один backfill и сразу NOT NULL, не ограждая старых writers; последующие NULL считают невозможными без проверки.",
      "Обновить приложение V2, но старые jobs оставить пишущими NULL; enforce constraint считать полностью совместимым rollout.",
      "Сначала убрать legacy field, затем восстанавливать ещё читающие его clients из backup; backup считают механизмом онлайн совместимости."
    ],
    [
      "Конфликт по другому payload_hash без нового effect или замены receipt; тот же scope/key не доказывает semantic equivalence payload.",
      "При ON CONFLICT вернуть старый result без проверки hash; несовместимый payload станет эквивалентным повтором.",
      "При новом hash перезаписать receipt и выполнить новый effect в том же scope, не сообщая semantic conflict. Проверить runtime форму входа, foreign-key references и права writer; хранить schema version и audit-id каждого commit.",
      "Дедуплицировать только event без tenant; независимое событие B считается повтором A и получает прежний receipt."
    ]
  ],
  "typescript": [
    [
      "Runtime decoder проверяет version и поля union либо возвращает ошибку; assertNever проверяет typed switch, неизвестная version не downcast.",
      "Runtime проверить только kind, затем as Protocol; обязательные version-dependent поля считать гарантированными TypeScript union. Зарегистрировать protocol version и считать reject/error metrics; неизвестные поля не передавать в UI log целиком.",
      "При неизвестной version перейти на V1 decoder и вернуть success, даже когда semantic contract новой версии неизвестен. Зарегистрировать protocol version и считать reject/error metrics; неизвестные поля не передавать в UI log целиком.",
      "В switch добавить общий default success; compilation продолжит проходить, но отсутствующая ветка расширенного union не будет обнаружена. Зарегистрировать protocol version и считать reject/error metrics; неизвестные поля не передавать в UI log целиком."
    ],
    [
      "Tagged state/event union плюс captured op-id check в reducer; external event type не гарантирует правильный порядок событий.",
      "Проверять только текущий discriminant loading, а operation-id не сравнивать; старый success A может завершить новый loading B.",
      "Тип Success снабдить optional op-id и default его на current id при decode; stale response станет текущим без доказательства.",
      "Использовать boolean loading с typed event payload; тип event считать гарантией порядка delivery от внешнего источника."
    ],
    [
      "Runtime discriminator и поля каждой ветки U валидируются явно; conditional type вычисляет типы, не фильтрует JSON на исполнении.",
      "Применить conditional type к unknown и as U к результату; считать это выполненным runtime filtering внешних JSON объектов.",
      "Проверить только наличие kind string и выдать U без проверки полей ветки; type-level never считают валидатором значения. Зарегистрировать protocol version и считать reject/error metrics; неизвестные поля не передавать в UI log целиком.",
      "Сделать tuple-wrapper conditional и объявить его runtime decoder с тем же результатом; TypeScript не исполняет этот код как проверку."
    ],
    [
      "Сохранить primitive v до scheduling либо изолировать нужный snapshot; const/readonly сами не замораживают object values.",
      "Сохранить const reference state, затем читать поле в microtask; const объявить снимком значения до последующей мутации.",
      "Назначить readonly type на state, но внешнему модулю оставить ту же mutable reference; runtime мутации не защищены. Описать strict compilation contract и включить lint no-implicit-any; наблюдаемые результаты проверить на representative payload.",
      "Сделать shallow copy outer state с вложенными mutable nodes, обещая snapshot всего графа без проверки изменяемого пути."
    ],
    [
      "Arrow/bound wrapper или explicit receiver contract; независимый callback может быть this:void. Runtime invocation должен соответствовать сигнатуре.",
      "Передать owner.read как отдельный callback без bind; receiver считается сохранённым только потому, что функция была извлечена из объекта.",
      "Привести отделённый метод as ()=>number и считать, что TypeScript заменит его runtime this.",
      "Bind owner, но объявить зафиксированным прежнее значение поля v; bound receiver всё ещё наблюдает позднюю мутацию объекта."
    ],
    [
      "Явный tagged wire format или ограничения допустимых значений и проверка обеих сторон; JSON.stringify не сохраняет все JS states.",
      "Разрешить все values типа number и JSON.stringify без finite check; NaN/Infinity превращаются в null без явной политики потери.",
      "Считать object missing и explicit undefined одним lossless wire состоянием; после roundtrip различие исчезает. Описать strict compilation contract и включить lint no-implicit-any; наблюдаемые результаты проверить на representative payload.",
      "Передавать BigInt через обычный JSON.stringify без encoder и считать поддержку гарантированной numeric type. Описать strict compilation contract и включить lint no-implicit-any; наблюдаемые результаты проверить на representative payload."
    ],
    [
      "Callback принимает широкий {id} и проверяет дополнительные поля, либо producer реально обещает обязательный admin; method bivariance этого не доказывает.",
      "Переписать callback property как method syntax для обхода variance check, сохранив producer широкий input и заявляя обязательный admin. Добавить compile-time fixtures accepted/rejected calls и записать expected API usage; unknown JSON не логировать публично.",
      "Сделать generic callback<T> с приведением узкого параметра и считать, что inference добавит runtime admin каждому producer объекту. Добавить compile-time fixtures accepted/rejected calls и записать expected API usage; unknown JSON не логировать публично.",
      "Проверить admin один раз у первого вызова callback, а все следующие более широкие inputs считать доказанно такими же. Добавить compile-time fixtures accepted/rejected calls и записать expected API usage; unknown JSON не логировать публично."
    ],
    [
      "Runtime own-key whitelist и форма obj проверяются до get; keyof/T[K] сохраняют статическую корреляцию, не разрешают внешний ключ автоматически.",
      "Привести внешнюю key:string к keyof T без runtime whitelist; inherited/private keys станут доступными как бизнес-поля.",
      "Проверять key in obj, но не own-property/allowed keys; любой inherited key считать разрешённым полем. Добавить compile-time fixtures accepted/rejected calls и записать expected API usage; unknown JSON не логировать публично.",
      "Валидировать key, но доверять форме obj после as T; return-type T[K] не гарантирует фактическое значение JSON. Добавить compile-time fixtures accepted/rejected calls и записать expected API usage; unknown JSON не логировать публично."
    ],
    [
      "Assertion обязана реально отвергать undefined; negative runtime inputs проверяются. Пустое тело нарушает soundness, несмотря на narrowed type.",
      "Оставить пустое тело assertion и проверить только compilation; утверждённый narrowed type считать доказанным runtime значением. Добавить compile-time fixtures accepted/rejected calls и записать expected API usage; unknown JSON не логировать публично.",
      "Сделать x as T до вызова assertion и не обрабатывать undefined; unsafe cast считать проверкой входа. Добавить compile-time fixtures accepted/rejected calls и записать expected API usage; unknown JSON не логировать публично.",
      "Проверять truthiness и принимать только truthy T, хотя контракт запрещает только undefined и разрешает0/false/пустую строку. Добавить compile-time fixtures accepted/rejected calls и записать expected API usage; unknown JSON не логировать публично."
    ],
    [
      "Новый index max revision с explicit conflict и provenance; source rows/изменяемые paths не мутировать, равный revision не скрывает разный payload.",
      "Выбирать последнюю row каждого id без сравнения revision или payload; порядок массива считать и версией, и semantic equivalence.",
      "При равных revision выбирать любую row и удалять конфликт из результата; source provenance не сохранять. Сохранять source ids в diagnostics, ограничить число входных элементов и проверить допустимые keys внешнего объекта.",
      "Сортировать original rows in-place и отдавать тот же nested graph всем consumers, считая новый Map полной immutable копией."
    ],
    [
      "Presence собственных полей и допустимые значения каждого present key; missing/null/value сохраняют разные PATCH-операции.",
      "Считать missing и null одной clear операцией; partial PATCH удалит отсутствующие поля baseline. Сохранять source ids в diagnostics, ограничить число входных элементов и проверить допустимые keys внешнего объекта.",
      "Использовать patch.field||baseline.field для merge; null и empty string будут незаметно превращены в прежнее значение. Сохранять source ids в diagnostics, ограничить число входных элементов и проверить допустимые keys внешнего объекта.",
      "Разрешить произвольные дополнительные patch keys, поскольку partial type на compile-time должен сам ограничить JSON payload."
    ],
    [
      "Schema-whitelist путей/keys, только собственные поля и явный DTO; unrestricted recursive assignment недоверенного graph запрещён.",
      "Применить unrestricted recursive merge после проверки одного верхнего id; опасные nested paths могут попасть в defaults.",
      "Назначить Record<string,unknown> и копировать все ключи через for-in, включая inherited fields; schema не ограничивает runtime пути.",
      "Запретить только __proto__ на верхнем уровне, но принимать constructor/prototype nested paths при глубоком assignment."
    ],
    [
      "Отдельный atomic/compensation protocol и idempotency; cancellation уменьшает работу, но не откатывает уже совершённые remote effects.",
      "После aggregate rejection послать AbortSignal siblings и считать уже committed remote effects автоматически отменёнными.",
      "В catch вернуть единый failure и повторить все siblings новыми operation ids; прежние successful effects не reconcilable.",
      "Promise.all заменить allSettled, а отсутствие rejected aggregate назвать атомарностью business effect, не анализируя отдельные results."
    ],
    [
      "Completion/cleanup допускаются лишь matching task/op identity; stale A не удаляет B и не меняет его current state.",
      "Применять identity guard только в success, но finally A удаляет общий cache entry B и сбрасывает его loading.",
      "После abort request A не сравнивать op-id: транспорт может продолжить работу, но cancel считается guaranteed.",
      "Cache хранить по URL без query/session и применять последний arrival независимо от current intent. Измерить общую длительность и сохранить op correlation-id; ошибки показывать отдельно от подтверждённого success."
    ],
    [
      "Стабильный idempotency-key, outcome reconciliation и bounded общий deadline. Timeout не доказывает отсутствие server commit.",
      "Сохранять общий deadline, но выдавать новый idempotency key при retry POST; неизвестный прежний commit может повториться.",
      "При timeout считать серверный outcome rollback и retry со старой моделью без status lookup/receipt.",
      "Каждой попытке заново выделять полный deadline и bounded count только в одном слое; общий elapsed budget может быть превышен."
    ],
    [
      "Ownership/type-contract запрещает мутации shared узлов; недоверенную сторону дополнительно изолировать/защитить runtime. Копируются изменяемые пути.",
      "Заморозить только outer object и разрешить downstream менять shared b; historical snapshots считаются immutable по readonly signature.",
      "Сделать outer spread, но mutate next.b и вернуть old как прежний snapshot; shared nested reference останется изменённой.",
      "Копировать только a для нового состояния, но передать b недоверенному mutable consumer без ownership или runtime защиты. Отдельно фиксировать memory budget и snapshot revision; подписать публичный contract и проверить повторяемость чтения."
    ],
    [
      "Visited graph traversal и явная политика Date/Map/arrays/ownership; freeze внешнего Map не запрещает внутренний Map.set.",
      "Обойти graph рекурсивно без visited set; циклы считаются безопасными, потому что каждый object freeze idempotent. Отдельно фиксировать memory budget и snapshot revision; подписать публичный contract и проверить повторяемость чтения.",
      "Freeze plain Map object и обещать запрет Map.set/delete без отдельной политики внутренних mutable slots. Отдельно фиксировать memory budget и snapshot revision; подписать публичный contract и проверить повторяемость чтения.",
      "Сделать visited traversal, но пропустить вложенные arrays и Date/Map, объявляя это полной неизменяемостью всех доступных значений."
    ],
    [
      "Transfer передаёт ArrayBuffer ownership и detaches прежние views; SharedArrayBuffer требует отдельного concurrency/Atomics контракта.",
      "Передать ArrayBuffer transferList и продолжить использовать прежний view как живой snapshot без обработки detach. Отдельно фиксировать memory budget и snapshot revision; подписать публичный contract и проверить повторяемость чтения.",
      "Использовать subarray вместо slice и разрешить receiver запись; shared bytes считать независимыми только по отдельному view объекту.",
      "SharedArrayBuffer объявить transfer-owned и читать/писать без Atomics или другой concurrency policy, игнорируя параллельный доступ. Отдельно фиксировать memory budget и snapshot revision; подписать публичный contract и проверить повторяемость чтения."
    ]
  ],
  "react": [
    [
      "Render/reducer чистые; payment — explicit command с operation-id/outcome protocol. Effects/commits сами не являются exactly-once delivery.",
      "Выполнить payment из reducer, но dedupe только по числу render; aborted/replayed renders не имеют устойчивой business identity.",
      "Сделать side effect внутри useMemo и считать зависимости гарантирующими единственное выполнение независимо от lifecycle. Дополнительно trace render/commit и entity/op-id; handler не должен раскрывать private payload в diagnostics.",
      "Перенести POST в effect без operation-id и reconciliation; StrictMode/retry эффекта считаются proof exactly-once. Дополнительно trace render/commit и entity/op-id; handler не должен раскрывать private payload в diagnostics."
    ],
    [
      "Immutable входы и чистое вычисление, external effects вне render; transition приоритизирует UI, не откатывает JS-мутации.",
      "Оборачивать impure calculation в startTransition и считать discard render rollback внешнего array mutation.",
      "Мутировать input snapshot во время render, но скопировать его после commit; отброшенные renders уже изменили исходный объект.",
      "Вынести мутацию в useMemo, сохранив внешний shared array; memoization считают изоляцией concurrent calculations."
    ],
    [
      "Связанный invariant выражен одной reducer/state-моделью и explicit action; batching не заменяет проверку business constraints.",
      "Хранить поля в отдельных setters и полагаться только на batching как проверку всех business constraints. Дополнительно trace render/commit и entity/op-id; handler не должен раскрывать private payload в diagnostics.",
      "Синхронизировать связанные поля useEffect после commit, разрешая промежуточное противоречивое состояние и команды из него.",
      "Обновлять state updater вместе с мутацией props business object, считая обе операции одной React-транзакцией."
    ],
    [
      "Команда target A/baseline явна; response обновляет cache A, активный draft только при matching entity/revision/operation.",
      "Проверять response op-id, но сбрасывать current draft независимо от entity-id; сохранение A затронет B.",
      "Обновлять callback dependencies и считать, что это перепишет target уже отправленного запроса A.",
      "Кэшировать response по одному editor key, не включая entity/revision; новый B получает старое server baseline A."
    ],
    [
      "Выбрать snapshot/live семантику явно, перед командой актуальная entity и guarded revision; stable callback не доказывает свежесть адресного действия.",
      "Получать актуальный count через functional updater, но server target оставлять из старой entity closure без проверки текущей identity. Сохранить correlation-id отправленного запроса и показывать pending/error раздельно; baseline snapshot доступен для восстановления.",
      "Хранить live entity в ref и считать это проверкой актуальных server permissions/revision перед записью. Сохранить correlation-id отправленного запроса и показывать pending/error раздельно; baseline snapshot доступен для восстановления.",
      "Зафиксировать dependencies=[] ради stable callback и объявить замыкание актуальным для любого последующего выбора объекта. Сохранить correlation-id отправленного запроса и показывать pending/error раздельно; baseline snapshot доступен для восстановления."
    ],
    [
      "Cleanup своего listener, stable scope и generation/entity guard queued events; live-values и источник snapshot определены явно.",
      "Делать cleanup subscription, но не проверять generation уже queued callbacks; старый event применится к новой сущности. Сохранить correlation-id отправленного запроса и показывать pending/error раздельно; baseline snapshot доступен для восстановления.",
      "Создавать новую subscription каждого render без cleanup старой; live filter считается достаточной изоляцией событий. Сохранить correlation-id отправленного запроса и показывать pending/error раздельно; baseline snapshot доступен для восстановления.",
      "Читать live values из shared mutable object, но забыть entity/generation check и snapshot contract источника. Сохранить correlation-id отправленного запроса и показывать pending/error раздельно; baseline snapshot доступен для восстановления."
    ],
    [
      "Cached immutable snapshot/revision меняет reference только при store change; subscribe уведомляет, mutable in-place snapshot не скрывает updates.",
      "Возвращать new object каждый getSnapshot и сравнивать только value внутри компонента; стабильность store snapshot reference отсутствует.",
      "Возвращать один mutable object после in-place изменений без notify; одинаковый reference скрывает изменившиеся данные. Измерять число активных subscriptions/resources и отмечать setup/cleanup generation в безопасных development traces.",
      "Кэшировать snapshot навсегда и уведомлять listeners без обновления snapshot revision; consistency между notify/read нарушена."
    ],
    [
      "Generation/cancel guard не только игнорирует stale completion, но и закрывает late-created A resource; cleanup прежнего socket этого не делает.",
      "Ставить generation guard, но при старой generation просто игнорировать late-created socket без close; resource leakage остаётся.",
      "Закрывать socket каждого setup в cleanup, но поздний reconnect всегда присоединять к текущему B, игнорируя старый key.",
      "После cleanup отменять локальное ожидание promise, но не обрабатывать её возможный late resource result."
    ],
    [
      "Request-scoped допустимый server DTO и соответствующий initial client snapshot; общий singleton не переносит private data между users.",
      "Сделать стабильный getServerSnapshot из общего singleton store без request/user scope; hydration совпадёт, но данные A попадут B.",
      "Использовать server snapshot с приватными полями, затем client redaction; первоначальные serialized bytes уже раскрыты. Измерять число активных subscriptions/resources и отмечать setup/cleanup generation в безопасных development traces.",
      "Скрыть несовпадение через suppressHydrationWarning и считать server/client snapshot согласованными без переноса исходного состояния."
    ],
    [
      "Устойчивый entity key; index key при reorder/removal может передать state другой сущности. Key выражает identity, а не права доступа.",
      "Использовать индекс key после reorder, но передавать новый entity-id prop; local draft сохраняется позиции и может сменить владельца.",
      "Использовать случайный key при каждом render ради уникальности; identity/state будут регулярно сбрасываться.",
      "Считать key глобальной business authorization и пропускать проверку identity адресного API запроса. Хранить entity-id в accessibility labels и проверить reordering representative списка; reset события отслеживаются отдельно."
    ],
    [
      "Durable draft хранить у стабильного owner/store по entity-id вне меняющейся subtree; intentional reset policy задана отдельно.",
      "Хранить durable draft в меняющейся subtree и задавать одинаковый child key; смена parent type уничтожит этот owner.",
      "Менять parent key при каждом layout update, ожидая сохранения nested local state по key Editor.",
      "Сохранять draft только в предыдущем unmounted component instance без store/serialization и считать remount восстановлением того же экземпляра."
    ],
    [
      "Component type вынести на уровень модуля, props передавать явно, key менять лишь при intentional identity reset.",
      "Объявлять component function внутри Parent и стабилизировать только key; новый type reference всё равно сбрасывает subtree.",
      "UseMemo key строки, но каждый render создавать новый function type; string key не обеспечивает устойчивый type. Хранить entity-id в accessibility labels и проверить reordering representative списка; reset события отслеживаются отдельно.",
      "Отдельно cache element object, но intentional reset-policy игнорировать и сохранять state разных business entities под общим key."
    ],
    [
      "Следующий submit использует подтверждённый server revision и current draft; conflict обрабатывается явно, новые локальные edits не стираются success.",
      "Обновить server revision, но заменить current draft отправленным snapshot; более поздний local edit потеряется.",
      "Сохранить local draft, но следующий submit отправить со старым baseline revision без конфликтной обработки. Показывать server revision и pending/error status, сохранить raw input для сравнения с отправленным snapshot.",
      "После success обозначить форму clean, хотя local draft отличается от реально сохранённого server snapshot. Показывать server revision и pending/error status, сохранить raw input для сравнения с отправленным snapshot."
    ],
    [
      "Uncertain outcome сохраняется с operation-id и reconcile; scoped rollback не отменяет opB, retry не создаёт новый business-key без проверки.",
      "Rollback failed opA всей list до начального snapshot; opB success также исчезнет из UI. Показывать server revision и pending/error status, сохранить raw input для сравнения с отправленным snapshot.",
      "Timeout opA считать definitive failure и повторить новый POST с другим key, не проверяя прежний outcome. Показывать server revision и pending/error status, сохранить raw input для сравнения с отправленным snapshot.",
      "Сохранить op-scoped rollback, но удалить operation identity до reconciliation uncertain response. Показывать server revision и pending/error status, сохранить raw input для сравнения с отправленным snapshot."
    ],
    [
      "Raw input/composition отдельно от validated model, label/error связаны семантически; промежуточный IME text не сбрасывается, submit проверяет current input.",
      "Coerce/reset controlled value каждого compositionupdate; intermediate IME intent исчезает до compositionend. Показывать server revision и pending/error status, сохранить raw input для сравнения с отправленным snapshot.",
      "Показывать error только цветом и placeholder, без label/error association; raw input считается достаточно доступным.",
      "Считать onChange committed business submit и автоматически отправлять форму при каждом завершении composition. Показывать server revision и pending/error status, сохранить raw input для сравнения с отправленным snapshot."
    ],
    [
      "Draft/operation receipt вне reset subtree; render retry и command reconciliation отдельно, reset не является commit или автоматическим POST-retry.",
      "Reset ErrorBoundary и одновременно повторить прежнюю command новым key, считая reset доказательством failure server operation.",
      "Хранить draft только внутри subtree, которую retry boundary уничтожает; сохранение draft до reset не обеспечено.",
      "Обрабатывать rejected submit только ErrorBoundary, не имея command catch/outcome state. Дать отдельные render/command error labels и correlation ids, ограничить retry count и сохранить last-known server baseline."
    ],
    [
      "Session generation в cache/action identity, private-store invalidation и reject late old-session response; route key не заменяет ACL.",
      "Очистить rendered user fields после logout, но сохранить private cache по URL без session generation. Дать отдельные render/command error labels и correlation ids, ограничить retry count и сохранить last-known server baseline.",
      "Проверять session только при старте fetch, а поздний response старого user записывать после login другого. Дать отдельные render/command error labels и correlation ids, ограничить retry count и сохранить last-known server baseline.",
      "Задать React key по route, но cache старого user оставить shared и считать remount новым authorization scope."
    ],
    [
      "Stable keyed resource/pending promise, targeted invalidation/retry и render ErrorBoundary; business command side effects вне render.",
      "Создавать новый pending promise каждого render без resource cache; стабильного lifecycle ожидания нет.",
      "Держать один resource entry для A/B и разных users; late A result может подменить B.",
      "При retry render всегда выполнять POST с новым key, смешивая resource read и business command side effects."
    ]
  ],
  "backend-engineering": [
    [
      "Срок replay согласовать с durable tombstone/business uniqueness или status policy; удаление receipt не разрешает тихий повтор старого effect.",
      "Хранить receipt только до TTL, затем разрешать key как новый; late retry считается новым effect без tombstone или status policy. Дополнительно хранить request audit-id и payload hash, измерять replay age и отдельно отвечать о compatibility текущего API.",
      "Сохранять tombstone по key без principal/action scope; независимые клиенты и операции получат общий прежний receipt. Дополнительно хранить request audit-id и payload hash, измерять replay age и отдельно отвечать о compatibility текущего API.",
      "После TTL сверять только payload hash, но не business identity; два равных payload разных operations считаются тем же запросом. Дополнительно хранить request audit-id и payload hash, измерять replay age и отдельно отвечать о compatibility текущего API."
    ],
    [
      "Operation receipt/idempotency binding или status lookup устанавливает own outcome; current ETag отражает версию, не автора прошлого commit.",
      "После412 считать первый запрос не выполненным и повторить PATCH автоматически с текущим ETag без operation receipt. Дополнительно хранить request audit-id и payload hash, измерять replay age и отдельно отвечать о compatibility текущего API.",
      "Если текущее значение совпало с отправленным, считать это доказательством own commit, игнорируя возможную чужую запись тех же данных. Дополнительно хранить request audit-id и payload hash, измерять replay age и отдельно отвечать о compatibility текущего API.",
      "Клиент хранит только последний ETag и предполагает, что он содержит origin/receipt любого предыдущего изменения. Дополнительно хранить request audit-id и payload hash, измерять replay age и отдельно отвечать о compatibility текущего API."
    ],
    [
      "Version/capability negotiation и expand/contract с прежней semantic поддержкой и consumer gates; старое amount не меняет units молча.",
      "Оставить amount:number и поменять единицы без version field, потому что structural JSON schema прежняя.",
      "Версионировать новые endpoints, но старый endpoint перевести на новую семантику в день rollout без agreed support window.",
      "Добавить currency обязательным в прежний request contract, не поддержав ещё работающих V1 consumers. Дополнительно хранить request audit-id и payload hash, измерять replay age и отдельно отвечать о compatibility текущего API."
    ],
    [
      "Общий serializable guard либо conserved bounded escrow quotas с reassignment/fencing; строгий global bound не совмещается с unlimited partition writes.",
      "Использовать local CAS каждой partition и async сводку total; reserved bound будет лишь eventually reconciled. Сохранять source versions и trace commits каждой partition, контролировать latency replica и alarm при расхождении сводки.",
      "Выдать каждой partition полную capacity n без conservatively allocated quotas, считая лимиты независимыми. Сохранять source versions и trace commits каждой partition, контролировать latency replica и alarm при расхождении сводки.",
      "При недоступности authoritative guard принимать операции и позже откатывать превышение, сохранив заявленную строгую гарантию bound. Сохранять source versions и trace commits каждой partition, контролировать latency replica и alarm при расхождении сводки."
    ],
    [
      "Authoritative ACL/version в согласованной границе нового sensitive read; eventual replica допустима только для явно разрешённой stale проекции.",
      "Проверять grant на eventually consistent replica с TTL и обещать немедленный revoke для новых private requests. Сохранять source versions и trace commits каждой partition, контролировать latency replica и alarm при расхождении сводки.",
      "Проверять authoritative session, но object grant брать из старого cache без версии; login validity заменяет object authorization. Сохранять source versions и trace commits каждой partition, контролировать latency replica и alarm при расхождении сводки.",
      "Authoritative ACL проверить до долгого ожидания, затем linearize новый request после revoke по прежней проверке без согласованной границы. Сохранять source versions и trace commits каждой partition, контролировать latency replica и alarm при расхождении сводки."
    ],
    [
      "DB outbox, versioned/idempotent index upsert, bounded retry и reconciliation с source version; index — eventual projection, не authoritative ledger.",
      "После DB commit отправлять index update без durable intent; timeout считать временным и забывать, не сохраняя retry identity.",
      "Использовать outbox, но index apply без source-version guard; поздний retry старого события перепишет более новое значение.",
      "При unknown index outcome автоматически удалять DB row и считать оба stores атомарно восстановленными."
    ],
    [
      "Propagated общий deadline/retry budget, jitter/backpressure и стабильный operation-id; recipient dedupe нужен отдельно от ограничения capacity.",
      "Дать каждому слою bounded count, но независимый полный deadline; умноженный downstream budget и общий elapsed не ограничены.",
      "Передавать deadline, но создавать новый operation-id каждого effect retry; budget защищён, business dedupe нет.",
      "Использовать один retry layer без jitter/admission, а recipient dedupe считать защитой capacity от retry storm."
    ],
    [
      "Backpressure/admission или явно ограниченное durable расширение; конечный ресурс не может бесконечно принимать excess без loss/задержки.",
      "Держать конечную queue, принимать новые сообщения без backpressure и заменять самые старые, сохранив обещание no loss. Заполнение контролируется метрикой и операторским алертом; производитель продолжает подтверждать новые сообщения, пока обработчик отстаёт.",
      "Добавить durable storage без общего лимита и обещать конечный resource budget при бесконечном producer excess.",
      "Использовать bounded queue только внутри process, а неограниченный upstream buffer оставить вне измеряемого budget."
    ],
    [
      "Local fence защищает только проверяющий его store; внешний effect требует recipient idempotency/reconciliation или явно ограниченной гарантии.",
      "Проверять fencing только при записи локального status после external call; уже совершённый provider effect считать защищённым тем же fence.",
      "После lease expiry автоматически retry внешнее действие новым key без provider dedupe/status lookup.",
      "Считать synchronized clocks достаточным доказательством физической остановки старого worker после выдачи нового token."
    ],
    [
      "SLI scope/eligible denominator и critical cohort impact проверяются с traces/outcomes; общий средний не скрывает отдельный договорённый путь.",
      "Считать общий средний success достаточным для critical cohort, даже если договорённый путь имеет отдельное нарушение. Показать оконные counts, deployment version и correlation ids; проводить bounded canary и сравнивать наблюдаемые outcomes.",
      "Считать average процентов unequal windows без weighting counts и использовать его как точный SLI общего окна. Показать оконные counts, deployment version и correlation ids; проводить bounded canary и сравнивать наблюдаемые outcomes.",
      "Исключать timeout/failed outcomes из eligible denominator после инцидента, чтобы сохранить target без изменения observed service. Показать оконные counts, deployment version и correlation ids; проводить bounded canary и сравнивать наблюдаемые outcomes."
    ],
    [
      "Arrival/service rate, active/waiters и concurrency budgets; bounded intervention с ожидаемыми метриками проверяет гипотезу до blind pool/SQL изменений.",
      "Увеличить DB pool по общему p95 без проверки downstream capacity; queue reduction предположить причинно доказанной. Показать оконные counts, deployment version и correlation ids; проводить bounded canary и сравнивать наблюдаемые outcomes.",
      "Переписать SQL по end-to-end latency, не отделив pool wait от query execution; время ожидания считается SQL временем. Показать оконные counts, deployment version и correlation ids; проводить bounded canary и сравнивать наблюдаемые outcomes.",
      "Добавить workers, но не admission budget и не измерять arrivals/service rate; saturation допускается перенести вниз незаметно. Показать оконные counts, deployment version и correlation ids; проводить bounded canary и сравнивать наблюдаемые outcomes."
    ],
    [
      "Безопасные correlation/op ids и outcome states, минимальные redacted fields, controlled доступ/retention; raw secrets не публикуются.",
      "Редактировать только email в response, но хранить bearer tokens/raw payload в общей trace dashboard всех tenants.",
      "Удалить operation ids ради privacy, оставив невозможным outcome reconciliation; такой tradeoff не объявлять.",
      "Публиковать payload failed operations для диагностики, считая статус failure достаточным разрешением на контакты и секреты."
    ],
    [
      "Server intersect актуальный object ACL с выбранными fields; cache scoped по object/grant-version/projection/session, stale private bytes не обходят revoke.",
      "Intersect projection на клиенте, а сервер выдаёт full document любому authenticated employer по resumeId.",
      "Проверить grant CV1 и использовать его для private CV2 того же owner; permission трактуется как owner-wide.",
      "Server cache-key включает projection, но не grant-version/session; старые full bytes выдаются после актуального revoke."
    ],
    [
      "Revoke-aware gateway/storage с актуальной version enforcement; автономный signedURL до expiry не обещает немедленный object revoke.",
      "Сократить TTL signedURL, но обещать немедленный отказ после revoke, хотя storage не проверяет текущую grant-version. Использовать HTTPS, проверять подпись/размер input, ограничить срок cache и логировать denied object-id без contacts/tokens.",
      "Скрывать старую ссылку из UI и не отзывать действующую capability; direct download продолжается до expiry. Использовать HTTPS, проверять подпись/размер input, ограничить срок cache и логировать denied object-id без contacts/tokens.",
      "Проверять grant только при выпуске signature и хранить долгий автономный URL как доказательство актуальной permission. Использовать HTTPS, проверять подпись/размер input, ограничить срок cache и логировать denied object-id без contacts/tokens."
    ],
    [
      "Signature по исходным bytes, timestamp window, account binding и atomic event-id dedupe; secret rotation имеет определённый overlap.",
      "Проверить signature/timestamp, но не atomic event-id dedupe; валидный replay внутри window повторит business effect.",
      "Проверить signature и dedupe глобально по event, но не bind authenticated account scope к payload/endpoint. Использовать HTTPS, проверять подпись/размер input, ограничить срок cache и логировать denied object-id без contacts/tokens.",
      "Проверить signature parsed/re-serialized JSON без согласованной канонизации вместо исходных signed bytes. Использовать HTTPS, проверять подпись/размер input, ограничить срок cache и логировать denied object-id без contacts/tokens."
    ],
    [
      "Gates всех readers/writers, checked backfill/invariant и проверенный rollback/forward recovery; schema/data/deployment версии согласованы.",
      "Завершить backfill и удалить old field, но не проверить оставшихся V1 readers/writers; snapshot check считается достаточным. Сохранять versioned runbook, operation audit ids и метрики recovery; выполнять bounded canary на отдельном наборе ресурсов.",
      "Проверить V2 synchronous clients, но background jobs/rollback V1 binary оставить несовместимыми с contract. Сохранять versioned runbook, operation audit ids и метрики recovery; выполнять bounded canary на отдельном наборе ресурсов.",
      "Рассчитывать на backup как rollback любого destructive schema change, не проверяя новые записи и online compatibility. Сохранять versioned runbook, operation audit ids и метрики recovery; выполнять bounded canary на отдельном наборе ресурсов."
    ],
    [
      "Durable steps/receipts/compensation ids и uncertain state; reconcile refund, bounded retry same key, SQL rollback не отменяет external payment.",
      "Refund retry использует same op-id, но после timeout saga сразу маркируется compensated до outcome reconciliation.",
      "Durable saga хранит steps, но для каждого refund retry создаётся новый key; повторный внешний refund не предотвращён.",
      "После reservation failure rollback локальную DB и удалить payment receipt, считая внешний payment отменённым. Сохранять versioned runbook, operation audit ids и метрики recovery; выполнять bounded canary на отдельном наборе ресурсов."
    ],
    [
      "Fence writes, восстановить durable ids или reconcile provider ledger по identity, проверить invariant/RPO/RTO; replay после определения outcome.",
      "Restore DB snapshot, но не fence текущих writers и не сверять provider; восстановленная dedupe таблица считается полной историей. Сохранять versioned runbook, operation audit ids и метрики recovery; выполнять bounded canary на отдельном наборе ресурсов.",
      "Replay всех отсутствующих DB payments новыми ids до reconciliation, хотя provider мог уже выполнить их после snapshot. Сохранять versioned runbook, operation audit ids и метрики recovery; выполнять bounded canary на отдельном наборе ресурсов.",
      "Сверять суммы ledger без identity receipts и считать равную общую сумму доказательством отсутствия повторов/пропущенных операций. Сохранять versioned runbook, operation audit ids и метрики recovery; выполнять bounded canary на отдельном наборе ресурсов."
    ]
  ],
  "frontend-engineering": [
    [
      "Entity store плюс per-entity draft/baseline/revision/op identity; counters derived из актуального snapshot, без второй вручную обновляемой истины.",
      "Namespace server cache по entity, но держать один global draft; success A сбрасывает draft активного B. Сохранить baseline/op audit-id, отдельно показать pending/dirty и добавить видимый error action без удаления введённого текста.",
      "Сохранять per-entity draft, но derived counters обновлять вручную из каждого response без версии authoritative snapshot. Сохранить baseline/op audit-id, отдельно показать pending/dirty и добавить видимый error action без удаления введённого текста.",
      "После op success обновить current baseline независимо от captured entity/revision и считать самый поздний arrival актуальным."
    ],
    [
      "Whole-state rollback теряет later updates; нужны op-scoped inverse/rebase/conflict policy, unknown outcome прежде всего reconcile.",
      "Rollback deleteA initial whole-state snapshot, включая более позднюю успешно обновлённую B. Сохранить baseline/op audit-id, отдельно показать pending/dirty и добавить видимый error action без удаления введённого текста.",
      "Использовать inverse delta, но применить его к новой entity без operation identity и rebase/conflict policy.",
      "Timeout считать definitive delete failure и восстановить A без reconcile, затем отправить delete новым business key."
    ],
    [
      "Account proofs/history независимы от resumeId; contextual suggestions пусты без CV, старый attempt context не перепривязывается молча.",
      "Account proofs отдавать только через выбранный resumeId; отсутствие CV блокирует исторические account evidence.",
      "При удалении CV переместить старые attempt.resumeId в последний оставшийся CV, не сохраняя исходный context snapshot.",
      "Копировать account proofs в изменяемые поля каждого CV и удалять их вместе с документом. Сохранить baseline/op audit-id, отдельно показать pending/dirty и добавить видимый error action без удаления введённого текста."
    ],
    [
      "Dialog: имя, inert background, focus trap/return к живому trigger/fallback; Escape только верхний portal, outside по ownership.",
      "Dialog имеет accessible name и focus trap, но Escape одновременно закрывает nested popover и dialog, а focus остаётся на удалённом node.",
      "Задать aria-modal=true без inert/focus management background; semantic flag считается блокировкой всех keyboard interactions. Дополнительно измерять contrast полей и кнопок в обеих темах; проверить порядок доступных keyboard shortcuts и скорость появления popover.",
      "Outside-click слушать только DOM containment dialog, не учитывая portal child; действие inside portal считается внешним до выполнения. Дополнительно измерять contrast полей и кнопок в обеих темах; проверить порядок доступных keyboard shortcuts и скорость появления popover."
    ],
    [
      "Semantic list/position counts, active entity и scroll-to-mount до focus; при removal доступный fallback, проверенный реальным AT/keyboard сценарием.",
      "Задать role/row counts, но позволить focused node исчезнуть без active identity/scroll-to-mount/focus fallback. Дополнительно измерять contrast полей и кнопок в обеих темах; проверить порядок доступных keyboard shortcuts и скорость появления popover.",
      "Навигировать по viewport index вместо business identity; reorder/virtualization может передать focus другой сущности.",
      "Увеличить overscan и считать это гарантией доступности всех возможных offscreen keyboard targets без mount policy. Дополнительно измерять contrast полей и кнопок в обеих темах; проверить порядок доступных keyboard shortcuts и скорость появления popover."
    ],
    [
      "Тот же status/text/icon без обязательного движения, respect reduced-motion; результат не зависит только от цвета/animationend и не захватывает focus.",
      "Поставить prefers-reduced-motion duration0, но финальный текст показывать только по animationend; при пропущенном событии смысл исчезнет. Дополнительно измерять contrast полей и кнопок в обеих темах; проверить порядок доступных keyboard shortcuts и скорость появления popover.",
      "Оставить движение выключенным, а статус передать только цветом без текста/иконки и screen-reader announcement. Дополнительно измерять contrast полей и кнопок в обеих темах; проверить порядок доступных keyboard shortcuts и скорость появления popover.",
      "Для любого async success переводить focus на toast, даже если user продолжает заполнять форму; information delivery нарушает рабочую позицию."
    ],
    [
      "Trace event→processing→paint, уменьшить/разделить измеренный work/DOM; pure compute worker где уместно, representative interaction после изменения.",
      "Разделить network span, но оптимизировать только payload и объявить measured main-thread task исправленным без interaction trace.",
      "Перенести pure calculation в worker, но оставить тяжёлый DOM commit неизмеренным и заявить устранение всего INP bottleneck.",
      "Virtualize список без проверки focus/accessibility и считать меньший DOM достаточным доказательством улучшения всех interactions."
    ],
    [
      "Measured initial/preview paths, local worker/fonts и failure/retry; приватные bytes invalidated по projection/identity/revoke, total bytes не выдаются за initial.",
      "Проверить initial bytes после split, но не проверить local worker/fonts и failure/retry preview. Для доказательства готовности показать успешный screenshot уже закэшированного preview предыдущей версии и сопоставить размер основных JS chunks.",
      "Cache PDF по resumeId без projection/grant-version; lazy chunk правильно загружен, но private stale bytes могут подменить документ.",
      "Считать общий sum всех lazy chunks initial bundle и сравнивать разные измеряемые пути как одинаковую метрику."
    ],
    [
      "Responsive reflow с доступными actions при zoom/mobile, естественная прокрутка при необходимости; performance проверяется без обрезания содержимого.",
      "Зафиксировать desktop height и overflow:hidden кабинета; при zoom/mobile нижние actions теряются вместо reflow.",
      "Уменьшать font-size при любом zoom, сохраняя исходную геометрию и обходя пользовательское увеличение текста.",
      "Резервировать image geometry, но не проверять поздние fonts/async cards; объявить отсутствие любых layout shifts по одной картинке."
    ],
    [
      "Captured query/filter/session cache-key и current intent generation guard; A response хранится только как A, cancel не заменяет stale check.",
      "Проверять current request-id при success, но сохранять cache по одному query key без filters/session scope. Записать query/entity operation-id, ограничить retry budget и показать локальные loading/error состояния без фиктивного success.",
      "Использовать abort как единственную stale guard; transport, который игнорирует cancel, всё ещё может применить поздний A. Записать query/entity operation-id, ограничить retry budget и показать локальные loading/error состояния без фиктивного success.",
      "Cache response A писать в key current query B после resolve; ключ выбирается по текущему UI вместо captured request identity. Записать query/entity operation-id, ограничить retry budget и показать локальные loading/error состояния без фиктивного success."
    ],
    [
      "Только successful authorized body download — серверный event с dedupe; preview/HEAD/denied/owner и смена projection не создают фиктивные downloads.",
      "Count download при успешном HEAD/preview, а actual body-response считать повтором; счётчик не отражает employer download contract. Записать query/entity operation-id, ограничить retry budget и показать локальные loading/error состояния без фиктивного success.",
      "Deduplicate employer download отдельно для каждой projection; изменение includeSalary искусственно увеличит счётчик одного события. Записать query/entity operation-id, ограничить retry budget и показать локальные loading/error состояния без фиктивного success.",
      "Increment UI counter до ответа API и не откатывать denied/aborted response; visual success считается фактом авторизованного скачивания."
    ],
    [
      "Persist entity/baseline/op-id intent со scoped data policy; online reconcile/rebase, owner/session check, приватная очередь прошлого user изолируется.",
      "При412 автоматически заменить baseline на current revision и повторить full draft без merge/user conflict policy.",
      "Очередь intents хранить без session/owner scope; login другого user получает прежние private operations. Записать query/entity operation-id, ограничить retry budget и показать локальные loading/error состояния без фиктивного success.",
      "Offline receipt показывать как server commit и удалять operation identity до подтверждения/reconciliation. Записать query/entity operation-id, ограничить retry budget и показать локальные loading/error состояния без фиктивного success."
    ],
    [
      "Effective projection server = текущий ACL ∩ выбранные fields; client key/lifecycle отсекает stale render, но не расширяет серверные права.",
      "Проверять server ACL только на login, потом разрешить выбранной projection возвращать любые поля по include flag.",
      "Intersect в HTML, но PDF/DOCX формировать из full source с контактами в hyperlinks/metadata.",
      "Cache-key включает resume/projection, но не grant-version/session; старый full preview остаётся после revoke."
    ],
    [
      "Browser-safe contracts отделены от server-only implementation/secrets; enforce dependency boundary и inspect bundle, types-only не переносит secret runtime.",
      "Секрет import остаётся в browser bundle, но ветка if(server) не выполняется; unreachable runtime считают границей публикации.",
      "Общий package экспортирует contracts и server secrets, а tree-shaking считать гарантированным без inspection build. Объявить versioned DTO contracts, проверить dependency graph и ограничить cache lifetime; private input не выводить в общие logs.",
      "Minify/обфускация secret string считаются достаточной защитой опубликованного artifact от recipient. Объявить versioned DTO contracts, проверить dependency graph и ограничить cache lifetime; private input не выводить в общие logs."
    ],
    [
      "Explicit domain owner/lifetime, immutable DTO/adapters и versioned commands; account proofs не копируются в editable CV поля.",
      "Account evidence owner размещён внутри каждой route и удаляет proofs при unmount; lifetime account фактически совпадает с tab.",
      "Хранить editable копии account proofs в CV и считать каждую независимой authoritative истиной. Объявить versioned DTO contracts, проверить dependency graph и ограничить cache lifetime; private input не выводить в общие logs.",
      "Derived UI фильтр меняет состав обязательной category matrix вместо проекции данных, незаметно повышая грейд."
    ],
    [
      "Request/session scoped DTO/cache и допустимый initial snapshot, session/revoke invalidation с late-result guard; private bytes не попадают в общий SSR.",
      "Full private DTO сериализовать в SSR, затем скрыть поля при client hydration; bytes уже доступны recipient.",
      "Использовать один server cache всех sessions с одинаковым route; initial private snapshot A попадёт другому user.",
      "Client cache после logout оставить доступным новой session, полагаясь только на remount страницы."
    ],
    [
      "Scoped op identity/status и authoritative outcome/baseline lookup; history navigation не откатывает command и не восстанавливает server grant.",
      "При navigation abort считать server command отменённой и повторить POST новым key после возврата. Сохранить route/session correlation-id и drafts по объявленной policy, проверить offline/online UI states и bounded retry сообщения.",
      "Хранить opK, но не выполнять status lookup; локальное отсутствие response считается подтверждённым failure. Сохранить route/session correlation-id и drafts по объявленной policy, проверить offline/online UI states и bounded retry сообщения.",
      "History back восстанавливает visual grant badge, а новые requests доверяют badge вместо актуального server permission."
    ],
    [
      "Compatible versioned API/assets с support window старых pages, safe refresh/draft recovery; private caches scoped, offline bytes не заменяют актуальный grant.",
      "Активировать V2 service worker и сразу удалить V1 API compatibility, хотя открытые страницы продолжают выполнять старый контракт.",
      "Forced reload выполнить без сохранения/согласования unsaved drafts; deployment считается достаточным основанием потери intent.",
      "Старый offline private cache считать действующим разрешением после authoritative revoke/session смены. Сохранить route/session correlation-id и drafts по объявленной policy, проверить offline/online UI states и bounded retry сообщения."
    ]
  ]
};
export function seniorReviewedPlans(skillId:string,c:number,s:number):readonly string[]{const row=choices[skillId]?.[c*3+s];if(!row||row.length!==4)throw new Error('Missing reviewed Senior choices');return row;}
