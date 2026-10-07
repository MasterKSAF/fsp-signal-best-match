/** A deliberately bounded, deterministic model of a studied source mechanism.
 * Input is visible fixture text only: no target key, oracle or scorer is read.
 * Unsupported syntax is not a failed student answer and must not be scored. */
import { createHash } from 'node:crypto';

type Grade = 'Junior' | 'Middle' | 'Senior';
type Program = 'backend-python' | 'frontend-typescript';
type Literal = number | string | boolean | null | { [key: string]: Literal };
export type TransferInput = { programId: Program; grade: Grade; sourceId: string; targetId: string; sourcePrompt: string; targetPrompt: string; strategy: 'same-template' | 'cross-template' };
export const transferModelVersion = 'signal-source-mechanism-transfer-v4';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
// The declared model recognizes exact source definitions, not arbitrary Python
// or TS semantics. Indentation, token boundaries and literals are significant.
// Normalize only CRLF and whitespace outside the complete definition's edges.
function canonicalDefinition(source: string) {
  return source.replace(/\r\n/g, '\n').trim();
}

const pythonDefinitions: Record<Grade, string> = {
  Junior: `stored = {}
def create(key, body_hash, next_order):
    previous = stored.get(key)
    if previous is None:
        stored[key] = (body_hash, next_order)
        return f"201:{next_order}"
    if previous[0] != body_hash:
        return f"409:{previous[1]}"
    return f"200:{previous[1]}"`,
  Middle: `stored = {}
def create(tenant, key, body_hash, next_order):
    full_key = (tenant, key)
    previous = stored.get(full_key)
    if previous is None:
        stored[full_key] = (body_hash, next_order)
        return f"201:{next_order}"
    if previous[0] != body_hash:
        return f"409:{previous[1]}"
    return f"200:{previous[1]}"`,
  Senior: `records = {}
def apply(key, version, body_hash, next_order):
    previous = records.get(key)
    if previous is None:
        records[key] = (version, body_hash, next_order)
        return f"201:{next_order}"
    if previous[0] != version:
        return f"412:{previous[2]}"
    if previous[1] != body_hash:
        return f"409:{previous[2]}"
    return f"200:{previous[2]}"`,
};
const typescriptDefinition = (grade: Grade) => `type State = { kind: 'ready'; value: number } | { kind: 'loading' } | { kind: 'error'; retry: boolean };
function label(s: State): string {
  if (s.kind === 'ready') return \`value:\${s.value}\`;
${grade === 'Junior' ? '' : "  if (s.kind === 'error') return s.retry ? 'retry' : 'stop';\n"}  return 'wait';
}`;

/** Parse a small literal grammar without executing source. Object literals are
 * needed for visible TS calls; arbitrary expressions/functions are unsupported. */
function argumentsFrom(text: string): Literal[] {
  let position = 0;
  const space = () => { while (/\s/.test(text[position] ?? '') && position < text.length) position++; };
  function literal(): Literal {
    space();
    const first = text[position];
    if (first === '"' || first === "'") {
      position++; let value = '';
      while (position < text.length) {
        const char = text[position++]!;
        if (char === first) return value;
        if (char !== '\\') { value += char; continue; }
        const escaped = text[position++]!;
        const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" };
        if (!(escaped in escapes)) throw Error('unsupported literal escape');
        value += escapes[escaped];
      }
      throw Error('unterminated literal string');
    }
    if (first === '{') {
      position++; const object: { [key: string]: Literal } = Object.create(null);
      space(); if (text[position] === '}') { position++; return object; }
      while (position < text.length) {
        space(); const name = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(text.slice(position))?.[0];
        if (!name || ['__proto__', 'constructor', 'prototype'].includes(name) || name in object) throw Error('unsupported literal object key');
        position += name.length; space();
        if (text[position++] !== ':') throw Error('unsupported literal object');
        object[name] = literal(); space();
        const delimiter = text[position++];
        if (delimiter === '}') return object;
        if (delimiter !== ',') throw Error('unsupported literal object delimiter');
      }
      throw Error('unterminated literal object');
    }
    for (const [token, value] of [['null', null], ['true', true], ['false', false]] as const) {
      if (text.slice(position, position + token.length) === token) { position += token.length; return value; }
    }
    const number = /^-?\d+(?:\.\d+)?/.exec(text.slice(position))?.[0];
    if (!number) throw Error('unsupported literal expression');
    position += number.length;
    if (!Number.isFinite(Number(number))) throw Error('nonfinite literal');
    return Number(number);
  }
  const result: Literal[] = [];
  space(); if (position === text.length) return result;
  while (position < text.length) {
    result.push(literal()); space();
    if (position === text.length) return result;
    if (text[position++] !== ',') throw Error('unsupported literal argument separator');
  }
  throw Error('trailing literal argument separator');
}

