"""Create a NEW guarded fixture runner; never rewrite historical controls."""
from pathlib import Path
import hashlib, zipfile, json
root=Path(__file__).resolve().parents[1]
archive=root/'outputs/release-0.6.0/fsp-signal-source-0.6.0.zip'
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='9258a60cded242bc283847f4b2d1173220a010193db21e4ceecf334712c6792f'
frozen=root/'outputs/local-backup/independent-load-20261007/frozen-form-source'
frozen.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(archive) as z:
    for name in z.namelist():
        relative=name.removeprefix('fsp-signal/')
        if relative.startswith('artifacts/api-server/src/lib/') and relative.endswith('.ts'):
            target=frozen/relative;target.parent.mkdir(parents=True,exist_ok=True)
            data=z.read(name)
            if target.exists(): assert target.read_bytes()==data
            else: target.write_bytes(data)
source=(root/'scripts/multi-resume-load-stage-v060.ts').read_text(encoding='utf8')
def replace(old,new):
    global source
    assert source.count(old)==1,(old[:80],source.count(old))
    source=source.replace(old,new)
start=source.index('import {\n  assembleManagedAttempt,')
end=source.index('import { emptyResume }',start)
source=source[:start]+source[end:]
replace('import { validatedLoadTarget } from "./multi-resume-load-target-v060";\nimport { profileOwnedResumePool } from "./profile-multi-resume-pool-v060";\nconst target = validatedLoadTarget(process.env);','import { validatedIndependentLoadTarget } from "./independent-load-target-20261007";\nconst target = validatedIndependentLoadTarget(process.env);')
replace('prefix = `LOAD-${id}`','prefix = `INDEPENDENT-${id}`')
replace('const out = "outputs/verification/0.6.0/multi-resume",\n  privateManifest = "outputs/local-backup/multi-resume-load-v060-owned.json";\nconst runManifest = `outputs/local-backup/multi-resume-load-v060-owned-${target.key}-${id}.json`;','const out = "outputs/verification/independent-performance-20261007",\n  privateManifest = "outputs/local-backup/independent-load-20261007/owned-current.json";\nconst runManifest = `outputs/local-backup/independent-load-20261007/owned-${id}.json`;')
start=source.index('const forms = new Map<')
end=source.index('async function makeSession',start)
source=source[:start]+'''const frozenForms = JSON.parse(await readFile(process.env.SIGNAL_INDEPENDENT_FORMS_PATH!, 'utf8'));
const forms = new Map<string, any>(Object.entries(frozenForms.forms));
assert.equal(forms.size, 6);
const programSpecialization = (program: string) => program === 'backend-python' ? 'Backend / Python' : 'Frontend / TypeScript';
'''+source[end:]
replace('result = scoreAttempt(form.cases, form.oracles, answers);','result = form.result;')
replace('skills: verifiedSkillsForAttempt(\n          form.cases,\n          form.oracles,\n          result.evidence,\n        ),','skills: form.verifiedSkills,')
replace('assessmentBankVersion(row.form.cases, row.form.oracles)','row.form.programVersion')
source=source.replace('v060-multi-load-${id}','independent-perf-${id}')
replace('    assert.ok(\n      sourceFiles.every(\n        (file) => typeof frozen.sourceHashes[file] === "string",\n      ),\n    );\n    return frozen.sourceHashes;','    for (const [file, expected] of Object.entries(frozen.harnessSources)) assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"), expected);\n    assert.equal(createHash("sha256").update(await readFile(frozen.formsPath)).digest("hex"), frozen.formsSha256);\n    return { associatedApiSources: frozen.sourceHashes, harnessSources: frozen.harnessSources, formsSha256: frozen.formsSha256, apiSha256: frozen.apiSha256 };')
replace('  if (process.argv.includes(\'--profile-pool\')) {\n    assert.ok(diagnostic, \'Serial profiling never alters acceptance execution\');\n    await profileOwnedResumePool(\'baseline-one-resume\', id);\n  }','')
replace("  if (process.argv.includes('--profile-pool')) await profileOwnedResumePool('expanded-five-resumes', id);",'''  let profiler: any = null;
  if (process.argv.includes('--profile-expanded')) {
    assert.ok(diagnostic);
    const endpoint = await fetch('http://127.0.0.1:9249/json/list').then(r => r.json());
    assert.equal(endpoint.length, 1);
    const socket = new WebSocket(endpoint[0].webSocketDebuggerUrl);
    await new Promise<void>((resolve,reject) => {socket.addEventListener('open',()=>resolve(),{once:true});socket.addEventListener('error',()=>reject(new Error('Owned profiler unavailable')),{once:true});});
    let counter=0; const pending=new Map<number,{resolve:(v:any)=>void,reject:(v:any)=>void}>();
    socket.addEventListener('message', event => {const value=JSON.parse(String(event.data));const request=pending.get(value.id);if(request){pending.delete(value.id);value.error?request.reject(new Error('Profiler method failed')):request.resolve(value.result);}});
    const call=(method:string,params?:unknown)=>new Promise<any>((resolve,reject)=>{const n=++counter;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
    await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:1000});await call('Profiler.start');
    profiler={socket,call};
  }''')
