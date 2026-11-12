import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {articleSections,articleSectionLimit,articleWordCount,articlePlainText} from '../article-content.js';
import * as richText from '../article-richtext.js';
const source=readFileSync(new URL('../article-editor.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function createArticleEditor','function createArticleEditor');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const record=(text,revision=1,updatedBy='s1')=>({text,revision,updatedBy,authorName:updatedBy==='s1'?'Ana':'Orientador',updatedAt:Date.now()});
function setup({onSave,subscribe,uid='s1',saveDelay=100000}={}){
  const {document,window}=parseHTML('<html><body></body></html>');let receive,stops=0,calls=[],downloads=[];
  const downloadURL={createObjectURL(blob){downloads.push(blob);return `blob:article-test-${downloads.length}`;},revokeObjectURL(){}};
  const context=vm.createContext({document,window,console,setTimeout,clearTimeout,Intl,Blob,URL:downloadURL,Map,articleSections,articleSectionLimit,articleWordCount,articlePlainText,...richText});vm.runInContext(source,context);
  const editor=context.createArticleEditor({group:{id:'g',name:'Equipe',topic:'Estufa',year:2027},user:{uid},saveDelay,onSave:async(...args)=>{calls.push(args);return onSave?onSave(...args):record(args[1],args[2]+1,uid);},subscribe:callback=>{receive=callback;return subscribe?subscribe(callback):()=>{stops++;};}});document.body.append(editor.element);
  return {document,window,editor,calls,downloads,get stops(){return stops;},emit(value){receive(value);},field(key='introduction'){return document.querySelector(`.article-input[data-section=${key}]`);},input(text,key='introduction'){const input=this.field(key);input.textContent=text;input.dispatchEvent(new window.Event('input'));return input;},formatted(html,key='introduction'){const input=this.field(key);input.innerHTML=html;input.dispatchEvent(new window.Event('input'));return input;},button(text){return [...document.querySelectorAll('button')].find(e=>e.textContent===text&&!e.closest('[hidden]'));},status(){return document.querySelector('.article-sync').textContent;},close(){editor.destroy();}};
}
test('five requested sections contain explanations and verified course links',()=>{
 const q=setup();try{for(const key of ['introduction','methodology','results','discussion','conclusion']){const panel=q.field(key).closest('section');assert.ok(panel.querySelector('.article-guidance p').textContent.length>80);assert.ok(panel.querySelector('a[href^="https://drivedepobre.com/outros-cursos/"]'));}assert.equal(q.field().getAttribute('aria-disabled'),'true');q.emit({ready:true,connected:true,sections:{}});assert.equal(q.field().getAttribute('aria-disabled'),'false');assert.match(q.status(),/estão salvas/);}finally{q.close();}
});
test('autosave debounces typing and acknowledges only the save promise',async()=>{
 let finish;const q=setup({saveDelay:15,onSave:()=>new Promise(resolve=>{finish=resolve;})});try{q.emit({ready:true,connected:true,sections:{}});q.input('Primeiro');q.input('Texto final');await new Promise(r=>setTimeout(r,35));assert.equal(q.calls.length,1);assert.equal(q.calls[0][1],'Texto final');assert.match(q.status(),/Salvando/);q.emit({ready:true,connected:true,sections:{introduction:record('Texto final')}});assert.match(q.status(),/Salvando/);assert.equal(q.editor.hasUnsaved(),true);finish(record('Texto final'));await tick();assert.equal(q.editor.hasUnsaved(),false);assert.match(q.status(),/estão salvas/);}finally{q.close();}
});
test('edits made while a save is in flight survive and use its acknowledged revision',async()=>{
 let finish;const q=setup({onSave:()=>new Promise(r=>{finish=r;})});try{q.emit({ready:true,connected:true,sections:{}});q.input('Primeira frase');const first=q.editor.flush();q.input('Primeira frase e nova frase');q.emit({ready:true,connected:true,sections:{introduction:record('Primeira frase')}});finish(record('Primeira frase'));await first;assert.equal(q.field().textContent,'Primeira frase e nova frase');assert.equal(q.editor.hasUnsaved(),true);const next=q.editor.flush();assert.equal(q.calls[1][2],1);finish(record('Primeira frase e nova frase',2));await next;assert.equal(q.editor.hasUnsaved(),false);}finally{q.close();}
});
test('remote updates do not replace the editable surface or discard a dirty local draft',async()=>{
 const q=setup();try{q.emit({ready:true,connected:true,sections:{introduction:record('Original')}});const field=q.field();q.input('Minha revisão');q.emit({ready:true,connected:true,sections:{introduction:record('Revisão do professor',2,'a1')}});assert.equal(q.field(),field);assert.equal(field.textContent,'Minha revisão');assert.equal(q.document.querySelector('.article-conflict:not([hidden]) .article-remote').textContent,'Revisão do professor');await q.editor.flush();assert.equal(q.calls.length,0);q.button('Salvar meu texto revisado').click();await tick();assert.equal(q.calls[0][2],2);assert.equal(q.field().textContent,'Minha revisão');assert.equal(q.editor.hasUnsaved(),false);}finally{q.close();}
});
test('a server conflict preserves the draft until the user chooses the shared version',async()=>{
 const q=setup({onSave:async()=>{throw Object.assign(new Error('Conflito'),{code:'article/conflict',remote:record('Versão compartilhada',2,'a1')});}});try{q.emit({ready:true,connected:true,sections:{introduction:record('Antes')}});q.input('Local');await q.editor.flush();assert.equal(q.field().textContent,'Local');q.button('Usar versão compartilhada').click();assert.equal(q.field().textContent,'Versão compartilhada');assert.equal(q.editor.hasUnsaved(),false);}finally{q.close();}
});
test('returning to the original text during a conflict stays unsaved across other sections and reconnection',async()=>{
 const q=setup();try{
  const shared=record('Revisão do orientador',2,'a1');
  q.emit({ready:true,connected:true,sections:{introduction:record('Original')}});
  const field=q.input('Minha revisão');
  q.emit({ready:true,connected:true,sections:{introduction:shared}});
  q.input('Original');
  assert.equal(q.editor.hasUnsaved(),true,'the unresolved local choice must still warn before leaving');
  q.emit({ready:true,connected:true,sections:{introduction:shared,methodology:record('Outro integrante escreveu o método',1,'s2')}});
  assert.equal(q.field(),field);assert.equal(field.textContent,'Original');
  assert.equal(q.field('methodology').textContent,'Outro integrante escreveu o método');
  q.emit({ready:true,connected:false,sections:{introduction:shared}});
  q.emit({ready:true,connected:true,sections:{introduction:shared}});
  assert.equal(field.textContent,'Original');assert.equal(q.editor.hasUnsaved(),true);
  assert.equal(field.closest('section').querySelector('.article-conflict').hidden,false);
  await q.editor.flush();assert.equal(q.calls.length,0,'an unresolved conflict must not be saved automatically');
  q.button('Salvar meu texto revisado').click();await tick();
  assert.deepEqual(q.calls[0],['introduction','Original',2]);
  assert.equal(field.textContent,'Original');assert.equal(q.editor.hasUnsaved(),false);
 }finally{q.close();}
});
test('a reverted local draft can explicitly accept the shared version to resolve its conflict',async()=>{
 const q=setup();try{
  q.emit({ready:true,connected:true,sections:{introduction:record('Original')}});
  q.input('Rascunho');q.emit({ready:true,connected:true,sections:{introduction:record('Compartilhado',2,'a1')}});
  q.input('Original');assert.equal(q.editor.hasUnsaved(),true);
  q.button('Usar versão compartilhada').click();
  assert.equal(q.field().textContent,'Compartilhado');assert.equal(q.editor.hasUnsaved(),false);
  assert.equal(q.field().closest('section').querySelector('.article-conflict').hidden,true);
  assert.equal(q.calls.length,0);
 }finally{q.close();}
});
test('a local revert while a save is pending survives a newer shared revision and the save acknowledgement',async()=>{
 let finish;let first=true;
 const q=setup({onSave:async(key,text,revision)=>{if(first){first=false;return new Promise(resolve=>{finish=resolve;});}return record(text,revision+1);}});try{
  q.emit({ready:true,connected:true,sections:{introduction:record('Original')}});
  q.input('Texto enviado');const saving=q.editor.flush();q.input('Original');
  const shared=record('Revisão mais recente do orientador',3,'a1');
  q.emit({ready:true,connected:true,sections:{introduction:shared}});
  finish(record('Texto enviado',2));await saving;
  assert.equal(q.field().textContent,'Original');assert.equal(q.editor.hasUnsaved(),true);
  q.emit({ready:true,connected:true,sections:{introduction:shared,results:record('Resultado do grupo',1,'s2')}});
  assert.equal(q.field().textContent,'Original');assert.equal(q.editor.hasUnsaved(),true);
  q.button('Salvar meu texto revisado').click();await tick();
  assert.deepEqual(q.calls[1],['introduction','Original',3]);
  assert.equal(q.editor.hasUnsaved(),false);
 }finally{q.close();}
});
test('different sections save independently and preview escapes untrusted text',async()=>{
 const q=setup();try{q.emit({ready:true,connected:true,sections:{}});q.input('<img src=x onerror=alert(1)>');q.input('Procedimento','methodology');await q.editor.flush();assert.deepEqual(q.calls.map(c=>c[0]).sort(),['introduction','methodology']);q.button('Ver artigo montado').click();assert.ok(q.document.querySelector('.article-preview').textContent.includes('<img src=x onerror=alert(1)>'));assert.equal(q.document.querySelector('.article-preview img'),null);assert.match(q.document.querySelector('.article-preview').textContent,/Procedimento/);}finally{q.close();}
});
test('offline drafting sends after reconnection without falsely claiming it was saved',async()=>{
 const q=setup();try{q.emit({ready:true,connected:true,sections:{}});q.emit({connected:false});q.input('Rascunho offline');await q.editor.flush();assert.equal(q.calls.length,0);assert.match(q.status(),/Sem conexão/);q.emit({connected:true});assert.equal(q.field().textContent,'Rascunho offline');await q.editor.flush();assert.equal(q.calls.length,1);assert.equal(q.editor.hasUnsaved(),false);}finally{q.close();}
});
test('failed saves remain visible and can be retried',async()=>{
 let fail=true;const q=setup({onSave:async(k,text,rev)=>{if(fail)throw Error('Falha de rede');return record(text,rev+1);}});try{q.emit({ready:true,connected:true,sections:{}});q.input('Não perder');await q.editor.flush();assert.equal(q.editor.hasUnsaved(),true);assert.equal(q.field().textContent,'Não perder');assert.match(q.document.querySelector('.article-field-error:not([hidden])').textContent,/Falha de rede/);fail=false;await q.editor.flush();assert.equal(q.editor.hasUnsaved(),false);}finally{q.close();}
});
test('access revocation immediately clears drafts and preview; destroy cancels timers',async()=>{
 const q=setup({saveDelay:15});q.emit({ready:true,connected:true,sections:{}});q.input('Conteúdo privado');q.button('Ver artigo montado').click();q.emit({revoked:true,error:{code:'PERMISSION_DENIED',message:'Acesso encerrado'}});assert.equal(q.field().textContent,'');assert.equal(q.field().getAttribute('aria-disabled'),'true');assert.equal(q.document.querySelector('.article-preview').textContent,'');assert.equal(q.editor.hasUnsaved(),false);q.close();await new Promise(r=>setTimeout(r,30));assert.equal(q.calls.length,0);assert.equal(q.stops,1);q.emit({ready:true,connected:true,sections:{introduction:record('Mensagem tardia')}});assert.equal(q.document.querySelector('.article-input'),null);
});
test('late save responses and subscriptions cannot restore private content after access revocation',async()=>{
 for(const response of ['success','conflict']){
  let finish,fail;
  const q=setup({onSave:()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;})});try{
   q.emit({ready:true,connected:true,sections:{introduction:record('Texto privado')}});
   q.input('Revisão privada');const saving=q.editor.flush();
   q.emit({revoked:true,error:{code:'PERMISSION_DENIED',message:'Acesso encerrado'}});
   const remote=record('Conteúdo compartilhado privado',2,'a1');
   if(response==='success')finish(remote);
   else fail(Object.assign(Error('Conflito'),{code:'article/conflict',remote}));
   await saving;
   q.emit({ready:true,connected:true,sections:{introduction:remote}});
   const field=q.field(),panel=field.closest('section');
   assert.equal(field.textContent,'',response);assert.equal(field.getAttribute('aria-disabled'),'true',response);
   assert.equal(panel.querySelector('.article-remote').textContent,'',response);
   assert.equal(panel.querySelector('.article-conflict').hidden,true,response);
   assert.equal(q.editor.hasUnsaved(),false,response);assert.match(q.status(),/Acesso encerrado/);
  }finally{q.close();}
 }
});

