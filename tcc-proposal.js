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
  let mode=initial?.mode==='file'||file?'file':'text';
  const id=`tcc-proposal-${++editorSequence}`;
  const element=make('fieldset','tcc-proposal-editor');
  element.append(make('legend','','Proposta para o orientador'),make('p','tcc-proposal-intro','Escreva até quatro tópicos ou anexe sua proposta. O professor poderá consultá-la antes de responder ao convite.'));
  const options=make('div','tcc-proposal-options');
  const radios=[];
  for(const [option,label] of [['text','Escrever proposta'],['file','Anexar proposta']]) {
    const row=make('label','tcc-proposal-option'),input=make('input');input.type='radio';input.name=id+'-mode';input.value=option;input.checked=mode===option;
    row.append(input,make('span','',label));options.append(row);radios.push(input);
    input.addEventListener('change',()=>{if(disposed||!input.checked)return;mode=option;paint();onChange();});
  }
  element.append(options);
  const textPanel=make('div','tcc-proposal-topics'),fields=new Map();
  for(const topic of proposalTopics) {
    const label=make('label','tcc-proposal-field'),input=make('textarea');input.name=`${id}-${topic.key}`;input.rows=3;input.maxLength=proposalLimits.maxTopicLength;input.value=typeof initial?.topics?.[topic.key]==='string'?initial.topics[topic.key]:'';
    input.addEventListener('input',()=>{if(!disposed)onChange();});
    label.append(make('span','',topic.title),make('small','',topic.help),input);textPanel.append(label);fields.set(topic.key,input);
  }
  textPanel.append(make('p','tcc-proposal-help','Preencha ao menos um tópico. Use até 2.000 caracteres em cada campo.'));
  const filePanel=make('div','tcc-proposal-file'),fileLabel=make('label','tcc-proposal-field'),fileInput=make('input');fileInput.type='file';fileInput.name=id+'-file';fileInput.accept='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
  fileLabel.append(make('span','','Arquivo da proposta'),make('small','','PDF, JPG ou PNG · até 3 MiB'),fileInput);
  const fileStatus=make('p','tcc-proposal-file-status');fileStatus.setAttribute('role','status');
  fileInput.addEventListener('change',()=>{if(disposed)return;file=fileInput.files?.[0]||null;paintFile();onChange();});
  filePanel.append(fileLabel,fileStatus);element.append(textPanel,filePanel);
  function paintFile(){fileStatus.textContent=file?`${file.name} · ${Math.ceil(file.size/1024)} KiB`:initial?.mode==='file'&&initial.filename?`Arquivo atual: ${initial.filename}. Escolha outro somente se quiser substituir.`:'Nenhum arquivo selecionado.';}
  function paint(){textPanel.hidden=mode!=='text';filePanel.hidden=mode!=='file';for(const input of fields.values())input.disabled=mode!=='text';fileInput.disabled=mode!=='file';paintFile();}
  paint();
  return {
    element,
    read(){
      if(disposed)throw new Error('Abra a proposta novamente.');
      if(mode==='file'){
        if(file)return {proposal:{mode:'file'},proposalFile:validateProposalFile(file)};
        if(initial?.mode==='file'&&initial.filename&&initial.version)return {proposal:{...initial,mode:'file'},proposalFile:null};
        throw new Error('Anexe sua proposta antes de enviar o convite.');
      }
      const topics={};for(const {key} of proposalTopics){const text=fields.get(key).value.trim();if(text.length>proposalLimits.maxTopicLength)throw new Error('Use até 2.000 caracteres por tópico.');if(text)topics[key]=text;}
      if(!Object.keys(topics).length)throw new Error('Escreva ao menos um tópico ou anexe a proposta.');
      return {proposal:{mode:'text',topics},proposalFile:null};
    },
    destroy(){disposed=true;file=null;fileInput.value='';for(const input of [...radios,...fields.values(),fileInput])input.disabled=true;}
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
