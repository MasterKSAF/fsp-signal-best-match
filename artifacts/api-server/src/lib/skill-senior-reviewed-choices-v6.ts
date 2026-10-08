/** v6 content review: distractors contain only the failed engineering strategy of their own scenario.
 * No shared telemetry/diagnostic tail is attached. Historical v4/v5 authored plans remain separate. */
const plans:Record<string,readonly (readonly string[])[]>={
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
      "Закрывать upstream лишь при parse error; успешный досрочный stop считать полным прочтением и пропускать finally."
    ],
    [
      "Перед мутацией заменить binding отдельным dict или обеспечить доказанный ownership; copy_context разделяет bindings, не deep-copy значения.",
      "Перед каждой операцией делать copy_context, но изменять прежний dict in-place; новое binding считать доказательством отдельного объекта.",
      "Хранить один dict в ContextVar и reset token после вызова; считать reset откатом всех вложенных мутаций dict.",
      "Использовать thread-local dict для всех async tasks одного thread и изолировать tenants только именем callback."
    ],
    [
      "Cache-key и scope включают tenant-identity вместе с args; lifetime/TTL ограничены. wraps сохраняет метаданные, но не изолирует tenants.",
      "Добавить wraps и cache-clear после каждого переключения текущего tenant; параллельные tasks используют общий cache без tenant-key.",
      "Включить tenant в лог результата, но ключ оставить только по args; совпавшие args считать достаточной функциональной эквивалентностью.",
      "Кэшировать по идентификатору потока и args; несколько async tenants одного thread считают одним cache scope."
    ],
    [
      "Cache владеет shared task, waiters используют shield; failed-entry удаляется по matching task identity, cancel operation — отдельное действие owner.",
      "Shield shared task, но удалять cache entry по key в finally любого waiter, не проверяя, что entry ещё относится к той же task.",
      "Удерживать task в cache и перезапускать её после failure через повторный await того же уже завершённого объекта task.",
      "Делать отдельную task каждого waiter, но оставить общий entry и считать это сохранением coalescing/единственного upstream вызова."
    ],
    [
      "Необработанная RuntimeError-подгруппа распространяется наружу. Частично обработанные ValueError не превращают всю исходную группу в success.",
      "После обработки ValueError объявить всю исходную группу восстановленной, хотя оставшаяся RuntimeError подгруппа не получила обработчика.",
      "Повторить все операции из исходной ExceptionGroup после частичного except* без operation identities, включая уже успешно завершённые шаги.",
      "Преобразовать оставшиеся RuntimeError в список warnings и вернуть success, не согласовав такую политику с вызывающим контрактом."
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
      "Заменить только outer message, но оставлять полный __cause__/__context__ в JSON DTO и в общедоступном diagnostics endpoint.",
      "Отправлять клиенту redacted message, но безусловно публиковать исходный payload/traceback в tenant-shared log с теми же секретами."
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
      "Проверять count type/range, но повтор ключа считать harmless last-write-wins без изменения явного duplicate-key контракта."
    ],
    [
      "Недоверенный pickle не исполнять; использовать формат данных со схемой и resource budget, проверяемый до сохранения.",
      "Разрешить pickle.loads в sandbox-функции, затем проверить форму результата; десериализация выполняется до проверки доверия к payload.",
      "Ограничить длину pickle и проверить magic prefix, но исполнять любые reduce-callables; размер считать защитой от произвольного исполнения.",
      "Использовать JSON schema после conversion из pickle; опасную первую фазу считать безопасной, поскольку сохранение данных происходит позже."
    ],
    [
      "Bytes до/во время parse, depth/nodes/time и atomic save; при превышении ошибка без частичной записи, truncation и echo секретного payload.",
      "Ограничить число узлов после полного parse, но не bytes/depth/time; allocation и рекурсия до проверки остаются неограниченными.",
      "Ограничить bytes и время, но silently truncate deep ветки и сохранять преобразованный объект как валидный исходный payload.",
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
      "Предагрегировать items по order_id; LEFT JOIN с COALESCE(count,0) сохраняет orders без children.",
      "Выполнить LEFT JOIN к необработанным items и использовать COUNT(*) для каждого order; NULL-строку отсутствующего child считать item.",
      "Предагрегировать items, но затем INNER JOIN к orders; исчезнувшие orders без items считают корректным нулевым представлением.",
      "Считать DISTINCT amount одним order при любой identity; равные суммы разных orders не включать в итог повторно."
    ],
    [
      "Защитить непересечение интервалов на записи в согласованной transaction boundary; 0/>1 price matches явно диагностировать, не скрывать LIMIT1.",
      "Применить UNIQUE(item,from) и LIMIT1 для любого пересечения; ограничение разных start считают доказательством непересекающихся интервалов.",
      "Проверять overlap отдельным SELECT до INSERT без общей сериализации writers; каждый precheck гарантирует глобальное непересечение.",
      "Для каждого item взять минимальный price среди совпавших интервалов; при 0 совпадений подставить0. INSERT разрешать при UNIQUE(item,from), даже если новый интервал пересекает прежний с другим start."
    ],
    [
      "Хранить SUM(amount) и COUNT(amount), явно обработать пустую группу. COUNT(*) и равные веса групп не заменяют количество наблюдений.",
      "Хранить SUM(amount) и COUNT(*) и делить их при слиянии; строки NULL учитываются в count, но не в sum.",
      "Хранить AVG каждой группы, усреднять эти averages равным весом; исходные counts считать лишними для объединения.",
      "Нормализовать все NULL в0 до статистики и не объявлять это изменением контракта отсутствующего наблюдения."
    ],
    [
      "Correction-id dedupe и delta — одна транзакция; разные corrections одной строки обрабатываются независимо.",
      "Проверять correction-id до транзакции, затем применять delta и записывать id двумя независимыми commits; concurrent duplicate допустим как редкий случай.",
      "Помечать correction processed до обновления aggregate; crash между шагами восстанавливать простым пропуском повторного id.",
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
      "Удалить внешний id IS NOT NULL, но сравнивать в NOT EXISTS только id; равные ids разных tenants подавят независимые строки.",
      "Фильтровать NULL только справа и оставить NOT IN tuple; NULL L остаётся UNKNOWN, хотя контракт требует включить его как unmatched.",
      "Использовать null-safe equality для tenant/id и считать два NULL одним identity, хотя контракт задаёт отсутствие совпадения."
    ],
    [
      "NOT NULL и CHECK(x>0); миграция старых NULL и совместимость writers проверены до включения.",
      "Добавить CHECK(x>0), сохранив nullable x; UNKNOWN трактовать как нарушение автоматически без отдельного NOT NULL.",
      "Добавить NOT NULL, но оставить отрицательные x допустимыми; корректность диапазона делегировать только текущему клиенту.",
      "В backfill заменить каждый NULL на0, затем включить CHECK(x>0); отсутствие значения считать законным нулевым значением."
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
      "После CAS failure повторять прежнее SET balance=old+2 без version predicate; потерянное обновление считать обычным retry.",
      "Всегда перечитывать version и автоматически выполнять новый increment, даже если прежний outcome неизвестен и receipt не проверен.",
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
      "Cursor включает sort key и id; inserts до cursor требуют отдельного snapshot или re-scan контракта.",
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
      "Проверять parent<>child и все foreign keys; эти локальные условия считать достаточными для DAG любой длины.",
      "Проверять reachability до insert каждой edge без защищённой graph-version/сериализации; concurrent prechecks считают независимыми.",
      "Уникальность пары parent/child считать запретом любого направленного цикла, даже если все пары цикла различны."
    ],
    [
      "Expand → fence writers → idempotent backfill/check → NOT NULL → contract legacy path.",
      "Завершить один backfill и сразу NOT NULL, не ограждая старых writers; последующие NULL считают невозможными без проверки.",
      "Обновить приложение V2, но старые jobs оставить пишущими NULL; enforce constraint считать полностью совместимым rollout.",
      "Сначала убрать legacy field, затем восстанавливать ещё читающие его clients из backup; backup считают механизмом онлайн совместимости."
    ],
    [
      "Конфликт по другому payload_hash без нового effect или замены receipt; тот же scope/key не доказывает semantic equivalence payload.",
      "При ON CONFLICT вернуть старый result без проверки hash; несовместимый payload станет эквивалентным повтором.",
      "При новом hash перезаписать receipt и выполнить новый effect в том же scope, не сообщая semantic conflict.",
      "По event_id найти прежний receipt без tenant; при совпадении payload hash вернуть его result новому tenant, не выполняя новый effect. Tenant входит в audit record, но не в lookup или unique constraint."
    ]
  ],
  "typescript": [
    [
      "Runtime decoder проверяет version и поля union либо возвращает ошибку; assertNever проверяет typed switch, неизвестная version не downcast.",
      "Runtime проверить только kind, затем as Protocol; обязательные version-dependent поля считать гарантированными TypeScript union.",
      "При неизвестной version перейти на V1 decoder и вернуть success, даже когда semantic contract новой версии неизвестен.",
      "В switch добавить общий default success; compilation продолжит проходить, но отсутствующая ветка расширенного union не будет обнаружена."
    ],
    [
      "Reducer: tagged state/event плюс captured op-id; stale event не завершает другую операцию.",
      "Проверять только текущий discriminant loading, а operation-id не сравнивать; старый success A может завершить новый loading B.",
      "Тип Success снабдить optional op-id и default его на current id при decode; stale response станет текущим без доказательства.",
      "Использовать boolean loading с typed event payload; тип event считать гарантией порядка delivery от внешнего источника."
    ],
    [
      "Runtime discriminator и поля каждой ветки U валидируются явно; conditional type вычисляет типы, не фильтрует JSON на исполнении.",
      "Применить conditional type к unknown и as U к результату; считать это выполненным runtime filtering внешних JSON объектов.",
      "Проверить только наличие kind string и выдать U без проверки полей ветки; type-level never считают валидатором значения.",
      "Сделать tuple-wrapper conditional и объявить его runtime decoder с тем же результатом; TypeScript не исполняет этот код как проверку."
    ],
    [
      "Сохранить primitive v до scheduling либо изолировать нужный snapshot; const/readonly сами не замораживают object values.",
      "Сохранить const reference state, затем читать поле в microtask; const объявить снимком значения до последующей мутации.",
      "Назначить readonly type на state, но внешнему модулю оставить ту же mutable reference; runtime мутации не защищены.",
      "Скопировать state внутри microtask, уже после state.v изменился; считать новую копию снимком значения на момент scheduling, а не на момент фактического чтения."
    ],
    [
      "bind/arrow сохраняет receiver; this:void — для независимого callback, bound object не snapshot.",
      "Передать owner.read как отдельный callback без bind; receiver считается сохранённым только потому, что функция была извлечена из объекта.",
      "Привести отделённый метод as ()=>number и считать, что TypeScript заменит его runtime this.",
      "Bind owner, но объявить зафиксированным прежнее значение поля v; bound receiver всё ещё наблюдает позднюю мутацию объекта."
    ],
    [
      "Явный tagged wire format или ограничения допустимых значений и проверка обеих сторон; JSON.stringify не сохраняет все JS states.",
      "Разрешить все values типа number и JSON.stringify без finite check; NaN/Infinity превращаются в null без явной политики потери.",
      "Считать object missing и explicit undefined одним lossless wire состоянием; после roundtrip различие исчезает.",
      "Передавать BigInt через обычный JSON.stringify без encoder и считать поддержку гарантированной numeric type."
    ],
    [
      "Callback принимает широкий {id} и проверяет дополнительные поля, либо producer реально обещает обязательный admin; method bivariance этого не доказывает.",
      "Переписать callback property как method syntax для обхода variance check, сохранив producer широкий input и заявляя обязательный admin.",
      "Сделать generic callback<T> с приведением узкого параметра и считать, что inference добавит runtime admin каждому producer объекту.",
      "Проверить admin один раз у первого вызова callback, а все следующие более широкие inputs считать доказанно такими же."
    ],
    [
      "До get проверить own-key whitelist и obj schema; T[K] сохраняет типовую корреляцию без runtime-разрешения.",
      "Привести внешнюю key:string к keyof T без runtime whitelist; inherited/private keys станут доступными как бизнес-поля.",
      "Проверять key in obj, но не own-property/allowed keys; любой inherited key считать разрешённым полем.",
      "Валидировать key, но доверять форме obj после as T; return-type T[K] не гарантирует фактическое значение JSON."
    ],
    [
      "Assertion обязана реально отвергать undefined; negative runtime inputs проверяются. Пустое тело нарушает soundness, несмотря на narrowed type.",
      "Оставить пустое тело assertion и проверить только compilation; утверждённый narrowed type считать доказанным runtime значением.",
      "Сделать x as T до вызова assertion и не обрабатывать undefined; unsafe cast считать проверкой входа.",
      "Проверять truthiness и принимать только truthy T, хотя контракт запрещает только undefined и разрешает0/false/пустую строку."
    ],
    [
      "Новый index max revision с explicit conflict и provenance; source rows/изменяемые paths не мутировать, равный revision не скрывает разный payload.",
      "Выбирать последнюю row каждого id без сравнения revision или payload; порядок массива считать и версией, и semantic equivalence.",
      "При равных revision выбирать любую row и удалять конфликт из результата; source provenance не сохранять.",
      "Сортировать original rows in-place и отдавать тот же nested graph всем consumers, считая новый Map полной immutable копией."
    ],
    [
      "PATCH: own-property presence и допустимые values; missing/null/value задают разные операции.",
      "Считать missing и null одной clear операцией; partial PATCH удалит отсутствующие поля baseline.",
      "Использовать patch.field||baseline.field для merge; null и empty string будут незаметно превращены в прежнее значение.",
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
      "Success и cleanup проверяют task/op identity; stale A не меняет state и не удаляет entry B.",
      "Применять identity guard только в success, но finally A удаляет общий cache entry B и сбрасывает его loading.",
      "После abort request A не сравнивать op-id: транспорт может продолжить работу, но cancel считается guaranteed.",
      "Хранить один cache entry по URL, включая ответы разных query/session; после restart loading применить последний arrival без сравнения captured task identity, а finally любого waiter удаляет этот общий entry."
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
      "Копировать только a для нового состояния, но передать b недоверенному mutable consumer без ownership или runtime защиты."
    ],
    [
      "Graph traversal с visited; Date/Map/arrays требуют своей политики, внешний freeze не блокирует Map.set.",
      "Обойти graph рекурсивно без visited set; циклы считаются безопасными, потому что каждый object freeze idempotent.",
      "Freeze plain Map object и обещать запрет Map.set/delete без отдельной политики внутренних mutable slots.",
      "Сделать visited traversal, но пропустить вложенные arrays и Date/Map, объявляя это полной неизменяемостью всех доступных значений."
    ],
    [
      "Transfer передаёт ArrayBuffer ownership и detaches прежние views; SharedArrayBuffer требует отдельного concurrency/Atomics контракта.",
      "Передать ArrayBuffer transferList и продолжить использовать прежний view как живой snapshot без обработки detach.",
      "Receiver получает subarray исходного view, записывает новые bytes и возвращает отдельный view object; sender сохраняет прежний view как historical snapshot. Shared buffer не копируется, поскольку identity двух views различна.",
      "SharedArrayBuffer объявить transfer-owned и читать/писать без Atomics или другой concurrency policy, игнорируя параллельный доступ."
    ]
  ],
  "react": [
    [
      "Render/reducer чистые; payment — explicit command с operation-id/outcome protocol. Effects/commits сами не являются exactly-once delivery.",
      "Выполнить payment из reducer, но dedupe только по числу render; aborted/replayed renders не имеют устойчивой business identity.",
      "Сделать side effect внутри useMemo и считать зависимости гарантирующими единственное выполнение независимо от lifecycle.",
      "Перенести POST в effect без operation-id и reconciliation; StrictMode/retry эффекта считаются proof exactly-once."
    ],
    [
      "Immutable входы и чистое вычисление, external effects вне render; transition приоритизирует UI, не откатывает JS-мутации.",
      "Оборачивать impure calculation в startTransition и считать discard render rollback внешнего array mutation.",
      "Мутировать input snapshot во время render, но скопировать его после commit; отброшенные renders уже изменили исходный объект.",
      "Вынести мутацию в useMemo, сохранив внешний shared array; memoization считают изоляцией concurrent calculations."
    ],
    [
      "Связанный invariant выражен одной reducer/state-моделью и explicit action; batching не заменяет проверку business constraints.",
      "Хранить поля в отдельных setters и полагаться только на batching как проверку всех business constraints.",
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
      "Получать актуальный count через functional updater, но server target оставлять из старой entity closure без проверки текущей identity.",
      "Хранить live entity в ref и считать это проверкой актуальных server permissions/revision перед записью.",
      "Зафиксировать dependencies=[] ради stable callback и объявить замыкание актуальным для любого последующего выбора объекта."
    ],
    [
      "Cleanup своего listener, stable scope и generation/entity guard queued events; live-values и источник snapshot определены явно.",
      "Делать cleanup subscription, но не проверять generation уже queued callbacks; старый event применится к новой сущности.",
      "Создавать новую subscription каждого render без cleanup старой; live filter считается достаточной изоляцией событий.",
      "Читать live values из shared mutable object, но забыть entity/generation check и snapshot contract источника."
    ],
    [
      "Cached immutable snapshot/revision меняет reference только при store change; subscribe уведомляет, mutable in-place snapshot не скрывает updates.",
      "Возвращать new object каждый getSnapshot и сравнивать только value внутри компонента; стабильность store snapshot reference отсутствует.",
      "Возвращать один mutable object после in-place изменений без notify; одинаковый reference скрывает изменившиеся данные.",
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
      "Использовать server snapshot с приватными полями, затем client redaction; первоначальные serialized bytes уже раскрыты.",
      "Скрыть несовпадение через suppressHydrationWarning и считать server/client snapshot согласованными без переноса исходного состояния."
    ],
    [
      "Устойчивый entity key; index key при reorder/removal может передать state другой сущности. Key выражает identity, а не права доступа.",
      "Использовать индекс key после reorder, но передавать новый entity-id prop; local draft сохраняется позиции и может сменить владельца.",
      "Использовать случайный key при каждом render ради уникальности; identity/state будут регулярно сбрасываться.",
      "Считать key глобальной business authorization и пропускать проверку identity адресного API запроса."
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
      "UseMemo key строки, но каждый render создавать новый function type; string key не обеспечивает устойчивый type.",
      "Отдельно cache element object, но intentional reset-policy игнорировать и сохранять state разных business entities под общим key."
    ],
    [
      "Следующий submit использует подтверждённый server revision и current draft; conflict обрабатывается явно, новые локальные edits не стираются success.",
      "Обновить server revision, но заменить current draft отправленным snapshot; более поздний local edit потеряется.",
      "Сохранить local draft, но следующий submit отправить со старым baseline revision без конфликтной обработки.",
      "После success обозначить форму clean, хотя local draft отличается от реально сохранённого server snapshot."
    ],
    [
      "Uncertain outcome сохраняется с operation-id и reconcile; scoped rollback не отменяет opB, retry не создаёт новый business-key без проверки.",
      "Rollback failed opA всей list до начального snapshot; opB success также исчезнет из UI.",
      "Timeout opA считать definitive failure и повторить новый POST с другим key, не проверяя прежний outcome.",
      "Сохранить op-scoped rollback, но удалить operation identity до reconciliation uncertain response."
    ],
    [
      "Raw input/composition отдельно от validated model, label/error связаны семантически; промежуточный IME text не сбрасывается, submit проверяет current input.",
      "Coerce/reset controlled value каждого compositionupdate; intermediate IME intent исчезает до compositionend.",
      "Показывать error только цветом и placeholder, без label/error association; raw input считается достаточно доступным.",
      "Считать onChange committed business submit и автоматически отправлять форму при каждом завершении composition."
    ],
    [
      "Draft/operation receipt вне reset subtree; render retry и command reconciliation отдельно, reset не является commit или автоматическим POST-retry.",
      "Reset ErrorBoundary и одновременно повторить прежнюю command новым key, считая reset доказательством failure server operation.",
      "Хранить draft только внутри subtree, которую retry boundary уничтожает; сохранение draft до reset не обеспечено.",
      "Обрабатывать rejected submit только ErrorBoundary, не имея command catch/outcome state."
    ],
    [
      "Session generation в cache/action identity, private-store invalidation и reject late old-session response; route key не заменяет ACL.",
      "Очистить rendered user fields после logout, но сохранить private cache по URL без session generation.",
      "Проверять session только при старте fetch, а поздний response старого user записывать после login другого.",
      "Задать React key по route, но cache старого user оставить shared и считать remount новым authorization scope."
    ],
    [
      "Stable keyed resource/pending promise, targeted invalidation/retry и render ErrorBoundary; business command side effects вне render.",
      "Создавать новый pending promise каждого render без resource cache; стабильного lifecycle ожидания нет.",
      "Держать один resource entry для A/B и разных users; late A result может подменить B.",
      "При retry render всегда выполнять POST с новым key, смешивая resource read и business command side effects."
    ]
  ],
  "frontend-engineering": [
    [
      "Entity store плюс per-entity draft/baseline/revision/op identity; counters derived из актуального snapshot, без второй вручную обновляемой истины.",
      "Namespace server cache по entity, но держать один global draft; success A сбрасывает draft активного B.",
      "Сохранять per-entity draft, но derived counters обновлять вручную из каждого response без версии authoritative snapshot.",
      "После op success обновить current baseline независимо от captured entity/revision и считать самый поздний arrival актуальным."
    ],
    [
      "Whole-state rollback теряет later updates; нужны op-scoped inverse/rebase/conflict policy, unknown outcome прежде всего reconcile.",
      "Rollback deleteA initial whole-state snapshot, включая более позднюю успешно обновлённую B.",
      "Использовать inverse delta, но применить его к новой entity без operation identity и rebase/conflict policy.",
      "Timeout считать definitive delete failure и восстановить A без reconcile, затем отправить delete новым business key."
    ],
    [
      "Account proofs/history независимы от resumeId; contextual suggestions пусты без CV, старый attempt context не перепривязывается молча.",
      "Account proofs отдавать только через выбранный resumeId; отсутствие CV блокирует исторические account evidence.",
      "При удалении CV переместить старые attempt.resumeId в последний оставшийся CV, не сохраняя исходный context snapshot.",
      "Копировать account proofs в изменяемые поля каждого CV и удалять их вместе с документом."
    ],
    [
      "Dialog: имя, inert background, focus trap/return к живому trigger/fallback; Escape только верхний portal, outside по ownership.",
      "Dialog имеет accessible name и focus trap, но Escape одновременно закрывает nested popover и dialog, а focus остаётся на удалённом node.",
      "Задать aria-modal=true без inert/focus management background; semantic flag считается блокировкой всех keyboard interactions.",
      "Outside-click слушать только DOM containment dialog, не учитывая portal child; действие inside portal считается внешним до выполнения."
    ],
    [
      "Semantic list/position counts, active entity и scroll-to-mount до focus; при removal доступный fallback, проверенный реальным AT/keyboard сценарием.",
      "Задать role/row counts, но позволить focused node исчезнуть без active identity/scroll-to-mount/focus fallback.",
      "Навигировать по viewport index вместо business identity; reorder/virtualization может передать focus другой сущности.",
      "Увеличить overscan и считать это гарантией доступности всех возможных offscreen keyboard targets без mount policy."
    ],
    [
      "Тот же status/text/icon без обязательного движения, respect reduced-motion; результат не зависит только от цвета/animationend и не захватывает focus.",
      "Поставить prefers-reduced-motion duration0, но финальный текст показывать только по animationend; при пропущенном событии смысл исчезнет.",
      "Оставить движение выключенным, а статус передать только цветом без текста/иконки и screen-reader announcement.",
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
      "Проверять current request-id при success, но сохранять cache по одному query key без filters/session scope.",
      "Использовать abort как единственную stale guard; transport, который игнорирует cancel, всё ещё может применить поздний A.",
      "Cache response A писать в key current query B после resolve; ключ выбирается по текущему UI вместо captured request identity."
    ],
    [
      "Только successful authorized body download — серверный event с dedupe; preview/HEAD/denied/owner и смена projection не создают фиктивные downloads.",
      "Count download при успешном HEAD/preview, а actual body-response считать повтором; счётчик не отражает employer download contract.",
      "Deduplicate employer download отдельно для каждой projection; изменение includeSalary искусственно увеличит счётчик одного события.",
      "Increment UI counter до ответа API и не откатывать denied/aborted response; visual success считается фактом авторизованного скачивания."
    ],
    [
      "Persist entity/baseline/op-id intent со scoped data policy; online reconcile/rebase, owner/session check, приватная очередь прошлого user изолируется.",
      "При412 автоматически заменить baseline на current revision и повторить full draft без merge/user conflict policy.",
      "Очередь intents хранить без session/owner scope; login другого user получает прежние private operations.",
      "Offline receipt показывать как server commit и удалять operation identity до подтверждения/reconciliation."
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
      "Общий package экспортирует contracts и server secrets, а tree-shaking считать гарантированным без inspection build.",
      "Minify/обфускация secret string считаются достаточной защитой опубликованного artifact от recipient."
    ],
    [
      "Explicit domain owner/lifetime, immutable DTO/adapters и versioned commands; account proofs не копируются в editable CV поля.",
      "Account evidence owner размещён внутри каждой route и удаляет proofs при unmount; lifetime account фактически совпадает с tab.",
      "Хранить editable копии account proofs в CV и считать каждую независимой authoritative истиной.",
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
      "При navigation abort считать server command отменённой и повторить POST новым key после возврата.",
      "Хранить opK, но не выполнять status lookup; локальное отсутствие response считается подтверждённым failure.",
      "History back восстанавливает visual grant badge, а новые requests доверяют badge вместо актуального server permission."
    ],
    [
      "Compatible versioned API/assets с support window старых pages, safe refresh/draft recovery; private caches scoped, offline bytes не заменяют актуальный grant.",
      "Активировать V2 service worker и сразу удалить V1 API compatibility, хотя открытые страницы продолжают выполнять старый контракт.",
      "Forced reload выполнить без сохранения/согласования unsaved drafts; deployment считается достаточным основанием потери intent.",
      "Старый offline private cache считать действующим разрешением после authoritative revoke/session смены."
    ]
  ]
};
export function seniorReviewedChoicesV6(skill:string,c:number,s:number):readonly string[]|null{return plans[skill]?.[c*3+s]??null;}
