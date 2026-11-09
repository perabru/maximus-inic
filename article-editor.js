import {articleSections, articleSectionLimit, articleWordCount, articlePlainText} from './article-content.js?v=20261109-1';

const make=(tag,css='',text)=>{const el=document.createElement(tag);if(css)el.className=css;if(text!==undefined)el.textContent=String(text);return el;};
const control=(text,css,handler)=>{const el=make('button',css,text);el.type='button';el.addEventListener('click',handler);return el;};
let sequence=0;

// One controller survives route changes within this session. Unsaved text is
// never stored in the public service-worker cache or browser persistent storage.
export function createArticleEditor({group,user,onSave,subscribe,saveDelay=800}={}) {
  const prefix=`article-${++sequence}`;
  let disposed=false,ready=false,connected=false,readError=null,activeKey='introduction',previewMode=false;
  let stop=()=>{};
  const entries=new Map(),timers=new Map(),downloads=new Set();
  const element=make('section','inic-article');element.dataset.groupId=group.id;
  const head=make('div','article-heading'),headCopy=make('div');
  headCopy.append(make('p','eyebrow','ESCRITA EM GRUPO'),make('h3','','Artigo INIC'),make('p','','Escrevam por etapas. O texto é compartilhado com os integrantes, o orientador e a coordenação.'));
  const actions=make('div','article-actions');
  const saveButton=control('Salvar agora','button primary compact',()=>flush());
  const previewButton=control('Ver artigo montado','button secondary compact',()=>{previewMode=!previewMode;paintMode();});
  const downloadButton=control('Baixar rascunho','button secondary compact',()=>download());
  actions.append(saveButton,previewButton,downloadButton);head.append(headCopy,actions);element.append(head);
  const status=make('p','article-sync','Conectando ao artigo do grupo…');status.setAttribute('role','status');status.setAttribute('aria-live','polite');element.append(status);
  const layout=make('div','article-layout'),nav=make('nav','article-sections');nav.setAttribute('aria-label','Seções do artigo');
  const workspace=make('div','article-workspace');layout.append(nav,workspace);element.append(layout);
  const preview=make('section','article-preview');preview.setAttribute('aria-label','Prévia do artigo');preview.hidden=true;element.append(preview);
  element.append(make('p','article-model-note','Este é um rascunho de escrita. Confira o modelo oficial da sua edição do INIC com o orientador antes de submeter.'));

  for(const [index,section] of articleSections.entries()) {
    const tab=control('','article-section',()=>{activeKey=section.key;previewMode=false;paintMode();});
    const number=make('span','article-section-number',String(index+1).padStart(2,'0'));
    const tabCopy=make('span');tabCopy.append(make('strong','',section.title),make('small','',section.short));
    const marker=make('span','article-section-marker','');marker.setAttribute('aria-hidden','true');tab.append(number,tabCopy,marker);nav.append(tab);
    const panel=make('section','article-section-panel');panel.id=`${prefix}-${section.key}-panel`;tab.setAttribute('aria-controls',panel.id);
    const heading=make('div','article-section-heading');heading.append(make('p','eyebrow',`ETAPA ${index+1} DE ${articleSections.length}`),make('h4','',section.title));panel.append(heading);
    const guidance=make('aside','article-guidance');guidance.id=`${prefix}-${section.key}-help`;guidance.append(make('strong','','O que escrever aqui?'),make('p','',section.help));
    if(section.prompts){const list=make('ul');for(const prompt of section.prompts)list.append(make('li','',prompt));guidance.append(list);}
    if(section.example){const details=make('details','article-example');details.append(make('summary','','Ver um exemplo'),make('p','',section.example),make('small','','Exemplo de orientação; escreva a partir dos dados do seu próprio projeto.'));guidance.append(details);}
    if(section.avoid)guidance.append(make('p','article-avoid',section.avoid));
    if(section.courses?.length){const courses=make('div','article-courses');courses.append(make('strong','','Aprenda com uma aula'));
      for(const course of section.courses){const a=make('a','article-course-link',course.title+' ↗');a.href=course.url;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label',`${course.title} no Drive de Pobre (abre em nova aba)`);courses.append(a);}
      courses.append(make('small','','Drive de Pobre · material de apoio à escrita'));guidance.append(courses);
    }
    panel.append(guidance);
    const label=make('label','article-input-label',`Texto: ${section.title}`);label.htmlFor=`${prefix}-${section.key}`;
    const input=make('textarea','article-input');input.id=label.htmlFor;input.name=section.key;input.rows=['title','keywords'].includes(section.key)?3:12;input.maxLength=articleSectionLimit(section.key);input.placeholder=section.placeholder;input.disabled=true;input.setAttribute('aria-describedby',`${guidance.id} ${prefix}-${section.key}-count`);
    const row=make('div','article-field-meta'),count=make('span');count.id=`${prefix}-${section.key}-count`;const audit=make('span','article-audit');row.append(count,audit);
    const conflict=make('div','article-conflict');conflict.hidden=true;conflict.setAttribute('role','alert');
    const conflictCopy=make('p'),remote=make('div','article-remote');
    conflict.append(make('strong','','Esta seção foi alterada por outra pessoa.'),conflictCopy,make('p','','Seu texto continua no campo acima. Compare as versões antes de salvar.'),remote);
    const conflictActions=make('div','article-actions');
    conflictActions.append(control('Usar versão compartilhada','button secondary compact',()=>resolve(section.key,'remote')),control('Salvar meu texto revisado','button primary compact',()=>resolve(section.key,'mine')));conflict.append(conflictActions);
    const error=make('p','article-field-error');error.setAttribute('role','alert');error.hidden=true;
    panel.append(label,input,row,error,conflict);workspace.append(panel);
    const entry={section,tab,marker,panel,input,count,audit,conflict,conflictCopy,remote,error,record:null,text:'',baseRevision:0,baseText:'',dirty:false,pending:null,conflicted:false,failure:''};entries.set(section.key,entry);
    input.addEventListener('input',()=>{if(disposed||!ready||readError)return;entry.text=input.value;entry.dirty=entry.text!==entry.baseText;entry.failure='';paintEntry(entry);paintStatus();schedule(section.key);});
    input.addEventListener('blur',()=>{if(!disposed)save(section.key);});
  }

  function paintEntry(entry) {
    const {section,input}=entry;
    // Never recreate the textarea when a remote event arrives: caret and focus survive.
    if(input.value!==entry.text)input.value=entry.text;
    input.disabled=disposed||!ready||Boolean(readError);
    entry.count.textContent=`${articleWordCount(entry.text)} palavras · ${entry.text.length.toLocaleString('pt-BR')}/${articleSectionLimit(section.key).toLocaleString('pt-BR')} caracteres`;
    const record=entry.record;
    entry.audit.textContent=record?.updatedAt?`Última alteração: ${record.authorName||'Integrante'} · ${new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(record.updatedAt))}`:'Seção ainda não salva';
    entry.marker.textContent=entry.conflicted?'!':entry.pending||entry.dirty?'•':entry.text.trim()?'✓':'';
    entry.tab.dataset.state=entry.conflicted?'conflict':entry.pending||entry.dirty?'pending':entry.text.trim()?'saved':'empty';
    entry.tab.setAttribute('aria-label',`${section.title}${entry.conflicted?', comparar alterações':entry.dirty?', alteração pendente':entry.text.trim()?', texto salvo':''}`);
    entry.conflict.hidden=!entry.conflicted;
    if(entry.conflicted){entry.conflictCopy.textContent=`A versão compartilhada foi atualizada por ${record?.authorName||'outro integrante'}.`;entry.remote.textContent=record?.text||'(Seção vazia)';}
    entry.error.hidden=!entry.failure;entry.error.textContent=entry.failure;
  }
  function paintStatus() {
    if(disposed)return;
    const list=[...entries.values()],dirty=list.some(e=>e.dirty),pending=list.some(e=>e.pending),conflict=list.some(e=>e.conflicted),failure=list.some(e=>e.failure);
    status.dataset.state=readError||failure?'error':conflict?'conflict':!connected||dirty||pending?'pending':'saved';
    status.textContent=readError?`Não foi possível abrir o artigo. ${readError.message||'Confira seu acesso e recarregue a página.'}`:!ready?'Carregando o artigo compartilhado…':!connected?'Sem conexão com o servidor. Mantenha esta página aberta; o texto pendente será enviado ao reconectar.':conflict?'Há alterações na mesma seção. Compare as versões para continuar.':pending?'Salvando no grupo…':failure?'Algumas alterações não foram confirmadas. Use “Salvar agora” para tentar novamente.':dirty?'Alterações pendentes · salvamento automático em instantes.':'Todas as alterações estão salvas no grupo.';
    saveButton.disabled=disposed||!ready||!connected||Boolean(readError)||(!dirty&&!failure);
    downloadButton.disabled=!ready||Boolean(readError);
  }
  function paintMode() {
    layout.hidden=previewMode;preview.hidden=!previewMode;previewButton.textContent=previewMode?'Voltar à escrita':'Ver artigo montado';previewButton.setAttribute('aria-pressed',String(previewMode));
    for(const [key,entry]of entries){entry.panel.hidden=key!==activeKey;if(key===activeKey)entry.tab.setAttribute('aria-current','step');else entry.tab.removeAttribute('aria-current');}
    if(previewMode)paintPreview();
  }
  function paintPreview() {
    preview.replaceChildren(make('p','eyebrow','PRÉVIA · RASCUNHO DO GRUPO'));
    if([...entries.values()].some(e=>e.dirty||e.pending||e.conflicted))preview.append(make('p','article-preview-note','A prévia inclui seu texto pendente. Confira o estado do salvamento antes de sair.'));
    for(const {key,title}of articleSections){const entry=entries.get(key);if(key==='title'){preview.append(make('h3','article-paper-title',entry.text||group.topic||group.name));continue;}const section=make('section','article-paper-section');section.append(make('h4','',title),make('p',entry.text?'':'article-empty',entry.text||'Em elaboração'));preview.append(section);}
  }
  function schedule(key){clearTimeout(timers.get(key));timers.delete(key);const entry=entries.get(key);if(!disposed&&connected&&ready&&!readError&&entry.dirty&&!entry.conflicted&&!entry.pending)timers.set(key,setTimeout(()=>{timers.delete(key);save(key);},saveDelay));}
  function adopt(entry,record){entry.record=record;entry.baseRevision=record?.revision||0;entry.baseText=record?.text||'';entry.text=entry.baseText;entry.dirty=false;entry.conflicted=false;entry.failure='';}
  function receive({sections={},connected:online,ready:loaded,error,revoked=false}={}) {
    if(disposed)return;
    if(error){readError=error;ready=false;for(const timer of timers.values())clearTimeout(timer);timers.clear();for(const entry of entries.values()){if(revoked){adopt(entry,null);entry.remote.textContent='';entry.pending=null;}paintEntry(entry);}preview.replaceChildren();paintStatus();return;}
    if(typeof online==='boolean')connected=online;
    if(loaded===true){ready=true;readError=null;
      for(const [key,entry]of entries){
        const record=sections[key]||null;
        // Firebase emits optimistic local writes; they are not server confirmations.
        if(entry.pending&&record?.revision===entry.pending.revision&&record?.updatedBy===user.uid&&record?.text===entry.pending.text)continue;
        if(!entry.dirty&&!entry.pending)adopt(entry,record);
        else if((record?.revision||0)!==entry.baseRevision|| (record?.text||'')!==entry.baseText){entry.record=record;entry.conflicted=entry.text!==(record?.text||'');if(!entry.conflicted&&!entry.pending)adopt(entry,record);}
        paintEntry(entry);
      }
    }
    for(const key of entries.keys())schedule(key);
    paintStatus();if(previewMode)paintPreview();
  }
  async function save(key) {
    const entry=entries.get(key);clearTimeout(timers.get(key));timers.delete(key);
    if(disposed||!ready||!connected||readError||!entry.dirty||entry.pending||entry.conflicted)return;
    const sent={text:entry.text,revision:entry.baseRevision+1};entry.pending=sent;entry.failure='';paintEntry(entry);paintStatus();
    try {
      const record=await onSave(key,sent.text,entry.baseRevision);
      if(disposed)return;
      entry.pending=null;
      const latest=(entry.record?.revision||0)>(record?.revision||0)?entry.record:record;
      if(entry.text===sent.text){adopt(entry,latest);}
      else if(latest?.text===sent.text){entry.record=latest;entry.baseRevision=latest.revision;entry.baseText=latest.text;entry.dirty=entry.text!==entry.baseText;entry.conflicted=false;}
      else {entry.record=latest;entry.conflicted=true;}
    } catch(error) {
      if(disposed)return;entry.pending=null;
      if(error.code==='article/conflict'){entry.record=error.remote||null;entry.conflicted=true;}
      else entry.failure=error.message||'Não foi possível salvar. Confira a conexão e tente novamente.';
    }
    paintEntry(entry);paintStatus();if(previewMode)paintPreview();if(entry.dirty&&!entry.failure&&!entry.conflicted)schedule(key);
  }
  function resolve(key,choice){const entry=entries.get(key);if(disposed||entry.pending||!entry.conflicted)return;if(choice==='remote')adopt(entry,entry.record);else {entry.baseRevision=entry.record?.revision||0;entry.baseText=entry.record?.text||'';entry.conflicted=false;entry.dirty=entry.text!==entry.baseText;entry.failure='';save(key);}paintEntry(entry);paintStatus();if(previewMode)paintPreview();}
  function flush(){return Promise.all([...entries.keys()].map(save));}
  function download(){if(disposed||!ready||readError)return;const sections=Object.fromEntries([...entries].map(([key,entry])=>[key,{text:entry.text}]));const blob=new Blob([articlePlainText({group,sections})],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);downloads.add(url);const a=make('a');a.href=url;a.download=`artigo-inic-${group.year||2027}.txt`;element.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},1000);}
  paintMode();for(const entry of entries.values())paintEntry(entry);paintStatus();
  try{stop=subscribe(receive)||(()=>{});}catch(error){receive({error});}
  return {element,flush,hasUnsaved:()=>!disposed&&[...entries.values()].some(e=>e.dirty||e.pending),destroy(){if(disposed)return;disposed=true;stop();for(const timer of timers.values())clearTimeout(timer);timers.clear();for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();for(const entry of entries.values()){entry.text='';entry.record=null;entry.input.value='';entry.input.disabled=true;entry.remote.textContent='';}element.replaceChildren();entries.clear();}};
}
