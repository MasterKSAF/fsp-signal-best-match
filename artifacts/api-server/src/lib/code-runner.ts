import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
export type CodeStatus='passed'|'wrong_answer'|'compile_error'|'runtime_error'|'time_limit'|'memory_limit'|'infrastructure_error'|'cancelled';
export type CodeTest={input:unknown;expected:unknown;public:boolean};
export const CODE_TEST_VERSION='python-stable-unique-v1',CODE_RUNTIME='3.11.14';
const docker=()=>process.env.SIGNAL_DOCKER_BIN??'docker';
const image=()=>process.env.SIGNAL_CODE_RUNNER_IMAGE??'signal-code-runner:1';
export const codeRunnerEnabled=()=>process.env.SIGNAL_CODE_RUNNER_ENABLED==='true'&&process.env.NODE_ENV!=='production';
async function command(args:string[],input:string,timeout=8000,max=65536):Promise<{code:number|null;out:string;error:boolean;timedOut:boolean}>{
 return new Promise(resolve=>{const p=spawn(docker(),args,{stdio:['pipe','pipe','pipe'],windowsHide:true}),parts:string[]=[];let size=0,done=false,error=false,timedOut=false;
  const finish=(code:number|null)=>{if(done)return;done=true;clearTimeout(timer);resolve({code,out:parts.join(''),error,timedOut});};
  const timer=setTimeout(()=>{timedOut=true;p.kill();finish(null);},timeout);
  p.stdout.setEncoding('utf8');p.stdout.on('data',(v:string)=>{size+=Buffer.byteLength(v);if(size>max){error=true;p.kill();finish(null);}else parts.push(v);});
  p.stderr.on('data',()=>{});p.on('error',()=>{error=true;finish(null);});p.on('close',finish);p.stdin.on('error',()=>{});p.stdin.end(input);
 });
}
export async function resolveCodeImage(){const r=await command(['image','inspect','--format','{{.Id}}',image()],'');const id=r.out.trim();return r.code===0&&/^sha256:[a-f0-9]{64}$/.test(id)?id:null;}
export async function stopCodeContainer(name:string){if(!/^signal-code-[a-f0-9-]{36}-\d+-\d+$/.test(name))return;await command(['rm','-f',name],'',5000);}
export async function runCodeTest(input:{attemptId:string;fence:number;index:number;source:string;test:CodeTest;imageDigest:string}){
 const name=`signal-code-${input.attemptId}-${input.fence}-${input.index}`;
 const result=await command(['run','--rm','--pull=never','--name',name,'--network=none','--read-only','--memory=192m','--memory-swap=192m','--cpus=1','--pids-limit=16','--cap-drop=ALL','--security-opt=no-new-privileges','--user=65532:65532','--tmpfs=/tmp:rw,size=16m,noexec,nosuid,nodev','--ulimit=nofile=64:64','-i',input.imageDigest],JSON.stringify({attemptId:input.attemptId,language:'python',testVersion:CODE_TEST_VERSION,source:input.source,input:input.test.input}),6500,32768);
 if(result.timedOut){await stopCodeContainer(name);return {status:'infrastructure_error' as CodeStatus,reason:'worker_transport_timeout',runtimeVersion:CODE_RUNTIME};}
 if(result.error||result.code!==0){await stopCodeContainer(name);return {status:'infrastructure_error' as CodeStatus,reason:'sandbox_unavailable',runtimeVersion:CODE_RUNTIME};}
 try{const value=JSON.parse(result.out);if(value.runtimeVersion!==CODE_RUNTIME||value.runnerVersion!=='signal-python-runner-v1')return {status:'infrastructure_error' as CodeStatus,reason:'runtime_version_mismatch',runtimeVersion:String(value.runtimeVersion)};
  if(value.status!=='executed'){const supported:CodeStatus[]=['compile_error','runtime_error','time_limit','memory_limit','infrastructure_error'];return {status:supported.includes(value.status)?value.status as CodeStatus:'infrastructure_error' as CodeStatus,reason:String(value.reason??'execution_failed'),runtimeVersion:CODE_RUNTIME};}
  let output:unknown;try{output=JSON.parse(value.output);}catch{return {status:'wrong_answer' as CodeStatus,reason:'invalid_output',runtimeVersion:CODE_RUNTIME};}
  return {status:JSON.stringify(output)===JSON.stringify(input.test.expected)?'passed' as CodeStatus:'wrong_answer' as CodeStatus,reason:null,runtimeVersion:CODE_RUNTIME};
 }catch{return {status:'infrastructure_error' as CodeStatus,reason:'invalid_runner_response',runtimeVersion:CODE_RUNTIME};}
}
export function codePracticeTests(seed:string):CodeTest[]{
 const hash=createHash('sha256').update(seed).digest(),n=hash[0]!+10,m=-hash[1]!-1;
 const fixtures:unknown[][]=[[1,2,1,3,2],[],[n,m,n,0,m],['я','a','я','b','a'],[...Array.from({length:40},(_,i)=>(i*hash[2]!)%13),n,n],['1',1,'1',2,1]];
 return fixtures.map((input,i)=>({input,expected:[...new Set(input)],public:i<2}));
}
export const codePracticePrompt={title:'Уникальные значения без перестановки',language:'Python 3.11',description:'Программа читает из stdin одну строку JSON — массив целых чисел или строк. Выведите в stdout JSON-массив без повторов, сохраняя порядок первого появления. Число 1 и строка "1" различаются.',sampleInput:[1,2,1,3,2],sampleOutput:[1,2,3],durationMinutes:30};
