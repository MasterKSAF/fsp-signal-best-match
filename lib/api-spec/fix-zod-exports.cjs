// Orval emits both a Zod value and a TS type for inline parameter/body schemas.
// Keep value names and expose only colliding TS declarations with a Type suffix.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../api-zod/src');
const values = new Set([...fs.readFileSync(path.join(root,'generated/api.ts'),'utf8').matchAll(/export const (\w+)/g)].map(m=>m[1]));
const names = new Set();
for (const file of fs.readdirSync(path.join(root,'generated/types')).filter(name=>name.endsWith('.ts')&&name!=='index.ts')) {
  for (const match of fs.readFileSync(path.join(root,'generated/types',file),'utf8').matchAll(/export (?:type|interface) (\w+)/g)) names.add(match[1]);
}
fs.writeFileSync(path.join(root,'index.ts'), '// Generated export bridge; regenerate with pnpm codegen.\nexport * from "./generated/api";\nexport type {\n'+[...names].sort().map(name=>'  '+name+(values.has(name)?' as '+name+'Type':'')+',').join('\n')+'\n} from "./generated/types";\n');
