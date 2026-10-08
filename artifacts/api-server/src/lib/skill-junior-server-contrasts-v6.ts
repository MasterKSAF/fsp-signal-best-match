/** Concise alternative decisions for the same Junior scenario, each with a specific contract error. */
export function compactJuniorServerDistractorsV6(skill:string,c:number,s:number,n:number,flag:boolean):readonly string[]|null{
 const errors:Record<string,readonly string[]>={
 'python:4:2':['close() после return результата.','close() только в except, successful return не закрывает.','with закрывает файл до вызова чтения в этой функции.'],
 'python:5:2':['count=int(str(count)[:2]); запись без проверки.','Отрицательный count заменить abs(count).','count:int считать runtime validation.'],
 'sql:3:1':[flag?'CAS0 считать success.':'Второй безCAS UPDATE считать rejected автоматически.','CAS retry: свежая revision, старое вычисленное value.','Expected revision проверять отдельным SELECT до UPDATE.'],
 'sql:3:2':[flag?'Подтвердить покупку до COMMIT.':'При UPDATE0 всё равно создать успешную покупку.','ROLLBACK после UPDATE сохраняет списание.','Любой rowcount считать доказательством COMMIT.'],
 'sql:5:0':[flag?'UNIQUE(event_id) для local event.':'UNIQUE(tenant_id,event_id) для global event.','SELECT business key, затем INSERT без UNIQUE.','Surrogate random id заменяет уникальность event.'],
 'sql:5:1':[flag?'Nullable customer_id, только FK.':'NOT NULL customer_id при допустимом отсутствии.','FK ON DELETE CASCADE при запрете удаления клиента.','Только SELECT клиента перед INSERT без FK.'],
 'sql:5:2':[flag?'Nullable amount, CHECK(amount>=0).':'NOT NULL amount, CHECK(amount>=0).','CHECK(amount>0): ноль отклоняется.','DEFAULT0 без CHECK для любых импортов.'],
 'backend-engineering:0:1':[flag?'Retry выполнить новый effect с прежним key.':'При отсутствии key вернуть придуманный old response.','Ключ только в памяти одного process.','Receipt записать отдельно после effect COMMIT.'],
 'backend-engineering:0:2':[flag?'Optional field сразу сделать required.':'Сменить units прежнего поля без версии.',flag?'Новый optional field требовать от старых клиентов; default не задавать.':'Default новых units назначает только новый клиент.',flag?'Отвергать прежний DTO без optional field как schema error.':'Старые units DTO/cache читать как новые без преобразования.'],
 'backend-engineering:1:1':['COMMIT order, отправить один раз, забыть timeout.','Broker event до COMMIT order.','Outbox commit отдельно после order COMMIT.'],
 'backend-engineering:1:2':[flag?'Financial write разрешает stale cache version.':'Повторный HTTP read брать из прежнего кеша без TTL/инвалидации; новый запрос считать гарантией свежести ≤30с.','TTL10min соответствует freshness30s.','Проверять version лишь при cache miss.'],
 'backend-engineering:2:2':[flag?'Принять меньший token A после B.':'Отклонить текущий token B из-за позднего A.','SELECT fence до write без atomic compare.','Client timestamp заменяет server fencing token.'],
 'backend-engineering:3:0':[flag?'CPU profile вместо доминирующего DB lock wait.':'Расширить DB pool вместо внешней90% ветки.','Общий p95 доказывает причину без spans.','Исключить timed-out requests из error denominator.'],
 'backend-engineering:3:2':[flag?'Один общий error rate без tenant cohorts.':'Deployment errors считать одной tenant config.','IP клиента заменяет сквозной correlation-id.','Raw payload/token записать в общую dashboard.'],
 'backend-engineering:4:1':['SQL-интерполяция после UI type validation.','Экранировать только первую quote.','Параметризовать table name, value интерполировать.'],
 'backend-engineering:4:2':[flag?'Private full файл отдавать из общего CDN.':'Public проекцию смешать с privatecacheпоid.','Grant только при первом cache fill.','Права выводить из самого наличия file URL.'],
 'backend-engineering:5:1':[flag?'Required schema сразу, старые replicas оставлены.':'Удалить поле до перехода old readers/writers.','Новое поле лишь в process memory.','Backup заменяет online compatibility старого кода.'],
 };return errors[`${skill}:${c}:${s}`]??null;
}
