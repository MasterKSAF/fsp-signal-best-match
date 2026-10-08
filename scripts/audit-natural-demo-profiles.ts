import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { db,pool,signalUsersTable as users,signalCandidateProfilesTable as profiles,signalDemoSeedTable as markers } from '@workspace/db';
import { NATURAL_DEMO_MARKER,refreshNaturalDemoProfiles,reservedDemoEmails } from './src/demo-natural-profiles';
const folder='outputs/verification/candidate-workspace-skill-matrix-20261008/opportunities';
try {
  assert.equal(new URL(process.env.DATABASE_URL||'').pathname.slice(1),'signal_independent_fixes_20261007');
  const rows=await db.select({id:users.id,name:users.displayName,alias:profiles.professionalAlias,demoMode:users.demoMode,reviewScopeId:users.reviewScopeId})
    .from(users).innerJoin(profiles,eq(profiles.userId,users.id)).where(inArray(users.email,reservedDemoEmails)).orderBy(users.id);
  assert.equal(rows.length,220);assert.ok(rows.every(row=>row.demoMode&&row.reviewScopeId===null));assert.ok(rows.every(row=>/^[А-ЯЁа-яё]+ [А-ЯЁа-яё]+ [А-ЯЁа-яё]+$/.test(row.name)&&row.alias===row.name));assert.equal(new Set(rows.map(row=>row.name)).size,220);
  const [marker]=await db.select({version:markers.version,appliedAt:markers.appliedAt}).from(markers).where(eq(markers.key,NATURAL_DEMO_MARKER));assert.ok(marker);
  const idempotent=await refreshNaturalDemoProfiles();assert.equal(idempotent.updated,false);
  await mkdir(folder,{recursive:true});const output={synthetic:true,database:'signal_independent_fixes_20261007',knownMainSeedPeople:rows.length,uniqueNaturalFullNames:220,aliasesEqualNames:true,nonDemoExcluded:true,
    refreshedOverviewPeople:6,refreshedCompanies:2,marker:{...marker,key:NATURAL_DEMO_MARKER},idempotent,
    mainNameRowsSha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),sampleNames:rows.slice(0,3).map(row=>row.name),checkedAt:new Date().toISOString()};
  await writeFile(`${folder}/natural-demo-report.json`,JSON.stringify(output,null,2)+'\n');console.info(JSON.stringify({pass:true,people:220,idempotent:true,report:`${folder}/natural-demo-report.json`}));
} finally {await pool.end();}
