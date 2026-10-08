/** Current-only plans over the operation in the stated scenario. Each row uses the same
 * executable fields; an alternative violates its actual predicate, lifecycle or constraint.
 * Option zero retains the historical invariant. Persisted attempts remain unchanged.
 */
export function juniorSqlPythonProtocolChoicesV6(
  skill: string, c: number, s: number, n: number, flag: boolean,
): string[] | null {
  const plans = (labels: readonly string[], rows: readonly (readonly string[])[]) =>
    rows.map(row => row.map((value, i) => `${labels[i]}: ${value}`).join('; ') + '.');
  const key = `${skill}:${c}:${s}`;

  if (key === 'python:4:2') {
    return plans(['Открытие', 'Успех', 'Ошибка'], [
      ['open(path) → file', 'parse(read(file)) → close(file) → return(result)', 'close(file) → raise(error)'],
      ['open(path) → file', 'parse(read(file)) → return(result) → close(file)', 'close(file) → raise(error)'],
      ['open(path) → file', 'close(file) → parse(read(file)) → return(result)', 'close(file) → raise(error)'],
      ['open(path) → file', 'parse(read(file)) → close(file) → return(result)', 'raise(error) → close(file)'],
    ]);
  }

  if (key === 'python:5:2') {
    return plans(['Разбор count', 'Диапазон', 'Запись'], flag ? [
      ['int(count)', 'value >= 0', 'разбор → диапазон → запись, ошибка → отказ'],
      ['int(count)', 'value >= 0', 'запись → разбор → диапазон, ошибка → отказ'],
      ['int(count)', 'value >= 0', 'разбор → диапазон → запись, ошибка → успех'],
      ['int(count)', 'value >= 0', 'разбор → диапазон → запись, ошибка → запись'],
    ] : [
      ['type(count) is int', 'count >= 0', 'тип → диапазон → запись, ошибка → отказ'],
      ['type(count) is int', 'count <= 0', 'тип → диапазон → запись, ошибка → отказ'],
      ['type(count) is int', 'count != 0', 'тип → диапазон → запись, ошибка → отказ'],
      ['type(count) is int', 'count >= 0', 'запись → тип → диапазон, ошибка → отказ'],
    ]);
  }

  if (key === 'sql:3:1') {
    return plans(['Предикат', 'Второй UPDATE', 'Обработка'], flag ? [
      [`WHERE revision=${n}`, 'rowcount=0, первая запись сохранена', '409, перечитать данные и пересчитать изменение'],
      [`WHERE revision=${n}`, 'rowcount=0, первая запись сохранена', '200, объявить второе изменение сохранённым'],
      [`WHERE revision=${n}`, 'rowcount=1, первая запись перезаписана', '200, считать старую revision достаточной'],
      [`WHERE revision=${n}`, 'rowcount=0, первая запись сохранена', 'перечитать revision и повторить старое значение без сравнения'],
    ] : [
      ['revision не участвует в WHERE', 'второе значение может затереть первое', 'добавить CAS по revision и обработку конфликта'],
      ['revision не участвует в WHERE', 'вторая запись автоматически получает 409', 'оставить UPDATE без CAS и обработать конфликт'],
      ['revision не участвует в WHERE', 'второе значение объединяется с первым', 'оставить UPDATE без CAS и подтвердить обе правки'],
      ['revision не участвует в WHERE', 'второе значение может затереть первое', 'читать revision перед записью, но оставить WHERE без неё'],
    ]);
  }

  if (key === 'sql:3:2') {
    return plans(['UPDATE', 'Транзакция', 'Покупка'], flag ? [
      ['rowcount=1, stock уменьшен с 1 до 0', 'COMMIT сохраняет списание', 'подтвердить успех после успешного COMMIT'],
      ['rowcount=1, stock уменьшен с 1 до 0', 'COMMIT сохраняет списание', 'подтвердить успех перед результатом COMMIT'],
      ['rowcount=1, stock уменьшен с 1 до 0', 'ROLLBACK сохраняет списание', 'подтвердить успех после успешного ROLLBACK'],
      ['rowcount=1, stock остался равен 1', 'COMMIT сохраняет прежний остаток', 'создать покупку без списания единицы'],
    ] : [
      ['rowcount=0, stock остался равен 0', 'предикат stock>0 остаётся обязательным', 'успешную покупку не создавать'],
      ['rowcount=0, stock остался равен 0', 'COMMIT считать выполненным списанием', 'успешную покупку создать'],
      ['rowcount=0, stock остался равен 0', 'повторить UPDATE без предиката stock>0', 'успех разрешить с остатком -1'],
      ['rowcount=0, stock уменьшен с 0 до -1', 'предикат stock>0 остаётся обязательным', 'успешную покупку создать'],
    ]);
  }

  if (key === 'sql:5:0') {
    return plans(['Ограничение', 'Та же пара', 'Другой tenant, тот же event_id'], flag ? [
      ['UNIQUE(tenant_id,event_id)', 'повтор отклоняется', 'вставка разрешается'],
      ['UNIQUE(event_id)', 'повтор отклоняется', 'вставка отклоняется'],
      ['UNIQUE(tenant_id)', 'повтор отклоняется', 'вставка разрешается, другие события tenant запрещены'],
      ['UNIQUE(tenant_id,event_id,id)', 'повтор с новым id разрешается', 'вставка разрешается'],
    ] : [
      ['UNIQUE(event_id)', 'повтор отклоняется', 'вставка отклоняется'],
      ['UNIQUE(tenant_id,event_id)', 'повтор отклоняется', 'вставка разрешается'],
      ['UNIQUE(tenant_id)', 'повтор отклоняется', 'вставка разрешается, другие события tenant запрещены'],
      ['UNIQUE(event_id,id)', 'повтор с новым id разрешается', 'вставка разрешается'],
    ]);
  }

  if (key === 'sql:5:1') {
    return plans(['customer_id', 'Ссылка на клиента', flag ? 'Удаление клиента' : 'Вставка заказа'], flag ? [
      ['NOT NULL', 'REFERENCES customers(id)', 'ON DELETE RESTRICT при существующих заказах'],
      ['NULL разрешён', 'REFERENCES customers(id)', 'ON DELETE RESTRICT при существующих заказах'],
      ['NOT NULL', 'REFERENCES customers(id)', 'ON DELETE CASCADE при существующих заказах'],
      ['NOT NULL', 'SELECT перед INSERT вместо FOREIGN KEY', 'удаление между SELECT и INSERT разрешено'],
    ] : [
      ['NULL разрешён', 'REFERENCES customers(id)', 'NULL принять, отсутствующий непустой id отклонить'],
      ['NOT NULL', 'REFERENCES customers(id)', 'NULL отклонить, существующий непустой id принять'],
      ['NULL разрешён', 'FOREIGN KEY отсутствует', 'NULL принять, отсутствующий непустой id принять'],
      ['NOT NULL DEFAULT 0', 'REFERENCES customers(id)', 'NULL заменить на 0 без существующего клиента id=0'],
    ]);
  }

  if (key === 'sql:5:2') {
    return plans(['amount', 'Ограничение', 'Нерассчитанная сумма'], flag ? [
      ['NOT NULL', 'CHECK(amount >= 0)', 'NULL отклоняется, ноль принимается'],
      ['NULL разрешён', 'CHECK(amount >= 0)', 'NULL принимается, ноль принимается'],
      ['NOT NULL', 'CHECK(amount > 0)', 'NULL отклоняется, ноль отклоняется'],
      ['NOT NULL', 'CHECK(amount >= -1)', 'NULL отклоняется, -1 принимается'],
    ] : [
      ['NULL разрешён', 'CHECK(amount >= 0)', 'NULL принимается, ноль принимается'],
      ['NOT NULL', 'CHECK(amount >= 0)', 'NULL отклоняется, ноль принимается'],
      ['NULL разрешён', 'CHECK(amount > 0)', 'NULL принимается, ноль отклоняется'],
      ['NULL разрешён', 'CHECK(amount >= -1)', 'NULL принимается, -1 принимается'],
    ]);
  }
  return null;
}