test('formatted drafts synchronize through the same revision contract and render both conflict versions safely',async()=>{
 const original=richText.articleRichSerialize([['strong',{},['Original']]]),shared=richText.articleRichSerialize([['u',{},['Revisão do orientador']]]);
 const q=setup();try{
  q.emit({ready:true,connected:true,sections:{introduction:record(original)}});assert.equal(q.field().querySelector('strong').textContent,'Original');
  q.formatted('<p style="text-align:center"><em>Minha revisão</em></p>');q.emit({ready:true,connected:true,sections:{introduction:record(shared,2,'a1')}});
  assert.equal(q.field().querySelector('em').textContent,'Minha revisão');assert.equal(q.document.querySelector('.article-remote u').textContent,'Revisão do orientador');
  await q.editor.flush();assert.equal(q.calls.length,0);q.button('Salvar meu texto revisado').click();await tick();
  assert.equal(q.calls[0][2],2);assert.ok(q.calls[0][1].startsWith(richText.ARTICLE_RICH_PREFIX));assert.equal(richText.articleRichPlain(q.calls[0][1]),'Minha revisão');assert.equal(q.editor.hasUnsaved(),false);
  q.button('Ver artigo montado').click();assert.equal(q.document.querySelector('.article-preview em').textContent,'Minha revisão');assert.equal(q.document.querySelector('.article-preview em').parentElement.style.textAlign,'center');
 }finally{q.close();}
});

