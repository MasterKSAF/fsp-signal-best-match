"""Evidence companion. Does not start services, mutate a database or package media."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8-sig"))


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def proof(path):
    return {"path": path, "sha256": sha(path)}


runtime = read("outputs/verification/qa-cycle-01-working-runtime.json")
isolated = read("outputs/verification/qa-cycle-01-isolated-runtime.json")
after = read("outputs/verification/qa-cycle-01-isolated-runtime-after.json")
ready = read("outputs/verification/qa-cycle-01-runtime-ready.json")
assert runtime["imageId"] == isolated["imageId"] == after["imageId"] == ready["imageId"]
assert runtime["bundleSHA"] == isolated["bundleSHA"] == after["bundleSHA"]
assert runtime["sourceHashes"] == isolated["sourceHashes"] == after["sourceHashes"]
assert read("outputs/verification/qa-cycle-01-preserved-after.json")["preserved"] is True
grade_sha = "8fb73421de22a16a38ac7befad4a62a585fa7d80af7e156dd3c0770ee0c97836"
assert sha("scripts/lib/grade-transfer-model.ts") == grade_sha

built = {}
for name in ("general", "managed", "opportunities", "matching", "quality"):
    path = f"outputs/verification/qa-cycle-01-{name}-http.json"
    report = read(path)
    assert report["passed"] is True
    groups = len(report["groups"]) if isinstance(report["groups"], list) else report["groups"]
    built[name] = {"groups": groups, **proof(path)}
bank_path = "outputs/verification/qa-cycle-01-bank.json"
bank = read(bank_path)
assert bank["verified"] is True
built["bank"] = {"groups": 6, **proof(bank_path)}
assert sum(item["groups"] for item in built.values()) == 65
ids = read("outputs/verification/qa-cycle-01-id-http.json")
assert ids["passed"] is True and ids["counts"]["passed"] == 130
browser = read("outputs/verification/qa-cycle-01-quality-browser.json")
assert browser["passed"] is True and browser["groups"] == 8
research = read("outputs/verification/qa-cycle-01-research-http.json")
assert research["passed"] is True and research["groups"] == 7
unit_log = (ROOT / "outputs/verification/qa-cycle-01-unit.log").read_text(encoding="utf-8-sig")
assert "tests 121" in unit_log and "pass 121" in unit_log and "fail 0" in unit_log

external_root = "../docs/best-match/qa-cycle-2026-10-06/"
method_path = external_root + "assessment/method-acceptance-v4-report.json"
guard_path = external_root + "assessment/python-definition-guard-v4-report.json"
order_path = external_root + "matching/order-preflight-5132063b3585.json"
assert read(method_path)["passed"] is True
assert read(guard_path)["guardCorrect"] is True

quality = read("artifacts/api-server/src/lib/quality-public-report.json")
current = {}
for item in quality["current"]:
    all_slice = next(part for part in item["slices"] if part["id"] == "all")
    current[item["datasetVersion"]] = {
        "algorithmSha256": item["algorithmSha256"], "datasetSha256": item["datasetSha256"],
        "evaluatorSha256": item["evaluatorSha256"], "sourceReportSha256": item["sourceReportSha256"],
        "measuredAt": item["measuredAt"], "evaluationClock": item["evaluationClock"],
        "queries": all_slice["queries"], "methods": all_slice["methods"],
        "splitPolicy": item["splitPolicy"], "limitations": item["limitations"],
    }

issues = [
    {"id": "QA-01", "subissues": ["QA-01b"], "fixed": True, "verified": True,
     "scope": "Common need-fit, then linked-proof completeness; local comparable quality + up to 3 FSP points; available queue heads FSP then stable alias/id. No raw cross-bank equivalence or technical group priority.",
     "proofs": [proof("outputs/verification/qa01-intergroup-control.json"), proof("outputs/quality/qa-cycle-01/traceability-regression-v1-report.json"), proof(built["matching"]["path"])],
     "independentPreflight": {"accepted": True, "checks": 15, **proof(order_path)},
     "independentBuiltApiAcceptance": "accepted", "limitations": ["Measured-grade promotion changes comparable group; universal ordinal monotonicity across such regrouping is not established.", "Previously measured controls are used regression controls; labels/partitions and common weights unchanged; losses retained."]},
    {"id": "QA-02", "subissues": ["QA-02b"], "fixed": True, "verified": True,
     "scope": "Exact source-mechanism model, CRLF normalized and outer whitespace trimmed; all internal indentation and tokens preserved; unsupported source not_evaluated/null.",
     "modelSha256": grade_sha, "independentLimitedAcceptance": True,
     "proofs": [proof("outputs/verification/qa-cycle-01-grade.json"), proof(method_path), proof(guard_path)],
     "limitations": ["36 conditional constructed experiments vary only core answer; other five competencies frozen correct. Not a human learning/anti-cheat effect estimate.", "Accepted model and measurement protocols preserved; later document hashes recorded as companion, not a new assessment measurement."]},
    {"id": "QA-03", "fixed": True, "verified": True, "scope": "Both built HTTP quality endpoints and actual browser; separate controls/history, own denominators, measurement/render time and source SHA; only safe aggregates.",
     "proofs": [proof(built["quality"]["path"]), proof("outputs/verification/qa-cycle-01-quality-browser.json"), proof("outputs/verification/qa-cycle-01-quality.json")],
     "independentBuiltAcceptance": "accepted", "limitations": ["Missing/stale/invalid states tested in source unit/isolated Express; current state additionally verified in deployed bundle HTTP/browser.", "Public canonical-manifest SHA and JSON file SHA are distinct and recorded separately."]},
    {"id": "QA-04", "fixed": True, "verified": True, "scope": "Actual built app, 130 requests; PostgreSQL int32 IDs 1..2147483647; invalid values 400 before DB binding; string program IDs unchanged.",
     "proofs": [proof("outputs/verification/qa-cycle-01-id.json"), proof("outputs/verification/qa-cycle-01-id-http.json")], "independentBuiltAcceptance": "accepted"},
    {"id": "QA-05", "fixed": True, "verified": True, "scope": "Actual PostgreSQL/ordinary-account HTTP: NFKC, exact supported whitespace, aliases, raw values preserved; historical null quality; filtering before COUNT/LIMIT; privacy/roles/pools; 27-row pagination 24/3/0.",
     "proofs": [proof(bank_path)], "independentBuiltAcceptance": "accepted"},
    {"id": "QA-06", "fixed": False, "verified": False, "phase": "after independent HTTP/UI acceptance and browser release",
     "remaining": "Observe and record ordinary registration plus email confirmation and required candidate/employer flow. Update video and TZ section3.3 coverage with new runtime image/source hashes.",
     "limitations": ["Existing 142-second/22-scene video is historical v0.4.0 and lacks ordinary-registration scene. No new video claim or continuous-recording requirement added."]},
    {"id": "QA-07", "fixed": False, "verified": False, "documentationFixed": True, "openapiVerified": True,
     "contractCoverage": read("outputs/verification/qa-cycle-01-documentation.json")["coverage"],
     "proofs": [proof("outputs/verification/qa-cycle-01-documentation.json"), proof("outputs/verification/qa-cycle-01-source-preflight.json")],
     "remaining": "Update technical-release-input/presentation-content and PDF/PPTX/video after acceptance; final source/submission package, source privacy audit and clean launch. Existing binary artifacts remain historical v0.4.0.",
     "sourceReproducibilityInputs": proof("outputs/verification/qa-cycle-01-source-required-inputs.json")},
]
docs = ["README.md", "docs/completion-status.md", "docs/technical-description.md", "docs/pitch-script.md", "docs/matching-v5.md", "docs/architecture.md", "docs/evaluation.md"]
report = {
    "version": "signal-qa-cycle-01-v1", "generatedAt": datetime.now(timezone.utc).isoformat(),
    "status": "functional independent acceptance PASS; media/source-package finalization pending",
    "allIssuesComplete": False, "packageVersion": "0.4.1", "runtime": runtime,
    "runtimeReady": proof("outputs/verification/qa-cycle-01-runtime-ready.json"),
    "runtimeFrozen": True, "independentRuntimeAcceptance": {"passed": True, "matchingGroups": 20, "assessmentGroups": 17, "securityGroups": 23, "uniqueGroups": 60, "securityHttpRequests": 184, "uiPassed": True, "publicAggregateIndependentCells": 1196, "scope": "Actual tested image55a5; own independent fixtures cleaned; core unchanged. Final artifacts still pending."}, "workingDatabaseSeededOrReset": False,
    "preservation": proof("outputs/verification/qa-cycle-01-preserved-after.json"),
    "checks": {"unit": {"passed": 121, "failed": 0, **proof("outputs/verification/qa-cycle-01-unit.log")},
               "typecheck": {"passed": True, **proof("outputs/verification/qa-cycle-01-typecheck.log")},
               "builtHttpGroups": 65, "builtHttp": built, "idRequests": ids["counts"],
               "browserQualityGroups": 8, "sourceResearchHttpGroups": 7,
               "sourceResearchProvenance": "Separate source-router HTTP process; not counted as built Docker group"},
    "issues": issues, "currentControls": current,
    "aggregateManifestSha256": quality["sha256"], "aggregateFileSha256": sha("artifacts/api-server/src/lib/quality-public-report.json"),
    "documentationCompanion": {"builtAt": datetime.now(timezone.utc).isoformat(), "files": [proof(path) for path in docs],
      "gradeSectionUnchanged": "Accepted transfer-model validation and immutable measurement bytes remain authoritative; current docs do not update the previous measurement timestamp."},
    "authorityLimits": ["No commit/push, final submission packaging, public publishing, spending or competition submission performed.",
                        "Runtime held stable until independent retest release. Human research and actual official FSP/ATS integrations not claimed."]
}
target = ROOT / "outputs/verification/qa-cycle-01.json"
target.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n",encoding="utf-8")
print(json.dumps({"file": str(target), "status": report["status"], "builtHttpGroups": 65, "idRequests": 130, "allIssuesComplete": False},ensure_ascii=False))
