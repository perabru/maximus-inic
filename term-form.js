import { createSignaturePad } from './signature-pad.js?v=20261112-12';

const form=document.getElementById('compliance-form');
const status=document.getElementById('term-status');
const download=document.getElementById('download-filled-document');
const print=document.getElementById('print-document');
const clear=document.getElementById('clear-document');
const roles=['student','guardian'];
const pads=new Map();
let busy=false,dirty=false,resetting=false,downloadUrl=null;

function message(text,error=false){
  status.textContent=text;
  status.classList.toggle('is-error',error);
}
function field(name){return form.querySelector('[name="'+name+'"]');}
function mirrorGuardian(){
  form.querySelector('[data-guardian-name]').textContent=field('guardian').value.trim();
}
function updateRole(role,change){
  const pad=pads.get(role);
  const empty=change?.empty??(!pad||pad.isEmpty());
  const preview=form.querySelector('[data-signature-preview="'+role+'"]');
  form.querySelector('[data-signature-placeholder="'+role+'"]').hidden=!empty;
  form.querySelector('[data-signature-action="undo"][data-signature-role="'+role+'"]').disabled=busy||empty;
  form.querySelector('[data-signature-action="clear"][data-signature-role="'+role+'"]').disabled=busy||empty;
  const label=form.querySelector('[data-signature-status="'+role+'"]');
  label.textContent=empty?'Sem assinatura desenhada.':'Assinatura posicionada no termo.';
  if(empty){preview.hidden=true;preview.removeAttribute('src');}
  else if(pad){
    try{preview.src=pad.toPng();preview.hidden=false;}
    catch(error){preview.hidden=true;preview.removeAttribute('src');label.textContent='Não foi possível preparar a assinatura.';message(error.message,true);}
  }
}
function refreshPreviews(){roles.forEach(role=>updateRole(role));mirrorGuardian();}
function applyPrintImages(payload){
  for(const role of roles){
    const image=form.querySelector('[data-signature-preview="'+role+'"]');
    const source=payload.signatures[role];
    if(source){if(image.getAttribute('src')!==source)image.src=source;image.hidden=false;}
    else{image.hidden=true;image.removeAttribute('src');}
  }
  mirrorGuardian();
  document.body.classList.remove('has-term-print-error');
}
function setBusy(value){
  busy=value;download.disabled=value;print.disabled=value;clear.disabled=value;
  form.inert=value;
  form.setAttribute('aria-busy',String(value));
  download.textContent=value?'Preparando documento…':'Baixar PDF preenchido';
  roles.forEach(role=>{
    const pad=pads.get(role),empty=!pad||pad.isEmpty();
    form.querySelectorAll('[data-signature-role="'+role+'"]').forEach(button=>{button.disabled=value||empty;});
  });
}
function collect(){
  const fields={};
  for(const name of ['student','class','group','advisor','guardian','date'])fields[name]=field(name).value.trim();
  const signatures={};
  for(const role of roles){
    signatures[role]=pads.get(role)?.toPng()||'';
    if(signatures[role]&&!fields.student)throw Object.assign(new Error('Preencha o nome do aluno para incluir as assinaturas.'),{field:'student'});
    if(signatures[role]&&role==='guardian'&&!fields.guardian)throw Object.assign(new Error('Preencha o nome completo do responsável para incluir sua assinatura.'),{field:'guardian'});
  }
  return {fields,signatures};
}
function savePdf(blob,filename){
  if(downloadUrl)URL.revokeObjectURL(downloadUrl);
  downloadUrl=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=downloadUrl;link.download=filename;link.hidden=true;
  document.body.append(link);
  try{link.click();}finally{link.remove();}
  const current=downloadUrl;
  window.setTimeout(()=>{URL.revokeObjectURL(current);if(downloadUrl===current)downloadUrl=null;},60000);
}

for(const role of roles){
  const canvas=form.querySelector('[data-signature-canvas="'+role+'"]');
  canvas.tabIndex=0;
  canvas.addEventListener('pointerdown',event=>{
    if(busy||event.button!==undefined&&event.button!==0||event.isPrimary===false)return;
    canvas.focus({preventScroll:true});
    dirty=true;
  });
  try{
    const pad=createSignaturePad(canvas,{
      onChange:change=>{updateRole(role,change);if(pads.has(role)&&!resetting)dirty=true;},
      onError:error=>message(error.message,true)
    });
    pads.set(role,pad);updateRole(role);
    form.querySelectorAll('[data-signature-role="'+role+'"]').forEach(button=>{
      button.addEventListener('click',()=>{if(!busy)pad[button.dataset.signatureAction]();});
    });
    canvas.addEventListener('keydown',event=>{
      if(!busy&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.shiftKey){event.preventDefault();pad.undo();}
    });
  }catch(error){
    const editor=form.querySelector('[data-signature-editor="'+role+'"]');
    editor.classList.add('signature-editor-unavailable');
    form.querySelector('[data-signature-status="'+role+'"]').textContent='O desenho não está disponível neste navegador. Use o modelo para assinar no papel.';
    message(error.message,true);
  }
}

form.addEventListener('submit',event=>event.preventDefault());
form.addEventListener('input',()=>{dirty=true;mirrorGuardian();});
clear.addEventListener('click',()=>{
  if(busy)return;
  resetting=true;
  try{form.reset();pads.forEach(pad=>pad.clear());refreshPreviews();}
  finally{resetting=false;dirty=false;}
  message('Preenchimento e assinaturas limpos.');
  field('student').focus({preventScroll:true});
});
download.addEventListener('click',async()=>{
  if(busy)return;
  setBusy(true);message('Preparando o PDF com os dados e as assinaturas…');
  let focus=null;
  try{
    const payload=collect();
    const {createFilledTermPdf}=await import('./term-pdf.js?v=20261112-12');
    const result=await createFilledTermPdf(payload);
    savePdf(result.blob,result.filename);
    message('PDF preparado. Salve o arquivo e envie em Meu termo, no aplicativo.');
  }catch(error){message(error.message||'Não foi possível preparar o PDF. Tente novamente.',true);focus=error.field;}
  finally{setBusy(false);if(focus)field(focus)?.focus();}
});
print.addEventListener('click',async()=>{
  if(busy)return;
  setBusy(true);let focus=null;
  try{
    const payload=collect();applyPrintImages(payload);
    await Promise.all([...form.querySelectorAll('[data-signature-preview]')].filter(image=>!image.hidden).map(image=>image.decode?image.decode():Promise.resolve()));
    message('O termo está pronto para impressão.');
    window.print();
  }catch(error){message(error.message||'Não foi possível preparar as assinaturas para impressão.',true);focus=error.field;}
  finally{setBusy(false);if(focus)field(focus)?.focus();}
});
window.addEventListener('beforeprint',()=>{
  if(busy)return;
  try{applyPrintImages(collect());}
  catch(error){
    document.getElementById('term-print-error').textContent=error.message+' Volte ao formulário e tente novamente antes de imprimir.';
    document.body.classList.add('has-term-print-error');
    message(error.message,true);
  }
});
window.addEventListener('afterprint',()=>document.body.classList.remove('has-term-print-error'));
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',event=>{
  if(event.persisted)return;
  pads.forEach(pad=>pad.destroy());
  if(downloadUrl)URL.revokeObjectURL(downloadUrl);
});
mirrorGuardian();download.disabled=false;
if(pads.size===2)message('Preencha os dados. As assinaturas desenhadas serão incluídas no PDF e na impressão.');
