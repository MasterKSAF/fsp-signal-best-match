import { and, eq, lte, sql } from 'drizzle-orm';
import { db, signalPdfImportDraftsTable as drafts,signalPdfImportReceiptsTable as receipts } from '@workspace/db';
export async function purgeExpiredPdfDrafts(){
 await db.delete(receipts).where(lte(receipts.createdAt,new Date(Date.now()-86400000)));
 const expired=await db.select({id:drafts.id}).from(drafts).where(and(lte(drafts.expiresAt,new Date()),sql`${drafts.fragments} <> '[]'::jsonb OR ${drafts.reviewTokenHash} IS NOT NULL`)).limit(100);
 for(const {id} of expired)await db.update(drafts).set({fields:{summary:'',skills:[]},fragments:[],provenance:{summary:[],skills:[]},reviewTokenHash:null}).where(and(eq(drafts.id,id),lte(drafts.expiresAt,new Date())));
}
export function startPdfImportRetention(){
 let busy=false;
 const run=async()=>{if(busy)return;busy=true;try{await purgeExpiredPdfDrafts();}catch{/* Draft reads independently enforce expiry; retry next interval. */}finally{busy=false;}};
 const timer=setInterval(()=>void run(),15*60_000);timer.unref();void run();return()=>clearInterval(timer);
}
