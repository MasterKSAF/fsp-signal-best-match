import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db,pool,signalExpertGrantsTable as grants,signalUsersTable as users } from '../lib/db/src/index';
const args=process.argv.slice(2),value=(name:string)=>args[args.indexOf(name)+1];
const userId=Number(value('--user')),operator=value('--operator'),days=Number(value('--days')??7);
try{
 if(!Number.isSafeInteger(userId)||userId<1||!operator||operator.startsWith('--')||!Number.isInteger(days)||days<1||days>30)throw new Error('Usage: --user ID --operator NAME --days 1..30 [--revoke GRANT_UUID]. Operator host access is required.');
 if(!(await db.select({id:users.id}).from(users).where(eq(users.id,userId)).limit(1)).length)throw new Error('User not found');
 if(args.includes('--revoke')){const id=value('--revoke');const rows=await db.update(grants).set({revokedAt:new Date()}).where(eq(grants.id,id!)).returning({id:grants.id});console.log({revoked:rows.length});}
 else{const id=randomUUID();await db.insert(grants).values({id,userId,grantedBy:operator,authority:'assessment_review',expiresAt:new Date(Date.now()+days*86400000)});console.log({grantId:id,userId,days});}
}finally{await pool.end();}
