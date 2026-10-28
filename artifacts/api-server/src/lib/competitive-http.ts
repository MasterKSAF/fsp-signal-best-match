import type { Request,Response } from 'express';
import { z } from 'zod';
import { getSessionUser } from './signal-auth';
export class FeatureError extends Error { constructor(readonly status:number,readonly code:string,message:string){super(message);} }
export const featureHandler=(fn:(req:Request,res:Response)=>Promise<void>)=>async(req:Request,res:Response)=>{
  try{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});await fn(req,res);}
  catch(e){if(e instanceof FeatureError){res.status(e.status).json({code:e.code,error:e.message});return;}if(e instanceof z.ZodError){res.status(400).json({code:'invalid_input',error:'Проверьте заполненные поля.'});return;}throw e;}
};
export async function featureUser(req:Request,role?:'candidate'|'employer'){
 const session=await getSessionUser(req);if(!session)throw new FeatureError(401,'sign_in','Войдите в аккаунт.');
 if(role&&session.user.role!==role)throw new FeatureError(403,'role_denied','Недостаточно прав.');return session.user;
}
