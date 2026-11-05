import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, PDFArray, decodePDFRawStream } from '../assets/vendor/pdf-lib-1.17.1.esm.min.js';
import { createSignedTermPdf, digestTermBlob, validateSignatureImage } from '../signed-term-pdf.js';

const uploadedAt=1793880000000,reviewedAt=uploadedAt+1000;
async function fixture(overrides={}) {
  const pdf=await PDFDocument.create();pdf.addPage([400,600]);pdf.addPage([600,400]);
  const original=new Uint8Array(await pdf.save());
  const originalBlob=new Blob([original],{type:'application/pdf'});
  const hash=createHash('sha256').update(original).digest('hex');
  const review={status:'approved',reviewerUid:'coord-a',reviewerName:'Coordenação de teste',reviewedAt,uploadVersion:'upload-a',uploadedAt};
  const base={signerUid:'advisor-a',signerName:'Professor de teste',signedAt:reviewedAt+1000,signaturePng:'',uploadVersion:'upload-a',uploadedAt,reviewedAt,documentSha256:hash,groupId:'group-a',consent:true};
  return {original,originalBlob,filename:'termo-teste.pdf',studentName:'Estudante de teste',year:2027,review,signatures:[{...base,role:'advisor'},{...base,role:'coordinator',signerUid:'coord-a',signerName:'Coordenação de teste',groupId:''}],uploadVersion:'upload-a',uploadedAt,...overrides};
}
async function attachment(bytes) {
  const doc=await PDFDocument.load(bytes);
  const names=doc.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray);
  const spec=doc.context.lookup(names.get(1),PDFDict);
  return decodePDFRawStream(spec.lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'))).decode();
}
test('PDF preserves page dimensions, attaches the exact original and reports its SHA256',async()=>{
  const input=await fixture(),result=await createSignedTermPdf(input),output=new Uint8Array(await result.blob.arrayBuffer()),doc=await PDFDocument.load(output);
  assert.equal(result.sha256,createHash('sha256').update(input.original).digest('hex'));
  assert.equal(await digestTermBlob(input.originalBlob),result.sha256);
  assert.deepEqual(doc.getPages().slice(0,2).map(p=>p.getSize()),[{width:400,height:600},{width:600,height:400}]);
  assert.ok(doc.getPageCount()>=3);
  assert.deepEqual(new Uint8Array(await attachment(output)),input.original);
  assert.deepEqual(new Uint8Array(await input.originalBlob.arrayBuffer()),input.original);
  assert.equal(result.filename,'termo-teste-com-assinaturas.pdf');
});
test('PNG original becomes a proportional content page and its bytes are attached unchanged',async()=>{
  const bytes=await readFile(new URL('../assets/icons/icon-192.png',import.meta.url)),input=await fixture({originalBlob:new Blob([bytes],{type:'image/png'}),filename:'foto.png'});
  const hash=createHash('sha256').update(bytes).digest('hex');input.signatures.forEach(s=>s.documentSha256=hash);
  const result=await createSignedTermPdf(input),output=new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(result.sha256,hash);assert.deepEqual(new Uint8Array(await attachment(output)),new Uint8Array(bytes));
  assert.equal((await PDFDocument.load(output)).getPage(0).getWidth(),595.28);
});
test('typed account signatures require consent and do not require a drawing',async()=>{
  const input=await fixture();input.signatures=input.signatures.slice(0,1);
  assert.equal((await createSignedTermPdf(input)).blob.type,'application/pdf');
});
test('a bounded PNG drawing is embedded together with its authenticated account stamp',async()=>{
  const image=await readFile(new URL('../assets/icons/icon-192.png',import.meta.url));
  const input=await fixture();input.signatures[0].signaturePng='data:image/png;base64,'+image.toString('base64');
  assert.deepEqual(validateSignatureImage(input.signatures[0].signaturePng),new Uint8Array(image));
  assert.ok((await createSignedTermPdf(input)).blob.size>1000);
});
test('oversized dimensions and oversized drawing bytes are rejected before decoding',async()=>{
  const image=new Uint8Array(await readFile(new URL('../assets/icons/icon-192.png',import.meta.url)));
  new DataView(image.buffer).setUint32(16,20000);
  assert.throws(()=>validateSignatureImage('data:image/png;base64,'+Buffer.from(image).toString('base64')),/dimensões/);
  assert.throws(()=>validateSignatureImage('data:image/png;base64,'+Buffer.alloc(201*1024).toString('base64')),/200 KB/);
});
test('a JPEG original is embedded proportionally and preserved as an exact attachment',async()=>{
  const encoded='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';
  const bytes=Buffer.from(encoded,'base64'),input=await fixture({originalBlob:new Blob([bytes],{type:'image/jpeg'}),filename:'foto.jpg'});
  input.signatures.forEach(s=>s.documentSha256=createHash('sha256').update(bytes).digest('hex'));
  const result=await createSignedTermPdf(input),output=new Uint8Array(await result.blob.arrayBuffer());
  assert.deepEqual(new Uint8Array(await attachment(output)),new Uint8Array(bytes));
});
test('the same account may sign as its assigned advisor and as coordination',async()=>{
  const input=await fixture();input.signatures.forEach(s=>s.signerUid='dual-role');
  assert.ok((await createSignedTermPdf(input)).blob.size>0);
});
test('rejected or awaiting documents cannot become a signed copy',async()=>{
  for(const status of ['returned','pending']){const input=await fixture();input.review.status=status;await assert.rejects(createSignedTermPdf(input),/aceitar/);}
});
test('a changed upload invalidates the old review',async()=>{
  const input=await fixture();input.uploadVersion='upload-b';await assert.rejects(createSignedTermPdf(input),/aceitar/);
});
test('a changed acceptance invalidates earlier signatures',async()=>{
  const input=await fixture();input.review.reviewedAt++;await assert.rejects(createSignedTermPdf(input),/outra versão/);
});
test('a changed original hash invalidates its signatures',async()=>{
  const input=await fixture();input.signatures[0].documentSha256='0'.repeat(64);await assert.rejects(createSignedTermPdf(input),/outra versão/);
});
test('a signature without explicit consent is rejected',async()=>{
  const input=await fixture();input.signatures[0].consent=false;await assert.rejects(createSignedTermPdf(input),/outra versão/);
});
test('duplicated audit records are rejected',async()=>{
  const input=await fixture();input.signatures.push({...input.signatures[0]});await assert.rejects(createSignedTermPdf(input),/duplicada/);
});
test('an advisor signature needs its assigned group identifier',async()=>{
  const input=await fixture();input.signatures[0].groupId='';await assert.rejects(createSignedTermPdf(input),/grupo válido/);
});
test('signature drawings accept only bounded PNG data, never URLs or SVG',()=>{
  assert.equal(validateSignatureImage(''),null);
  for(const value of ['https://example.invalid/a.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,AAAA'])assert.throws(()=>validateSignatureImage(value));
});
test('truncated, mismatching and oversized source files fail closed',async()=>{
  const input=await fixture();
  await assert.rejects(createSignedTermPdf({...input,originalBlob:new Blob(['bad'],{type:'application/pdf'})}),/formato/);
  await assert.rejects(createSignedTermPdf({...input,originalBlob:new Blob([input.original],{type:'image/png'})}),/formato/);
  await assert.rejects(createSignedTermPdf({...input,originalBlob:new Blob([new Uint8Array(3*1024*1024+1)])}),/3 MB/);
});
test('a source PDF with more than 30 pages is rejected before copying',async()=>{
  const pdf=await PDFDocument.create();for(let i=0;i<31;i++)pdf.addPage();const bytes=await pdf.save();const input=await fixture({originalBlob:new Blob([bytes],{type:'application/pdf'})});
  input.signatures.forEach(s=>s.documentSha256=createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(createSignedTermPdf(input),/30 páginas/);
});
test('long names, filenames and audit identifiers wrap into extra evidence pages',async()=>{
  const input=await fixture({studentName:'Nome de estudante '.repeat(10),filename:'arquivo_sem_espacos_'.repeat(12)+'.pdf'});
  input.signatures=Array.from({length:8},(_,i)=>({...input.signatures[0],signerUid:('advisor'+i).padEnd(128,'x'),signerName:'Nome de professor '.repeat(5).slice(0,100),groupId:'g'.repeat(128)}));
  const result=await createSignedTermPdf(input),doc=await PDFDocument.load(await result.blob.arrayBuffer());assert.ok(doc.getPageCount()>4);
});
