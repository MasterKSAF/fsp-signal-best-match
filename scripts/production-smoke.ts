import assert from 'node:assert/strict';
process.env.NODE_ENV = 'production';
process.env.DEMO_MODE = 'false';
process.env.PUBLIC_URL = 'http://127.0.0.1:4313';
const {default:app} = await import('../artifacts/api-server/src/app.ts');
const {pool} = await import('../lib/db/src/index.ts');
const server = app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
try {
  const disabledDemo = await fetch(`${origin}/api/auth/demo-session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employer'})});
  assert.equal(disabledDemo.status,404);
  const demoSummary = await fetch(`${origin}/api/public/demo-summary`);
  assert.equal(demoSummary.status,404);
  const forged = await fetch(`${origin}/api/me`,{headers:{'x-user-id':'1'}});
  assert.equal(forged.status,401);
  const hostileOrigin = await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{Origin:'https://outside.invalid','Content-Type':'application/json'},body:JSON.stringify({email:'nobody@example.test',password:'unimportant'})});
  assert.equal(hostileOrigin.status,403);
  console.log('PASS production: demo disabled, forged identity rejected, browser origin enforced.');
} finally {
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await pool.end();
}