test('formatting overhead blocks only the oversized save without truncating the title',async()=>{
 const q=setup(),title='T'.repeat(280);try{
  q.emit({ready:true,connected:true,sections:{}});q.formatted(`<strong>${title}</strong>`,'title');
  assert.equal(q.field('title').textContent,title);assert.equal(q.editor.hasUnsaved(),true);assert.match(q.status(),/ultrapassou o limite/);assert.match(q.field('title').closest('section').querySelector('.article-field-error').textContent,/texto está preservado/);
  await q.editor.flush();assert.equal(q.calls.length,0);q.input('Método dentro do limite','methodology');await q.editor.flush();assert.equal(q.calls[0][0],'methodology','other valid sections can still save');
  q.input(title,'title');await q.editor.flush();assert.equal(q.calls[1][1],title);assert.equal(q.editor.hasUnsaved(),false);assert.equal(q.field('title').textContent.length,280);
 }finally{q.close();}
});

test('Word download preserves formatting and TXT exports readable text without the envelope',async()=>{
 const q=setup();try{
  q.emit({ready:true,connected:true,sections:{}});q.input('<script>título literal</script>','title');q.formatted('<p style="text-align:justify;font-family:Georgia;font-size:14pt"><strong>Pesquisa</strong> com <em>método</em>.</p><ul><li>Primeiro</li><li>Segundo</li></ul>');
  q.button('Baixar para Word').click();q.button('Baixar texto (.txt)').click();assert.equal(q.downloads.length,2);
  const word=await q.downloads[0].text(),plain=await q.downloads[1].text();assert.match(q.downloads[0].type,/application\/msword/);assert.match(word,/<strong>Pesquisa<\/strong>/);assert.match(word,/<em>método<\/em>/);assert.match(word,/text-align:justify/);assert.match(word,/<li>Segundo<\/li>/);assert.match(word,/&lt;script&gt;título literal&lt;\/script&gt;/);assert.doesNotMatch(word,/<script>/);
  assert.match(plain,/Pesquisa com método\.\nPrimeiro\nSegundo/);assert.match(plain,/<script>título literal<\/script>/);assert.doesNotMatch(plain,/INIC-RICH\/1|<strong>/);assert.equal(q.editor.hasUnsaved(),true,'export must not falsely acknowledge a pending save');
 }finally{q.close();}
});

