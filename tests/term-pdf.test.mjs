import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PDFDocument} from '../assets/vendor/pdf-lib-1.17.1.esm.min.js';
import {createFilledTermPdf} from '../term-pdf.js';

// Rendering/extraction use local dependencies only; fetchImpl never reaches the network.
// Local setup from tests/: npm install --no-save @napi-rs/canvas pdfjs-dist
const require=createRequire(import.meta.url);
const resolve=name=>require.resolve(name,{paths:[fileURLToPath(new URL('.',import.meta.url)),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)});
const {createCanvas}=require(resolve('@napi-rs/canvas'));
const pdfjs=await import(pathToFileURL(resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const templateUrl=new URL('../documentos/Termo_Compromisso_INIC_2027_Maximus.pdf',import.meta.url);
const layoutUrl=new URL('../documentos/termo-layout.json',import.meta.url);
const fields={student:'João Antônio da Conceição',class:'2º ano',group:'Pesquisa sobre educação e tecnologia',advisor:'Professora Júlia de Sá',guardian:'José Antônio da Conceição',date:'12 de novembro de 2026'};
const normal=text=>text.normalize('NFC').replace(/\s+/g,' ').trim();

function drawing(width,height,color){
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
  ctx.strokeStyle=color;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(6,height-8);ctx.lineTo(width*.38,8);ctx.lineTo(width-6,height*.6);ctx.stroke();
  return canvas.toDataURL('image/png');
}
const studentDrawing=drawing(360,72,'#143b8b'),guardianDrawing=drawing(92,156,'#156e30');
async function fixture(change={}){
  const bytes=new Uint8Array(await readFile(templateUrl));
  const layout=JSON.parse(await readFile(layoutUrl,'utf8'));
  const calls=[],value={bytes,layout,...change};
  const fetchImpl=async(input,options)=>{
    const url=new URL(String(input));calls.push({url,options});
    if(url.pathname.endsWith('/Termo_Compromisso_INIC_2027_Maximus.pdf'))return new Response(value.bytes,{status:200,headers:{'Content-Type':'application/pdf'}});
    if(url.pathname.endsWith('/termo-layout.json'))return new Response(JSON.stringify(value.layout),{status:200,headers:{'Content-Type':'application/json'}});
    throw new Error('Unexpected fixture URL: '+url.href);
  };
  return {...value,calls,fetchImpl};
}
async function inspect(blobOrBytes){
  const bytes=blobOrBytes instanceof Blob?new Uint8Array(await blobOrBytes.arrayBuffer()):new Uint8Array(blobOrBytes);
  const task=pdfjs.getDocument({data:bytes,useSystemFonts:true,isEvalSupported:false}),pdf=await task.promise;
  const pages=[];
  for(let number=1;number<=pdf.numPages;number++){
    const page=await pdf.getPage(number),content=await page.getTextContent(),operators=await page.getOperatorList();
    let matrix=[1,0,0,1,0,0];const stack=[],images=[];
    for(let index=0;index<operators.fnArray.length;index++){
      const fn=operators.fnArray[index],args=operators.argsArray[index];
      if(fn===pdfjs.OPS.save)stack.push([...matrix]);
      else if(fn===pdfjs.OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
      else if(fn===pdfjs.OPS.transform)matrix=pdfjs.Util.transform(matrix,args);
      else if(fn===pdfjs.OPS.paintImageXObject)images.push({sourceWidth:args[1],sourceHeight:args[2],x:matrix[4],y:matrix[5],width:Math.hypot(matrix[0],matrix[1]),height:Math.hypot(matrix[2],matrix[3])});
    }
    pages.push({text:normal(content.items.map(item=>item.str||'').join(' ')),items:content.items,images,view:page.view});
  }
  await pdf.destroy();return pages;
}
function within(image,box){
  const epsilon=.015;
  assert.ok(image.x>=box.x-epsilon&&image.y>=box.y-epsilon,'Image must start inside its reserved field');
  assert.ok(image.x+image.width<=box.x+box.width+epsilon&&image.y+image.height<=box.y+box.height+epsilon,'Image must fit without invading labels or the adjacent signature');
  assert.ok(Math.abs(image.width/image.height-image.sourceWidth/image.sourceHeight)<.0001,'Image must keep its original aspect ratio');
  assert.ok(Math.abs((image.x+image.width/2)-(box.x+box.width/2))<epsilon,'Image must be centered automatically');
}

test('unsigned filled PDF preserves both A4 pages, every original clause and the institutional names',async()=>{
  const f=await fixture(),original=await inspect(f.bytes),result=await createFilledTermPdf({fields:{...fields,teacher:'VALUE THAT MUST NOT REPLACE THE TEACHER'},fetchImpl:f.fetchImpl}),pages=await inspect(result.blob);
  assert.equal(result.blob.type,'application/pdf');assert.ok(result.blob.size<3*1024*1024);assert.match(result.filename,/\.pdf$/);assert.doesNotMatch(result.filename,/[\\/]/);
  assert.equal(pages.length,2);
  pages.forEach((page,index)=>{assert.deepEqual(page.view,original[index].view);assert.ok(page.text.includes(original[index].text),'The entire original page text must remain present');assert.equal(page.images.length,original[index].images.length);});
  const text=pages.map(page=>page.text).join(' ');
  for(const value of Object.values(fields))assert.ok(text.includes(value),'Missing entered field: '+value);
  assert.match(text,/Prof\. Esp\. Bruno Michel Pera/);assert.match(text,/Profa\. Esp\. Mariana Carmona/);assert.doesNotMatch(text,/VALUE THAT MUST NOT REPLACE/);
  assert.equal(f.calls.length,2);
  for(const {url,options} of f.calls){assert.equal(url.searchParams.get('v'),'20261112-12');assert.equal(options.credentials,'omit');assert.ok(!url.href.includes(encodeURIComponent(fields.student)));}
});

test('two distinct drawings are placed in the correct second-page fields without swapping, clipping or stretching',async()=>{
  const f=await fixture(),result=await createFilledTermPdf({fields,signatures:{student:studentDrawing,guardian:guardianDrawing},fetchImpl:f.fetchImpl});
  const original=await inspect(f.bytes),pages=await inspect(result.blob);
  assert.equal(pages.length,2);assert.equal(pages[0].images.length,original[0].images.length);assert.equal(pages[1].images.length,original[1].images.length+2);
  const student=pages[1].images.find(image=>image.sourceWidth===360&&image.sourceHeight===72),guardian=pages[1].images.find(image=>image.sourceWidth===92&&image.sourceHeight===156);
  assert.ok(student&&guardian,'Both actual image streams must be present');within(student,f.layout.signatures.student);within(guardian,f.layout.signatures.guardian);
  assert.ok(student.x+student.width<guardian.x,'Student stays in the left field and guardian in the right');
  const studentLabel=pages[1].items.find(item=>item.str==='Aluno'),guardianLabel=pages[1].items.find(item=>item.str==='Responsável');
  assert.ok(student.y>studentLabel.transform[5]&&guardian.y>guardianLabel.transform[5],'Each drawing must sit above its printed role label');
  const doc=await PDFDocument.load(await result.blob.arrayBuffer());
  assert.equal(doc.getPageCount(),2);assert.equal(doc.getForm().getFields().filter(field=>field.constructor.name==='PDFSignature').length,0,'A drawing must not fabricate a certificate signature');
});

test('signing only one field leaves the other field untouched and never moves it to the opposite role',async()=>{
  for(const [role,png,width,height] of [['student',studentDrawing,360,72],['guardian',guardianDrawing,92,156]]){
    const f=await fixture(),result=await createFilledTermPdf({fields,signatures:{[role]:png},fetchImpl:f.fetchImpl}),pages=await inspect(result.blob);
    const generated=pages[1].images.filter(image=>(image.sourceWidth===360&&image.sourceHeight===72)||(image.sourceWidth===92&&image.sourceHeight===156));
    assert.equal(generated.length,1);assert.equal(generated[0].sourceWidth,width);assert.equal(generated[0].sourceHeight,height);within(generated[0],f.layout.signatures[role]);
  }
});

test('long accented names remain complete, fit the available boxes and do not affect the other page',async()=>{
  const f=await fixture(),student='Maria Aparecida da Conceição dos Santos Oliveira de Albuquerque Nascimento Pereira',guardian='José Antônio da Conceição de Albuquerque Nascimento Pereira dos Santos Oliveira';
  const result=await createFilledTermPdf({fields:{...fields,student,guardian},signatures:{student:studentDrawing,guardian:guardianDrawing},fetchImpl:f.fetchImpl}),pages=await inspect(result.blob);
  for(const [key,value] of [['student',student],['guardian',guardian]]){
    const box=f.layout.fields[key];
    const items=pages[box.page].items.filter(item=>item.str?.trim()&&item.transform[4]>=box.x-.02&&item.transform[4]<=box.x+box.width+.02&&item.transform[5]>=box.y-.02&&item.transform[5]<=box.y+box.height+.02);
    assert.equal(normal(items.map(item=>item.str).join(' ')),value,'Name must not be silently shortened');
    for(const item of items)assert.ok(item.transform[4]+item.width<=box.x+box.width+.1,'Name must fit its field horizontally');
  }
});

test('missing names, unsupported image formats and unexpected signature roles fail before creating a PDF',async()=>{
  const f=await fixture();
  await assert.rejects(createFilledTermPdf({fields:{},signatures:{student:studentDrawing},fetchImpl:f.fetchImpl}),/nome do aluno/i);
  await assert.rejects(createFilledTermPdf({fields:{student:fields.student},signatures:{guardian:guardianDrawing},fetchImpl:f.fetchImpl}),/nome do respons[aá]vel/i);
  for(const png of ['https://example.invalid/signature.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,AAAA'])await assert.rejects(createFilledTermPdf({fields,signatures:{student:png},fetchImpl:f.fetchImpl}),/assinatura|PNG/i);
  await assert.rejects(createFilledTermPdf({fields,signatures:{teacher:studentDrawing},fetchImpl:f.fetchImpl}),/aluno.*respons[aá]vel/i);
  assert.equal(f.calls.length,0,'Invalid signing inputs must not even fetch the template');
});

test('too much text, unsupported glyphs and overlarge PNGs are rejected explicitly without silent truncation',async()=>{
  const f=await fixture();
  await assert.rejects(createFilledTermPdf({fields:{...fields,student:'A'.repeat(121)},fetchImpl:f.fetchImpl}),/120 caracteres/i);
  await assert.rejects(createFilledTermPdf({fields:{...fields,guardian:'W'.repeat(120)},fetchImpl:f.fetchImpl}),/longo demais|espa[cç]o/i);
  await assert.rejects(createFilledTermPdf({fields:{...fields,student:'Nome 😀'},fetchImpl:f.fetchImpl}),/caractere/i);
  const badDimensions=Buffer.from(studentDrawing.split(',')[1],'base64');badDimensions.writeUInt32BE(20000,16);
  await assert.rejects(createFilledTermPdf({fields,signatures:{student:'data:image/png;base64,'+badDimensions.toString('base64')},fetchImpl:f.fetchImpl}),/dimens[oõ]es/i);
  await assert.rejects(createFilledTermPdf({fields,signatures:{student:'data:image/png;base64,'+Buffer.alloc(201*1024).toString('base64')},fetchImpl:f.fetchImpl}),/200 KB/i);
});

test('an outdated PDF hash or invalid field mapping stops export instead of placing ink into the wrong document',async()=>{
  const f=await fixture();
  for(const mutate of [
    value=>{value.templateSha256='0'.repeat(64);},
    value=>{value.pageCount=1;},
    value=>{value.fields.guardian.page=0;},
    value=>{value.signatures.student.x=-1;},
    value=>{value.signatures.guardian={...value.signatures.student};},
    value=>{value.fields.student.width=value.pages[0].width;}
  ]){
    const layout=structuredClone(f.layout);mutate(layout);const wrong=await fixture({layout});
    await assert.rejects(createFilledTermPdf({fields,signatures:{student:studentDrawing,guardian:guardianDrawing},fetchImpl:wrong.fetchImpl}),/modelo.*desatualizado|modelo.*incompleto/i);
  }
  const bytes=new Uint8Array(f.bytes);bytes[bytes.length-1]^=1;
  const wrongPdf=await fixture({bytes});await assert.rejects(createFilledTermPdf({fields,fetchImpl:wrongPdf.fetchImpl}),/modelo.*desatualizado|modelo.*incompleto/i);
});

test('a two-page layout cannot be applied to a differently sized PDF even with a matching hash',async()=>{
  const f=await fixture(),pdf=await PDFDocument.create();pdf.addPage([400,600]);pdf.addPage([400,600]);const bytes=await pdf.save();
  const layout={...f.layout,templateSha256:createHash('sha256').update(bytes).digest('hex')},wrong=await fixture({bytes,layout});
  await assert.rejects(createFilledTermPdf({fields,fetchImpl:wrong.fetchImpl}),/modelo.*desatualizado|modelo.*incompleto/i);
});

test('failed and incomplete model downloads give a retryable error instead of an empty or unsigned result',async()=>{
  await assert.rejects(createFilledTermPdf({fields,fetchImpl:async()=>{throw new Error('Offline');}}),/conex[aã]o|carregar/i);
  await assert.rejects(createFilledTermPdf({fields,fetchImpl:async()=>new Response('Not found',{status:404})}),/carregar|modelo/i);
  const f=await fixture({bytes:new Uint8Array([1,2,3])});await assert.rejects(createFilledTermPdf({fields,fetchImpl:f.fetchImpl}),/modelo.*desatualizado|modelo.*incompleto/i);
});
