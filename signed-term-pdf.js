/* Local PDF generation. PDF-LIB 1.17.1 (MIT): assets/vendor/pdf-lib-1.17.1.LICENSE.md. */
import { PDFDocument, StandardFonts, rgb } from './assets/vendor/pdf-lib-1.17.1.esm.min.js';

const MAX_FILE = 3 * 1024 * 1024;
const MAX_SIGNATURE = 200 * 1024;
const MAX_PAGES = 30;
const PAGE = [595.28, 841.89];
const NAVY = rgb(0.19, 0.20, 0.47);
const ORANGE = rgb(0.95, 0.53, 0.21);
const INK = rgb(0.13, 0.15, 0.23);
const MUTED = rgb(0.38, 0.41, 0.49);
const SOFT = rgb(0.96, 0.96, 0.985);
const fail = message => { throw new Error(message); };
const stamp = value => Number.isSafeInteger(value) && value > 0;
const digestPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;

function string(value, max = 180) {
  return String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function filename(value, suffix = '') {
  const name=string(value || 'termo-2027', 180).replace(/[\\/<>:"|?*]/g,'_').replace(/^\.+/,'').replace(/\.[^.]*$/,'');
  return `${name || 'termo'}${suffix}.pdf`;
}
function bytesOfBase64(encoded) {
  if(!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0)fail('A imagem da assinatura não é válida.');
  let binary;
  try {binary=atob(encoded);} catch {fail('A imagem da assinatura não é válida.');}
  return Uint8Array.from(binary, char=>char.charCodeAt(0));
}
function pngSize(bytes) {
  if(bytes.length<33 || ![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n) || String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')fail('Envie a assinatura como uma imagem PNG válida.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return {width:view.getUint32(16),height:view.getUint32(20)};
}
/** Validate a locally captured PNG. No images or document data leave the browser. */
export function validateSignatureImage(dataUri) {
  if(dataUri==='' || dataUri==null)return null;
  if(typeof dataUri!=='string' || dataUri.length>Math.ceil(MAX_SIGNATURE/3)*4+30 || !dataUri.startsWith('data:image/png;base64,'))fail('A assinatura deve ser um PNG de até 200 KB.');
  const bytes=bytesOfBase64(dataUri.slice(22));
  if(bytes.length>MAX_SIGNATURE)fail('A imagem da assinatura ultrapassa 200 KB.');
  const {width,height}=pngSize(bytes);
  if(width<1 || height<1 || width>1600 || height>800 || width*height>1000000)fail('A imagem da assinatura possui dimensões inválidas.');
  return bytes;
}
async function originalBytes(blob) {
  if(!blob || typeof blob.arrayBuffer!=='function' || !Number.isInteger(blob.size) || blob.size<1 || blob.size>MAX_FILE)fail('O termo deve ser um PDF, JPG ou PNG de até 3 MB.');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(bytes.length!==blob.size)fail('Não foi possível ler o termo completo. Tente baixar novamente.');
  let type='';
  if(bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70&&bytes[4]===45)type='application/pdf';
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)type='image/jpeg';
  else if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71){pngSize(bytes);type='image/png';}
  if(!type || blob.type&&blob.type!==type)fail('O formato do termo não corresponde ao arquivo enviado.');
  return {bytes,type};
}
async function sha256(bytes) {
  if(!globalThis.crypto?.subtle)fail('O navegador não oferece a verificação necessária. Use o aplicativo em uma conexão segura.');
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function digestTermBlob(blob) {return sha256((await originalBytes(blob)).bytes);}

function effectiveSignatures(signatures, {uploadVersion,uploadedAt,review,hash}) {
  if(!Array.isArray(signatures) || signatures.length<1 || signatures.length>20)fail('Nenhuma assinatura eletrônica válida está disponível para este termo.');
  const seen=new Set();
  return signatures.map(signature=>{
    if(!signature || !['advisor','coordinator'].includes(signature.role) || !idPattern.test(signature.signerUid||'') || typeof signature.signerName!=='string' || !string(signature.signerName,101) || signature.signerName.length>100 || signature.consent!==true || !stamp(signature.signedAt) || signature.signedAt<review.reviewedAt || signature.uploadVersion!==uploadVersion || signature.uploadedAt!==uploadedAt || signature.reviewedAt!==review.reviewedAt || signature.documentSha256!==hash)fail('Uma assinatura pertence a outra versão do termo. Atualize a página e tente novamente.');
    if(signature.role==='advisor'&&!idPattern.test(signature.groupId||''))fail('A assinatura do orientador não informa um grupo válido.');
    if(signature.role==='coordinator'&&signature.groupId!=='')fail('O registro de assinatura da coordenação está inconsistente.');
    const key=`${signature.role}/${signature.signerUid}`;
    if(seen.has(key))fail('O registro contém uma assinatura duplicada.');
    seen.add(key);
    return {...signature,imageBytes:validateSignatureImage(signature.signaturePng)};
  }).sort((a,b)=>a.role.localeCompare(b.role)||a.signedAt-b.signedAt||a.signerUid.localeCompare(b.signerUid));
}
function date(value) {return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(value));}
function compatible(text,font) {
  return Array.from(string(text,4000).replace(/[\u2010-\u2015]/g,'-')).map(character=>{try{font.encodeText(character);return character;}catch{return '?';}}).join('');
}
function lines(text,font,size,width) {
  const value=compatible(text,font);const result=[];let line='';
  for(const word of value.split(/\s+/)){
    let rest=word;
    while(font.widthOfTextAtSize(rest,size)>width){
      if(line){result.push(line);line='';}
      let chunk='';
      for(const char of rest){if(font.widthOfTextAtSize(chunk+char,size)>width)break;chunk+=char;}
      if(!chunk)break;result.push(chunk);rest=rest.slice(chunk.length);
    }
    const next=line?`${line} ${rest}`:rest;
    if(font.widthOfTextAtSize(next,size)>width&&line){result.push(line);line=rest;}else line=next;
  }
  if(line)result.push(line);return result.length?result:[''];
}

/**
 * Build a consultation copy plus authenticated signature records. This does not
 * produce an ICP-Brasil/Gov.br certificate. The exact original is also attached.
 */
export async function createSignedTermPdf({originalBlob,filename:originalFilename,studentName,year=2027,review,signatures,uploadVersion='',uploadedAt}={}) {
  if(!stamp(uploadedAt) || typeof uploadVersion!=='string' || uploadVersion!==''&&!idPattern.test(uploadVersion) || !Number.isInteger(Number(year)) || Number(year)<2027 || Number(year)>2100)fail('A versão do termo não pôde ser identificada. Baixe o arquivo novamente.');
  if(!review || review.status!=='approved' || !stamp(review.reviewedAt) || review.reviewedAt<uploadedAt || review.uploadVersion!==uploadVersion || review.uploadedAt!==uploadedAt || !idPattern.test(review.reviewerUid||'') || !string(review.reviewerName,101))fail('A coordenação precisa aceitar esta versão do termo antes das assinaturas.');
  const {bytes,type}=await originalBytes(originalBlob);
  const hash=await sha256(bytes);
  if(!digestPattern.test(hash))fail('Não foi possível verificar o termo original.');
  const records=effectiveSignatures(signatures,{uploadVersion,uploadedAt,review,hash});
  const pdf=await PDFDocument.create();
  let originalPages=1;
  try{
    if(type==='application/pdf'){
      const input=await PDFDocument.load(bytes,{updateMetadata:false});
      originalPages=input.getPageCount();
      if(originalPages<1||originalPages>MAX_PAGES)fail('O termo deve ter entre 1 e 30 páginas.');
      const copied=await pdf.copyPages(input,input.getPageIndices());copied.forEach(page=>pdf.addPage(page));
    }else{
      if(type==='image/png'){const dimensions=pngSize(bytes);if(dimensions.width*dimensions.height>16000000)fail('Reduza a resolução da foto do termo antes de gerar o PDF.');}
      const image=type==='image/png'?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);
      if(image.width<1||image.height<1||image.width*image.height>16000000)fail('Reduza a resolução da foto do termo antes de gerar o PDF.');
      const page=pdf.addPage(PAGE),scale=Math.min((PAGE[0]-48)/image.width,(PAGE[1]-48)/image.height);
      page.drawImage(image,{x:(PAGE[0]-image.width*scale)/2,y:(PAGE[1]-image.height*scale)/2,width:image.width*scale,height:image.height*scale});
    }
  }catch(error){
    if(/resolução|30 páginas/.test(error.message))throw error;
    fail('Não foi possível abrir o termo. Use um PDF sem senha ou uma foto JPG/PNG legível.');
  }
  const originalName=string(originalFilename||`termo-original-${year}`,180).replace(/[\\/<>:"|?*]/g,'_')||`termo-original-${year}`;
  await pdf.attach(bytes,originalName,{mimeType:type,description:'Arquivo original enviado pelo estudante, sem alterações.',creationDate:new Date(uploadedAt),modificationDate:new Date(uploadedAt)});
  const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),mono=await pdf.embedFont(StandardFonts.Courier);
  let page,y;
  const start=()=>{
    page=pdf.addPage(PAGE);page.drawRectangle({x:0,y:PAGE[1]-91,width:PAGE[0],height:91,color:NAVY});
    page.drawText("MÁXIMU'S  |  INIC "+Number(year),{x:42,y:PAGE[1]-34,font:bold,size:11,color:rgb(1,1,1)});
    page.drawText('Registro de assinaturas eletrônicas',{x:42,y:PAGE[1]-61,font:bold,size:18,color:rgb(1,1,1)});
    page.drawRectangle({x:42,y:PAGE[1]-80,width:62,height:3,color:ORANGE});y=PAGE[1]-116;
  };
  const ensure=height=>{if(!page||y-height<77)start();};
  const text=(value,{size=10,font=regular,color=INK,gap=7,width=511}={})=>{
    const rows=lines(value,font,size,width);ensure(rows.length*(size+4)+gap);
    rows.forEach(row=>{page.drawText(row,{x:42,y:y-size,font,size,color});y-=size+4;});y-=gap;
  };
  start();
  text('Assinaturas registradas por contas autenticadas no aplicativo Máximu’s INIC.',{size:10,color:MUTED,gap:13});
  text(`Estudante: ${string(studentName||'Estudante',100)}`,{font:bold,size:11});
  text(`Arquivo: ${originalName}`,{size:9});
  text(`Envio: ${date(uploadedAt)}  |  ${originalPages} página(s) de conteúdo original`,{size:9});
  text(`Versão: ${uploadVersion||'legado - identificado pela data do envio'}`,{size:8,color:MUTED});
  text(`SHA-256 do arquivo original:`,{font:bold,size:8,gap:1});
  text(hash,{font:mono,size:8,color:MUTED,gap:12});
  text(`Recebimento confirmado por ${string(review.reviewerName,100)} em ${date(review.reviewedAt)}.`,{size:9});
  text(`Conta da coordenação: ${review.reviewerUid}`,{size:8,color:MUTED,gap:15});
  for(const record of records){
    const nameRows=lines(record.signerName,bold,11,475);
    const accountRows=lines(`Conta: ${record.signerUid}`,regular,8,475);
    const groupRows=record.groupId?lines(`Grupo: ${record.groupId}`,regular,8,475):[];
    const extraRows=Math.max(0,accountRows.length-1)+Math.max(0,groupRows.length-1);
    const height=(record.imageBytes?160:118)+Math.max(0,nameRows.length-1)*15+extraRows*14;
    ensure(height+14);const top=y;
    page.drawRectangle({x:42,y:top-height,width:511,height,color:SOFT,borderColor:rgb(.84,.85,.91),borderWidth:.6});
    page.drawRectangle({x:42,y:top-height,width:3,height,color:record.role==='advisor'?NAVY:ORANGE});
    const role=record.role==='advisor'?'PROFESSOR(A) ORIENTADOR(A)':'COORDENAÇÃO';
    page.drawText(role,{x:58,y:top-20,font:bold,size:8,color:NAVY});
    nameRows.forEach((row,i)=>page.drawText(row,{x:58,y:top-39-i*15,font:bold,size:11,color:INK}));
    const base=top-43-Math.max(0,nameRows.length-1)*15;
    if(record.imageBytes){
      let image;try{image=await pdf.embedPng(record.imageBytes);}catch{fail('A imagem da assinatura não pôde ser aberta. Refaça a assinatura.');}
      const scale=Math.min(280/image.width,51/image.height);
      page.drawImage(image,{x:58,y:base-56,width:image.width*scale,height:image.height*scale});
    }
    const info=record.imageBytes?base-70:base-16;
    page.drawText(`Assinado em ${date(record.signedAt)} (horário de Brasília)`,{x:58,y:info,font:regular,size:8,color:MUTED});
    let auditY=info-14;
    for(const row of [...accountRows,...groupRows]){page.drawText(row,{x:58,y:auditY,font:regular,size:8,color:MUTED});auditY-=14;}
    page.drawText('Consentimento expresso registrado no aplicativo.',{x:58,y:auditY,font:regular,size:8,color:MUTED});
    y=top-height-14;
  }
  const missing=['advisor','coordinator'].filter(role=>!records.some(record=>record.role===role));
  if(missing.length)text('Ainda sem assinatura eletrônica: '+missing.map(role=>role==='advisor'?'professor(a) orientador(a)':'coordenação').join(' e ')+'.',{size:9,color:MUTED,gap:10});
  text('Este registro usa a conta autenticada e o consentimento de quem assina. Não é um certificado ICP-Brasil ou Gov.br.',{size:8,color:MUTED,gap:7});
  text('Cópia para consulta. O original está anexado sem alterações; eventual certificado digital anterior deve ser verificado nesse arquivo original.',{size:8,color:MUTED,gap:0});
  const total=pdf.getPageCount();
  for(let i=originalPages;i<total;i++)pdf.getPage(i).drawText(`Máximu's INIC  |  Registro ${i-originalPages+1}/${total-originalPages}`,{x:42,y:35,font:regular,size:8,color:MUTED});
  pdf.setTitle(`Termo INIC ${year} - registro de assinaturas`);pdf.setAuthor("Escola Máximu's");pdf.setCreator("Máximu's INIC - registro eletrônico");pdf.setSubject(`SHA-256 do original: ${hash}`);
  const output=await pdf.save({useObjectStreams:true});
  return {blob:new Blob([output],{type:'application/pdf'}),filename:filename(originalName,'-com-assinaturas'),sha256:hash};
}
