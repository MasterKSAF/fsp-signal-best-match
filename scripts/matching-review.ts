import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { matchingBlindPacket, validateMatchingReview, compareMatchingReviews } from '../artifacts/api-server/src/lib/matching-review';

const [command, firstFile, secondFile] = process.argv.slice(2);
if (command === 'export') {
  const directory = resolve('outputs/quality/blind-review');
  await mkdir(directory, { recursive: true });
  const packet = JSON.stringify(matchingBlindPacket(), null, 2) + '\n';
  for (const name of ['reviewer-a.json', 'reviewer-b.json']) await writeFile(join(directory, name), packet, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
  console.log(JSON.stringify({ directory, state: 'blank-packets-only', humanMeasurements: 'not_measured' }));
} else if (command === 'import' && firstFile && secondFile) {
  const sourceA = await readFile(resolve(firstFile), 'utf8'), sourceB = await readFile(resolve(secondFile), 'utf8');
  const a = validateMatchingReview(JSON.parse(sourceA)), b = validateMatchingReview(JSON.parse(sourceB));
  const report = compareMatchingReviews(a, b);
  const directory = resolve('outputs/internal/matching-reviews', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'reviewer-a-original.json'), sourceA, { flag: 'wx' });
  await writeFile(join(directory, 'reviewer-b-original.json'), sourceB, { flag: 'wx' });
  await writeFile(join(directory, 'report.json'), JSON.stringify({ ...report, importedAt: new Date().toISOString(), inputSha256: [sourceA, sourceB].map(text => createHash('sha256').update(text).digest('hex')) }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ directory, pairs: report.pairs, disagreements: report.disagreements.length }));
} else {
  throw new Error('Использование: node --import tsx scripts/matching-review.ts export | import reviewer-a.json reviewer-b.json');
}
