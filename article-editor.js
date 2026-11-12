import {articleSections, articleSectionLimit, articleWordCount, articlePlainText} from './article-content.js?v=20261109-1';
import {createArticleRichField, articleRichPlain, articleRichRender} from './article-richtext.js?v=20261112-4';

const make=(tag,css='',text)=>{const el=document.createElement(tag);if(css)el.className=css;if(text!==undefined)el.textContent=String(text);return el;};
const control=(text,css,handler)=>{const el=make('button',css,text);el.type='button';el.addEventListener('click',handler);return el;};
let sequence=0;

// One controller survives route changes within this session. Unsaved text is
// never stored in the public service-worker cache or browser persistent storage.
export function createArticleEditor({group,user,onSave,subscribe,saveDelay=800}={}) {
  const prefix=`article-${++sequence}`;
  let disposed=false,accessRevoked=false,ready=false,connected=false,readError=null,activeKey='introduction',previewMode=false;
  let stop=()=>{};
  const entries=new Map(),timers=new Map(),downloads=new Set();
  const element=make('section','inic-article');element.dataset.groupId=group.id;
  const head=make('div','article-heading'),headCopy=make('div');
  headCopy.append(make('p','eyebrow','ESCRITA EM GRUPO'),make('h3','','Artigo INIC'),make('p','','Escrevam por etapas. O texto é compartilhado com os integrantes, o orientador e a coordenação.'));
  const actions=make('div','article-actions');
  const saveButton=control('Salvar agora','button primary compact',()=>flush());
  const previewButton=control('Ver artigo montado','button secondary compact',()=>{previewMode=!previewMode;paintMode();});
  const downloadButton=control('Baixar para Word','button secondary compact',()=>download('word'));
  const textButton=control('Baixar texto (.txt)','button secondary compact',()=>download('text'));
  actions.append(saveButton,previewButton,downloadButton,textButton);head.append(headCopy,actions);element.append(head);
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
    const label=make('div','article-input-label',`Texto: ${section.title}`);label.id=`${prefix}-${section.key}-label`;
    const rich=createArticleRichField({document,id:`${prefix}-${section.key}`,name:section.key,label:section.title,placeholder:section.placeholder,onChange:text=>{const entry=entries.get(section.key);if(disposed||!ready||readError||!entry)return;entry.text=text;entry.dirty=text!==entry.baseText;entry.failure='';paintEntry(entry);paintStatus();schedule(section.key);},onBlur:()=>{if(!disposed)save(section.key);},onComposition:active=>{const entry=entries.get(section.key);if(disposed||!ready||readError||!entry)return;entry.composing=active;if(!active&&!entry.pending&&entry.text===(entry.record?.text||''))adopt(entry,entry.record);paintEntry(entry);paintStatus();schedule(section.key);}});
    const input=rich.input;input.setAttribute('aria-labelledby',label.id);input.setAttribute('aria-describedby',`${guidance.id} ${prefix}-${section.key}-count`);if(['title','keywords'].includes(section.key))input.classList.add('article-input-short');
    const row=make('div','article-field-meta'),count=make('span');count.id=`${prefix}-${section.key}-count`;const audit=make('span','article-audit');row.append(count,audit);
    const conflict=make('div','article-conflict');conflict.hidden=true;conflict.setAttribute('role','alert');
    const conflictCopy=make('p'),remote=make('div','article-remote');
    conflict.append(make('strong','','Esta seção foi alterada por outra pessoa.'),conflictCopy,make('p','','Seu texto continua no campo acima. Compare as versões antes de salvar.'),remote);
    const conflictActions=make('div','article-actions');
    conflictActions.append(control('Usar versão compartilhada','button secondary compact',()=>resolve(section.key,'remote')),control('Salvar meu texto revisado','button primary compact',()=>resolve(section.key,'mine')));conflict.append(conflictActions);
    const error=make('p','article-field-error');error.setAttribute('role','alert');error.hidden=true;
    panel.append(label,rich.element,row,error,conflict);workspace.append(panel);
    const entry={section,tab,marker,panel,input,rich,count,audit,conflict,conflictCopy,remote,error,record:null,text:'',baseRevision:0,baseText:'',dirty:false,pending:null,conflicted:false,composing:false,failure:'',limitError:''};entries.set(section.key,entry);
  }

  function paintEntry(entry) {
    const {section,rich}=entry;
    // Local input already owns this exact value. Remote events never rebuild a
    // dirty editor, so its caret, selection and undo history survive.
    rich.setValue(entry.text);rich.setDisabled(disposed||!ready||Boolean(readError));
    const plain=articleRichPlain(entry.text),max=articleSectionLimit(section.key),formatted=entry.text!==plain;
    entry.limitError=entry.text.length>max?`Esta seção ultrapassou o limite de ${max.toLocaleString('pt-BR')} caracteres de armazenamento${formatted?' (texto e formatação)':''}. Seu texto está preservado neste campo. Reduza o conteúdo ou use Limpar formatação para poder salvar.`:'';
    entry.count.textContent=`${articleWordCount(plain)} palavras · ${plain.length.toLocaleString('pt-BR')} caracteres de texto · ${entry.text.length.toLocaleString('pt-BR')}/${max.toLocaleString('pt-BR')} usados${formatted?' com formatação':''}`;
    entry.count.classList.toggle('article-over-limit',Boolean(entry.limitError));
    const record=entry.record;
    entry.audit.textContent=record?.updatedAt?`Última alteração: ${record.authorName||'Integrante'} · ${new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(record.updatedAt))}`:'Seção ainda não salva';
    entry.marker.textContent=entry.conflicted||entry.limitError?'!':entry.pending||entry.dirty?'•':plain.trim()?'✓':'';
    entry.tab.dataset.state=entry.conflicted||entry.limitError?'conflict':entry.pending||entry.dirty?'pending':plain.trim()?'saved':'empty';
    entry.tab.setAttribute('aria-label',`${section.title}${entry.limitError?', limite excedido':entry.conflicted?', comparar alterações':entry.dirty?', alteração pendente':plain.trim()?', texto salvo':''}`);
    entry.conflict.hidden=!entry.conflicted;
    if(entry.conflicted){entry.conflictCopy.textContent=`A versão compartilhada foi atualizada por ${record?.authorName||'outro integrante'}.`;articleRichRender(entry.remote,record?.text||'(Seção vazia)');entry.remote.classList.add('article-rich-content');}
    entry.error.hidden=!(entry.failure||entry.limitError);entry.error.textContent=entry.limitError||entry.failure;
  }
  function paintStatus() {
    if(disposed)return;
    const list=[...entries.values()],dirty=list.some(e=>e.dirty||e.composing),pending=list.some(e=>e.pending),conflict=list.some(e=>e.conflicted),failure=list.some(e=>e.failure),limit=list.some(e=>e.limitError);
    status.dataset.state=readError||failure||limit?'error':conflict?'conflict':!connected||dirty||pending?'pending':'saved';
    status.textContent=readError?`Não foi possível abrir o artigo. ${readError.message||'Confira seu acesso e recarregue a página.'}`:!ready?'Carregando o artigo compartilhado…':!connected?'Sem conexão com o servidor. Mantenha esta página aberta; o texto pendente será enviado ao reconectar.':limit?'Uma seção ultrapassou o limite. O texto continua no editor; ajuste a seção indicada para salvar.':conflict?'Há alterações na mesma seção. Compare as versões para continuar.':pending?'Salvando no grupo…':failure?'Algumas alterações não foram confirmadas. Use “Salvar agora” para tentar novamente.':dirty?'Alterações pendentes · salvamento automático em instantes.':'Todas as alterações estão salvas no grupo.';
    saveButton.disabled=disposed||!ready||!connected||Boolean(readError)||(!dirty&&!failure);
    previewButton.disabled=!ready||Boolean(readError);
    downloadButton.disabled=textButton.disabled=!ready||Boolean(readError);
  }
  function paintMode() {
    layout.hidden=previewMode;preview.hidden=!previewMode;previewButton.textContent=previewMode?'Voltar à escrita':'Ver artigo montado';previewButton.setAttribute('aria-pressed',String(previewMode));
    for(const [key,entry]of entries){entry.panel.hidden=key!==activeKey;if(key===activeKey)entry.tab.setAttribute('aria-current','step');else entry.tab.removeAttribute('aria-current');}
    if(previewMode)paintPreview();
  }
  function paintPreview() {
    preview.replaceChildren(make('p','eyebrow','PRÉVIA · RASCUNHO DO GRUPO'));
    if([...entries.values()].some(e=>e.dirty||e.pending||e.conflicted||e.composing))preview.append(make('p','article-preview-note','A prévia inclui seu texto pendente. Confira o estado do salvamento antes de sair.'));
    for(const {key,title}of articleSections){const entry=entries.get(key),content=make('div','article-rich-content');if(key==='title'){content.classList.add('article-paper-title');content.setAttribute('role','heading');content.setAttribute('aria-level','3');articleRichRender(content,articleRichPlain(entry.text).trim()?entry.text:group.topic||group.name);preview.append(content);continue;}const section=make('section','article-paper-section');if(articleRichPlain(entry.text).trim())articleRichRender(content,entry.text);else{content.textContent='Em elaboração';content.classList.add('article-empty');}section.append(make('h4','',title),content);preview.append(section);}
  }
  function schedule(key){clearTimeout(timers.get(key));timers.delete(key);const entry=entries.get(key);if(!disposed&&connected&&ready&&!readError&&entry.dirty&&!entry.conflicted&&!entry.pending&&!entry.limitError&&!entry.composing)timers.set(key,setTimeout(()=>{timers.delete(key);save(key);},saveDelay));}
  function adopt(entry,record){entry.record=record;entry.baseRevision=record?.revision||0;entry.baseText=record?.text||'';entry.text=entry.baseText;entry.dirty=false;entry.conflicted=false;entry.failure='';}
  function receive({sections={},connected:online,ready:loaded,error,revoked=false}={}) {
    if(disposed||accessRevoked)return;
    if(error){readError=error;ready=false;accessRevoked=revoked;for(const timer of timers.values())clearTimeout(timer);timers.clear();for(const entry of entries.values()){entry.composing=false;if(revoked){adopt(entry,null);entry.rich.reset();entry.remote.textContent='';entry.pending=null;}paintEntry(entry);}preview.replaceChildren();paintStatus();return;}
    if(typeof online==='boolean')connected=online;
    if(loaded===true){ready=true;readError=null;
      for(const [key,entry]of entries){
        const record=sections[key]||null;
        // Firebase emits optimistic local writes; they are not server confirmations.
        if(entry.pending&&record?.revision===entry.pending.revision&&record?.updatedBy===user.uid&&record?.text===entry.pending.text)continue;
        // Returning to the old baseline does not resolve a conflict with a
        // newer shared revision. Preserve that choice until it is resolved.
        if(!entry.dirty&&!entry.pending&&!entry.conflicted&&!entry.composing)adopt(entry,record);
        else if((record?.revision||0)!==entry.baseRevision|| (record?.text||'')!==entry.baseText){entry.record=record;entry.conflicted=entry.text!==(record?.text||'');if(!entry.conflicted&&!entry.pending&&!entry.composing)adopt(entry,record);}
        paintEntry(entry);
      }
    }
    for(const key of entries.keys())schedule(key);
    paintStatus();if(previewMode)paintPreview();
  }
  async function save(key) {
    const entry=entries.get(key);clearTimeout(timers.get(key));timers.delete(key);
    if(disposed||!ready||!connected||readError||!entry.dirty||entry.pending||entry.conflicted||entry.limitError||entry.composing)return;
    const sent={text:entry.text,revision:entry.baseRevision+1};entry.pending=sent;entry.failure='';paintEntry(entry);paintStatus();
    try {
      const record=await onSave(key,sent.text,entry.baseRevision);
      if(disposed||accessRevoked)return;
      entry.pending=null;
      const latest=(entry.record?.revision||0)>(record?.revision||0)?entry.record:record;
      if(entry.text===sent.text&&!entry.composing){adopt(entry,latest);}
      else if(latest?.text===sent.text){entry.record=latest;entry.baseRevision=latest.revision;entry.baseText=latest.text;entry.dirty=entry.text!==entry.baseText;entry.conflicted=false;}
      else {entry.record=latest;entry.conflicted=true;}
    } catch(error) {
      if(disposed||accessRevoked)return;entry.pending=null;
      if(error.code==='article/conflict'){entry.record=error.remote||null;entry.conflicted=true;}
      else entry.failure=error.message||'Não foi possível salvar. Confira a conexão e tente novamente.';
    }
    paintEntry(entry);paintStatus();if(previewMode)paintPreview();if(entry.dirty&&!entry.failure&&!entry.conflicted)schedule(key);
  }
  function resolve(key,choice){const entry=entries.get(key);if(disposed||entry.pending||!entry.conflicted)return;if(choice==='remote')adopt(entry,entry.record);else {entry.baseRevision=entry.record?.revision||0;entry.baseText=entry.record?.text||'';entry.conflicted=false;entry.dirty=entry.text!==entry.baseText;entry.failure='';save(key);}paintEntry(entry);paintStatus();if(previewMode)paintPreview();}
  function flush(){return Promise.all([...entries.keys()].map(save));}
  function download(format){
    if(disposed||!ready||readError)return;
    let content,type,extension;
    if(format==='word'){
      const paper=make('div');
      for(const {key,title}of articleSections){const entry=entries.get(key),section=make('section'),text=make('div','article-rich-content');if(key==='title'){text.classList.add('article-paper-title');articleRichRender(text,articleRichPlain(entry.text).trim()?entry.text:group.topic||group.name||'Artigo INIC');paper.append(text);continue;}section.append(make('h2','',title));articleRichRender(text,articleRichPlain(entry.text).trim()?entry.text:'[Em elaboração]');section.append(text);paper.append(section);}
      content='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Rascunho do artigo INIC</title><style>body{font-family:Arial,sans-serif;font-size:12pt;color:#111827;line-height:1.6;margin:2cm}.article-rich-content{white-space:pre-wrap}p{margin:0 0 10pt}h2{font-size:15pt;margin:20pt 0 10pt}.article-paper-title{text-align:center;font-size:18pt;font-weight:bold;margin-bottom:24pt}blockquote{margin-left:24pt;border-left:2pt solid #b7bcc5;padding-left:12pt}ul,ol{padding-left:24pt}a{color:#1d4ed8}</style></head><body>'+paper.innerHTML+'</body></html>';
      type='application/msword;charset=utf-8';extension='doc';
    }else{const sections=Object.fromEntries([...entries].map(([key,entry])=>[key,{text:articleRichPlain(entry.text)}]));content=articlePlainText({group,sections});type='text/plain;charset=utf-8';extension='txt';}
    const blob=new Blob(['\ufeff',content],{type}),url=URL.createObjectURL(blob);downloads.add(url);const a=make('a');a.href=url;a.download=`artigo-inic-${group.year||2027}.${extension}`;element.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},1000);
  }
  paintMode();for(const entry of entries.values())paintEntry(entry);paintStatus();
  try{stop=subscribe(receive)||(()=>{});}catch(error){receive({error});}
  return {element,flush,hasUnsaved:()=>!disposed&&[...entries.values()].some(e=>e.dirty||e.pending||e.conflicted||e.composing),destroy(){if(disposed)return;disposed=true;stop();for(const timer of timers.values())clearTimeout(timer);timers.clear();for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();for(const entry of entries.values()){entry.text='';entry.record=null;entry.rich.destroy();entry.remote.textContent='';}element.replaceChildren();entries.clear();}};
}
