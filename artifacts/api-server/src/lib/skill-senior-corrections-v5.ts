/** Five genuinely new v5 scenarios. Old v4 cases/oracles remain immutable snapshots. */
import type { SeniorPart } from './skill-senior-outcomes';

export const seniorV5ChangedFamilies = new Set([
  'sql:transactions:s1', 'sql:constraints:s3', 'typescript:generics:s1',
  'react:closures:s1', 'react:forms:s1',
]);
const result = (prompt: string, expected: string, explanation: string): SeniorPart => ({ prompt, expected, explanation, responseType: 'text' });
const invariant = (prompt: string, choices: readonly [string, string, string, string], explanation: string): SeniorPart => ({ prompt, choices, expected: '1', explanation, responseType: 'integer' });

export function seniorCorrectionV5(skill: string, c: number, s: number, n: number, flag: boolean): readonly [SeniorPart, SeniorPart] | null {
  if (skill === 'sql' && c === 3 && s === 0) return [
    result(`SQL-транзакция ${n} атомарно записывает order=paid и outbox(event=K,pending). ${flag ? 'Первая попытка полностью ROLLBACK; вторая COMMIT.' : 'Первая попытка COMMIT; вторая с тем же operation-id видит сохранённый receipt и ничего не пишет.'} Процесс падает после COMMIT до отправки K. Новый dispatcher читает pending и отправляет K; провайдер выполняет effect, но ACK потерян. Lease истекает; другой dispatcher снова отправляет K и получает ACK. В этом trace провайдер НЕ хранит dedupe-key, каждый receive выполняет effect. Введите committed orders|committed outbox rows|external effects.`,
      '1|1|2', 'ROLLBACK отменяет и order, и outbox. COMMIT сохраняет durable intent несмотря на падение publisher. Два delivery одного K без recipient dedupe дают два внешних эффекта, независимо от SQL isolation.'),
    invariant('Нужен один external effect на committed order при этих двух окнах сбоя. Какой протокол обеспечивает safety и восстановление, а не просто локальный SQL invariant?', [
      'Order + outbox в одной SQL-транзакции; dispatcher повторяет stable K. Recipient атомарно связывает K/payload с effect/result и возвращает прежний результат после потерянного ACK; delivery подтверждается после ответа.',
      'Сохранить order и SQL receipt в SERIALIZABLE, отправить K только после COMMIT. Потеря процесса до send или ACK считается автоматически исправленной самой изоляцией SQL.',
      'Order + outbox атомарны, но при каждой lease смене новый delivery-key. Recipient дедуплицирует по delivery-key, поэтому два receive одного order считаются двумя допустимыми эффектами.',
      'Перед сетевым вызовом отметить outbox delivered отдельным COMMIT. Это устраняет повтор после потерянного ACK; падение между отметкой и send также считать успешным эффектом.',
    ], 'SQL не атомарен с произвольным внешним provider. Durable outbox закрывает commit/send gap; стабильный recipient dedupe закрывает receive/ACK gap. Если provider не поддерживает подобный контракт, обещание одного effect недоказуемо.'),
  ];
  if (skill === 'sql' && c === 5 && s === 2) return [
    result(`СУБД поддерживает partial unique index. users(tenant,id,email,deleted_at) имеет UNIQUE(tenant,id) и UNIQUE(tenant,lower(email)) WHERE deleted_at IS NULL. orders(tenant,user_id) имеет обычный FK на users(tenant,id); иных constraints/triggers нет. В tenant A: id=${n}, email=x, ${flag ? 'active' : 'soft-deleted'}; id=${n + 1}, email=x, soft-deleted. В tenant B есть active email=x. Сначала INSERT order(A,${n + 1}), затем отдельная транзакция восстанавливает id=${n + 1} (deleted_at=NULL). Введите принятых orders|успешных restore (0/1).`,
      `1|${flag ? 0 : 1}`, 'Обычный FK проверяет существующий ключ, а не active-предикат: order к soft-deleted пользователю принимается. Partial unique ограничивает только активные email внутри tenant; restore конфликтует лишь с другим active A/x.'),
    invariant('Новый invariant: каждый действующий order ссылается на active пользователя; concurrent create-order и soft-delete должны его сохранять, history нельзя удалять. Какой дизайн достаточен?', [
      'Сделать active membership канонической активностью: ключ (tenant,user_id) с FK к user, live orders с FK к membership. Удаление membership запрещено при live ссылках; закрытие orders/deactivate согласованы, history отдельно, независимая запись deleted_at запрещена.',
      'Оставить обычный FK orders→users и partial unique email. Эти два ограничения автоматически требуют deleted_at IS NULL у любого parent, поэтому дополнительная модель активности не нужна.',
      'Перед INSERT проверить active SELECT, а soft-delete выполнить независимо. Два concurrent writers используют разные строки и потому precheck всегда остаётся действителен до COMMIT.',
      'Сделать FK на partial unique email активных users и ON DELETE CASCADE всех orders; partial predicate сам обеспечивает поддерживаемый referenced key и требование сохранять историю.',
    ], 'Partial uniqueness не выражает ссылку только на active parent. Referenced active-key + FK защищает конкурентную ссылочную границу; альтернативно оба writer должны участвовать в доказанном общем lock/validation протоколе. Историю нельзя безусловно cascade-delete.'),
  ];
  if (skill === 'typescript' && c === 2 && s === 0) return [
    result(`TypeScript strict:true. Fields={name:string;age:number}. Функция set<K extends keyof Fields>(target:Fields,key:K,value:Fields[K]){target[key]=value}. Выполнен set<keyof Fields>(target,${flag ? "'age','Ada'" : "'name'," + n}). Альтернатива: type Command={[K in keyof Fields]:[key:K,value:Fields[K]]}[keyof Fields]; declare function safeSet(...command:Command):void; safeSet(${flag ? "'age','Ada'" : "'name'," + n}). Введите generic call typechecks yes/no|tuple-union call typechecks yes/no|runtime typeof поля, которое записал generic call.`,
      `yes|no|${flag ? 'string' : 'number'}`, 'Явный K=name|age превращает Fields[K] в string|number: generic call теряет корреляцию аргументов. Mapped union отдельных пар сохраняет её; static generic ограничение не предотвращает неправильный runtime assignment.'),
    invariant('API принимает ещё и unknown JSON commands. Нужно сохранить key/value корреляцию, безопасно реализовать запись и не выдать type assertion за валидатор. Выберите достаточную границу.', [
      'Typed вход — mapped discriminated tuple/object union; implementation narrowing по key сохраняет связь value. Unknown command отдельно проверяется runtime по разрешённому key и типу именно его value; лишь затем применяется запись.',
      'Оставить generic K extends keyof Fields и убрать возможность явно писать K из документации. Inference никогда не выбирает union, поэтому external key/value и ручные generic calls считаются доказанно связанными.',
      'Принять key:keyof Fields и value:Fields[keyof Fields] двумя независимыми аргументами; каждый прошёл свою проверку типа, поэтому age+string не может пройти их сочетание.',
      'Mapped tuple union оставить только в публичной сигнатуре, unknown JSON привести as Command; в implementation записывать через any, считая, что erased union проверит runtime пары.',
    ], 'Корреляция альтернатив теряется в произведении unions. Сужение конкретной discriminated пары и runtime decoding решают разные задачи; generic inference и assertion не добавляют данные или проверки.'),
  ];
  if (skill === 'react' && c === 1 && s === 0) return [
    result(`React concurrent render: committed UI показывает editor A. stable onClick отправляет latestTarget.current; изначально ref=A. Начался speculative render B, но Suspense прервал его и B НЕ commit; эффект B также не запускался. ${flag ? 'Render body B успел выполнить latestTarget.current=B.' : 'Render body не пишет ref; только layout-effect успешного commit мог бы поменять ref.'} До следующего commit пользователь кликает видимую кнопку A. Введите target отправленной команды|entity committed UI.`,
      `${flag ? 'B' : 'A'}|A`, 'Mutable ref общая для renders: запись speculative render наблюдаема даже после его abandonment. Отсутствие commit не откатывает произвольную мутацию ref; commit-bound синхронизация не публикует B.'),
    invariant('Как гарантировать, что target клика соответствует committed UI, сохранив concurrent rendering и поздние callbacks?', [
      'Render остаётся pure. Target берётся из handler committed render либо commit-bound layout lifecycle с явным ownership; speculative B ничего не публикует. Late response затем проверяет captured command/entity generation отдельно.',
      'Каждый render как можно раньше пишет current target в ref, чтобы stable handler видел последнее вычисление. Даже discarded render считается достаточным подтверждением выбранной entity.',
      'Переместить публикацию target в useMemo и считать memoization commit barrier. При Suspense React автоматически отменит мутацию ref, выполненную внутри вычисления memo.',
      'Публиковать target в passive effect, но разрешить click с новой committed entity до синхронизации и игнорировать этот промежуток. Свежая callback reference автоматически перепривяжет уже отправленную команду.',
    ], 'Новая проблема — публикация неcommitted render, а не только stale response другой entity. Pure render и согласованная commit граница устраняют эту утечку intent; response fencing остаётся отдельным необходимым условием.'),
  ];
  if (skill === 'react' && c === 4 && s === 0) return [
    result(`Форма адресов хранится по stable row id. Base rev${n}: a.city=Kazan,b.city=Perm. Local draft: a.city=Moscow,b.city=Perm. Submit с If-Match rev${n} получил409 и remote rev${n + 1}: ${flag ? 'row a удалена' : 'a.city=Moscow'}, b.city=Ufa. Правило three-way merge по исходному base: одна изменившая сторона принимается; одинаковые изменения обеих принимаются; local edit против remote delete — явный конфликт без молчаливого resurrect. Для a при конфликте напишите conflict. Введите merged a.city|merged b.city|число конфликтов.`,
      `${flag ? 'conflict' : 'Moscow'}|Ufa|${flag ? 1 : 0}`, 'Для b local совпадает с base: remote изменение принимается. У a edit/delete расходятся и требуют выбора; одинаковый local/remote Moscow не является конфликтом. Общий dirty boolean или новая revision не устанавливают эти отношения.'),
    invariant('Как сохранить intent и корректно отправить следующее изменение после этого409, включая удалённые и reordered rows?', [
      'Сопоставлять base/local/remote по stable id, включая tombstones и изменения полей; конфликт edit/delete показать явно. Не применять row index или blind retry. После выбора сохранить remote baseline/revision и отправить осознанный merged intent с новой precondition.',
      'Поменять If-Match на новую remote revision и автоматически повторить весь local draft. Удалённая a восстановится, но новая revision считается достаточным разрешением конфликтующего intent.',
      'Совместить arrays по index после сортировки remote; удалить dirty flag по409 и объявить server baseline local draft. Row id не нужен, если число оставшихся адресов невелико.',
      'При любом409 заменить local всем remote и скрыть conflict. Это сохраняет наиболее свежий server snapshot и потому также сохраняет введённый пользователем local edit a.',
    ], 'Это three-way разрешение конкурентного edit/delete и независимого изменения другой строки. HTTP precondition защищает запись, но не решает смысл конфликта; без stable identity merge переносит intent между адресами.'),
  ];
  return null;
}
