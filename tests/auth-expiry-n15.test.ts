import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '../artifacts/fsp-signal/node_modules/@tanstack/react-query/build/modern/index.js';
import { captureAuthQuerySession, currentAuthUser, expireRejectedAuthQuery, isAuthQuerySessionCurrent, isAuthSessionRejected, replaceAuthQueryCache } from '../artifacts/fsp-signal/src/lib/auth-query-cache';

const key = ['/api/me'] as const;
const account = (id:number) => ({user:{id,role:'candidate'}});
const fail = (status?:number) => Object.assign(new Error(status ? `HTTP ${status}` : 'Network offline'), status ? {status} : {});
async function rejected(client:QueryClient,error:Error) {
  await assert.rejects(client.fetchQuery({queryKey:key,queryFn:async()=>{throw error;},retry:false}),error);
}

test('real React Query 401/403 retained data is hidden immediately and clears only the expired account cache', async () => {
  for (const status of [401,403]) {
    const client = new QueryClient();
    client.setQueryData(key,account(7));
    client.setQueryData(['candidate-resumes',7],{resumes:[{id:81}]});
    const captured=captureAuthQuerySession(client,key,7,'candidate')!;
    const observer=new QueryObserver(client,{queryKey:key,enabled:false});
    const stop=observer.subscribe(()=>{});
    let release!:(value:unknown)=>void;
    const pending=client.fetchQuery({queryKey:['private-history',7],queryFn:()=>new Promise(resolve=>{release=resolve;})}).catch(()=> 'cancelled');
    const error=fail(status);await rejected(client,error);
    assert.deepEqual(client.getQueryData(key),account(7),'this reproduces the previous stale-data condition');
    assert.equal(currentAuthUser(account(7),error),undefined,'protected route and /auth redirect must not trust rejected data');
    assert.equal(await expireRejectedAuthQuery(client,key,error),true);
    assert.equal(observer.getCurrentResult().data,null,'mounted auth observer receives expiration');
    assert.equal(client.getQueryData(['candidate-resumes',7]),undefined);
    assert.equal(isAuthQuerySessionCurrent(client,key,captured),false,'old mutation callbacks are revoked');
    release({secret:'only an in-memory fixture'});assert.equal(await pending,'cancelled');
    assert.equal(client.getQueryData(['private-history',7]),undefined,'late private request cannot refill cleared data');
    stop();client.clear();
  }
});

test('offline, timeout and server failure do not turn a known session into logout', async () => {
  for(const error of [fail(),fail(408),fail(429),fail(500),fail(503)]) {
    const client=new QueryClient();client.setQueryData(key,account(7));client.setQueryData(['candidate-resumes',7],{id:81});
    await rejected(client,error);
    assert.equal(isAuthSessionRejected(error),false);
    assert.deepEqual(currentAuthUser(account(7),error),account(7).user);
    assert.equal(await expireRejectedAuthQuery(client,key,error),false);
    assert.deepEqual(client.getQueryData(key),account(7));assert.deepEqual(client.getQueryData(['candidate-resumes',7]),{id:81});client.clear();
  }
});

test('new login wins while expiration waits for query cancellation; an old error cannot clear the next account', async () => {
  const client=new QueryClient();client.setQueryData(key,account(7));
  const error=fail(401);await rejected(client,error);
  const cancel=client.cancelQueries.bind(client);let release!:()=>void;let calls=0;
  client.cancelQueries=async(...args:Parameters<typeof client.cancelQueries>)=>{await cancel(...args);if(++calls===1)await new Promise<void>(resolve=>{release=resolve;});};
  const expiry=expireRejectedAuthQuery(client,key,error);
  // Let the first cancellation reach its deliberate, deterministic pause.
  await new Promise<void>(resolve=>setImmediate(resolve));
  await replaceAuthQueryCache(client,key,account(8));client.setQueryData(['candidate-resumes',8],{id:92});
  release();assert.equal(await expiry,false);
  assert.deepEqual(client.getQueryData(key),account(8));assert.deepEqual(client.getQueryData(['candidate-resumes',8]),{id:92});
  assert.equal(await expireRejectedAuthQuery(client,key,error),false,'old error identity is no longer current');client.clear();
});

test('anonymous rejected session settles without repeated cache replacement or mount/refetch loops', async () => {
  const client=new QueryClient();client.setQueryDefaults(key,{retry:false,retryOnMount:false});
  let requests=0;const error=fail(401),queryFn=async()=>{requests++;throw error;};
  for(let mount=0;mount<15;mount++) {
    const observer=new QueryObserver(client,{queryKey:key,queryFn});const stop=observer.subscribe(()=>{});
    await client.getQueryCache().find({queryKey:key})?.promise?.catch(()=>{});
    assert.equal(await expireRejectedAuthQuery(client,key,error),false,'no previous user data needs expiration');
    assert.equal(observer.getCurrentResult().isLoading,false);assert.equal(requests,1);stop();
  }
  client.clear();
});