test('revocation clears formatted content, clipboard tools and private undo history',()=>{
 const q=setup();try{
  q.emit({ready:true,connected:true,sections:{}});q.formatted('<strong>Rascunho privado</strong>');q.formatted('<em>Revisão privada</em>');
  const panel=q.field().closest('section'),undo=panel.querySelector('button[aria-label="Desfazer (Ctrl+Z)"]');assert.equal(undo.disabled,false);
  q.emit({revoked:true,error:{message:'Acesso encerrado'}});undo.click();assert.equal(q.field().textContent,'');assert.equal(panel.querySelector('button[aria-label="Refazer (Ctrl+Y)"]').disabled,true);assert.equal(panel.querySelector('button[aria-label="Inserir ou editar link"]').disabled,true);assert.equal(q.editor.hasUnsaved(),false);
 }finally{q.close();}
});

test('IME drafts are unsaved immediately, defer autosave, and survive a remote revision',async()=>{
 const q=setup({saveDelay:15});try{
  q.emit({ready:true,connected:true,sections:{introduction:record('Original')}});const field=q.field();field.dispatchEvent(new q.window.Event('compositionstart'));assert.equal(q.editor.hasUnsaved(),true);
  q.input('Original ç');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(q.calls.length,0,'an unfinished composition must not be sent');
  q.emit({ready:true,connected:true,sections:{introduction:record('Revisão remota',2,'a1')}});assert.equal(field.textContent,'Original ç');assert.equal(q.editor.hasUnsaved(),true);
  field.dispatchEvent(new q.window.Event('compositionend'));await q.editor.flush();assert.equal(field.textContent,'Original ç');assert.equal(q.calls.length,0,'the remote conflict must remain explicit');
  q.button('Salvar meu texto revisado').click();await tick();assert.deepEqual(q.calls[0],['introduction','Original ç',2]);assert.equal(q.editor.hasUnsaved(),false);
 }finally{q.close();}
});

