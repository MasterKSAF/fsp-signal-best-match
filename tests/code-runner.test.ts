import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {resolveCodeImage,runCodeTest} from '../artifacts/api-server/src/lib/code-runner';
test('actual pinned Python sandbox checks behavior and bounds hostile code',async()=>{
 const imageDigest=await resolveCodeImage();assert.ok(imageDigest,'Build the dedicated QA image first');
 const run=(source:string,input:unknown=[],expected:unknown=[])=>runCodeTest({attemptId:randomUUID(),fence:1,index:0,source,test:{input,expected,public:false},imageDigest});
 assert.equal((await run("import json,sys\na=json.load(sys.stdin)\nprint(json.dumps(list(dict.fromkeys(a))))",[2,1,2,-1,1],[2,1,-1])).status,'passed');
 assert.equal((await run("import json,sys\nprint(json.dumps(sorted(set(json.load(sys.stdin)))))",[2,1,2],[2,1])).status,'wrong_answer');
 assert.equal((await run('for :')).status,'compile_error');assert.equal((await run("raise RuntimeError('own-code')")).status,'runtime_error');
 assert.equal((await run('while True: pass')).status,'time_limit');assert.equal((await run('a=bytearray(512*1024*1024)')).status,'memory_limit');
 const noisy=await run("print('x'*100000)");assert.equal(noisy.status,'runtime_error');assert.equal(noisy.reason,'output_limit');
 const forked=await run("import os,time\nfor _ in range(100):\n p=os.fork()\n if p==0: time.sleep(100)\nprint('[]')");assert.ok(['runtime_error','time_limit'].includes(forked.status),JSON.stringify(forked));
});
test('actual sandbox denies egress, root writes, privilege and inherited secrets; runs do not share /tmp',async()=>{
 const imageDigest=await resolveCodeImage();assert.ok(imageDigest);process.env.SIGNAL_RUNNER_SENTINEL='host-only-not-forwarded';
 const source=`import os,json,socket\nr={'uid':os.getuid(),'secret':bool(os.getenv('SIGNAL_RUNNER_SENTINEL')),'socket':os.path.exists('/var/run/docker.sock')}\ntry:\n open('/outside-runner','w').write('x');r['rootWrite']=True\nexcept OSError:r['rootWrite']=False\ntry:\n os.setuid(0);r['root']=True\nexcept OSError:r['root']=False\nfor name,host in [('egress','1.1.1.1'),('metadata','169.254.169.254')]:\n s=socket.socket();s.settimeout(.3)\n try:s.connect((host,80));r[name]=True\n except OSError:r[name]=False\n finally:s.close()\ntry:socket.getaddrinfo('example.com',443);r['dns']=True\nexcept OSError:r['dns']=False\nprint(json.dumps(r))`;
 const expected={uid:65532,secret:false,socket:false,rootWrite:false,root:false,egress:false,metadata:false,dns:false};
 assert.equal((await runCodeTest({attemptId:randomUUID(),fence:1,index:0,source,test:{input:[],expected,public:false},imageDigest})).status,'passed');
 const first=await runCodeTest({attemptId:randomUUID(),fence:1,index:0,source:"open('/tmp/cross-attempt-marker','w').write('private')\nprint('true')",test:{input:[],expected:true,public:false},imageDigest});assert.equal(first.status,'passed');
 const second=await runCodeTest({attemptId:randomUUID(),fence:1,index:0,source:"import os,json\nprint(json.dumps(os.path.exists('/tmp/cross-attempt-marker')))",test:{input:[],expected:false,public:false},imageDigest});assert.equal(second.status,'passed');
 delete process.env.SIGNAL_RUNNER_SENTINEL;
});