function codeOf(prompt: string, language: string) {
  const blocks = [...prompt.matchAll(new RegExp('```' + language + '\\r?\\n([\\s\\S]*?)\\r?\\n```', 'g'))];
  return blocks.length === 1 ? blocks[0]![1]! : null;
}
function callsOf(code: string, name: string) {
  const starts = new RegExp('^(?:r\\d+\\s*=\\s*)?' + name + '\\s*\\(');
  const whole = new RegExp('^(?:r\\d+\\s*=\\s*)?' + name + '\\s*\\((.*)\\)\\s*;?$');
  const candidates = code.split(/\r?\n/).map(s => s.trim()).filter(s => starts.test(s));
  const calls: Literal[][] = []; let error: string | null = null;
  for (const line of candidates) {
    try {
      const content = whole.exec(line)?.[1];
      if (content === undefined) throw Error('unsupported literal call line');
      calls.push(argumentsFrom(content));
    } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  }
  return { calls, expectedCallCount: candidates.length, recognizedCallCount: calls.length, error };
}

export function modelSourceMechanismTransfer(input: TransferInput) {
  const sourceFunction = input.programId === 'frontend-typescript' ? 'label' : input.grade === 'Senior' ? 'apply' : 'create';
  const targetFunction = input.strategy === 'same-template' ? sourceFunction : input.programId === 'frontend-typescript' ? 'read' : 'write';
  const sourceMethod = input.programId === 'backend-python' ? `durable-command-${input.grade.toLowerCase()}` : `discriminated-state-${input.grade.toLowerCase()}`;
  const mapping = input.strategy === 'same-template' ? 'Keep source argument roles unchanged; use newly shown target calls.' : input.programId === 'frontend-typescript'
    ? 'Apply the studied kind/value/retry branches independently to each shown read input. Missing kind follows wait; null records TypeError. No count/version validation is learned.'
    : input.grade === 'Junior' ? 'expected→key; value→body_hash and next_order. Keep source durable-key decisions.'
      : input.grade === 'Middle' ? 'resource→tenant; expected→key; value→body_hash and next_order. Preserve source tenant/key separation.'
        : 'expected→key and command version; digest→body_hash; value→next_order. Preserve source stored-version/hash decisions; no target digest validation or revision increments are learned.';
  const provenance = { modelVersion: transferModelVersion, sourceId: input.sourceId, targetId: input.targetId, sourcePromptSha256: sha(input.sourcePrompt), targetPromptSha256: sha(input.targetPrompt), sourceMethod, sourceFunction, targetFunction, strategy: input.strategy, argumentMapping: mapping, targetAnswerKeyAccess: false as const };
  let expectedCallCount = input.programId === 'frontend-typescript' ? input.strategy === 'same-template' && input.grade === 'Senior' ? 4 : 3 : input.grade === 'Junior' ? 3 : 4;
  let recognizedCallCount = 0;
  const notEvaluated = (reason: string) => ({ status: 'not_evaluated' as const, reason, answer: null, expectedCallCount, recognizedCallCount, provenance, trace: [] });
  const language = input.programId === 'backend-python' ? 'python' : 'typescript';
  const sourceCode = codeOf(input.sourcePrompt, language);
  const targetCode = codeOf(input.targetPrompt, language);
  if (sourceCode === null || targetCode === null) return notEvaluated('Expected exactly one recognized fenced code block in source and target.');
  const sourceCallStart = new RegExp('^(?:r\\d+\\s*=\\s*)?' + sourceFunction + '\\s*\\(', 'm').exec(sourceCode);
  const definition = sourceCallStart ? sourceCode.slice(0, sourceCallStart.index).trim() : '';
  const supportedDefinition = input.programId === 'backend-python' ? pythonDefinitions[input.grade] : typescriptDefinition(input.grade);
  if (canonicalDefinition(definition) !== canonicalDefinition(supportedDefinition)) return notEvaluated('Unsupported source-method definition; exact internal whitespace, indentation, token boundaries and literals are required.');
  const sourceCalls = callsOf(sourceCode, sourceFunction);
  const sourceExpected = input.programId === 'frontend-typescript' ? input.grade === 'Senior' ? 4 : 3 : input.grade === 'Junior' ? 3 : 4;
  if (sourceCalls.error || sourceCalls.recognizedCallCount !== sourceExpected) return notEvaluated('Unsupported source-method call list.');
  const parsed = callsOf(targetCode, targetFunction);
  recognizedCallCount = parsed.recognizedCallCount;
  if (parsed.error) return notEvaluated(parsed.error);
  if (recognizedCallCount !== expectedCallCount || parsed.expectedCallCount !== expectedCallCount) return notEvaluated(`Unsupported call-count: expected ${expectedCallCount}, recognized ${recognizedCallCount}.`);

  type RecordValue = { version: Literal; body: Literal; result: number };
  const ledger = new Map<string, RecordValue>();
  const trace: { index: number; arguments: Literal[]; sourceArguments: Literal[]; output: string; decision: string }[] = [];
  for (const [index, args] of parsed.calls.entries()) {
    let output: string, decision: string, sourceArgs: Literal[] = args;
    if (input.programId === 'frontend-typescript') {
      if (args.length !== 1 || args[0] !== null && (typeof args[0] !== 'object' || Array.isArray(args[0]))) return notEvaluated('Unsupported frontend literal signature.');
      const state = args[0];
      if (state === null) { output = 'error:TypeError'; decision = 'Source method dereferences kind on null; independently record the runtime error.'; }
      else if (state!.kind === 'ready') { output = `value:${state!.value}`; decision = 'Source ready branch.'; }
      else if (input.grade !== 'Junior' && state!.kind === 'error') { output = state!.retry ? 'retry' : 'stop'; decision = 'Source error/retry branch.'; }
      else { output = 'wait'; decision = 'Source fallback for loading or absent/unrecognized discriminator.'; }
    } else {
      if (input.strategy === 'cross-template') {
        const valid = input.grade === 'Junior' ? args.length === 2 && args.every(value => typeof value === 'number' && Number.isSafeInteger(value))
          : input.grade === 'Middle' ? args.length === 3 && typeof args[0] === 'string' && args.slice(1).every(value => typeof value === 'number' && Number.isSafeInteger(value))
            : args.length === 3 && typeof args[0] === 'number' && Number.isSafeInteger(args[0]) && typeof args[1] === 'string' && typeof args[2] === 'number' && Number.isSafeInteger(args[2]);
        if (!valid) return notEvaluated('Unsupported backend write signature for declared grade.');
        sourceArgs = input.grade === 'Junior' ? [args[0]!, args[1]!, args[1]!] : input.grade === 'Middle' ? [args[0]!, args[1]!, args[2]!, args[2]!] : [args[0]!, args[0]!, args[1]!, args[2]!];
      } else {
        const valid = input.grade === 'Junior' ? args.length === 3 && typeof args[0] === 'string' && typeof args[1] === 'string' && typeof args[2] === 'number'
          : input.grade === 'Middle' ? args.length === 4 && typeof args[0] === 'number' && typeof args[1] === 'string' && typeof args[2] === 'string' && typeof args[3] === 'number'
            : args.length === 4 && typeof args[0] === 'string' && typeof args[1] === 'number' && typeof args[2] === 'string' && typeof args[3] === 'number';
        if (!valid) return notEvaluated('Unsupported backend same-template signature for declared grade.');
      }
      const key = JSON.stringify(input.grade === 'Middle' ? sourceArgs.slice(0, 2) : [sourceArgs[0]]);
      const version = input.grade === 'Senior' ? sourceArgs[1]! : null;
      const body = sourceArgs[input.grade === 'Junior' ? 1 : 2]!;
      const nextOrder = sourceArgs.at(-1) as number;
      const previous = ledger.get(key);
      if (!previous) { ledger.set(key, { version, body, result: nextOrder }); output = `201:${nextOrder}`; decision = 'Source ledger creates first key.'; }
      else if (input.grade === 'Senior' && previous.version !== version) { output = `412:${previous.result}`; decision = 'Source rejects changed stored command version.'; }
      else if (previous.body !== body) { output = `409:${previous.result}`; decision = 'Source rejects changed body for durable key.'; }
      else { output = `200:${previous.result}`; decision = 'Source replays stored result.'; }
    }
    trace.push({ index, arguments: args, sourceArguments: sourceArgs, output, decision });
  }
  const answer = trace.map(item => item.output).join('|');
  if (!answer || trace.length !== expectedCallCount || trace.some(item => !item.output)) return notEvaluated('Incomplete or empty model answer; cannot be counted as a failed transfer.');
  return { status: 'evaluated' as const, reason: null, answer, expectedCallCount, recognizedCallCount, provenance, trace };
}
