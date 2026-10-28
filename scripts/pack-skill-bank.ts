import { buildBankBundle, assertBankAttested } from '../artifacts/api-server/src/lib/skill-bank-manifest';
const bundle = buildBankBundle();
assertBankAttested(bundle);
process.stdout.write(JSON.stringify(bundle));
