import {Router,type IRouter,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {getSessionUser} from '../lib/signal-auth';
import {ReviewError} from '../lib/assessment-review';
import {codeRunnerEnabled} from '../lib/code-runner';
import {cancelCodePractice,issueCodePractice,listCodePractice,publicCodePractice,readCodePractice,retryCodePractice,submitCodePractice} from '../lib/code-practice';
const router:IRouter=Router(),Id=z.string().uuid(),Revision=z.object({revision:z.number().int().positive()}).strict();
function handle(fn:(req:Request,res:Response,userId:number)=>Promise<void>,gate=true){return async(req:Request,res:Response,next:NextFunction)=>{try{const s=await getSessionUser(req);if(!s)throw new ReviewError(401,'AUTH_REQUIRED','Войдите в аккаунт.');if(s.user.role!=='candidate')throw new ReviewError(403,'CANDIDATE_REQUIRED','Практика доступна кандидату.');res.setHeader('Cache-Control','no-store, private');if(gate&&!codeRunnerEnabled())throw new ReviewError(503,'CODE_RUNNER_DISABLED','Исполнение программ пока доступно только в проверенной экспериментальной среде.');await fn(req,res,s.user.id);}catch(e){if(e instanceof ReviewError)res.status(e.status).json({error:e.message,code:e.code});else if(e instanceof z.ZodError)res.status(400).json({error:'Проверьте код, номер проверки и версию.'});else next(e);}};}
router.get('/me/code-practice/config',handle(async(_req,res)=>{res.json({enabled:codeRunnerEnabled(),languages:['Python 3.11.14'],experimental:true,qualificationGranted:false});},false));
router.get('/me/code-practice',handle(async(_req,res,userId)=>{res.json({items:(await listCodePractice(userId)).map(publicCodePractice)});},false));
router.post('/me/code-practice',handle(async(req,res,userId)=>{const input=z.object({id:Id,acceptExperimental:z.literal(true)}).strict().parse(req.body);res.status(201).json(publicCodePractice(await issueCodePractice(userId,input.id)));}));
router.get('/me/code-practice/:id',handle(async(req,res,userId)=>{res.json(publicCodePractice(await readCodePractice(userId,Id.parse(req.params.id))));},false));
router.post('/me/code-practice/:id/submit',handle(async(req,res,userId)=>{const input=z.object({revision:z.number().int().positive(),source:z.string().min(1).max(32768).refine(v=>Buffer.byteLength(v)<=32768)}).strict().parse(req.body);res.json(publicCodePractice(await submitCodePractice(userId,Id.parse(req.params.id),input)));}));
router.post('/me/code-practice/:id/retry',handle(async(req,res,userId)=>{res.json(publicCodePractice(await retryCodePractice(userId,Id.parse(req.params.id),Revision.parse(req.body).revision)));}));
router.post('/me/code-practice/:id/cancel',handle(async(req,res,userId)=>{res.json(publicCodePractice(await cancelCodePractice(userId,Id.parse(req.params.id),Revision.parse(req.body).revision)));},false));
export default router;
