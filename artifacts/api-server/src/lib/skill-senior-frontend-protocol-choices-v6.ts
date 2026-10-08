type Protocol = readonly [readonly [string, string], readonly [string, string], readonly [string, string]];
type Case = { protocol: Protocol; alternatives: readonly [number, string][] };

/** Current-only Frontend Senior plans share explicit scenario fields. An alternative changes one
 * substantive step of the protocol; none is lengthened with unrelated checks or editorial tails.
 * Option zero preserves the previous engineering invariant, not its historical wording.
 */
export function frontendSeniorProtocolChoicesV6(c: number, s: number, _n: number, _flag: boolean): string[] {
  const cases: readonly Case[] = [
    {
      protocol: [
        ['Модель', 'baseline, draft и operation принадлежат конкретной entity; active view вычисляется из них'],
        ['Ответ A', 'обновляет baseline A и оставляет изменённый draft B владельцу B'],
        ['Доступ', 'cache scope включает session, права и допустимую projection'],
      ],
      alternatives: [
        [0, 'baseline, draft и operation принадлежат общему editor; active view вычисляется из них'],
        [1, 'обновляет baseline B и оставляет изменённый draft A владельцу A'],
        [2, 'cache scope включает entity; session и права учитываются только при первом заполнении'],
      ],
    },
    {
      protocol: [
        ['Rollback A', 'возвращает owned delta A; данные и новую revision B сохраняет'],
        ['Неизвестный исход', 'выясняется по сохранённому operation id, а не по одному таймауту'],
        ['Baseline', 'учитывает независимые committed изменения; whole-state snapshot не восстанавливается'],
      ],
      alternatives: [
        [0, 'возвращает owned delta B; данные и новую revision A сохраняет'],
        [1, 'выясняется по одному таймауту, а не по сохранённому operation id'],
        [2, 'учитывает независимые committed изменения; whole-state snapshot восстанавливается'],
      ],
    },
    {
      protocol: [
        ['Подтверждения', 'account proofs и history живут независимо от существования CV'],
        ['Удалённый CV', 'больше не создаёт рекомендации из прежнего стека или ревизии'],
        ['Empty context', 'показан явно; данные другого CV не подставляются вместо выбранного'],
      ],
      alternatives: [
        [0, 'account proofs и history живут только при существовании выбранного CV'],
        [1, 'создаёт рекомендации из прежнего стека или ревизии после удаления'],
        [2, 'показан явно; данные другого CV подставляются вместо выбранного'],
      ],
    },
    {
      protocol: [
        ['Закрытие', 'Escape и outside обрабатывает topmost overlay; touch использует тот же стек'],
        ['Фокус', 'scope включает portal; после закрытия выбран живой trigger или доступный fallback'],
        ['Фон', 'неактивен для ввода и focus, пока соответствующий modal слой открыт'],
      ],
      alternatives: [
        [0, 'Escape и outside обрабатывает каждый overlay; touch использует тот же стек'],
        [1, 'scope исключает portal; после закрытия выбран удалённый trigger вместо fallback'],
        [2, 'активен для ввода и focus, пока соответствующий modal слой открыт'],
      ],
    },
    {
      protocol: [
        ['Identity', 'active item хранится по stable business id, а не viewport index'],
        ['Windowing', 'сохраняет active DOM либо предсказуемо переносит focus с объявлением'],
        ['Семантика', 'total и позиции объявлены; aria target существует в доступном DOM'],
      ],
      alternatives: [
        [0, 'active item хранится по viewport index, а не stable business id'],
        [1, 'удаляет active DOM и сохраняет прежний focus без доступного target'],
        [2, 'total и позиции объявлены; aria target отсутствует в доступном DOM'],
      ],
    },
    {
      protocol: [
        ['Результат', 'achievement сохраняет текст и status независимо от наличия анимации'],
        ['Reduced motion', 'не блокирует действие; завершение workflow не зависит от animationend'],
        ['Фокус', 'остаётся предсказуемым; анимация дополняет понятное сообщение об успехе'],
      ],
      alternatives: [
        [0, 'achievement сохраняет текст и status только при наличии анимации'],
        [1, 'убирает анимацию; завершение workflow зависит от animationend'],
        [2, 'переносится в toast; анимация заменяет понятное сообщение об успехе'],
      ],
    },
    {
      protocol: [
        ['Измерение', 'interaction trace разделяет main-thread CPU/render и network ожидание'],
        ['Исправление', 'длинная CPU/render работа сокращается или разбивается; сеть меняется по её trace'],
        ['Приёмка', 'повторно измеряет latency и CPU с проверкой корректности результата'],
      ],
      alternatives: [
        [0, 'interaction trace объединяет main-thread CPU/render и network в один network span'],
        [1, 'длинная CPU/render работа переносится в microtask; её sync объём остаётся прежним'],
        [2, 'повторно измеряет число renders вместо latency; корректность результата проверяет'],
      ],
    },
    {
      protocol: [
        ['Загрузка', 'viewer chunk загружается по preview; entry page не тянет необязательный viewer'],
        ['Отказ', 'failed import показан как ошибка с retry; worker очищается при закрытии'],
        ['Проверка', 'chunk waterfall и доступ к PDF проверены в текущей session'],
      ],
      alternatives: [
        [0, 'viewer chunk загружается при entry; preview только использует уже готовый viewer'],
        [1, 'failed import показан как успех с retry; worker очищается при закрытии'],
        [2, 'chunk waterfall проверен в текущей session; доступ к PDF берётся из чужой session'],
      ],
    },
    {
      protocol: [
        ['Геометрия', 'image box резервирует нужное соотношение и размер до load'],
        ['Reflow/zoom', 'labels и действия остаются читаемыми и доступными без потери keyboard пути'],
        ['Объём', 'windowing/lazy loading не заменяют общий total числом видимых DOM rows'],
      ],
      alternatives: [
        [0, 'image box получает нужное соотношение и размер только после load'],
        [1, 'labels и действия скрыты overflow; keyboard путь у скрытых действий отсутствует'],
        [2, 'windowing/lazy loading заменяют общий total числом видимых DOM rows'],
      ],
    },
    {
      protocol: [
        ['Cache', 'scoped по entity, query и session; разные поиски не подменяют друг друга'],
        ['Current view', 'принимает data/error только от текущей request generation'],
        ['Отмена', 'abort дополняет guard; stale completion не сбрасывает новые data/error'],
      ],
      alternatives: [
        [0, 'scoped по entity; query и session разных поисков подменяют друг друга'],
        [1, 'принимает data/error от последней доставленной request generation'],
        [2, 'guard дополняет abort; stale completion сбрасывает новые data/error'],
      ],
    },
    {
      protocol: [
        ['Доступ', 'актуальный grant и действительный HTTP/result проверяются при выдаче файла'],
        ['Событие', 'считается только разрешённое реальное скачивание; denied, HEAD и preview не входят'],
        ['Повтор', 'учитывает общий dedupe contract, а не смену projection как новое скачивание'],
      ],
      alternatives: [
        [0, 'grant проверяется при создании ссылки; HTTP/result не проверяется при выдаче файла'],
        [1, 'считается разрешённое реальное скачивание; denied, HEAD и preview также входят'],
        [2, 'учитывает смену projection как новое скачивание, а не общий dedupe contract'],
      ],
    },
    {
      protocol: [
        ['Queue', 'scoped по session/entity и сохраняет baseline вместе с operation id'],
        ['Reconnect', 'выясняет outcome и конфликт; старый intent не пишется поверх свежей revision без rebase'],
        ['Logout/доступ', 'закрывает старые операции; private cached grant не разрешает новые действия'],
      ],
      alternatives: [
        [0, 'scoped по entity; baseline и operation id общей queue переносит в другую session'],
        [1, 'выясняет свежую revision; старый intent пишется поверх неё без rebase'],
        [2, 'сохраняет старые операции; private cached grant разрешает новые действия'],
      ],
    },
    {
      protocol: [
        ['Выдача', 'сервер проверяет актуальные grant и effective projection, включая metadata'],
        ['Cache', 'включает session, projection и grant version конкретных bytes'],
        ['Revoke', 'инвалидирует full bytes; UI фильтр не расширяет доступ при новой выдаче'],
      ],
      alternatives: [
        [0, 'клиент проверяет grant и effective projection; сервер выдаёт исходные full metadata'],
        [1, 'включает session и projection; прежние full bytes выдаются после смены grant'],
        [2, 'сохраняет full bytes; UI фильтр расширяет доступ при новой выдаче'],
      ],
    },
    {
      protocol: [
        ['Shared', 'публичные типы и чистая логика; browser/server exports разделены'],
        ['Secret', 'остаётся на server boundary, не попадает в browser import graph'],
        ['Контроль', 'проверяет импорт и resulting bundle, включая side effects и chunks'],
      ],
      alternatives: [
        [0, 'публичные типы и чистая логика; browser entry также реэкспортирует server adapter'],
        [1, 'остаётся в browser import graph; runtime if(server) скрывает его исполнение'],
        [2, 'проверяет runtime ветки вместо resulting bundle, side effects и chunks'],
      ],
    },
    {
      protocol: [
        ['Ownership', 'у каждого state один owner; account evidence отделено от route draft'],
        ['Lifecycle', 'discard/restore касается route draft; unmount сохраняет durable proofs'],
        ['Derived view', 'вычисляется из owner contract и не становится второй независимой копией'],
      ],
      alternatives: [
        [0, 'у каждого CV свой proof owner; account evidence копируется в route draft'],
        [1, 'discard/restore касается account proofs; unmount сохраняет только route draft'],
        [2, 'вычисляется из owner contract и становится второй независимой копией'],
      ],
    },
    {
      protocol: [
        ['SSR', 'DTO и cache scoped по request/session и допустимой projection'],
        ['Hydration', 'использует тот же разрешённый snapshot, без full DTO другой session'],
        ['Смена доступа', 'session/revoke invalidation и late guards закрывают старые private bytes'],
      ],
      alternatives: [
        [0, 'DTO и cache scoped по CV; request/session и projection применяются лишь в HTML'],
        [1, 'использует full DTO другой session, а не тот же разрешённый snapshot'],
        [2, 'remount и отсутствие late guards сохраняют старые private bytes для нового B'],
      ],
    },
    {
      protocol: [
        ['Операция', 'scoped op-id сохраняется; authoritative outcome и baseline перечитываются'],
        ['Back', 'меняет navigation, не отменяет уже совершённый server commit'],
        ['Доступ', 'история страницы не восстанавливает отозванный server grant'],
      ],
      alternatives: [
        [0, 'scoped op-id заменяется; новый POST выполняется до authoritative outcome lookup'],
        [1, 'меняет navigation и отменяет уже совершённый server commit'],
        [2, 'история страницы восстанавливает отозванный server grant'],
      ],
    },
    {
      protocol: [
        ['Совместимость', 'API/assets поддерживают старые pages в объявленном version window'],
        ['Recovery', 'refresh сохраняет intent и предлагает восстановление несохранённого draft'],
        ['Private cache', 'scoped; offline bytes не заменяют актуальный grant после logout/revoke'],
      ],
      alternatives: [
        [0, 'API/assets удаляют поддержку старых pages сразу после activation нового worker'],
        [1, 'refresh удаляет intent и несохранённый draft; recovery не предлагается'],
        [2, 'scoped; offline bytes заменяют актуальный grant после logout/revoke'],
      ],
    },
  ];
  const entry = cases[c * 3 + s];
  if (!entry || !Number.isInteger(c) || !Number.isInteger(s) || c < 0 || c > 5 || s < 0 || s > 2) throw new Error('Unknown Frontend Senior protocol');
  const render = (protocol: Protocol) => protocol.map(([field, value]) => `${field}: ${value}.`).join(' ');
  return [render(entry.protocol), ...entry.alternatives.map(([index, value]) => render(entry.protocol.map((field, i) => i === index ? [field[0], value] : field) as unknown as Protocol))];
}
