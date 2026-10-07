import { matchingDataset, runMatchingQuality } from '../artifacts/api-server/src/lib/matching-quality';
import { mkdir, writeFile } from 'node:fs/promises';
import { controlQueries, runControlEvaluation } from '../artifacts/api-server/src/lib/quality-evaluation';

const report = runControlEvaluation();
await mkdir('outputs/quality', { recursive: true });
await writeFile('outputs/quality/control-report.json', JSON.stringify(report, null, 2) + '\n');
await writeFile('outputs/quality/control-fixtures.json', JSON.stringify(controlQueries(), null, 2) + '\n');
await writeFile('outputs/quality/matching-v2-report.json', JSON.stringify(runMatchingQuality(), null, 2) + '\n');
await writeFile('outputs/quality/matching-v2-fixtures.json', JSON.stringify(matchingDataset(), null, 2) + '\n');
const quote = (value: unknown) => '"' + String(value).replaceAll('"', '""') + '"';
const rows = [['query_id', 'candidate_id', 'grade_required', 'required', 'desirable', 'candidate_grade', 'verified_skills', 'stated_skills', 'assessment_score', 'work_format', 'reviewer', 'relevance_0_3', 'comment']];
for (const query of controlQueries()) for (const candidate of query.candidates) rows.push([query.id, String(candidate.userId), query.need.grade, query.need.requiredSkills.join('; '), query.need.desirableSkills.join('; '), candidate.verifiedGrade ?? '', candidate.verifiedSkills.join('; '), candidate.statedSkills.join('; '), String(candidate.verifiedScore), candidate.workFormat, '', '', '']);
await writeFile('outputs/quality/pilot-annotation-template.csv', '\ufeff' + rows.map(row => row.map(quote).join(',')).join('\r\n'));
console.log(JSON.stringify({ artifact: 'outputs/quality/control-report.json', ...report.metrics, annotationSource: report.annotationSource, limitations: 'Synthetic control only; see full report' }, null, 2));
