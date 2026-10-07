"""Export a strict safe summary of independently produced local audit reports."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json
ROOT=Path(__file__).resolve().parents[1]
AUDIT=ROOT.parent/'docs/best-match/qa-cycle-2026-10-06'
IMAGE='sha256:55a5c92928c6f0f9d22e07ca6d991e32fa39602d86f2ee871cbe41d3f83c0120'
def load(relative):
    p=AUDIT/relative
    return json.loads(p.read_text(encoding='utf-8-sig')), hashlib.sha256(p.read_bytes()).hexdigest()
def groups(d):
    return [{'name':c.get('name',c.get('id')), 'passed':c.get('passed',c.get('status')=='pass')} for c in d['checks']]
m,ms=load('matching/matching-api-report-qa-match-6ff685acda.json')
a,as_=load('assessment/api-adversarial-report-after-runtime-55a5.json')
s,ss=load('api-security/report-69cc27a6.json')
assert m['before']['runtime']['image']==IMAGE and m['runtimeUnchanged'] and m['sourceUnchanged']
assert a['imageBefore']==a['imageAfter']==s['imageBefore']==s['imageAfter']==IMAGE
assert a['imageStable'] and not a['failures'] and a['cleanup']['remainingUsers']==0
assert s['passed'] and s['serverStable'] and s['cleanup']=='complete'
sections=[]
for name,d,digest,expected in [('matching',m,ms,20),('assessment',a,as_,17),('api-security',s,ss,23)]:
    checks=groups(d);assert len(checks)==expected and all(c['passed'] for c in checks)
    assert len({c['name'] for c in checks})==expected
    sections.append({'scope':name,'groups':expected,'checks':checks,'originalReportSha256':digest,'passed':True})
method,method_sha=load('assessment/method-acceptance-v4-report.json')
order,order_sha=load('matching/order-preflight-5132063b3585.json')
guard,guard_sha=load('assessment/python-definition-guard-v4-report.json')
http,http_sha=load('api-security/public-quality-http-runtime55a5.json')
arithmetic,arithmetic_sha=load('api-security/public-quality-independent-report.json')
assert method['passed'] and len(method['checks'])==24 and guard['guardCorrect']
assert len(order['checks'])==15 and all(c['status']=='pass' for c in order['checks'])
assert http['passed'] and http['serverStable'] and http['imageBefore']==http['imageAfter']==IMAGE
assert arithmetic['passed'] and not arithmetic['errors']
out={'schemaVersion':'signal-safe-independent-acceptance-v1','exportedAt':datetime.now(timezone.utc).isoformat(),'passed':True,'provenance':'Independent local technical audits produced in a separate audit chat. This whitelisted summary exports counts, check names and original report digests; it omits fixture identities, request/response bodies, credentials, answers and contact details. Original private reports are retained outside the public handoff; no external file is required to read this summary.','applicationVersion':'0.4.1','imageId':IMAGE,'apiBundleSha256':m['before']['runtime']['bundleSha256'],'matchingAlgorithmVersion':'fsp-signal-match-v5','matcherSha256':m['before']['runtime']['sourceHashes']['artifacts/api-server/src/lib/signal-matching.ts'],'acceptedIssues':['QA-01','QA-01b','QA-02','QA-02b','QA-03','QA-04','QA-05'],'uniqueBuiltRuntimeGroups':60,'groups':sections,'securityHttpRequests':len(s['requests']),'additionalChecks':{'order':{'checks':15,'passed':True,'originalReportSha256':order_sha},'transferModel':{'checks':24,'passed':True,'originalReportSha256':method_sha},'exactDefinitionGuard':{'passed':True,'originalReportSha256':guard_sha},'publicQualityHttp':{'passed':True,'originalReportSha256':http_sha},'publicQualityArithmetic':{'passed':True,'counts':arithmetic['counts'],'originalReportSha256':arithmetic_sha}},'fixturesCleaned':True,'limits':['Finite local synthetic/adversarial fixtures; not human assessment validation, usability research or a claim of security certification.','Historical reports and observed metric losses remain explicitly historical; the current model controls are used regression controls, not untouched final holdout.']}
p=ROOT/'outputs/verification/qa-cycle-02-independent-acceptance.json';p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':True,'runtimeGroups':60,'securityHttpRequests':184,'output':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
