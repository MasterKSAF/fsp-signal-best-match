import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobSearchInput, parseSkillFilters, safeSpreadsheetText, jobsCsv, jobExportCells, skillRequirementCovered, type ExportableJob } from '../artifacts/api-server/src/lib/job-discovery';
import { naturalDemoName, reservedDemoEmails } from '../scripts/src/demo-natural-data';

const job: ExportableJob = { id:217,companyName:'=HYPERLINK("https://example.test")',title:'Разработчик, "React"\nновая строка',specialization:'Frontend / TypeScript',grade:'Middle',skills:['TypeScript','React','Accessibility'],skillRequirements:[{skill:'React',level:'Middle'},{skill:'TypeScript',level:'Junior'}],salaryMin:150000,salaryMax:220000,salaryPeriod:'month',salaryType:'net',workFormat:'Гибрид',location:'Казань',publishedAt:'2026-10-08T10:00:00.000Z' };
test('job query validates full-set pagination and explicit skill levels',()=>{
  const parsed=jobSearchInput.parse({page:'12',pageSize:'20',salaryMin:'100000',skills:'[{"skill":"React","level":"Middle"}]',sort:'salary_desc'});
  assert.equal(parsed.page,12);assert.equal(parsed.salaryPeriod,'month');assert.deepEqual(parseSkillFilters(parsed.skills),[{skill:'React',level:'Middle'}]);
  assert.equal(jobSearchInput.safeParse({skills:'[{"skill":"React","level":"Expert"}]'}).success,false);
  assert.equal(jobSearchInput.safeParse({skills:'invalid'}).success,false);
  assert.equal(jobSearchInput.safeParse({salaryMin:300,salaryMax:200}).success,false);
});
test('CSV escapes Cyrillic, multiline values and formula prefixes without adding private fields',()=>{
  const text=jobsCsv([job],'http://localhost:4368');
  assert.ok(text.startsWith('\uFEFF"Компания"')); assert.ok(text.includes('"\'=HYPERLINK(""https://example.test"")"'));
  assert.ok(text.includes('Разработчик, ""React""\nновая строка'));assert.ok(text.includes('Казань'));assert.ok(text.includes('React — Middle'));
  assert.ok(text.includes('Accessibility — уровень не указан'));assert.ok(text.endsWith('\r\n'));assert.equal(jobExportCells(job,'https://signal.example.test')[13],'https://signal.example.test/jobs?job=217');
  for(const input of ['=1+1',' +SUM(1)','\t@foo','\r-HYPERLINK(1)'])assert.ok(safeSpreadsheetText(input).startsWith("'"));
  assert.equal(safeSpreadsheetText('С++'),'С++');
});
test('skill coverage never upgrades legacy unlevelled evidence or maps SQL to PostgreSQL',()=>{
  assert.equal(skillRequirementCovered({skill:'React',level:'Middle'},[{skill:'React'}]),false);
  assert.equal(skillRequirementCovered({skill:'react',level:'Junior'},[{skill:'React',level:'Middle'}]),true);
  assert.equal(skillRequirementCovered({skill:'PostgreSQL'},[{skill:'SQL',level:'Senior'}]),false);
  assert.equal(skillRequirementCovered({skill:'SQL'},[{skill:'SQL'}]),true);
});
test('owned demo identity list is exact, diverse, full-name and stable',()=>{
  assert.equal(reservedDemoEmails.length,220); assert.equal(new Set(reservedDemoEmails).size,220);
  const names=Array.from({length:220},(_,index)=>naturalDemoName(index));
  assert.equal(new Set(names).size,220);assert.ok(names.every(name=>/^[А-ЯЁа-яё]+ [А-ЯЁа-яё]+ [А-ЯЁа-яё]+$/.test(name)));
  assert.equal(names[0],'Алексей Сергеевич Орлов');assert.equal(names[219],naturalDemoName(219));
});
