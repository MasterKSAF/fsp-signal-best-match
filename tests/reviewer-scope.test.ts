import assert from "node:assert/strict";
import test from "node:test";
import { pgTable, text, boolean, PgDialect } from "../lib/db/node_modules/drizzle-orm/pg-core/index.js";
import { isOverviewDemo, poolScopeForAccount, sameSignalPool, signalPoolPredicate } from "../artifacts/api-server/src/lib/signal-pool-scope.ts";
import { assertLocalReviewerTarget, assertPrivateReviewerPath } from "../scripts/reviewer-local-guards.ts";
const a={demoMode:true,reviewScopeId:"7f4c451a-6421-4809-88a3-9150810c349d"},b={demoMode:true,reviewScopeId:"9cd7a9f1-3110-4f98-b86e-d8bed9b220fb"};
test("reviewers, common Demo and ordinary users are three separate server scopes",()=> {
  assert.equal(sameSignalPool(a,a),true);
  for(const right of [b,{demoMode:true,reviewScopeId:null},{demoMode:false,reviewScopeId:null}]) assert.equal(sameSignalPool(a,right),false);
  assert.equal(isOverviewDemo(a),false); assert.equal(isOverviewDemo({demoMode:true}),true); assert.equal(isOverviewDemo({demoMode:false}),false);
  assert.deepEqual(poolScopeForAccount(true),{demoMode:true,reviewScopeId:null});
});
test("ordinary accounts cannot acquire reviewer scope and invalid persisted identifiers fail closed",()=> {
  for(const scope of [{...a,demoMode:false},{...a,reviewScopeId:""},{...a,reviewScopeId:"arbitrary-header-value"}]) assert.throws(()=>poolScopeForAccount(scope),/Invalid persisted/);
});
test("SQL predicates bind exact persisted scope and null common pools, including aliases",()=> {
  const users=pgTable("scope_subject",{demoMode:boolean("demo_mode"),reviewScopeId:text("review_scope_id")});
  const dialect=new PgDialect(); const exact=dialect.sqlToQuery(signalPoolPredicate(users,a));
  assert.match(exact.sql,/review_scope_id.*= \$2/);assert.deepEqual(exact.params,[true,a.reviewScopeId]);
  const common=dialect.sqlToQuery(signalPoolPredicate(users,true));assert.match(common.sql,/review_scope_id.*is null/);assert.deepEqual(common.params,[true]);
});
test("provision guards reject public/nonlocal/main targets and require explicit profile",()=> {
  const env={DEMO_MODE:"true",SIGNAL_REVIEWER_PROFILE:"isolated-local-review"};
  assertLocalReviewerTarget("postgresql://local:fixture@127.0.0.1:55435/signal_resume_stage","http://127.0.0.1:4314","signal_resume_stage",env);
  for(const [db,origin,name,flags] of [["postgresql://x:y@127.0.0.1:55433/signal_resume_stage","http://127.0.0.1:4314","signal_resume_stage",env],["postgresql://x:y@public.example:55435/signal_resume_stage","http://127.0.0.1:4314","signal_resume_stage",env],["postgresql://x:y@127.0.0.1:55435/signal","http://127.0.0.1:4314","signal",env],["postgresql://x:y@127.0.0.1:55435/signal_resume_stage","https://public.example","signal_resume_stage",env],["postgresql://x:y@127.0.0.1:55435/signal_resume_stage","http://127.0.0.1:4310","signal_resume_stage",env],["postgresql://x:y@127.0.0.1:55435/signal_resume_stage","http://127.0.0.1:4314","signal_resume_stage",{}]] as const) assert.throws(()=>assertLocalReviewerTarget(db,origin,name,flags));
});
test("credentials cannot be placed in packaged project and path must be absolute",()=> {
  const root=process.cwd();assert.throws(()=>assertPrivateReviewerPath("reviewers.json",root));
  assert.throws(()=>assertPrivateReviewerPath(`${root}/outputs/reviewers.json`,root));
  const outside=assertPrivateReviewerPath(`${root}/../private-reviewers.json`,root);assert.ok(outside.endsWith("private-reviewers.json"));
});
