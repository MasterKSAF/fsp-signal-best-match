/** Current invariant plans. Original answer position 0 stays stable before assembly shuffle.
 * Four substantive React v5/v6 corrections retain their own plans and are not replaced here.
 * Wrong plans describe near-valid implementations with one concrete missing guarantee.
 */
export function seniorReactFrontendReviewedChoicesV6(skill:string,c:number,s:number):readonly string[]|null {
  const choices:Record<string,readonly string[]>={
    'react:0:0':[
      'Render/reducer чистые; payment — отдельная команда с operation-id и проверяемым outcome. Повтор render не является новой оплатой.',
      'POST выполнять в reducer с тем же payload; результат reducer кешировать по props. Повтор вызова после отброшенного render считать продолжением прежней оплаты без receipt.',
      'POST в useMemo([]); mounted component считать единственным владельцем business key.',
      'POST перенести в effect и отключить StrictMode. После remount создать новый key, поскольку прежний effect уже завершился; неизвестный исход первого POST не сверять.',
    ],
    'react:0:1':[
      'Immutable input и чистый расчёт; внешний эффект — вне render. Transition меняет приоритет, не откатывает JS-мутации.',
      'Начать transition, изменить общий array и вернуть JSX. При отмене render ожидать восстановления прежнего array как части React rollback.',
      'Shared array изменять внутри useMemo, а снаружи отдавать shallow copy; mutations до commit считать скрытыми от остальных читателей.',
      'Мутировать props при расчёте, затем восстановить копию в effect; до первого commit исходные данные уже могут читать другие renders.',
    ],
    'react:0:2':[
      'Связанные поля и invariant — в одной reducer-модели с проверяемым action; batching не проверяет бизнес-ограничения.',
      'Отдельные setters выполнять в одном handler; batching считать доказательством invariant для всех последующих actions и внешних callbacks.',
      'Связанные поля сверять effect после commit; до сверки разрешать submit из промежуточного состояния.',
      'Reducer меняет собственное state и mutable props объекта заказа. Отброшенное state считать откатом обеих записей, хотя общий объект изменился до commit.',
    ],
    'react:1:1':[
      'Задать snapshot/live контракт; команда имеет явную entity и guarded revision. Stable callback сам не доказывает свежесть target.',
      'Текущее число получать updater, но target брать из старой closure. Проверять revision только адресованного старого объекта, считая актуальное число подтверждением нового выбора.',
      'Live ref хранит entity; наличие id в ref считать актуальным server permission без новой проверки.',
      'Callback пересоздавать при выборе entity, однако уже запланированный таймер применять к текущему editor. Новый render считать обновлением target старой команды.',
    ],
    'react:1:2':[
      'Cleanup своей подписки, generation/entity guard queued callbacks; snapshot/live чтение определено контрактом источника.',
      'Отписаться при смене entity, но queued callbacks применять без generation. Считать удаление listener отменой всех уже поставленных событий.',
      'Обработчик читает live ref; event от прежней entity записывает в новый draft, поскольку ref указывает на актуальную страницу.',
      'Для каждого render подписывать новый callback. При unmount удалить только последний listener; предыдущие считать безопасными из-за одинакового имени события.',
    ],
    'react:2:0':[
      'Snapshot immutable и кеширован по revision; store change обновляет reference и уведомляет subscribe. In-place мутация не скрывает изменение.',
      'getSnapshot создаёт объект при каждом вызове; shallow compare перенести в компонент. Повторные store reads до изменения revision всё равно возвращают новые references.',
      'Изменять один mutable snapshot и вызывать notify; прежнюю reference считать достаточным сигналом нового contents.',
      'При notify обновлять revision отдельно, а getSnapshot навсегда возвращает старый кешированный объект.',
    ],
    'react:2:1':[
      'Guard generation проверяет поздний reconnect; устаревший созданный socket закрывается. Cleanup старого socket не закрывает ещё не созданный ресурс.',
      'Игнорировать stale completion по generation, но возвращённый socket не закрывать: он не записан в UI state, значит ресурс считать освобождённым.',
      'В cleanup закрыть уже известный socket; promise reconnect после cleanup присоединить к текущему B.',
      'Пометить promise ожидания cancelled и выйти из callback. У upstream creation нет отмены, но результат с новым socket не обрабатывать, полагаясь на локальный флаг.',
    ],
    'react:2:2':[
      'Допустимый server DTO и initial snapshot scoped по request/session; client начинает с той же проекции. Singleton не переносит private data.',
      'Стабилизировать getServerSnapshot общим singleton. Совпадение hydration считать достаточным, хотя snapshot A может сериализоваться для B.',
      'Передать full DTO через SSR props и удалить private поля в первом client effect; отсутствие их после hydration считать отсутствием утечки initial bytes.',
      'Не передавать initial snapshot, включить suppressHydrationWarning и читать произвольное актуальное store state в первом client render.',
    ],
    'react:3:1':[
      'Durable draft — у стабильного owner по entity вне меняющейся subtree; intentional reset/restore policy задаётся отдельно.',
      'Draft оставить в Editor внутри меняющегося parent type, сохранив child key. Равный key считать достаточным для переживания удаления всего parent subtree.',
      'При layout update менять parent key; перед remount сохранять только server initial data, а несохранённый draft считать восстанавливаемым автоматически.',
      'Вынести только последнее saved значение в общий store; более новые edits держать внутри subtree и после смены типа восстановить saved как полный draft.',
    ],
    'react:4:1':[
      'Uncertain opA сохраняет identity и проходит reconciliation; rollback касается A, не opB. Retry не создаёт новый key при неизвестном исходе.',
      'Op-scoped rollback сохранить, но timeout принять как definitive failure. Повторить POST новым key, не читая receipt/status прежнего вызова.',
      'После ошибки A восстановить initial whole-list snapshot; B success вернётся только после будущего refetch.',
      'Хранить A/B deltas отдельно, но удалить opA identity до reconciliation. Повтор с тем же payload считать безопасным независимо от нового business key.',
    ],
    'react:4:2':[
      'Raw input/composition отдельно от validated model; label/error связаны. IME intent сохраняется, submit проверяет текущий законченный ввод.',
      'Каждый compositionupdate преобразовывать к validated числу; промежуточную строку заменять нулём. После compositionend считать исходный intent восстановленным из этой модели.',
      'Raw input сохранять, но доступное имя — только placeholder, ошибка — только красная рамка.',
      'Raw/validated разделить, а compositionend сразу выполнять как POST submit. Отсутствие ошибки парсинга считать согласием на бизнес-операцию без отдельной отправки.',
    ],
    'react:5:0':[
      'Draft/receipt живут вне reset subtree; render retry и reconciliation команды разделены. Boundary reset не доказывает failure и не повторяет POST.',
      'Draft поднять выше boundary, но при reset послать новую команду с новым key. Ошибку render считать свидетельством неуспешного server commit.',
      'Receipt хранить вне subtree, draft внутри. Boundary retry восстанавливает только server baseline и теряет несохранённый пользовательский ввод.',
      'Draft сохранять, rejected submit оставить без catch и ждать render fallback. Error boundary считать обработчиком любого Promise rejection из event handler.',
    ],
    'react:5:1':[
      'Session generation входит в cache/action identity; private store очищается, late response старой session отклоняется. Route key не заменяет ACL.',
      'На logout очистить DOM, cache оставить по URL. После login B прежний response A записать туда же, если route совпадает.',
      'Проверить session при старте fetch и отменить его при logout. Возможный уже доставленный response принять без generation check, полагаясь только на AbortController.',
      'Перемонтировать страницу с key пользователя, но resource cache хранить глобально без session scope.',
    ],
    'react:5:2':[
      'Stable resource key/lifetime и pending promise; targeted retry, render ErrorBoundary. Business-команды выполняются отдельно от render read.',
      'Ключ resource scoped, но каждый render создаёт новый pending promise. Suspense retry считать гарантией, что прежнее ожидание уже завершилось.',
      'Один resource для A/B, а selected entity хранить в component props; late A result считать B result после смены props.',
      'Resource read при каждом retry вызывает POST с новым key. ErrorBoundary reset трактовать как командный retry без status/outcome прежнего вызова.',
    ],
    'frontend-engineering:0:0':[
      'Entity baseline/draft/operation разделены; active view derived. Response A обновляет A, не draft B; права и projection входят в cache scope.',
      'Кешировать entity отдельно, но один global success-effect сбрасывает active draft. Response A считать подтверждением B, поскольку action завершился на той же странице.',
      'Один current-editor cache key; новый selection меняет props, но не namespace server snapshot.',
      'Хранить draft и selectedItem независимыми копиями server DTO; после refetch заменить обе, даже если пользователь уже редактирует B.',
    ],
    'frontend-engineering:0:1':[
      'Rollback отменяет owned delta A; успех B сохраняется. Unknown outcome сверяется по operation identity, не объявляется failure по таймауту.',
      'При ошибке A восстановить initial snapshot всей коллекции; отдельно успешный B откатится вместе с A.',
      'Вычесть delta A из текущей коллекции, но любой timeout считать confirmed failure. Server receipt не читать, следующую попытку создать с новым key.',
      'После rollback показать новый list snapshot, но server revision оставить от failed optimistic state; следующую запись отправить с этой недоказанной revision.',
    ],
    'frontend-engineering:0:2':[
      'Account proofs/history сохраняются; удалённый CV больше не задаёт recommendations. Empty контекст явный, данные другого CV не подставляются.',
      'Удаление CV очищает общий account evidence store; историю считать принадлежащей только этому editor.',
      'Proofs оставить, recommendations перенести на первый доступный CV без подтверждения выбора. Пустое выбранное резюме скрыть, сохранив прежние CTA и target.',
      'Сохранить удалённый CV как active context в local cache; его рекомендации продолжать применять к новым записям.',
    ],
    'frontend-engineering:1:0':[
      'Overlay stack с topmost Escape/outside, focus scope через portal, inert background и живой trigger/fallback. Touch и keyboard используют тот же слой.',
      'Dialog trap оставить, portal popover исключить из scope. Его focus считать уходом в фон и каждый Tab возвращать на первый dialog control.',
      'Каждый overlay отдельно слушает document Escape; одно нажатие закрывает оба и фокусирует прежние, уже удалённые triggers.',
      'Escape закрывает topmost, но после закрытия искать только исходный trigger. Удалённому trigger вызвать focus; fallback и inert background не управлять.',
    ],
    'frontend-engineering:1:1':[
      'Stable item identity, объявленный total/позиции и политика active focus при windowing. Активный DOM сохраняется либо focus перемещается предсказуемо с объявлением.',
      'Держать aria-rowcount=500, focus оставить на удаляемой row. Число общего списка считать достаточным для сохранения keyboard target после её unmount.',
      'Focus привязать к index видимого окна; после scroll тот же index адресует уже другой business item.',
      'Для keyboard mount все 500 rows, но объявить только видимые10; screen reader не получает согласованной общей структуры и навигации.',
    ],
    'frontend-engineering:1:2':[
      'Achievement имеет текст/status без motion; reduced-motion не мешает действию, а focus сохраняется. Анимация — дополнение к понятному результату.',
      'В reduced-motion скрыть анимацию и весь achievement блок. Отсутствие движения считать сохранением смысла, даже если текст результата исчез.',
      'Заменить анимацию мигающим цветом без подписи; toast получает focus после каждого успеха.',
      'Оставить текст, но disable действий держать до animationend. При motion off событие не приходит, поэтому workflow останется заблокированным.',
    ],
    'frontend-engineering:2:0':[
      'Измерить interaction main-thread path, разбить/сократить CPU и render; network оптимизировать по trace отдельно. Проверить latency, CPU и корректность результата.',
      'Снизить network20ms до10ms, оставив calculation500ms; улучшение общего времени считать устранением main-thread blocking.',
      'Перенести500ms расчёт в microtask через Promise.then; считать main thread свободным для ввода во время её выполнения.',
      'Разбить расчёт на chunks и дать yield, но partial result объявлять окончательным до обработки всех данных. Короткие tasks считать доказательством и скорости, и точности.',
    ],
    'frontend-engineering:2:1':[
      'Viewer lazy chunk загружается по preview; проверить chunk waterfall, error/retry, worker cleanup и ACL. Первичная страница не тащит необязательный viewer.',
      'Вынести viewer в dynamic import, но вызвать import при mount каждой страницы; размер основного файла снизился, стартовая загрузка всё ещё включает viewer.',
      'Lazy import включить, failed import заменить сообщением «Файл загружен»; retry не предусмотрен.',
      'JS viewer lazy, worker создавать глобально на старте и не закрывать после preview. Неучтённые workers считать частью браузерного кеша независимо от ресурсов.',
    ],
    'frontend-engineering:2:2':[
      'Reflow/zoom и доступные labels/actions сохраняются; image geometry резервируется. Windowing/lazy loading не скрывают общий объём и keyboard путь.',
      'Фиксировать desktop ширину и overflow:hidden. Zoom200% считать масштабированием того же layout, даже если действия за краем недоступны.',
      'Снизить шрифт до8px при360px и запретить zoom; компактность считать достаточной читабельностью.',
      'Виртуализировать список, но фокусируемые controls вне окна удалять без fallback; image размеры узнать только после load, полагаясь на последующий scroll correction.',
    ],
    'frontend-engineering:3:0':[
      'Cache scoped по entity/query/session, current view — по request generation; abort дополняет guard. Stale completion не сбрасывает новый data/error.',
      'Abort A при старте B; все callbacks всё равно пишут current data. Транспортную отмену считать доказанной, хотя A resolve уже доставлен.',
      'Проверять current query, но cache по одному search key; response A может заменить B в общем кешированном baseline.',
      'Cache key корректный, однако общий finally любого запроса снимает B pending и очищает B error. Entity-scoped data считать достаточной защитой всего view state.',
    ],
    'frontend-engineering:3:1':[
      'Проверить действительный HTTP/result и актуальный доступ; denied HEAD/preview не являются download. Success/аналитика следуют контракту реального разрешённого события.',
      'HEAD успешно вернул metadata: сразу показать скачивание завершённым и увеличить download counter.',
      'Увеличить counter на click до ACL ответа; denied request затем скрыть из UI, но считать факт клика скачиванием.',
      'Разрешённый preview считать первым download, затем повторный download с новой projection посчитать второй раз в том же dedupe window. Актуальную проверку grant выполнить только для preview.',
    ],
    'frontend-engineering:3:2':[
      'Offline queue scoped по session/entity и сохраняет baseline/op-id; reconnect сверяет outcome и conflict. Logout закрывает старые операции; stale private grants не применяются.',
      'После412 заменить expectedRevision текущей и повторить старый draft. Fresh revision считать разрешением на потерю изменений другого автора.',
      'Сохранить queue в одном localStorage всех sessions; после login B доставить команды A с credentials B.',
      'При offline считать последний cached grant действующим; после revoke разрешать новые private действия до следующего успешного permission refresh.',
    ],
    'frontend-engineering:4:0':[
      'Projection и grant проверяет сервер при выдаче; cache включает session/projection/grant version. Revoke инвалидирует full bytes, UI-фильтр не расширяет доступ.',
      'Сервер отдаёт full DTO всем, UI hides contacts по grant. Full cache между grant versions оставить общим, считая визуальную redaction границей данных.',
      'Cache включает projection, но не grant version; прежний full file повторно отдать после revoke без server проверки.',
      'Проверить grant только при генерации URL; браузерные cache bytes считать доступными любой session с этим URL.',
    ],
    'frontend-engineering:4:1':[
      'Shared package содержит чистые public types/logic; server/browser exports разделены. Bundle/import проверяется, secrets остаются только на server boundary.',
      'Secret import оставить в общем module под if(server). Невыполненную ветку считать отсутствием строки secret в browser bundle.',
      'Secret заменить browser env variable с public prefix; ключ нужен shared helper, значит считать его защищённым именем переменной.',
      'Frontend импортирует server adapter ради одного чистого типа; tree shaking считать доказанной защитой без проверки resulting bundle и side-effect imports.',
    ],
    'frontend-engineering:4:2':[
      'У каждого state один owner/contract; account evidence отдельно от route draft. Lifecycle и discard/restore заданы, derived view не становится второй независимой копией.',
      'Account proofs скопировать в каждый route state; route cleanup удалить и локальную копию, и общий account store.',
      'Draft хранить и в route, и в account store; оба независимо правят его и reconciliate таймером. Отсутствие сообщения о конфликте считать согласованным ownership.',
      'Сохранить server snapshot как editable draft без baseline/dirty; refetch заменяет пользовательский ввод, поскольку сервер считается единственным владельцем всех значений.',
    ],
    'frontend-engineering:5:0':[
      'SSR DTO/cache scoped по request/session и допустимой проекции; hydration использует тот же snapshot. Session/revoke invalidation и late guards не дают B private bytes A.',
      'Full DTO сериализовать в SSR, client убрать контакты до paint. Отсутствие видимого мигания считать отсутствием приватных данных в отправленном HTML.',
      'Общий server cache по route: hydration совпадает, но initial DTO прежней session используется для новой.',
      'SSR redacted корректно, client cache full другой session сохранить и использовать после login B. Успешную hydration считать новым contacts grant без server проверки.',
    ],
    'frontend-engineering:5:1':[
      'Scoped op-id/status и authoritative outcome/baseline lookup. Back меняет navigation, не отменяет commit и не восстанавливает отозванный server grant.',
      'При navigation abort объявить POST отменённым; по возвращении создать новый key без status lookup.',
      'Хранить прежний opK, но отсутствие response считать failed. Новый mount повторяет POST с новым key, даже когда прежний request мог уже commit.',
      'History восстанавливает badge открытых контактов; следующий запрос авторизовать этим badge вместо актуального server grant.',
    ],
    'frontend-engineering:5:2':[
      'Версии API/assets совместимы в support window старых pages; refresh/recovery сохраняет intent. Private caches scoped, offline bytes не заменяют актуальный grant.',
      'Активировать V2 worker и сразу удалить V1 API. Открытые V1 pages считать мигрированными фактом worker activation.',
      'Сохранить V1 API, но forced reload стирает unsaved drafts; deployment считать достаточным подтверждением discard.',
      'Versioned rollout и draft recovery есть, однако старый private offline file считать бессрочным permission после logout/revoke. Изменение assets не меняет scope этих bytes.',
    ],
  };
  return choices[`${skill}:${c}:${s}`]??null;
}
