/** Editorial alternatives: each wrong plan violates a named contract, not a generic absurdity. */
export function middleReviewedChoicesV6(skill: string, c: number, s: number, n: number, flag: boolean): string[] | null {
  const choices: Record<string, string[]> = {
    'python:3': [
      'Сохранить ValueError как primary; rollback выполнить отдельно, его failure связать как secondary. Ответ — отказ.',
      'Сохранить ValueError в журнале; RuntimeError rollback назначить единственной причиной для клиента. Primary больше не передавать по API, поскольку cleanup был последним шагом.',
      'Не выполнять rollback после ValueError: состояние считать неполным. Клиенту вернуть исходную причину, соединение оставить доступным следующему запросу.',
      'В finally вернуть структурированный failed-result вместо raise. Вызывающий код ожидает исключение для отказа, но журнал сохранит обе причины и compensating job позже проверит состояние.',
    ],
    'python:5': [
      'Отклонить пакет до записи: count не удовлетворяет контракту; вернуть ошибку этого поля, rows не менять.',
      'Проверить isinstance(count,int) и positive rows; равенство count/len(rows) доверить producer без сверки. Bool численно совместим с int, поэтому пакет можно принять как пришедший.',
      'Проверить все rows до записи, затем заменить ошибочный count фактической длиной. Commit считать принятием исходного пакета; исправление не отражать в результате.',
      'Записать валидные rows в транзакции, а count проверять после COMMIT. При несовпадении вернуть validation-error и отметить уже committed rows для последующей компенсации.',
    ],
    'sql:3': [
      'Общий guard либо SERIALIZABLE с rollback/retry полной проверки: сериализуется межстрочный predicate.',
      'Зафиксировать version обеих прочитанных rows, но CAS выполнять только для собственной. Перед COMMIT сравнить результат собственного UPDATE с1; другие rows больше не читать.',
      'Перечитать второго дежурного в READ COMMITTED непосредственно перед своим UPDATE без общего lock. Это сокращает race window и позволяет каждой транзакции принимать решение независимо.',
      'Взять row lock только своей строки, затем проверить общий snapshot. При deadlock повторить транзакцию; чужую строку намеренно не блокировать для параллельности.',
    ],
    'sql:5': [
      `UNIQUE(${flag ? 'tenant_id,event_id' : 'event_id'}); claim/hash/result и effect — один COMMIT. Same hash возвращает R, другой — conflict; rollback отменяет claim.`,
      `UNIQUE(${flag ? 'tenant_id,event_id' : 'event_id'}); effect/result атомарны. Duplicate возвращает committed R, а входной hash сравнивается лишь при создании нового claim, чтобы replay не менять результат.`,
      'Сначала durable claim и hash, затем отдельная transaction effect/result. Crash между ними возвращает найденный claim как successful replay без дополнительного outcome-state.',
      `Хранить hash/result транзакционно, но unique scope=${flag ? 'event_id без tenant' : 'tenant_id,event_id'}. Это изолирует запись и позволяет выбранному scope считаться полным business identity независимо от контракта.`,
    ],
    'typescript:0': [
      'Runtime decode kind/fields отклоняет JSON; assertNever после него проверяет полноту typed switch.',
      'Проверить только discriminant, затем as Union. Для ready преобразовать count через Number, а неизвестный kind нормализовать в loading, чтобы приложение пережило новую server version.',
      'Передать raw JSON в switch с default assertNever. Неподдержанные входы объявить невозможными на compile time; отдельный runtime decoder не нужен при strict:true.',
      'Применить runtime field decoder, но kind принять любой string. После проверки count использовать generic fallback для неизвестной ветки и возвращать успешный typed result.',
    ],
    'typescript:2': [
      'Callback должен принимать {id}; admin проверяется внутри. Либо Consumer меняется и реально гарантирует admin каждому вызову.',
      'Сделать admin optional у входа Consumer, callback оставить с обязательным admin. Optional поле есть в описании типа, поэтому проверка каждого вызова больше не требуется.',
      'Сохранить широкий producer, но оформить callback методом вместо function property. Пройденную bivariant проверку считать доказательством наличия admin у runtime input.',
      'Сузить только тип callback через generic constraint и as, не меняя producer. В тесте с admin:true вызов проходит; тот же contract распространяется на остальные {id} inputs.',
    ],
    'react:1': [
      'A response обновляет A cache; current draft только при совпадении entity/operation/revision. Draft B сохраняется.',
      'Сравнить operation-id, но cache оставить по одному editor key. Результат A станет текущим baseline; отдельный dirty flag защитит B только от прямого сброса поля.',
      'Создавать submit через useCallback([resumeId]); поздний callback применять к current editor. Dependencies считаются достаточными, поскольку B уже вызвал новый render.',
      'Сохранять response в A cache, затем global success-effect сбрасывает текущий draft. Entity-scoped cache предотвращает смешение данных, поэтому дополнительный guard у success-effect не нужен.',
    ],
    'react:4': [
      'Baseline — отправленный snapshot с новой server revision; более новый local draft остаётся dirty.',
      'Принять новую revision, но baseline оставить прежним. Local draft сохранить; следующий submit использует свежую precondition, хотя сравнение dirty по-прежнему основано на old server content.',
      'Записать в baseline текущий local draft и новую revision. Значение input не теряется; success-response считать подтверждением всех правок, существующих на момент получения ответа.',
      'Обновить baseline отправленным snapshot и восстановить его в input. Последние edits перенести в audit log, dirty очистить; пользователь позже сможет ввести изменения снова.',
    ],
    'react:5': [
      'Boundary/reset — для render; catch/error-state — для submit. Durable draft хранится выше reset subtree; успех отдельно.',
      'Render error и submit rejection направить в один boundary reset. Draft поднять выше subtree; повтор mount считать повтором business operation, без отдельной сохранённой command identity.',
      'Submit rejection обрабатывать catch, render fallback через boundary. Draft оставить внутри remounted Editor; после reset восстановить только серверный baseline и сообщить ввод потерянным.',
      'Обе ошибки показывать отдельно и сохранять draft. После network rejection сразу создать POST с новым key: reset boundary завершён, поэтому прежний command outcome считаем failed.',
    ],
    'backend-engineering:0': [
      'Receipt key=(principal,action,key), hash/effect/result атомарны. Replay same hash возвращает своё R; other hash — conflict.',
      'Receipt key=(action,key), hash проверяется и effect атомарен. Principal используется только для проверки права вызвать action; одинаковый payload разрешает разделять result между A/B.',
      'Receipt key=(principal,key), hash/effect/result атомарны. Action хранить в response metadata, но не в unique scope: pay и refund одного клиента с k считаются одним command.',
      'Receipt key=(principal,action,key) и hash верны, но claim фиксировать первым COMMIT. Наличие claim означает выполненный effect даже после crash до отдельной записи результата.',
    ],
    'backend-engineering:1': [
      'Общий guard/serializable retry полной проверки суммы; локальные CAS разных warehouses её не защищают.',
      'Проверить version собственной warehouse и добавить1, затем читать global total. Если оба UPDATE уже committed, превышение исправить асинхронной отменой одного reservation, считая исходный invariant строгим.',
      'Добавить CHECK(reserved<=capacity) каждой warehouse, сохранив независимые transaction snapshots. Суммарную capacity не распределять: локальные constraints считаются достаточными для bound по двум строкам.',
      'Перед записью перечитать обе warehouses, но блокировать только свою row. Retry при собственном CAS failure выполняет полную проверку; отсутствие такого failure трактовать как отсутствие write skew.',
    ],
    'backend-engineering:2': [
      'Повторить stable external key; сохранять pending/outcome. Dedupe provider возвращает результат без нового effect.',
      'Без dedupe/status lookup однократный effect недоказуем: ограничить retry и сверять исход либо изменить внешний контракт.',
      'После потери ACK пометить outbox done: первый send успешно ушёл в сеть. Business outcome принять successful без повторного status чтения; provider receipt клиент не видел.',
      'Повторить новый external key, а локальный outbox-id сохранить. Database receipt предотвращает второй INSERT intent, поэтому второй delivery считать тем же внешним эффектом.',
    ],
    'backend-engineering:3': [
      'Сначала pool queue: active/waiters, предел параллелизма и trace границы ожидания; SQL plan отдельно.',
      'Сначала execution plan/rows DB: воспроизвести scan и объём. Pool увеличить лишь по измеренному ожиданию.',
      'Сначала увеличить pool вдвое и повторить p95. Если итоговая latency упала, исходную причину записать как DB scan без раздельного сравнения queue и execution spans.',
      'Сначала уменьшить query timeout, затем измерять только successful requests. Отменённые slow requests исключить из latency denominator, чтобы отделить работу DB от ожидания клиента.',
    ],
    'backend-engineering:4': [
      'Отзыв раньше launch point: новый экспорт запрещён. Cache или прежняя precheck не заменяют актуальную grant-version.',
      'Launch зафиксирован раньше отзыва: по заданному контракту этот body может завершиться; новые launches запрещены.',
      'Проверить grant только при открытии preview. Download позднее использует тот же URL/version и cached bytes; отсутствие нового UI согласия означает продление первоначального разрешения.',
      'После любого revoke считать ранее выданные bytes удалёнными у recipient. Передачу body остановить в UI, а уже сохранённую копию объявить технически недоступной без подтверждения удаления.',
    ],
    'backend-engineering:5': [
      'Восстановить pending intent; stable key + status/reconciliation. Success только после подтверждения оплаты.',
      'При crash до ACK повторить payment с новым key, сохранив order-id. Локальный order unique обеспечивает отсутствие второго order, а значит и отсутствие второго платёжного эффекта.',
      'Удалить pending intent и начать процесс заново. Нет сохранённого ACK — нет подтверждённой оплаты; предыдущий внешний вызов считать failed независимо от provider состояния.',
      'Сохранить intent и key, но сразу вернуть success после SQL COMMIT. Dispatcher выполнит или проверит payment позже; eventual completion считать уже подтверждённым outcome.',
    ],
    'frontend-engineering:0': [
      'A result/baseline остаётся в CV1; draft и feedback CV2 меняются лишь от своей operation identity.',
      'CV1/CV2 cache разделить, а save-status оставить account-wide. При любом success reset текущего draft разрешён, поскольку исходный response не записан в чужой cache key.',
      'Проверять response revision против current CV2 revision, не сравнивая resume-id. Совпадение numeric revision считать доказательством связи сохранения с выбранным документом.',
      'Сохранить A в CV1, но selected context перенести обратно на CV1 при completion. Это сохраняет все server данные, поэтому смену пользовательского intent считать допустимым recovery.',
    ],
    'frontend-engineering:4': [
      'Keys и observers scoped по account/session; guard late A response, удалить A private cache при logout.',
      'Ключ дополнить accountId, но callback A сохраняет payload в current B key. Query cancellation best-effort; отсутствие транспортного abort считать разрешением завершить запись в новый scope.',
      'На logout очистить A cache, но оставить old observer subscribed. Его completion заново создаст тот же A entry; изоляцию keys считать достаточной без lifetime policy приватных bytes.',
      'Отменить старый request и очистить cache, но response guard не проверять. AbortSignal считать гарантирующим отсутствие любого completion даже у transport, который игнорирует abort.',
    ],
    'frontend-engineering:5': [
      'Повторный server ACL запрещает download; удалить stale preview, показать отзыв и сохранить рабочий context.',
      'Проверить server ACL для нового preview, но download отправить из уже загруженного full blob. Такой локальный export считать новым разрешённым действием по прежнему UI snapshot.',
      'На Back восстановить preview и grant badge из history; до следующего focus refetch старый download разрешить. Историю UI считать достаточным receipt актуального согласия.',
      'При403 очистить весь редактор и все drafts, затем показать успешно завершённый export с redacted полями. Отказ доступа считать разрешением на fallback без нового server DTO.',
    ],
  };
  const shortErrors: Record<string, string[]> = {
    'python:3': ['Оставить primary, rollback пропустить: сам exception уже отменил SQL writes.', 'Возвращать последнюю cleanup-ошибку; первичная больше не влияет на отказ.', 'Первичную ошибку сохранить, вторичный rollback failure не фиксировать.'],
    'python:5': ['Принять rows; count считать необязательным hint, даже при version=2.', 'Исправить count на len(rows) без ошибки и принять изменённый пакет.', 'Принять bool как int, связь count с rows доверить внешнему producer.'],
    'sql:3': ['Обновить две независимые строки через CAS; общий guard не нужен.', 'Взять lock своей строки после общего snapshot; вторую не защищать.', 'После serialization failure повторить только UPDATE по старому решению.'],
    'sql:5': ['Hash проверять только при первом claim; duplicate всегда возвращает R.', 'Закоммитить receipt раньше effect; найденный claim означает success.', `Unique scope=${flag ? 'event_id' : 'tenant,event_id'}; payload hash правильный, scope не сверять.`],
    'typescript:0': ['Проверить kind, count привести через Number и считать JSON валидным.', 'Перед switch привести JSON as Union; assertNever проверит payload.', 'Неизвестный kind считать loading; поля остальных веток декодировать.'],
    'typescript:2': ['Сделать admin optional у Consumer, узкий callback оставить прежним.', 'Передать narrow callback as wide; producer продолжит выдавать {id}.', 'Оформить callback методом; bivariance считать runtime гарантией admin.'],
    'react:1': ['Response A записать в current B; useCallback уже обновил зависимости.', 'Scope cache по A, но global success сбрасывает draft текущего editor.', 'Сравнить operation-id без entity; один editor cache использовать для A/B.'],
    'react:4': ['Baseline считать текущим draft; новый input автоматически сохранён.', 'Обновить revision, old baseline оставить для следующего dirty diff.', 'Восстановить отправленный snapshot в input, поздние edits удалить.'],
    'react:5': ['ErrorBoundary reset повторяет сетевой POST и подтверждает его исход.', 'Draft оставить в reset subtree; после ошибки remount создаст empty.', 'После network failure повторить новым key без проверки старого outcome.'],
    'backend-engineering:0': ['Receipt key=(action,key); одинаковый hash позволяет разделить result A/B.', 'Receipt key=(principal,key); pay/refund разделяются только metadata.', 'Claim commit отдельно от effect; отсутствие result трактовать как success.'],
    'backend-engineering:1': ['CAS каждой warehouse достаточен; global total вычисляется до writes.', 'Проверять local capacity, общий bound не распределять и не блокировать.', 'Commit обеих, затем компенсировать excess; строгий bound считать сохранённым.'],
    'backend-engineering:2': ['Mark done после send, без ACK/status: сеть приняла bytes, effect доказан.', 'При retry менять key; unique outbox row дедуплицирует provider effects.', 'Без dedupe после потерянного ACK повторить и гарантировать один effect.'],
    'backend-engineering:3': ['Увеличить pool до замера queues; любое улучшение приписать SQL plan.', 'Уменьшить timeout и исключить отменённые requests из latency выборки.', 'Низкий CPU означает отсутствие DB/queue bottleneck; trace не проверять.'],
    'backend-engineering:4': ['Cached preview считается разрешением каждого следующего download.', 'Revoke удаляет уже скачанные bytes у recipient без его подтверждения.', 'History badge использовать вместо grant-version при новом launch.'],
    'backend-engineering:5': ['SQL COMMIT intent означает confirmed payment; сразу сообщить success.', 'Нет ACK — нет payment: удалить intent и повторить оплату новым key.', 'Retry менять key, order-id unique гарантирует один external effect.'],
    'frontend-engineering:0': ['Сравнить numeric revision A/B без resumeId и применить совпавший response.', 'Сохранить cache CV1, но success-effect очищает draft выбранного CV2.', 'После success вернуть выбранное CV1, игнорируя новый editing intent.'],
    'frontend-engineering:4': ['На logout очистить cache, старый subscribed observer оставить активным.', 'Abort request без response guard; любой transport соблюдает abort.', 'Account key верен, но A callback пишет payload в current B observer.'],
    'frontend-engineering:5': ['После revoke выдавать старый full blob как новый разрешённый export.', 'Back восстанавливает grant badge; server ACL проверять только на focus.', 'При403 объявить redacted export успешным без новой server проекции.'],
  };
  const key = `${skill}:${c}`, base = choices[key];
  if (!base) return null;
  const correctIndex = skill === 'backend-engineering' && [2, 3, 4].includes(c) && !flag ? 1 : 0;
  const correct = base[correctIndex]!;
  if(skill==='sql') return [correct,...(c===3?[
    'CAS своей строки после общего snapshot; межстрочный predicate второй транзакции не блокировать.',
    'READ COMMITTED с проверкой active до UPDATE: другой дежурный может одновременно отключиться.',
    'SERIALIZABLE, но после rollback повторить только UPDATE без полной проверки active других строк.',
  ]:[
    `UNIQUE(${flag?'tenant_id,event_id':'event_id'}); один COMMIT claim/hash/result/effect. Same hash возвращает R; Q!=P принять как replay без conflict.`,
    `UNIQUE(${flag?'tenant_id,event_id':'event_id'}); claim/hash COMMIT раньше effect/result. Crash возвращает R из claim, хотя result ещё не записан.`,
    `UNIQUE(${flag?'event_id':'tenant_id,event_id'}); hash/effect/result — один COMMIT. Same P возвращает R, Q — conflict; выбранный tenant scope не сверять с контрактом.`,
  ])];
  const pool = [...base.filter((_v, i) => i !== correctIndex), ...shortErrors[key]!];
  if (skill === 'backend-engineering' && [2, 3, 4].includes(c)) pool.push('При неопределённом исходе применить одинаковый автоматический recovery для обоих описанных порядков: сначала сообщить успех, а различия provider/trace/grant проверить асинхронно после ответа.');
  const shorter = pool.filter(text => text.length < correct.length), longer = pool.filter(text => text.length > correct.length);
  if (shorter.length < 3 || longer.length < 3) throw new Error(`Insufficient substantive editorial alternatives: ${key}`);
  // Four authored contrasts contain respectively 0/1/2/3 longer plans.
  // Every alternative has a distinct concrete fault; no string-padding or answer-position trick.
  // Parameter combinations are variants of the SAME outcome, not new exposure families.
  const contrast = (s * 10 + (n - 5) * 2 + Number(flag)) % 4;
  const selected = [...shorter.slice(0, 3 - contrast), ...longer.slice(0, contrast)];
  selected.splice(correctIndex, 0, correct);
  return selected;
}
