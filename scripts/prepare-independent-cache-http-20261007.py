"""New exact-target HTTP controls; historical v060 runner stays byte-identical."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
text=(root/'scripts/multi-resume-cache-http-v060.ts').read_text(encoding='utf8')
old="import { validatedLoadTarget } from './multi-resume-load-target-v060';\nassert.equal(validatedLoadTarget(process.env).key,'dedicated-v060');"
assert text.count(old)==1
text=text.replace(old,"import { validatedIndependentLoadTarget } from './independent-load-target-20261007';\nassert.equal(validatedIndependentLoadTarget(process.env).key,'independent-20261007');")
text=text.replace('v060-multi-load-cache-${nonce}','independent-cache-20261007-${nonce}')
text=text.replace('outputs/verification/0.6.0/multi-resume/cache-http-${nonce}.json','outputs/verification/independent-performance-20261007/cache-http-${nonce}.json')
old='  if(owned.length)await db.delete(users).where(inArray(users.id,owned));'
assert text.count(old)==1
text=text.replace(old,'  const cleanupRows=owned.length?await db.select({id:users.id,email:users.email}).from(users).where(inArray(users.id,owned)):[];assert.ok(cleanupRows.every(row=>row.email.startsWith(`independent-cache-20261007-${nonce}-`)&&row.email.endsWith("@example.test")),"Exact own fixture IDs/prefix required");\n  if(owned.length)await db.delete(users).where(inArray(users.id,owned));')
(root/'scripts/independent-cache-http-20261007.ts').write_text(text,encoding='utf8',newline='\n')
print('New strictly guarded cache HTTP controls prepared; historical source unchanged.')
