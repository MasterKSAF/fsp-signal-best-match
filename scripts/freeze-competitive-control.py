"""One-time synthetic authoring, never imports matcher, score or oracle code.

The relevance columns below are editorial judgements, not computed labels.
After freezing, do not regenerate or tune this control against its results.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
AT = datetime(2026, 10, 6, 0, 0, tzinfo=timezone.utc)
VERSION = "signal-competitive-control-v1-2026-10-06"
dest = ROOT / "artifacts/api-server/src/lib/matching-competitive-data.json"
manifest = ROOT / "outputs/quality/matching-competitive-freeze.json"
if dest.exists() or manifest.exists():
    raise SystemExit("Already frozen: refusing to overwrite the independent control")

# Each authored row: observed successful result, desired-skill count, working
# context, age-days, confirmed FSP, explicit relevance, origin/version/grade.
# No function translates matcher score, ordering or oracle outputs into labels.
scenarios = [
    ("dev-platform-api", "development", "Middle", "Backend / Python", ["PYTHON", "API-контракты"], ["Idempotency", "Architecture"], "Удалённо", [
        (83,2,True,5,False,1,"current",None), (100,2,True,5,False,4,"current",None),
        (91,2,True,5,False,3,"current",None), (86,2,True,5,False,2,"current",None),
        (98,2,True,5,False,4,"current",None), (84,2,True,5,False,1,"current",None),
        (93,2,True,5,False,3,"current",None), (90,2,True,5,False,2,"current",None),
        (96,2,True,5,False,3,"current",None), (88,1,True,5,False,2,"current",None),
        (85,2,True,170,False,1,"current",None), (95,2,True,5,True,4,"current",None),
        (100,1,False,120,False,2,"current","Senior"), (100,2,True,5,True,2,"missing",None),
    ]),
    ("dev-accessible-ui", "development", "Junior", "Frontend / TypeScript", ["ts", "a11y"], ["Frontend state", "Async UI"], "Гибрид", [
        (68,2,True,10,False,1,"current",None), (97,2,True,10,False,4,"current",None),
        (82,1,True,20,False,2,"current",None), (91,2,True,10,False,3,"current",None),
        (99,2,True,10,True,4,"current",None), (70,2,True,10,False,1,"current",None),
        (88,2,True,10,False,2,"current",None), (95,2,True,10,False,3,"current",None),
        (95,2,True,10,False,3,"current",None), (90,1,False,170,False,1,"current",None),
        (100,2,True,10,False,3,"current","Middle"), (98,1,True,90,False,2,"missing",None),
    ]),
    ("dev-service-recovery", "development", "Senior", "Backend / Python", ["Python", "Диагностика инцидента"], ["Replay safety", "Architecture"], "Гибрид", [
        (84,2,True,7,False,1,"current",None), (99,2,True,7,False,4,"current",None),
        (90,2,True,7,False,2,"current",None), (97,2,True,7,True,4,"current",None),
        (85,2,True,7,False,1,"current",None), (94,2,True,7,False,3,"current",None),
        (96,2,True,7,False,3,"current",None), (88,1,True,7,False,2,"current",None),
        (91,2,False,7,False,2,"current",None), (100,2,False,175,False,2,"current",None),
        (93,2,True,7,False,3,"current",None), (97,2,True,7,True,2,"previous",None),
    ]),
    ("heldout-ledger-data", "control-holdout", "Middle", "Backend / Python", ["py", "SQL"], ["Postgres", "Idempotency"], "Удалённо", [
        (84,2,True,2,False,1,"current",None), (92,2,True,2,False,3,"current",None),
        (100,2,True,2,False,4,"current",None), (86,2,True,2,False,2,"current",None),
        (96,2,True,2,False,3,"current",None), (83,2,True,2,False,1,"current",None),
        (98,2,True,2,False,4,"current",None), (89,2,True,2,False,2,"current",None),
        (95,2,True,2,True,4,"current",None), (94,2,True,2,False,3,"current",None),
        (94,2,True,2,False,3,"current",None), (97,1,True,2,False,3,"current",None),
        (88,1,False,160,False,1,"current",None), (100,2,True,2,False,4,"current","Senior"),
        (91,2,True,2,True,2,"previous",None), (99,2,True,2,True,2,"missing",None),
    ]),
    ("heldout-ui-performance", "control-holdout", "Middle", "Frontend / TypeScript", ["TypeScript", "Производительность интерфейса"], ["Frontend architecture", "Async UI"], "Удалённо", [
        (85,2,True,14,False,1,"current",None), (98,2,True,14,True,4,"current",None),
        (91,2,True,14,False,3,"current",None), (100,2,True,14,False,4,"current",None),
        (84,2,True,14,False,1,"current",None), (95,2,True,14,False,3,"current",None),
        (89,2,True,14,False,2,"current",None), (96,2,True,14,False,3,"current",None),
        (87,1,True,14,False,2,"current",None), (93,2,True,14,False,3,"current",None),
        (99,1,False,14,False,2,"current",None), (100,2,True,14,False,2,"current","Senior"),
        (97,2,True,160,False,2,"missing",None), (99,2,True,14,False,3,"previous",None),
    ]),
    ("heldout-qstore-import", "control-holdout", "Junior", "Backend / Python", ["Python", "Q-Store"], ["SQL", "API contracts"], "Офис", [
        (70,2,True,30,False,1,"current",None), (94,2,True,30,False,3,"current",None),
        (100,2,True,30,False,4,"current",None), (78,2,True,30,False,1,"current",None),
        (92,2,True,30,True,4,"current",None), (88,2,True,30,False,2,"current",None),
        (97,2,True,30,False,3,"current",None), (91,1,True,30,False,2,"current",None),
        (96,2,True,30,False,3,"current",None), (99,2,False,150,False,2,"current",None),
        (98,2,True,30,False,3,"current","Middle"), (96,2,True,30,True,2,"missing",None),
    ]),
]

rubric = {
    "version": "signal-competitive-rubric-v1",
    "provenance": "AI-authored synthetic business judgements; no human expert or participant",
    "eligibility": "Same chosen pool, visible, explicit matching consent, exact specialization, category at least the role minimum, every mandatory skill evidenced by a current or honest historical record. No inferred framework/database equivalence. A revoked-only category cannot establish eligibility.",
    "privacy": "Hidden, non-consenting and cross-pool profiles cannot be disclosed even when technically strong.",
    "relevance": {
        "0": "Ineligible or no meaningful fit; excluded candidates never count as relevant.",
        "1": "Only minimum plausible fit: fragile same-category result or substantial contextual/staleness limitations.",
        "2": "Useful but limited: moderate same-category evidence, missing desired criterion, uncertain historical quality or contextual cost.",
        "3": "Strong substantive role fit with convincing comparable evidence and at most a bounded limitation.",
        "4": "Exceptional role-specific evidence: very strong current comparable result plus all desired criteria and suitable working conditions, or strong complementary verified FSP.",
    },
    "judgementRules": [
        "Labels are explicit row judgements, not a weighted matcher score or a numeric threshold-to-label conversion. Same observed result can have different relevance for different role/context/provenance.",
        "Within the same grade/version/rubric, stronger successful answers can support stronger confidence. Results across grades/versions are never normalized onto a common test scale.",
        "An advanced category may provide substantive value for the role; the production technical group priority is intentionally not assumed by the relevance rubric.",
        "Missing FSP creates no adverse inference. Confirmed FSP can corroborate relevant work, but cannot replace a required skill.",
        "Full mandatory coverage is admission, desired coverage affects substantive relevance. Salary and work format are context, not an admission gate.",
        "Historical records remain honestly eligible where category/skills are preserved but their unknown comparable quality must not be invented.",
        "No numeric weights were selected by looking at measured matcher output. A proposed policy was received from the implementation agent before final serialization; labels were drafted separately and do not adopt its technical group priority.",
    ],
    "metrics": {"k": 5, "relevantAtLeast": 2, "ndcgGain": "2^relevance - 1", "shortPrecisionDenominator": 5, "emptyNdcg": None},
    "holdout": "Scenario-level control-holdout authored before ranking implementation/evaluation; synthetic construct check, not statistical unseen-market or independent-human holdout. It becomes consumed when the final report is viewed; no tuning from it is authorized.",
}

records = []
queries = []
counter = 6100

def record(need, observed, desired, context, age, fsp, origin="current", grade=None, note="", alias_index=0):
    global counter
    counter += 1
    grade = grade or need["grade"]
    program = "backend-python" if need["specialization"].startswith("Backend") else "frontend-typescript"
    version = "signal-backend-python-v5" if program == "backend-python" else "signal-frontend-typescript-v1"
    if origin == "previous":
        version = "kalibr-backend-python-v4" if program == "backend-python" else "historical-frontend-v0"
    at = (AT - timedelta(days=age)).isoformat().replace("+00:00", "Z")
    skills = need["requiredSkills"] + need["desirableSkills"][:desired]
    # A distinct alias scramble makes rounded-score ties substantive; IDs are
    # registration order, not relevance. Do not special-case them in production.
    alias = ["Ясный", "Кедр", "Маяк", "Атлас", "Феникс", "Бриз", "Орион", "Лотос", "Зенит", "Сфера", "Вектор", "Комета", "Лира", "Ритм", "Парус", "Точка"][alias_index % 16]
    profile = {
        "userId": counter, "alias": f"{alias} {counter}", "specialization": need["specialization"],
        "verifiedGrade": grade, "verifiedScore": observed, "verifiedSkills": skills,
        "stack": [need["requiredSkills"][0]],
        "statedSkills": need["requiredSkills"] + need["desirableSkills"] if observed < 90 else [need["requiredSkills"][0]],
        "workFormat": need["workFormat"] if context else ("Офис" if need["workFormat"] != "Офис" else "Удалённо"),
        "salaryMin": 180000, "salaryMax": 280000, "salaryPeriod": "month", "salaryType": "gross",
        "latestAssessmentAt": at, "hasFspHistory": fsp, "visibility": "pseudonymous", "consentMatching": True, "demoMode": True,
    }
    assessment = None if origin == "missing" else {
        "attemptId": counter + 10000, "candidateId": counter, "programId": program, "programVersion": version,
        "grade": grade, "score": observed, "submittedAt": at, "state": "verified",
        "comparisonPolicy": "same-program-version-rubric-v1", "rubricKey": f"synthetic-six-criterion-{program}-{grade}-v1",
        "form": "A" if counter % 2 else "B", "origin": "synthetic authored successful-attempt record; not a real participant",
    }
    records.append({"profile": profile, "assessment": assessment, "annotation": note})
    return counter

for scenario_id, split, grade, specialization, required, desired, work, rows in scenarios:
    need = {"specialization": specialization, "grade": grade, "requiredSkills": required, "desirableSkills": desired, "workFormat": work, "salaryMin": 180000, "salaryMax": 300000, "salaryPeriod": "month", "salaryType": "gross"}
    population, eligible, labels, reasons = [], [], {}, {}
    for i, (score, cover, context, age, fsp, relevance, origin, category) in enumerate(rows):
        why = f"Authored relevance {relevance}: desired criteria {cover}/{len(desired)}, working context {'fits' if context else 'differs'}, evidence {age} days old, source {origin}, FSP {'confirmed synthetic record' if fsp else 'absent without penalty'}; observed {score} belongs only to {category or grade}/{specialization}."
        cid = record(need, score, cover, context, age, fsp, origin, category, why, i)
        population.append(cid); eligible.append(cid); labels[str(cid)] = relevance; reasons[str(cid)] = why
    # Explicitly authored inadmissible controls, labels do not call the matcher.
    for kind in ["private", "consent", "pool", "unverified", "missing-mandatory", "wrong-specialization"]:
        cid = record(need, 100, 2, True, 1, True, alias_index=len(population))
        item = records[-1]
        profile = item["profile"]
        if kind == "private": profile["visibility"] = "private"
        if kind == "consent": profile["consentMatching"] = False
        if kind == "pool": profile["demoMode"] = False
        if kind == "unverified": profile["verifiedGrade"] = None; item["assessment"] = None
        if kind == "missing-mandatory": profile["verifiedSkills"] = desired; profile["statedSkills"] = required + desired
        if kind == "wrong-specialization": profile["specialization"] = "Frontend / TypeScript" if specialization.startswith("Backend") else "Backend / Python"
        population.append(cid); labels[str(cid)] = 0; reasons[str(cid)] = f"Independent admission label: {kind} disqualifies regardless of score100/FSP."
    visible = [cid for cid in population if cid not in population[-6:-3]]
    queries.append({"id": scenario_id, "split": split, "kind": "competitive", "purpose": scenario_id.replace("-", " "), "need": need, "populationIds": population, "expectedEligibleIds": eligible, "privacyPermittedIds": visible, "relevanceLabels": labels, "labelReasons": reasons})

for scenario_id, split, required, count, grades, labels_list in [
    ("dev-short-postgres", "development", ["Python", "Postgres"], 4, ["Middle"]*4, [3,2,1,2]),
    ("heldout-short-framework", "control-holdout", ["Python", "FastAPI"], 3, ["Middle"]*3, [3,2,1]),
]:
    need = {"specialization": "Backend / Python", "grade": "Middle", "requiredSkills": required, "desirableSkills": ["SQL"], "workFormat": "Удалённо", "salaryMin": 180000, "salaryMax": 300000, "salaryPeriod": "month", "salaryType": "gross"}
    ids, labels, reasons = [], {}, {}
    for i in range(count):
        cid = record(need, [95,87,84,91][i], 1 if i<2 else 0, True, [3,30,175,60][i], False, "missing" if i==count-1 else "current", grades[i], alias_index=i)
        ids.append(cid); labels[str(cid)] = labels_list[i]; reasons[str(cid)] = "Short pool independent substantive label; absence of extra people is not rank success."
    queries.append({"id": scenario_id, "split": split, "kind": "short", "purpose": "Short admissible pool with separately evidenced technology", "need": need, "populationIds": ids, "expectedEligibleIds": ids, "privacyPermittedIds": ids, "relevanceLabels": labels, "labelReasons": reasons})

need = {"specialization": "Backend / Python", "grade": "Senior", "requiredSkills": ["Python", "Rust"], "desirableSkills": ["SQL"], "workFormat": "Удалённо", "salaryMin": 180000, "salaryMax": 300000, "salaryPeriod": "month", "salaryType": "gross"}
ids, visible, labels, reasons = [], [], {}, {}
for i in range(5):
    cid = record(need, 100, 1, True, 1, True, alias_index=i)
    records[-1]["profile"]["verifiedSkills"] = ["Python", "SQL"]
    if i == 3: records[-1]["profile"]["visibility"] = "private"
    elif i == 4: records[-1]["profile"]["consentMatching"] = False
    else: visible.append(cid)
    ids.append(cid); labels[str(cid)] = 0; reasons[str(cid)] = "No explicit Rust evidence; keywords and score100 must not create a witness."
queries.append({"id": "heldout-empty-rust", "split": "control-holdout", "kind": "empty", "purpose": "Correct empty role, no relaxation of Rust", "need": need, "populationIds": ids, "expectedEligibleIds": [], "privacyPermittedIds": visible, "relevanceLabels": labels, "labelReasons": reasons})

payload = {"version": VERSION, "evaluatedAt": AT.isoformat().replace("+00:00", "Z"), "rubric": rubric, "candidates": records, "queries": queries}
raw = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(raw)
canonical = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
sha = lambda value: hashlib.sha256(value).hexdigest()
freeze = {
    "version": VERSION, "frozenAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "dataFile": str(dest.relative_to(ROOT)).replace("\\", "/"), "fileSha256": sha(raw),
    "canonicalDataSha256": sha(canonical(payload)), "rubricSha256": sha(canonical(rubric)),
    "labelsSha256": sha(canonical([{k:q[k] for k in ["id", "expectedEligibleIds", "privacyPermittedIds", "relevanceLabels", "labelReasons"]} for q in queries])),
    "splitSha256": sha(canonical([{k:q[k] for k in ["id", "split", "kind", "populationIds"]} for q in queries])),
    "oldMatcherSha256": sha((ROOT/"artifacts/api-server/src/lib/matching-v3-frozen.ts").read_bytes()),
    "queries": len(queries), "profiles": len(records), "pairs": sum(len(q["populationIds"]) for q in queries),
    "competitivePools": [{"id":q["id"], "split":q["split"], "eligible":len(q["expectedEligibleIds"])} for q in queries if q["kind"] == "competitive"],
    "source": rubric["provenance"], "labelDerivation": "Explicit authored arrays, no production matcher/oracle call; AI assistance is not human expertise.",
    "firstEvaluation": "not_run", "tuningAllowed": False,
}
manifest.parent.mkdir(parents=True, exist_ok=True); manifest.write_text(json.dumps(freeze, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print(json.dumps(freeze, ensure_ascii=False, indent=2))