replace('  const expanded = await phase("expanded-five-resumes");','''  const expanded = await phase("expanded-five-resumes");
  if (profiler) {
    const captured=await profiler.call('Profiler.stop');await profiler.call('Profiler.disable');profiler.socket.close();
    const rawPath=process.env.SIGNAL_INDEPENDENT_CPU_PROFILE_PATH!;assert.ok(rawPath && !rawPath.includes('outputs/submission'));
    await writeFile(rawPath,JSON.stringify(captured.profile));
    const profile=captured.profile,nodes=new Map(profile.nodes.map((node:any)=>[node.id,node]));const totals=new Map<number,number>();
    (profile.samples??[]).forEach((node:number,index:number)=>totals.set(node,(totals.get(node)??0)+(profile.timeDeltas?.[index]??1000)));
    const hotspots=[...totals].sort((a,b)=>b[1]-a[1]).slice(0,60).map(([node,microseconds])=>{const entry:any=nodes.get(node);return {function:entry.callFrame.functionName,file:entry.callFrame.url.split(/[\\\\/]/).at(-1),line:entry.callFrame.lineNumber+1,selfMs:Math.round(microseconds/10)/100};});
    await writeFile(`${out}/cpu-expanded-${id}.json`,JSON.stringify({diagnosticOnly:true,apiSha256:(await runtimeIdentity()).apiBundleSha256,rawProfileSha256:createHash('sha256').update(await readFile(rawPath)).digest('hex'),period:'expanded diagnostic phase only, after functional reads; seed and cleanup excluded',samples:profile.samples.length,hotspots},null,2));
  }''')
replace('readFile("scripts/multi-resume-load-stage-v060.ts")','readFile("scripts/independent-load-stage-20261007.ts")')
source=source.replace('"Controlled native-stage HTTP load, not production capacity or official FSP score"','"NEW isolated native HTTP performance control; same historical scenario, not production capacity or official SLA"')
# Cleanup must recheck exact fixture ownership, never trust an arbitrary saved ID.
replace('    for (let offset = 0; offset < ownedIds.length; offset += 100)\n      await db','    const actualOwned = ownedIds.length ? await db.select({id:users.id,email:users.email}).from(users).where(inArray(users.id,ownedIds)) : [];\n    assert.ok(actualOwned.every(row=>row.email.startsWith(`independent-perf-${id}-`) && row.email.endsWith("@example.test")), "Owned cleanup prefix must match every ID");\n    for (let offset = 0; offset < ownedIds.length; offset += 100)\n      await db')
(root/'scripts/independent-load-stage-20261007.ts').write_text(source,encoding='utf8',newline='\n')
print(json.dumps({'newFixtureCreated':True,'historicalScriptUnchanged':True,'frozenSourceDirectory':str(frozen)}))
