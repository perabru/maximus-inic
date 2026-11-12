// Proposal editor has no network access or persistent storage. Files stay in
// memory until the caller submits the group's authenticated atomic operation.
export const proposalLimits=Object.freeze({maxBytes:3*1024*1024,maxTopicLength:2000});
export const proposalTopics=Object.freeze([
  {key:'problem',title:'Tema e problema',help:'Qual problema vocês querem investigar ou resolver?'},
  {key:'objective',title:'Objetivo',help:'O que vocês pretendem alcançar com o trabalho?'},
  {key:'method',title:'Como será feito',help:'Quais etapas, recursos ou testes vocês pretendem usar?'},
  {key:'expectedResult',title:'Resultado esperado',help:'O que vocês pretendem entregar ou demonstrar?'}
]);
let editorSequence=0;
const make=(tag,className='',text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;};
const allowedTypes=new Set(['application/pdf','image/jpeg','image/png']);

export function validateProposalFile(file) {
  if(!file||typeof file.name!=='string'||!Number.isFinite(file.size)||file.size<=0)throw new Error('Selecione o arquivo da proposta.');
  if(file.size>proposalLimits.maxBytes)throw new Error('A proposta deve ter até 3 MiB.');
  const extension=file.name.split('.').pop().toLowerCase();
  const expectedType={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'}[extension];
  if(!allowedTypes.has(file.type)||expectedType!==file.type)throw new Error('Envie a proposta em PDF, JPG ou PNG.');
  return file;
}

export function createProposalEditor({value=null,proposalFile=null,onChange=()=>{}}={}) {
  const initial=value&&typeof value==='object'?value:null;
  let file=proposalFile||null,disposed=false;
  const canRetain=initial?.mode==='file'&&Boolean(initial.filename&&initial.version);
  const id=`tcc-proposal-${++editorSequence}`;
  const element=make('fieldset','tcc-proposal-editor');
  element.append(make('legend','','Anexar proposta'),make('p','tcc-proposal-intro','Envie o arquivo da proposta. O professor poderá consultá-lo antes de responder ao convite.'));
  if(initial?.mode==='text')element.append(make('p','tcc-proposal-legacy-note','Sua proposta anterior continua salva. Para atualizá-la, anexe um arquivo e confirme o envio.'));
  const filePanel=make('div','tcc-proposal-file'),fileLabel=make('label','tcc-proposal-field'),fileInput=make('input');fileInput.type='file';fileInput.name=id+'-file';fileInput.accept='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
  const fileHelp=make('small','','PDF, JPG ou PNG · até 3 MiB');fileHelp.id=id+'-help';
  fileLabel.append(make('span','','Arquivo da proposta'),fileHelp,fileInput);
  const fileStatus=make('p','tcc-proposal-file-status');fileStatus.id=id+'-status';fileStatus.setAttribute('role','status');fileStatus.setAttribute('aria-live','polite');fileStatus.setAttribute('aria-atomic','true');
  fileInput.setAttribute('aria-describedby',`${fileHelp.id} ${fileStatus.id}`);
  const clearSelection=make('button','tcc-proposal-clear','Remover seleção');clearSelection.type='button';
  clearSelection.addEventListener('click',()=>{if(disposed)return;file=null;fileInput.value='';paintFile();onChange();fileInput.focus?.();});
  fileInput.addEventListener('change',()=>{if(disposed)return;file=fileInput.files?.[0]||null;paintFile();onChange();});
  filePanel.append(fileLabel,fileStatus,clearSelection);element.append(filePanel);
  function paintFile(){
    let error='';if(file){try{validateProposalFile(file);}catch(reason){error=reason.message;}}
    fileInput.setAttribute('aria-invalid',String(Boolean(error)));
    filePanel.className=`tcc-proposal-file${error?' has-error':file||canRetain?' has-file':''}`;
    fileStatus.textContent=error||(file?`${file.name} · ${Math.ceil(file.size/1024)} KiB · Pronto para enviar.`:canRetain?`Arquivo atual: ${initial.filename}. Escolha outro somente se quiser substituir.`:'Nenhum arquivo selecionado. Escolha o arquivo da sua proposta.');
    clearSelection.hidden=!file;
  }
  paintFile();
  return {
    element,
    read(){
      if(disposed)throw new Error('Abra a proposta novamente.');
      if(file)return {proposal:{mode:'file'},proposalFile:validateProposalFile(file)};
      if(canRetain)return {proposal:{...initial,mode:'file'},proposalFile:null};
      throw new Error('Anexe sua proposta antes de enviar.');
    },
    destroy(){disposed=true;file=null;fileInput.value='';fileInput.disabled=true;clearSelection.disabled=true;}
  };
}

export function createProposalView({proposal,onDownload}={}) {
  const element=make('section','tcc-proposal-view');element.setAttribute('aria-label','Proposta de TCC');element.append(make('h4','','Proposta de TCC'));
  if(proposal?.mode==='text') {
    let count=0;
    for(const topic of proposalTopics){const text=proposal.topics?.[topic.key];if(typeof text!=='string'||!text.trim())continue;const section=make('section','tcc-proposal-topic');section.append(make('h5','',topic.title),make('p','',text));element.append(section);count++;}
    if(!count)element.append(make('p','tcc-proposal-help','A proposta ainda não foi preenchida.'));
  } else if(proposal?.mode==='file'&&proposal.filename) {
    element.append(make('p','tcc-proposal-help',`${proposal.filename}${proposal.size?` · ${Math.ceil(proposal.size/1024)} KiB`:''}`));
    if(typeof onDownload==='function'){const button=make('button','button secondary compact tcc-proposal-download','Abrir proposta');button.type='button';button.addEventListener('click',event=>onDownload(event));element.append(button);}
  } else element.append(make('p','tcc-proposal-help','Este convite foi enviado antes da exigência da proposta. Consulte o tema e a descrição do grupo.'));
  return element;
}
