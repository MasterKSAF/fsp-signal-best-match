import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GetQualityReportResponse } from '@workspace/api-zod';
import { z } from 'zod';
import { MATCH_ALGORITHM_VERSION } from './signal-matching';

declare const __SIGNAL_MATCHER_SHA256__: string;
export const PUBLIC_QUALITY_SCHEMA_VERSION = 'signal-public-quality-v1' as const;
export const publicMeasurementsSchema = GetQualityReportResponse.shape.current;
const manifestSchema = z.object({
  schemaVersion: z.literal(PUBLIC_QUALITY_SCHEMA_VERSION),
  aggregateVersion: z.string().min(1), builtAt: z.string().datetime(),
  current: publicMeasurementsSchema, history: publicMeasurementsSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type QualityManifest = z.infer<typeof manifestSchema>;

/** Stable bytes for the safe aggregate, independent of pretty-printing. */
export function canonicalQualityJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalQualityJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => JSON.stringify(key) + ':' + canonicalQualityJson(child)).join(',') + '}';
  }
  return JSON.stringify(value);
}
export const qualityDigest = (value: unknown) => createHash('sha256').update(canonicalQualityJson(value)).digest('hex');
const sha = /^[a-f0-9]{64}$/;
const instant = (value: string | null) => value === null || Number.isFinite(Date.parse(value));

function verifyMeasurements(manifest: QualityManifest) {
  for (const report of [...manifest.current, ...manifest.history]) {
    if (!sha.test(report.datasetSha256) || !sha.test(report.sourceReportSha256)
      || (report.algorithmSha256 !== null && !sha.test(report.algorithmSha256))
      || (report.evaluatorSha256 !== null && !sha.test(report.evaluatorSha256))
      || !instant(report.measuredAt) || !instant(report.evaluationClock)) throw new Error('Invalid report provenance');
    if (manifest.current.includes(report) && (report.measuredAt === null || report.algorithmSha256 === null)) throw new Error('Current report lacks measurement provenance');
    for (const slice of report.slices) for (const method of slice.methods) {
      for (const metric of [method.precisionAt5, method.ndcgAt5, method.relevantRecallAt5, method.relevantRecallAll]) {
        if (metric.total !== metric.defined + metric.undefined || metric.total !== slice.queries
          || (metric.defined === 0) !== (metric.value === null)
          || (metric.numerator === null) !== (metric.denominator === null)
          || (metric.denominator !== null && (metric.denominator === 0 || metric.numerator! > metric.denominator
            || metric.value === null || Math.abs(metric.value - metric.numerator! / metric.denominator) > 1e-12))) throw new Error('Invalid metric denominator');
      }
    }
  }
}

/** Unknown fields are stripped by Zod then rejected by the digest comparison. */
export function verifyQualityManifest(raw: unknown): QualityManifest {
  const parsed = manifestSchema.parse(raw);
  const { sha256, ...content } = parsed;
  if (qualityDigest(content) !== sha256) throw new Error('Public aggregate checksum mismatch');
  verifyMeasurements(parsed);
  return parsed;
}

export function runtimeMatcherSha256(): string {
  return typeof __SIGNAL_MATCHER_SHA256__ !== 'undefined' ? __SIGNAL_MATCHER_SHA256__
    : createHash('sha256').update(readFileSync(new URL('./signal-matching.ts', import.meta.url))).digest('hex');
}

export function loadPublicQualityReport(options: {
  aggregatePath?: string | URL; algorithmVersion?: string; algorithmSha256?: string; renderedAt?: Date;
} = {}) {
  const runtimeAlgorithmVersion = options.algorithmVersion ?? MATCH_ALGORITHM_VERSION;
  const runtimeAlgorithmSha256 = options.algorithmSha256 ?? runtimeMatcherSha256();
  const base = {
    schemaVersion: PUBLIC_QUALITY_SCHEMA_VERSION, renderedAt: options.renderedAt ?? new Date(),
    runtimeAlgorithmVersion, runtimeAlgorithmSha256,
    aggregateVersion: null, aggregateBuiltAt: null, aggregateSha256: null,
    current: [], history: [],
  };
  let raw: string;
  try { raw = readFileSync(options.aggregatePath ?? new URL('./quality-public-report.json', import.meta.url), 'utf8'); }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return GetQualityReportResponse.parse({ ...base, status: missing ? 'missing' : 'invalid',
      notices: [missing ? 'Актуальный контрольный отчёт ещё не опубликован. Точность подбора здесь не заявляется.'
        : 'Контрольный отчёт недоступен. Точность подбора здесь не заявляется.'] });
  }
  let manifest: QualityManifest;
  try { manifest = verifyQualityManifest(JSON.parse(raw)); }
  catch {
    return GetQualityReportResponse.parse({ ...base, status: 'invalid',
      notices: ['Не удалось подтвердить целостность или знаменатели контрольного отчёта. Показатели скрыты.'] });
  }
  const stale = manifest.current.some(report => report.algorithmVersion !== runtimeAlgorithmVersion || report.algorithmSha256 !== runtimeAlgorithmSha256);
  const empty = !manifest.current.length;
  return GetQualityReportResponse.parse({ ...base,
    aggregateVersion: manifest.aggregateVersion, aggregateBuiltAt: manifest.builtAt, aggregateSha256: manifest.sha256,
    status: stale ? 'stale' : empty ? 'missing' : 'current',
    current: stale ? [] : manifest.current,
    history: stale ? [...manifest.current, ...manifest.history] : manifest.history,
    notices: [stale ? 'Сохранённые измерения относятся к другой версии или исходникам алгоритма. Они доступны только как история; качество текущего алгоритма не измерено.'
      : empty ? 'Для текущего алгоритма пока нет проверенного измерения.'
        : 'Это синтетический контроль поведения подбора. Точность реального найма и человеческая оценка сложности не измерены.',
    'Время построения страницы не является временем измерения. Каждое измерение и каждый срез показаны отдельно.'],
  });
}
