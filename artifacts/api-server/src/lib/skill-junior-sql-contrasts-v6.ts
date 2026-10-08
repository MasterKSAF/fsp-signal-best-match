/** SQL counterplans keep the same entities and decision vocabulary; each makes one specific
 * transaction/scope/integrity error. Historical choices and the current correct meaning stay intact. */
export function juniorSqlContrastsV6(c:number,s:number,flag:boolean,correct:string):string[]|null{
 const wrong:Record<string,string[]>={
 '3:1':flag?[
  'UPDATE с прежней revision меняет 0 строк: вернуть успех, сохранить прежнее вычисленное значение.',
  'UPDATE с прежней revision меняет 0 строк: перечитать revision и повторить старое вычисленное значение.',
  'Перед вторым UPDATE проверить revision отдельным SELECT; последующий UPDATE выполнить без WHERE revision.',
 ]:[
  'Второй UPDATE без WHERE revision автоматически обнаружит первый; вернуть конфликт без проверки rowcount.',
  'Второй UPDATE без WHERE revision затрёт первый; считать оба изменения сохранёнными в одной итоговой строке.',
  'Проверить прежнюю revision отдельным SELECT, затем UPDATE без CAS; считать промежуток защищённым.',
 ],
 '3:2':flag?[
  'Изменена 1 строка: подтвердить покупку до COMMIT; отказ COMMIT не отзывает это подтверждение.',
  'Изменена 1 строка: выполнить ROLLBACK; считать списание сохранённым по числу изменённых строк.',
  'Изменена 1 строка: повторить UPDATE stock=stock-1 перед COMMIT без проверки stock>0.',
 ]:[
  'Изменено 0 строк: подтвердить успешную покупку, поскольку inventory содержит товар с этим id.',
  'Изменено 0 строк: повторить UPDATE без stock>0; отрицательный остаток считать допустимым резервом.',
  'Изменено 0 строк: выполнить COMMIT и считать его успешное завершение доказательством списания.',
 ],
 '5:0':flag?[
  'UNIQUE(event_id): события разных tenants с одинаковым event_id считать одним событием.',
  'UNIQUE(tenant_id): разные event_id одного tenant считать повтором и отклонять.',
  'SELECT(tenant_id,event_id), затем INSERT без UNIQUE; две транзакции после SELECT обе могут записать пару.',
 ]:[
  'UNIQUE(tenant_id,event_id): одинаковый глобальный event_id другого tenant разрешить повторно.',
  'UNIQUE(tenant_id): разные глобальные event_id одного tenant считать одним событием.',
  'SELECT(event_id), затем INSERT без UNIQUE; совместный отрицательный SELECT разрешает обеим транзакциям запись.',
 ],
 '5:1':flag?[
  'customer_id допускает NULL; FOREIGN KEY и RESTRICT проверяют только непустую ссылку клиента.',
  'customer_id NOT NULL и FOREIGN KEY ON DELETE CASCADE: удаление клиента удаляет заказы.',
  'customer_id NOT NULL; клиента проверить SELECT перед INSERT без FOREIGN KEY и защиты от удаления.',
 ]:[
  'customer_id NOT NULL, FOREIGN KEY: заказ без выбранного клиента отклонять вместо хранения NULL.',
  'customer_id допускает NULL; непустой id проверять только SELECT без FOREIGN KEY.',
  'customer_id NOT NULL DEFAULT 0; FOREIGN KEY убрать, заказ без клиента связывать с несуществующим id=0.',
 ],
 '5:2':flag?[
  'CHECK(amount>=0) без NOT NULL: NULL принять как неизвестную обязательную сумму.',
  'NOT NULL и CHECK(amount>0): обязательную сумму ноль отклонить вместе с отрицательной.',
  'NOT NULL и DEFAULT 0 без CHECK: отрицательную сумму импорта сохранить до последующего расчёта.',
 ]:[
  'NOT NULL и CHECK(amount>=0): неизвестную сумму NULL отклонить, хотя контракт её допускает.',
  'NULL допустим, CHECK(amount>0): рассчитанную сумму ноль отклонить как нарушение.',
  'NULL допустим, DEFAULT 0 без CHECK: отрицательную рассчитанную сумму принять при импорте.',
 ],
 };
 return wrong[`${c}:${s}`]?[correct,...wrong[`${c}:${s}`]!]:null;
}