test('an IME draft saves after compositionend and cannot reappear after revoked access',async()=>{
 const q=setup({saveDelay:15});try{
  q.emit({ready:true,connected:true,sections:{}});const field=q.field();field.dispatchEvent(new q.window.Event('compositionstart'));q.input('Pesquisa ç');field.dispatchEvent(new q.window.Event('compositionend'));await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(q.calls[0],['introduction','Pesquisa ç',0]);assert.equal(q.editor.hasUnsaved(),false);
  field.dispatchEvent(new q.window.Event('compositionstart'));q.input('Revisão privada ç');q.emit({revoked:true,error:{message:'Acesso encerrado'}});field.dispatchEvent(new q.window.Event('compositionend'));assert.equal(field.textContent,'');assert.equal(q.editor.hasUnsaved(),false);await q.editor.flush();assert.equal(q.calls.length,1);
 }finally{q.close();}
});

test('a pending save acknowledgement cannot replace a new IME composition',async()=>{
 let finish;const q=setup({onSave:()=>new Promise(resolve=>{finish=resolve;})});try{
  q.emit({ready:true,connected:true,sections:{introduction:record('Original')}});q.input('Enviado');const saving=q.editor.flush();const field=q.field();field.dispatchEvent(new q.window.Event('compositionstart'));
  q.emit({ready:true,connected:true,sections:{introduction:record('Revisão remota',3,'a1')}});finish(record('Enviado',2));await saving;assert.equal(field.textContent,'Enviado');assert.equal(q.editor.hasUnsaved(),true);
  q.input('Enviado ç');field.dispatchEvent(new q.window.Event('compositionend'));assert.equal(field.textContent,'Enviado ç');assert.match(q.status(),/Compare as versões/);assert.equal(q.calls.length,1);
 }finally{q.close();}
});
