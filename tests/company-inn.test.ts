import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {companyInnError} from '../lib/api-zod/src/company-inn';
import {CompanyUpdateBody,companyInnUpdate} from '../artifacts/api-server/src/lib/company-profile-input';
import {GetEmployerCompanyResponse,SaveEmployerCompanyBody} from '../lib/api-zod/src/generated/api';
const company={name:'Тестовая компания',description:'Собственная компания для проверки ИНН',industry:'Разработка',contactEmail:'inn-qa@example.test',contactPhone:null,contactMethod:'Электронная почта'};

test('company INN accepts empty legacy values and valid 10/12 digit strings while preserving leading zeros',()=>{
  for(const inn of ['', '   ','0012345673','001234567887','7707083893'])assert.equal(companyInnError(inn),null,inn);
  for(const inn of ['0012345673','001234567887']) {
    const result=CompanyUpdateBody.parse({...company,inn:` ${inn} `});assert.equal(result.inn,inn);assert.deepEqual(companyInnUpdate(result.inn),{inn});
  }
});
test('both 12-digit checksums and the 10-digit checksum are checked; malformed strings and zero identifiers are rejected',()=>{
  for(const inn of ['0012345674','001234567877','001234567886','0000000000','000000000000','001234567','00123456733','0012345678870','００１２３４５６７３','00123 5673','001234567x']) {
    assert.ok(companyInnError(inn),inn);assert.equal(CompanyUpdateBody.safeParse({...company,inn}).success,false,inn);
  }
  for(const inn of [1234567890,null,{},true])assert.equal(CompanyUpdateBody.safeParse({...company,inn}).success,false,'tax identifiers are never coerced into numbers');
});
test('legacy company PUT without INN preserves the stored value; explicit empty input clears it',()=>{
  const legacy=CompanyUpdateBody.parse(company);assert.equal(legacy.inn,undefined);assert.deepEqual(companyInnUpdate(legacy.inn),{});
  const cleared=CompanyUpdateBody.parse({...company,inn:'  '});assert.deepEqual(companyInnUpdate(cleared.inn),{inn:null});
  assert.equal(CompanyUpdateBody.safeParse({...company,companyId:99}).success,false,'an arbitrary company owner/id cannot be supplied');
});
test('documented API contract round-trips INN as text and still permits older request bodies',()=>{
  assert.equal(SaveEmployerCompanyBody.safeParse(company).success,true);
  for(const inn of ['','0012345673','001234567887']) {
    assert.equal(SaveEmployerCompanyBody.parse({...company,inn}).inn,inn);
    assert.equal(GetEmployerCompanyResponse.parse({company:{...company,id:1,inn}}).company.inn,inn);
  }
});
test('migration 17 adds only an optional text company column and format constraint, preserving existing history',()=>{
  const migration=readFileSync('lib/db/migrations/0016_company_inn.sql','utf8');
  assert.match(migration,/ADD COLUMN inn text;/);assert.equal(/NOT NULL|UPDATE |DELETE |DROP |TRUNCATE|signal_jobs|signal_micro|signal_invitations/.test(migration),false);
  const journal=JSON.parse(readFileSync('lib/db/migrations/meta/_journal.json','utf8'));
  const entries=journal.entries.filter((entry:{idx:number})=>entry.idx===16);
  assert.equal(entries.length,1);assert.equal(entries[0].tag,'0016_company_inn');
  assert.equal(journal.entries.filter((entry:{tag:string})=>entry.tag==='0016_company_inn').length,1);
});
