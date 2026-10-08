import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const lines=(await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008.env','utf8')).split(/\r?\n/);
for(const line of lines){if(!line||line.startsWith('#'))continue;const index=line.indexOf('=');process.env[line.slice(0,index)]=line.slice(index+1).replace(/^"|"$/g,'');}
const database=new URL(process.env.DATABASE_URL);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_employer_e_20261008');
await import('./src/seed-fsp-signal.ts');
