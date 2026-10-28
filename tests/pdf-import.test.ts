import assert from 'node:assert/strict';
import test from 'node:test';
import { pdfFixture } from './fixtures/pdf-import';
import { extractVisiblePdf, pdfImportFields, PdfImportError } from '../artifacts/api-server/src/lib/pdf-import';
test('visible PDF: opacity, colour, paint order, off-page and tiny text excluded; footnotes and inverse text preserved',async()=>{
 const result=await extractVisiblePdf(await pdfFixture());
 const fields=pdfImportFields(result.fragments);
 assert.deepEqual(fields.fields.skills.sort(),['Python','Redis','SQL','JavaScript'].sort());
 assert.equal(result.warnings.includes('HIDDEN_TEXT_EXCLUDED'),true);
 assert.equal(result.fragments.some(f=>f.text.includes('React')),false);
 assert.equal(fields.fields.summary.includes('Senior grade'),true); // Text is data, never a qualification command.
 assert.deepEqual(Object.keys(fields.fields).sort(),['skills','summary']);
 assert.ok(fields.provenance.skills.length>0);
 assert.ok(result.fragments.every(f=>f.page===1&&f.bbox.length===4));
});
test('scan, damaged PDF and compressed expansion have controlled bounded results',async()=>{
 const scan=await extractVisiblePdf(await pdfFixture('scan'));
 assert.equal(scan.fragments.length,0);assert.ok(scan.warnings.includes('NO_VISIBLE_TEXT'));
 await assert.rejects(extractVisiblePdf(Buffer.from('%PDF-invalid')),e=>e instanceof PdfImportError&&e.status===422);
 const before=Date.now();
 await assert.rejects(extractVisiblePdf(await pdfFixture('expansion')),e=>e instanceof PdfImportError&&e.status===422);
 assert.ok(Date.now()-before<20_000);
 await assert.rejects(extractVisiblePdf(Buffer.alloc(5_242_881)),e=>e instanceof PdfImportError&&e.status===400);
});
