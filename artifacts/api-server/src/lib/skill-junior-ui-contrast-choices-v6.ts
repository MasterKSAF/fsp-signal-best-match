/** Current-only, concrete counterplans for the UI/TypeScript Junior families.
 * These alternatives express different wrong implementations, not filler added to alter length.
 * Selection and preservation of the correct plan are handled by the shared bank presentation policy.
 */
export function compactJuniorUiDistractorsV6(skill: string, c: number, s: number, _n: number, flag: boolean): string[] | null {
  const alternatives: Record<string, string[]> = {
    'typescript:0:2': [
      flag ? 'assertNever примет cancelled: strict проверяет только сам аргумент never.' : 'strict отклонит cancelled: любой default обязан принимать только never.',
      flag ? 'Функция скомпилируется; assertNever автоматически вернёт прежний wait.' : 'Функция вернёт undefined: новый variant не может попасть в default.',
      flag ? 'Ошибка возникнет только в runtime; проверка union не относится к default.' : 'Функция бросит Error: default отклоняет неизвестный cancelled сам.',
    ],
    'typescript:1:2': [
      flag ? 'Принять JSON через as Payload; записать без schema.parse.' : 'Проверить только схему; валидный resourceId даёт право записи.',
      'Сначала выполнить запись; затем вернуть ошибку проверки.',
      flag ? 'Отбросить ошибку схемы и записать исходный JSON.' : 'Использовать role из body как разрешение на чужой resourceId.',
    ],
    'typescript:2:1': [
      'Вернуть {id:item.id} вместо T; остальные поля отбросить.',
      'Принимать any и читать id; отсутствие id проверить после возврата.',
      flag ? 'Ослабить T до {id?:number}; id читать без проверки undefined.' : 'Оставить T без constraint; id получить assertion без runtime-проверки.',
    ],
    'typescript:4:2': [
      'await rows.map(save); отправить ответ с массивом Promise.',
      flag ? 'await Promise.allSettled(...); success вернуть и при rejected.' : 'await Promise.all(...); при rejection вернуть только одну ошибку.',
      'await rows.forEach(async row => save(row)); затем вернуть success.',
    ],
    'typescript:5:2': [
      flag ? 'Передать исходную ссылку как Readonly<T>; runtime не менять.' : 'Скопировать корень; затем изменить прежний nested объект.',
      flag ? 'Object.freeze только корня; вложенные plain objects оставить mutable.' : 'Поставить as const; новую версию получить записью через as any.',
      flag ? 'Заморозить копию, оставив библиотеке исходную mutable ссылку.' : 'В новой версии повторно использовать вложенную ссылку и мутировать её.',
    ],
    'react:0:2': [
      'Изменить profile.points; вызвать setProfile с той же ссылкой.',
      'setProfile({points:profile.points+1}); поле name не переносить.',
      'Создать копию с прежним points; новое значение записать в старый объект.',
    ],
    'react:1:1': [
      flag ? 'Callback с [] читает новый id: render заменяет прежнее замыкание.' : 'Callback остаётся с прежним id, хотя selectedId есть в dependencies.',
      'Оставить [] и отслеживать selectedId через стабильный setter в deps.',
      flag ? 'Очистить зависимости; сохранённый callback читает текущий props.id.' : 'Удалить selectedId из dependencies; body обновится без новой функции.',
    ],
    'react:2:1': [
      'Подписаться при mount; cleanup не возвращать.',
      'В cleanup вызвать subscribe заново с другой функцией.',
      flag ? 'Вернуть отписку, но изменяемый id не включать в dependencies.' : 'Вернуть отписку из listener, а не из самого эффекта.',
    ],
    'react:2:2': [
      'Последний доставленный response A записать как текущие data.',
      'Использовать только время ответа; identity операции не проверять.',
      flag ? 'Сравнить id из A с id из A; при совпадении заменить data B.' : 'После unmount записать ответ в общий draft следующего mount.',
    ],
    'react:3:0': [
      flag ? 'key=index сохраняет draft по business id после удаления строки.' : 'key=stableTaskId переносит draft по новой позиции строки.',
      'Заменить key на новый UUID при каждом render; draft сохранится.',
      flag ? 'Оставить index key, но добавить data-id: он владеет React state.' : 'После reorder заменить stable key на индекс и оставить локальный draft.',
    ],
    'react:3:2': [
      'Оставить Editor внутри render; постоянный key сохраняет его тип.',
      'Каждый render создавать memo(Editor); одинаковые props сохранят draft.',
      'При render заново взять initial draft с сервера; локальный ввод отбросить.',
    ],
    'react:4:0': [
      flag ? 'value="" оставляет ввод браузеру; onChange необязателен.' : 'onChange меняет state, но value продолжает читать прежний DOM.',
      'Сохранить value; defaultValue использовать для следующих вводов.',
      'Менять только ref.current.value; state для controlled input не обновлять.',
    ],
    'react:4:2': [
      flag ? 'type="submit"; удалить avatar в onClick без отмены отправки.' : 'type="button"; form отправится после локального onClick сам.',
      flag ? 'Не задавать type; наличие onClick отменит submit автоматически.' : 'type="reset"; сброс полей вызовет submit и сохранит текущие значения.',
      'div role="button" без keyboard/submit кода заменяет нативную кнопку.',
    ],
    'react:5:0': [
      'Оба ребёнка хранят свой state фильтра; сверяют значения таймером.',
      flag ? 'Общий фильтр хранить в parent state; при reload восстановление не нужно.' : 'Фильтр одного ребёнка читать другому только при первом mount.',
      flag ? 'В URL сохранить форму, запрос отправлять по отдельному старому state.' : 'Значение хранить только в ref первого ребёнка; второй не подписан.',
    ],
    'react:5:1': [
      'selectedItem сохранить копией при выборе; список больше не учитывать.',
      flag ? 'Выбрать первую строку, оставив прежний selectedId для действий.' : 'Найти запись по старому индексу, а не по selectedId.',
      'На каждое обновление списка сбрасывать selectedId без проверки записи.',
    ],
    'react:5:2': [
      flag ? 'Обернуть только submit в try/catch; им же ловить render-сбой.' : 'Оставить rejected submit без catch; его поймает Error boundary.',
      'Сбросить draft к baseline и повторить submit без согласия пользователя.',
      flag ? 'try/catch вокруг setState поймает последующий render дочерней панели.' : 'Отметить любой rejected submit как success; error state не создавать.',
    ],
    'frontend-engineering:0:1': [
      flag ? 'Разделяемый фильтр хранить в URL; server query брать из независимого старого state.' : 'Несохранённый текст писать в server snapshot; local draft не отделять от baseline.',
      flag ? 'URL восстанавливает поля при Back; cache key оставлять одинаковым для разных фильтров.' : 'Local draft хранить отдельно; при любом refetch заменять его server snapshot без сравнения.',
      flag ? 'URL менять только при reload; текущий server query строить по local draft, не по ссылке.' : 'Server snapshot хранить отдельно; local draft применять к серверу сразу после каждого ввода.',
    ],
    'frontend-engineering:0:2': [
      flag ? 'Совпавшая revision допускает запись; вернуть прежнюю revision и прежний server snapshot.' : 'Конфликт перечитать со свежей revision; прежний draft повторить без сравнения изменений.',
      flag ? 'Совпавшую revision проверить при чтении; UPDATE выполнить без условного сравнения revision.' : 'Конфликт показать, затем очистить local draft; оставить только актуальный server snapshot.',
      flag ? 'Новую revision выдать до COMMIT; successful ответ считать подтверждением независимо от записи.' : 'Сохранить draft для сравнения; запись продолжить без expectedRevision, обходя конфликт сервера.',
    ],
    'frontend-engineering:1:1': [
      flag ? 'Сообщение ошибки связать с другим полем; фокус оставить на submit, неверное поле не обозначать.' : 'Успех объявить через status; после ответа сбросить текущий фокус на body.',
      flag ? 'Ошибку связать с полем через tooltip на hover; keyboard focus и доступное описание не создавать.' : 'Успех показать текстом в aria-live=off; смену текста считать автоматическим объявлением.',
      flag ? 'Первое неверное поле сфокусировать; подробный текст ошибки скрыть aria-hidden от его описания.' : 'Текущий фокус сохранить; success сообщить только цветом, без текста и live/status.',
    ],
    'frontend-engineering:1:2': [
      flag ? 'Переход в раздел — ссылка без href; доступное название есть, mouse click меняет location.' : 'Локальный диалог — button type=submit; click открывает его и одновременно отправляет форму.',
      flag ? 'Переход — div role=link с tabindex; только mouse click, стандартный keyboard путь не реализован.' : 'Диалог — div role=button с tabindex; Enter/Space считать нативными без обработчика.',
      flag ? 'Ссылка имеет href другого раздела; onClick отменяет переход и доступную keyboard навигацию.' : 'Диалог — ссылка href=#; default переход не отменять, положение страницы меняется вместе с открытием.',
    ],
    'frontend-engineering:2:1': [
      flag ? 'Длинный расчёт перенести в microtask; main-thread работу не делить, input delay не измерять.' : 'Network waterfall оптимизировать memo компонентов; независимые запросы оставить последовательными.',
      flag ? 'Измерить расчёт, затем увеличить network cache TTL; main-thread задачу выполнить без изменения.' : 'Проверить HTTP dependencies; независимые запросы всё равно ждать по одному, render оптимизировать отдельно.',
      flag ? 'Расчёт обернуть debounce; оставшийся длинный sync task считать исправленным без замера input delay.' : 'Параллельную загрузку включить только для рендера; фактические HTTP запросы запускать после предыдущих.',
    ],
    'frontend-engineering:3:2': [
      flag ? 'Identity проверить при success; старый catch всё равно очистит актуальные data/error.' : 'Актуальный отказ скрыть; сохранить pending и draft без причины ошибки или retry.',
      flag ? 'Поздний отказ считать текущим по общему URL; generation нового запроса не учитывать.' : 'Отказ показать с retry; local draft очистить до повторения, даже если данные формы доступны.',
      flag ? 'Старый error игнорировать в сообщении; его finally сбросит loading и draft нового запроса.' : 'Актуальный отказ отметить как success; повторение разрешить только после потери текущего draft.',
    ],
    'frontend-engineering:4:0': [
      flag ? 'Версии DTO проверить по одному optional полю; отличающуюся структуру передать без преобразования.' : 'Optional поле проверять как обязательное; его отсутствие отклонить вместо документированного default.',
      flag ? 'Обе версии передать компонентам raw; каждый выберет свой default без единой UI-модели на границе.' : 'Optional поле дополнить своим default в каждом компоненте; общий документированный default не использовать.',
      flag ? 'Версии DTO привести через as UIModel; успешную компиляцию считать runtime проверкой структуры.' : 'Default вычислить после рендера; до этого optional поле читать как гарантированно присутствующее.',
    ],
    'frontend-engineering:4:1': [
      flag ? 'Ключ включает identity B и параметры; поздний completion A пишет общий current view без session guard.' : 'Ключ включает identity; фильтры исключить, разные выдачи записывать в одну cache entry.',
      flag ? 'Ключ включает фильтр; identity убрать, logout только скрывает DOM без очистки private observers.' : 'Ключ включает фильтр, но не identity; приватный ответ другого аккаунта допустимо переиспользовать.',
      flag ? 'Identity поменять в ключе; старый запрос A после завершения переложить в новую cache entry B.' : 'Identity и фильтр есть в URL; cache key составлять только по identity до ручного refresh.',
    ],
    'frontend-engineering:4:2': [
      flag ? 'Secondary error показать отдельно; основной editor и доступный draft сбросить при этом же отказе.' : 'Обязательную проверку прав считать успешной по stale разрешению; действие выполнить до fresh ответа.',
      flag ? 'У secondary есть retry; весь основной workflow блокировать до успеха необязательной панели.' : 'Недоступность проверки прав показать; действие всё равно разрешить, раз явного запрета не получено.',
      flag ? 'Основную работу оставить; secondary error объявить success и удалить её состояние/retry.' : 'Действие блокировать только визуально; handler продолжает запись при недостоверном разрешении.',
    ],
    'frontend-engineering:5:0': [
      flag ? 'Актуальный success объявить; server snapshot/cache/revision не менять, следующий submit берёт прежний baseline.' : 'Draft и conflict сохранить до старого success; затем применить его без проверки operation identity.',
      flag ? 'Server snapshot обновить; active draft очистить и фокус сбросить на body после каждого success.' : 'Старый success игнорировать; конфликт обойти новой revision и автоматически записать прежний draft.',
      flag ? 'Success применить к текущему draft; revision из response заменить старой, чтобы сохранялась исходная версия.' : 'Server cache обновить старым success; его baseline применить к новому draft, не сравнивая изменения.',
    ],
    'frontend-engineering:5:2': [
      flag ? 'Экспортировать все строки текущей страницы; total текущего фильтра считать размером этого же файла.' : 'Back восстанавливает фильтр в URL; server query/cache оставить в состоянии после reset.',
      flag ? 'Экспортировать всю разрешённую базу без текущего фильтра; тот же порядок применить только к экрану.' : 'Back восстанавливает query/cache фильтра; экспорт продолжает использовать сброшенный URL-контекст.',
      flag ? 'Текущий фильтр передать экспорту; выгрузку обрезать20 строками и взять порядок другого query.' : 'Back возвращает поля формы; query и экспорт строить по прежнему local state без восстановления URL.',
    ],
  };
  return alternatives[`${skill}:${c}:${s}`] ?? null;
}
