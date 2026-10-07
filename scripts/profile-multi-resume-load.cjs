/** Owned dedicated-stand diagnostic only; never claims acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = process.cwd();
async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'outputs/local-backup/multi-resume-load-stand/stand.json'), 'utf8'));
  assert.equal(manifest.owner, 'resume_catalog'); assert.equal(manifest.database, 'signal_resume_load_check'); assert.equal(manifest.apiPort, 4315);
  const pwsh = 'C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe';
  const inspectPid = Number(execFileSync(pwsh, ['-NoLogo','-NoProfile','-Command', 'Get-NetTCPConnection -LocalPort 9235 -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess'], { encoding: 'utf8' }).trim());
  assert.equal(inspectPid, manifest.pid, 'Inspector must belong to the exact owned API');
  const targets = await (await fetch('http://127.0.0.1:9235/json/list')).json();
  assert.equal(targets.length, 1); assert.ok(targets[0].webSocketDebuggerUrl.startsWith('ws://127.0.0.1:9235/'));
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl), pending = new Map(); let serial = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => { const row = JSON.parse(String(event.data)), waiter = pending.get(row.id); if (waiter) { pending.delete(row.id); row.error ? waiter.reject(new Error(row.error.message)) : waiter.resolve(row.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const beforeRead=await send('Runtime.evaluate',{expression:"globalThis[Symbol.for('signal.load.cacheDiagnostics')]?.map(cache=>cache.diagnostics())",returnByValue:true});
  const cacheDiagnosticsBefore=beforeRead.result?.value??[];
  await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 1000 }); await send('Profiler.start');
  const child = spawn(process.execPath, ['scripts/run-multi-resume-load.cjs', '--diagnostic', ...(process.argv.includes('--both') ? [] : ['--baseline-only'])], { cwd: root, stdio: 'inherit', windowsHide: true });
  const exitCode = await new Promise(resolve => child.once('exit', resolve));
  const { profile } = await send('Profiler.stop'); await send('Profiler.disable');
  const cacheRead=await send('Runtime.evaluate',{expression:"globalThis[Symbol.for('signal.load.cacheDiagnostics')]?.map(cache=>cache.diagnostics())",returnByValue:true});
  const cacheDiagnostics=cacheRead.result?.value??[];socket.close();
  const out = path.join(root, 'outputs/verification/multi-resume'), prefix = `cpu-${manifest.buildId}`;
  fs.writeFileSync(path.join(out, `${prefix}.cpuprofile`), JSON.stringify(profile));
  const nodes = new Map(profile.nodes.map(row => [row.id, row])); const times = new Map();
  for (let n = 0; n < profile.samples.length; n++) { const node = nodes.get(profile.samples[n]); const key = JSON.stringify(node.callFrame); times.set(key, (times.get(key) ?? 0) + profile.timeDeltas[n]); }
  const report = { mode: 'diagnostic-not-acceptance', apiPid: manifest.pid, buildId: manifest.buildId, apiSha256: manifest.apiSha256, exitCode, cacheDiagnosticsBefore, cacheDiagnostics, samples: profile.samples.length, elapsedSeconds: (profile.endTime - profile.startTime) / 1e6, functions: [...times].sort((a,b) => b[1]-a[1]).slice(0,100).map(([key, micros]) => ({ ...JSON.parse(key), selfMilliseconds: micros/1000 })) };
  fs.writeFileSync(path.join(out, `${prefix}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ buildId: manifest.buildId, cacheDiagnostics, top: report.functions.slice(0,20) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
