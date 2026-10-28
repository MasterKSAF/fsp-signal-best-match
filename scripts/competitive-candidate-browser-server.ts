/** Own QA API without automatic ATS, watch or recovery workers. */
import assert from 'node:assert/strict';
import {assertOwnDatabase} from './competitive-fixtures';
assertOwnDatabase();assert.equal(process.env.NODE_ENV,'test');
const {default:app}=await import('../artifacts/api-server/src/app');
app.listen(4480,'127.0.0.1',()=>console.log('B2 own QA API4480; automatic workers OFF'));
