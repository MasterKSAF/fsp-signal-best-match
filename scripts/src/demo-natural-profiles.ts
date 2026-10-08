import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, signalUsersTable as users, signalCandidateProfilesTable as profiles, signalCandidateResumesTable as resumes,
  signalCompaniesTable as companies, signalDemoSeedTable as markers } from '@workspace/db';

export const NATURAL_DEMO_MARKER = 'demo-natural-fio-content-20261008-v1';
import { naturalDemoName, naturalDemoStory, reservedDemoEmails } from "./demo-natural-data";
export { naturalDemoName, naturalDemoStory, reservedDemoEmails } from "./demo-natural-data";
const overviewNames = [
  { slug:'backend-junior',name:'Арсений Ильич Медведев' },{ slug:'backend-middle',name:'Ксения Олеговна Новикова' },
  { slug:'backend-senior',name:'Даниил Сергеевич Ковалёв' },{ slug:'frontend-junior',name:'Алиса Андреевна Ермакова' },
  { slug:'frontend-middle',name:'Иван Михайлович Лазарев' },{ slug:'frontend-ungraded',name:'Виктория Павловна Аксенова' },
];
/** Repairs this named fixture set once. Ordinary accounts and reviewer fixtures are excluded. */
export async function refreshNaturalDemoProfiles() {
  if (process.env.DEMO_MODE!=='true' || process.env.SIGNAL_WORKSPACE_ENABLED!=='true') throw new Error('Natural demo refresh requires the isolated demo workspace flags.');
  return db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${NATURAL_DEMO_MARKER}))`);
    const [marker] = await tx.select().from(markers).where(eq(markers.key,NATURAL_DEMO_MARKER));
    if (marker) return { updated:false,people:0,marker:NATURAL_DEMO_MARKER };
    const owned = [...reservedDemoEmails,...overviewNames.map(item=>`overview-v060-${item.slug}@example.test`)];
    const rows = await tx.select().from(users).where(inArray(users.email,owned));
    if (rows.some(row=>!row.demoMode||row.reviewScopeId!==null||row.role!=='candidate')) throw new Error('Reserved natural demo fixture collides with an ordinary/reviewer account; transaction stopped.');
    for (const row of rows) {
      const index = reservedDemoEmails.indexOf(row.email), overview = overviewNames.find(item=>row.email===`overview-v060-${item.slug}@example.test`);
      const name = overview?.name || naturalDemoName(index);
      await tx.update(users).set({ displayName:name }).where(and(eq(users.id,row.id),eq(users.demoMode,true),isNull(users.reviewScopeId)));
      await tx.update(profiles).set({ professionalAlias:name }).where(eq(profiles.userId,row.id));
      const documents = await tx.select().from(resumes).where(and(eq(resumes.userId,row.id),isNull(resumes.deletedAt)));
      for (const document of documents) {
        const story = naturalDemoStory(index<0?220+overviewNames.indexOf(overview!):index,document.specialization.startsWith('Frontend'));
        const role = document.specialization.startsWith('Frontend')?'Frontend-разработчик':'Backend-разработчик';
        const technicalTitle = /^Мо[её] резюме$|Demo|основное/i.test(document.title);
        const technicalSummary = !document.summary || /^Синтетический обзорный профиль\./.test(document.summary);
        const additions = { ...(technicalTitle?{title:`${role} · ${document.assumedGrade}`} : {}),
          ...(technicalSummary?{summary:story.summary}:{}),
          ...(!document.experience.length?{experience:story.experience}:{}), ...(!document.projects.length?{projects:story.projects}:{}),
          ...(!document.education.length?{education:story.education}:{}), };
        if (Object.keys(additions).length) await tx.update(resumes).set({ ...additions,revision:document.revision+1 }).where(eq(resumes.id,document.id));
      }
    }
    const employers = await tx.select().from(users).where(inArray(users.email,['employer-demo@example.test','employer-alt@example.test']));
    if (employers.some(row=>!row.demoMode||row.reviewScopeId!==null||row.role!=='employer')) throw new Error('Reserved company fixture collides with a non-demo account; transaction stopped.');
    for (const employer of employers) {
      const first = employer.email==='employer-demo@example.test';
      await tx.update(users).set({displayName:first?'Андрей Сергеевич Горин':'Елена Викторовна Бурова'}).where(eq(users.id,employer.id));
      await tx.update(companies).set({description:first?'Northstar Systems разрабатывает сервисы для электронной торговли: каталог, заказы и интеграции. Команда работает с Python, PostgreSQL и TypeScript.':'Meridian Lab создаёт аналитические веб-продукты. Команда объединяет специалистов по данным, разработчиков интерфейсов и продуктовых дизайнеров.'}).where(eq(companies.ownerUserId,employer.id));
    }
    await tx.insert(markers).values({key:NATURAL_DEMO_MARKER,version:'reserved-fictitious-fio-and-stories-v1'});
    return {updated:true,people:rows.length,companies:employers.length,marker:NATURAL_DEMO_MARKER};
  });
}
