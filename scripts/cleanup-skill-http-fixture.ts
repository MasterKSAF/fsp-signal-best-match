import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { inArray } from 'drizzle-orm';
import { db,pool,signalUsersTable as users } from '../lib/db/src/index';
const p=resolve(process.argv[2]??'');assert.equal(p.startsWith('C:\\Users\\Misha\\.codex\\private\\'),true);
assert.match(basename(p),/^skill-http-[0-9a-f-]{36}\.json$/);const fixture=JSON.parse(await readFile(p,'utf8'));
assert.equal(`${fixture.fixtureId}.json`,basename(p));const database=new URL(process.env.DATABASE_URL!);assert.equal(database.pathname,'/signal_independent_fixes_20261007');assert.equal(database.hostname,'127.0.0.1');
const ids=fixture.accounts.map((a:any)=>a.id);const rows=await db.select({id:users.id,email:users.email}).from(users).where(inArray(users.id,ids));
for(const row of rows){assert.ok(row.email.startsWith(fixture.fixtureId+'-'));assert.equal(row.email,fixture.accounts.find((a:any)=>a.id===row.id)?.email);}
if(rows.length)await db.delete(users).where(inArray(users.id,rows.map(r=>r.id)));fixture.cleanedAt=new Date().toISOString();await writeFile(p,JSON.stringify(fixture,null,2));await pool.end();console.log(JSON.stringify({deletedOwnedActors:rows.length,fixtureId:fixture.fixtureId}));
