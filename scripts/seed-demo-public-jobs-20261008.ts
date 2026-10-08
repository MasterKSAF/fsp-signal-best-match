import assert from 'node:assert/strict';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db,pool,signalUsersTable as users,signalCompaniesTable as companies,signalJobsTable as jobs,signalJobRequirementsTable as requirements,signalDemoSeedTable as markers } from '@workspace/db';
const marker='workspace-demo-public-jobs-20261008-v1';
try {
  assert.equal(new URL(process.env.DATABASE_URL||'').pathname.slice(1),'signal_independent_fixes_20261007');
  assert.equal(process.env.SIGNAL_WORKSPACE_ENABLED,'true');assert.equal(process.env.DEMO_MODE,'true');
  const result=await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${marker}))`);
    const [existing]=await tx.select().from(markers).where(eq(markers.key,marker));if(existing)return {created:false,jobs:0};
    const owners=await tx.select({user:users,company:companies}).from(users).innerJoin(companies,eq(companies.ownerUserId,users.id))
      .where(and(inArray(users.email,['employer-demo@example.test','employer-alt@example.test']),eq(users.role,'employer'),eq(users.demoMode,true),isNull(users.reviewScopeId)));
    assert.equal(owners.length,2);
    const variants=[
      {title:'Python-разработчик платформы заказов',specialization:'Backend / Python',grade:'Middle',skills:['Python','SQL','Backend engineering'],location:'Казань',salaryMin:220000,salaryMax:280000,workFormat:'Гибрид',description:'Развивайте платформу заказов: API для веб-продукта, интеграции с партнёрами и обработку фоновых задач. Работаем небольшими командами, проводим ревью и пишем воспроизводимые тесты.'},
      {title:'React-разработчик аналитического продукта',specialization:'Frontend / TypeScript',grade:'Middle',skills:['React','TypeScript','Frontend engineering'],location:'Москва',salaryMin:210000,salaryMax:290000,workFormat:'Удалённо',description:'Создавайте интерфейс аналитического продукта: отчёты, фильтры и удобные формы. Вместе с дизайнером улучшайте доступность, состояние интерфейса и скорость важных сценариев.'},
      {title:'Начинающий Python-разработчик',specialization:'Backend / Python',grade:'Junior',skills:['Python','SQL'],location:'Казань',salaryMin:100000,salaryMax:150000,workFormat:'Офис',description:'Присоединяйтесь к команде внутренних инструментов. Поможем освоить API, небольшие фоновые задачи, SQL-запросы и командное ревью. Наставник и понятные первые задачи предусмотрены.'},
      {title:'Frontend-разработчик командного портала',specialization:'Frontend / TypeScript',grade:'Junior',skills:['TypeScript','React'],location:'Санкт-Петербург',salaryMin:120000,salaryMax:170000,workFormat:'Гибрид',description:'Развивайте командный портал: списки задач, формы и уведомления. Важны аккуратная работа с TypeScript, понятное состояние компонентов и внимание к доступности.'},
      {title:'Инженер SQL и продуктовых данных',specialization:'Backend / Python',grade:'Middle',skills:['SQL','Python'],location:'Екатеринбург',salaryMin:180000,salaryMax:240000,workFormat:'Удалённо',description:'Работайте с моделями продуктовых данных, отчётами и серверными интеграциями. Вместе с аналитиками уточняйте правила расчётов, проверяйте ограничения и поддерживайте воспроизводимость результатов.'},
      {title:'Разработчик интеграций на TypeScript',specialization:'Backend / Python',grade:'Middle',skills:['TypeScript','SQL','Backend engineering'],location:'Казань',salaryMin:190000,salaryMax:260000,workFormat:'Удалённо',description:'Разрабатывайте серверные интеграции на TypeScript: договорённости API, очереди и обработку ошибок. Вместе с командой поддерживайте SDK партнёров и тесты повторных запросов.'},
    ] as const;
    for(const [index,variant] of variants.entries()){
      const company=owners.find(owner=>owner.user.email===(index%2?'employer-alt@example.test':'employer-demo@example.test'))!.company;
      const [job]=await tx.insert(jobs).values({...variant,skills:[...variant.skills],companyId:company.id,salaryPeriod:'month',salaryType:'gross',status:'published',publishedAt:new Date(Date.UTC(2026,9,8,8,index*10)),createdAt:new Date(Date.UTC(2026,9,8,8,index*10))}).returning();
      await tx.insert(requirements).values({jobId:job.id,location:variant.location,skillRequirements:variant.skills.map(skill=>({skill,level:variant.grade as 'Junior'|'Middle'}))});
    }
    await tx.insert(markers).values({key:marker,version:'six-fictitious-publications-two-known-demo-companies'});return{created:true,jobs:6};
  });console.info(JSON.stringify({synthetic:true,marker,...result}));
} finally {await pool.end();}
