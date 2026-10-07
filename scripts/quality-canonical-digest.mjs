import { createHash } from 'node:crypto';
let input = '';
for await (const part of process.stdin) input += part;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object'
    ? '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child)).join(',') + '}'
    : JSON.stringify(value);
process.stdout.write(createHash('sha256').update(canonical(JSON.parse(input))).digest('hex'));
