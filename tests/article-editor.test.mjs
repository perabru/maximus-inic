import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {articleSections,articleSectionLimit,articleWordCount,articlePlainText} from '../article-content.js';
const source=readFileSync(new URL('../article-editor.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function createArticleEditor','function createArticleEditor');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const record=(text,revision=1,updatedBy='s1')=>({text,revision,updatedBy,authorName:updatedBy==='s1'?'Ana':'Orientador',updatedAt:Date.now()});
const milestone=(revision=1,completedBy='s1',firstCompletedAt=Date.now())=>({revision,completedBy,completedByName:completedBy==='s1'?'Ana':'Orientador',completedAt:Date.now(),firstCompletedAt});
function setup({onSave,onComplete,subscribe,uid='s1',saveDelay=100000,workMode='group'}={}){
  const {document,window}=parseHTML('<html><body></body></html>');let receive,stops=0,calls=[],completionCalls=[];
  const context=vm.createContext({document,window,console,setTimeout,clearTimeout,Intl,Blob,URL,Map,articleSections,articleSectionLimit,articleWordCount,articlePlainText});vm.runInContext(source,context);
  const editor=context.createArticleEditor({group:{id:'g',name:'Equipe',topic:'Estufa',year:2027,workMode},user:{uid},saveDelay,onSave:async(...args)=>{calls.push(args);return onSave?onSave(...args):record(args[1],args[2]+1,uid);},onComplete:async(...args)=>{completionCalls.push(args);return onComplete?onComplete(...args):milestone(args[1],uid);},subscribe:callback=>{receive=callback;return subscribe?subscribe(callback):()=>{stops++;};}});document.body.append(editor.element);
  return {document,window,editor,calls,completionCalls,get stops(){return stops;},emit(value){receive(value);},field(key='introduction'){return document.querySelector(`textarea[name=${key}]`);},input(text,key='introduction'){const input=this.field(key);input.value=text;input.dispatchEvent(new window.Event('input'));return input;},button(text){return [...document.querySelectorAll('button')].find(e=>e.textContent===text&&!e.closest('[hidden]'));},completeButton(key='introduction'){return this.field(key).closest('section').querySelector('.article-completion button');},trophy(key='introduction'){return document.querySelector(`.article-trophy[data-section=${key}]`);},count(){return document.querySelector('.article-trophy-count').textContent;},announcement(){return document.querySelector('.article-achievement-notice');},status(){return document.querySelector('.article-sync').textContent;},close(){editor.destroy();}};
}
test('five requested sections contain explanations and verified course links',()=>{
 const q=setup();try{for(const key of ['introduction','methodology','results','discussion','conclusion']){const panel=q.field(key).closest('section');assert.ok(panel.querySelector('.article-guidance p').textContent.length>80);assert.ok(panel.querySelector('a[href^="https://drivedepobre.com/outros-cursos/"]'));}assert.equal(q.field().disabled,true);q.emit({ready:true,connected:true,sections:{}});assert.equal(q.field().disabled,false);assert.match(q.status(),/estão salvas/);}finally{q.close();}
});
test('autosave debounces typing and acknowledges only the save promise',async()=>{
 let finish;const q=setup({saveDelay:15,onSave:()=>new Promise(resolve=>{finish=resolve;})});try{q.emit({ready:true,connected:true,sections:{}});q.input('Primeiro');q.input('Texto final');await new Promise(r=>setTimeout(r,35));assert.equal(q.calls.length,1);assert.equal(q.calls[0][1],'Texto final');assert.match(q.status(),/Salvando/);q.emit({ready:true,connected:true,sections:{introduction:record('Texto final')}});assert.match(q.status(),/Salvando/);assert.equal(q.editor.hasUnsaved(),true);finish(record('Texto final'));await tick();assert.equal(q.editor.hasUnsaved(),false);assert.match(q.status(),/estão salvas/);}finally{q.close();}
});
test('edits made while a save is in flight survive and use its acknowledged revision',async()=>{
 let finish;const q=setup({onSave:()=>new Promise(r=>{finish=r;})});try{q.emit({ready:true,connected:true,sections:{}});q.input('Primeira frase');const first=q.editor.flush();q.input('Primeira frase e nova frase');q.emit({ready:true,connected:true,sections:{introduction:record('Primeira frase')}});finish(record('Primeira frase'));await first;assert.equal(q.field().value,'Primeira frase e nova frase');assert.equal(q.editor.hasUnsaved(),true);const next=q.editor.flush();assert.equal(q.calls[1][2],1);finish(record('Primeira frase e nova frase',2));await next;assert.equal(q.editor.hasUnsaved(),false);}finally{q.close();}
});
test('remote updates do not replace the textarea or discard a dirty local draft',async()=>{
 const q=setup();try{q.emit({ready:true,connected:true,sections:{introduction:record('Original')}});const field=q.field();q.input('Minha revisão');q.emit({ready:true,connected:true,sections:{introduction:record('Revisão do professor',2,'a1')}});assert.equal(q.field(),field);assert.equal(field.value,'Minha revisão');assert.equal(q.document.querySelector('.article-conflict:not([hidden]) .article-remote').textContent,'Revisão do professor');await q.editor.flush();assert.equal(q.calls.length,0);q.button('Salvar meu texto revisado').click();await tick();assert.equal(q.calls[0][2],2);assert.equal(q.field().value,'Minha revisão');assert.equal(q.editor.hasUnsaved(),false);}finally{q.close();}
});
test('a server conflict preserves the draft until the user chooses the shared version',async()=>{
 const q=setup({onSave:async()=>{throw Object.assign(new Error('Conflito'),{code:'article/conflict',remote:record('Versão compartilhada',2,'a1')});}});try{q.emit({ready:true,connected:true,sections:{introduction:record('Antes')}});q.input('Local');await q.editor.flush();assert.equal(q.field().value,'Local');q.button('Usar versão compartilhada').click();assert.equal(q.field().value,'Versão compartilhada');assert.equal(q.editor.hasUnsaved(),false);}finally{q.close();}
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
  assert.equal(q.field(),field);assert.equal(field.value,'Original');
  assert.equal(q.field('methodology').value,'Outro integrante escreveu o método');
  q.emit({ready:true,connected:false,sections:{introduction:shared}});
  q.emit({ready:true,connected:true,sections:{introduction:shared}});
  assert.equal(field.value,'Original');assert.equal(q.editor.hasUnsaved(),true);
  assert.equal(field.closest('section').querySelector('.article-conflict').hidden,false);
  await q.editor.flush();assert.equal(q.calls.length,0,'an unresolved conflict must not be saved automatically');
  q.button('Salvar meu texto revisado').click();await tick();
  assert.deepEqual(q.calls[0],['introduction','Original',2]);
  assert.equal(field.value,'Original');assert.equal(q.editor.hasUnsaved(),false);
 }finally{q.close();}
});
test('a reverted local draft can explicitly accept the shared version to resolve its conflict',async()=>{
 const q=setup();try{
  q.emit({ready:true,connected:true,sections:{introduction:record('Original')}});
  q.input('Rascunho');q.emit({ready:true,connected:true,sections:{introduction:record('Compartilhado',2,'a1')}});
  q.input('Original');assert.equal(q.editor.hasUnsaved(),true);
  q.button('Usar versão compartilhada').click();
  assert.equal(q.field().value,'Compartilhado');assert.equal(q.editor.hasUnsaved(),false);
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
  assert.equal(q.field().value,'Original');assert.equal(q.editor.hasUnsaved(),true);
  q.emit({ready:true,connected:true,sections:{introduction:shared,results:record('Resultado do grupo',1,'s2')}});
  assert.equal(q.field().value,'Original');assert.equal(q.editor.hasUnsaved(),true);
  q.button('Salvar meu texto revisado').click();await tick();
  assert.deepEqual(q.calls[1],['introduction','Original',3]);
  assert.equal(q.editor.hasUnsaved(),false);
 }finally{q.close();}
});
test('different sections save independently and preview escapes untrusted text',async()=>{
 const q=setup();try{q.emit({ready:true,connected:true,sections:{}});q.input('<img src=x onerror=alert(1)>');q.input('Procedimento','methodology');await q.editor.flush();assert.deepEqual(q.calls.map(c=>c[0]).sort(),['introduction','methodology']);q.button('Ver artigo montado').click();assert.ok(q.document.querySelector('.article-preview').textContent.includes('<img src=x onerror=alert(1)>'));assert.equal(q.document.querySelector('.article-preview img'),null);assert.match(q.document.querySelector('.article-preview').textContent,/Procedimento/);}finally{q.close();}
});
test('offline drafting sends after reconnection without falsely claiming it was saved',async()=>{
 const q=setup();try{q.emit({ready:true,connected:true,sections:{}});q.emit({connected:false});q.input('Rascunho offline');await q.editor.flush();assert.equal(q.calls.length,0);assert.match(q.status(),/Sem conexão/);q.emit({connected:true});assert.equal(q.field().value,'Rascunho offline');await q.editor.flush();assert.equal(q.calls.length,1);assert.equal(q.editor.hasUnsaved(),false);}finally{q.close();}
});
test('failed saves remain visible and can be retried',async()=>{
 let fail=true;const q=setup({onSave:async(k,text,rev)=>{if(fail)throw Error('Falha de rede');return record(text,rev+1);}});try{q.emit({ready:true,connected:true,sections:{}});q.input('Não perder');await q.editor.flush();assert.equal(q.editor.hasUnsaved(),true);assert.equal(q.field().value,'Não perder');assert.match(q.document.querySelector('.article-field-error:not([hidden])').textContent,/Falha de rede/);fail=false;await q.editor.flush();assert.equal(q.editor.hasUnsaved(),false);}finally{q.close();}
});
test('access revocation immediately clears drafts and preview; destroy cancels timers',async()=>{
 const q=setup({saveDelay:15});q.emit({ready:true,connected:true,sections:{}});q.input('Conteúdo privado');q.button('Ver artigo montado').click();q.emit({revoked:true,error:{code:'PERMISSION_DENIED',message:'Acesso encerrado'}});assert.equal(q.field().value,'');assert.equal(q.field().disabled,true);assert.equal(q.document.querySelector('.article-preview').textContent,'');assert.equal(q.editor.hasUnsaved(),false);q.close();await new Promise(r=>setTimeout(r,30));assert.equal(q.calls.length,0);assert.equal(q.stops,1);q.emit({ready:true,connected:true,sections:{introduction:record('Mensagem tardia')}});assert.equal(q.document.querySelector('textarea'),null);
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
   assert.equal(field.value,'',response);assert.equal(field.disabled,true,response);
   assert.equal(panel.querySelector('.article-remote').textContent,'',response);
   assert.equal(panel.querySelector('.article-conflict').hidden,true,response);
   assert.equal(q.editor.hasUnsaved(),false,response);assert.match(q.status(),/Acesso encerrado/);
  }finally{q.close();}
 }
});

test('the ten-stage trophy collection navigates to sections and uses individual wording when selected',()=>{
 const q=setup({workMode:'individual'});try{
  assert.equal(q.document.querySelectorAll('.article-trophy').length,10);
  assert.equal(new Set(articleSections.map(section=>section.trophy)).size,10);
  assert.match(q.document.querySelector('.article-heading').textContent,/ESCRITA INDIVIDUAL/);
  assert.match(q.document.querySelector('.article-trophies h4').textContent,/Suas conquistas/);
  assert.equal(q.count(),'0 de 10 troféus');assert.equal(q.completeButton().disabled,true);
  q.emit({ready:true,connected:true,sections:{},milestones:{}});
  q.trophy('conclusion').click();
  assert.equal(q.field('conclusion').closest('section').hidden,false);
  assert.equal(q.field('introduction').closest('section').hidden,true);
  q.button('Ver artigo montado').click();assert.match(q.document.querySelector('.article-preview').textContent,/SEU RASCUNHO/);
  assert.match(q.status(),/salvas no seu artigo/);
 }finally{q.close();}
});

test('completion requires nonblank confirmed text and is blocked by offline, pending edits, or conflicts',async()=>{
 let finish;
 const q=setup({onSave:()=>new Promise(resolve=>{finish=resolve;})});try{
  q.emit({ready:true,connected:true,sections:{introduction:record(' \n ')},milestones:{}});
  q.completeButton().click();assert.equal(q.completeButton().disabled,true);assert.equal(q.completionCalls.length,0);
  q.emit({ready:true,connected:true,sections:{introduction:record('Introdução salva')},milestones:{}});
  assert.equal(q.completeButton().disabled,false);
  q.emit({connected:false});assert.equal(q.completeButton().disabled,true);q.completeButton().click();assert.equal(q.completionCalls.length,0);
  q.emit({connected:true});q.input('Introdução revisada');assert.equal(q.completeButton().disabled,true);
  const saving=q.editor.flush();assert.equal(q.completeButton().disabled,true);
  finish(record('Introdução revisada',2));await saving;assert.equal(q.completeButton().disabled,false);
  q.input('Outra revisão');q.emit({ready:true,connected:true,sections:{introduction:record('Revisão do orientador',3,'a1')},milestones:{}});
  assert.equal(q.completeButton().disabled,true);q.completeButton().click();assert.equal(q.completionCalls.length,0);
 }finally{q.close();}
});

test('an optimistic milestone cannot award a trophy before acknowledgement and repeated clicks are deduplicated',async()=>{
 let finish;
 const q=setup({onComplete:()=>new Promise(resolve=>{finish=resolve;})});try{
  const sections={introduction:record('Introdução pronta')},earned=milestone();
  q.emit({ready:true,connected:true,sections,milestones:{}});q.completeButton().click();q.completeButton().click();
  assert.equal(q.completionCalls.length,1);assert.deepEqual(q.completionCalls[0],['introduction',1]);
  q.emit({ready:true,connected:true,sections,milestones:{introduction:earned}});
  assert.equal(q.count(),'0 de 10 troféus');assert.equal(q.announcement().hidden,true);assert.equal(q.editor.hasUnsaved(),true);
  let flushed=false;const flushing=q.editor.flush().then(()=>{flushed=true;});await tick();assert.equal(flushed,false);
  finish(earned);await flushing;
  assert.equal(q.count(),'1 de 10 troféus');assert.equal(q.trophy().dataset.state,'earned');assert.equal(q.announcement().hidden,false);assert.match(q.announcement().textContent,/Troféu conquistado: Problema apresentado/);
  assert.equal(q.editor.hasUnsaved(),false);assert.equal(q.completeButton().disabled,true);
  const notice=q.announcement();q.emit({ready:true,connected:true,sections,milestones:{introduction:earned}});
  assert.equal(q.announcement(),notice);assert.equal(q.completionCalls.length,1);assert.equal(q.count(),'1 de 10 troféus');
 }finally{q.close();}
});

test('loaded or remotely completed stages synchronize without replaying a celebration',()=>{
 const q=setup(),other=setup({uid:'s2'});try{
  const sections={introduction:record('Introdução'),methodology:record('Método')},intro=milestone(),method=milestone(1,'a1');
  for(const editor of [q,other])editor.emit({ready:true,connected:true,sections,milestones:{introduction:intro}});
  assert.equal(q.count(),'1 de 10 troféus');assert.equal(other.count(),q.count());assert.equal(q.announcement().hidden,true);
  for(const editor of [q,other])editor.emit({ready:true,connected:true,sections,milestones:{introduction:intro,methodology:method}});
  assert.equal(q.count(),'2 de 10 troféus');assert.equal(other.count(),q.count());assert.equal(q.announcement().hidden,true);assert.equal(other.announcement().hidden,true);
  assert.match(other.field('methodology').closest('section').querySelector('.article-completion-help').textContent,/Orientador/);
 }finally{q.close();other.close();}
});

test('failed completion restores the previous collection and ignores a replayed optimistic milestone until rollback',async()=>{
 let reject;let fails=true;
 const earned=milestone(),q=setup({onComplete:async()=>fails?new Promise((_resolve,fail)=>{reject=fail;}):earned});try{
  const sections={introduction:record('Texto salvo')};q.emit({ready:true,connected:true,sections,milestones:{}});
  q.completeButton().click();q.emit({ready:true,connected:true,sections,milestones:{introduction:earned}});
  reject(Error('A conexão falhou'));await tick();
  assert.equal(q.count(),'0 de 10 troféus');assert.equal(q.announcement().hidden,true);assert.equal(q.field().value,'Texto salvo');assert.equal(q.editor.hasUnsaved(),false);
  assert.match(q.field().closest('section').querySelector('.article-completion-error').textContent,/conexão falhou/);
  q.emit({ready:true,connected:true,sections,milestones:{introduction:earned}});assert.equal(q.count(),'0 de 10 troféus');
  q.emit({ready:true,connected:true,sections,milestones:{}});fails=false;q.completeButton().click();await tick();
  assert.equal(q.count(),'1 de 10 troféus');assert.equal(q.trophy().dataset.state,'earned');assert.equal(q.completionCalls.length,2);
 }finally{q.close();}
});

test('earned trophies survive later edits and reconcluding a revision does not duplicate the award',async()=>{
 const original=milestone(1,'s1',1000);
 const q=setup({onComplete:async(_key,revision)=>milestone(revision,'s1',1000)});try{
  q.emit({ready:true,connected:true,sections:{introduction:record('Versão inicial')},milestones:{introduction:original}});
  q.input('Texto revisado');assert.equal(q.count(),'1 de 10 troféus');assert.equal(q.trophy().dataset.state,'review');
  await q.editor.flush();assert.equal(q.completeButton().textContent,'Concluir revisão');assert.equal(q.completeButton().disabled,false);
  q.completeButton().click();await tick();
  assert.deepEqual(q.completionCalls[0],['introduction',2]);assert.equal(q.count(),'1 de 10 troféus');assert.equal(q.trophy().dataset.state,'earned');
  assert.match(q.announcement().textContent,/Revisão de Introdução concluída/);assert.equal(q.announcement().dataset.celebrate,'false');
  q.input('');await q.editor.flush();assert.equal(q.count(),'1 de 10 troféus');assert.equal(q.trophy().dataset.state,'review');assert.equal(q.completeButton().disabled,true);
 }finally{q.close();}
});

test('typing during completion preserves the draft and leaves the awarded stage in review',async()=>{
 let finish;
 const q=setup({onComplete:()=>new Promise(resolve=>{finish=resolve;})});try{
  q.emit({ready:true,connected:true,sections:{introduction:record('Versão salva')},milestones:{}});
  q.completeButton().click();q.input('Nova ideia durante a conclusão');finish(milestone());await tick();
  assert.equal(q.field().value,'Nova ideia durante a conclusão');assert.equal(q.count(),'1 de 10 troféus');assert.equal(q.trophy().dataset.state,'review');assert.equal(q.editor.hasUnsaved(),true);
  await q.editor.flush();assert.equal(q.field().value,'Nova ideia durante a conclusão');assert.equal(q.trophy().dataset.state,'review');assert.equal(q.completeButton().disabled,false);
 }finally{q.close();}
});

test('a concurrent text revision prevents stale completion without losing the shared text',async()=>{
 let reject;
 const q=setup({onComplete:()=>new Promise((_resolve,fail)=>{reject=fail;})});try{
  q.emit({ready:true,connected:true,sections:{introduction:record('Versão anterior')},milestones:{}});
  q.completeButton().click();q.emit({ready:true,connected:true,sections:{introduction:record('Nova revisão do professor',2,'a1')},milestones:{}});
  reject(Object.assign(Error('O texto mudou. Revise a versão atual antes de concluir.'),{code:'article/conflict'}));await tick();
  assert.equal(q.field().value,'Nova revisão do professor');assert.equal(q.count(),'0 de 10 troféus');assert.equal(q.announcement().hidden,true);assert.equal(q.completeButton().disabled,false);
 }finally{q.close();}
});

test('late completion responses and milestones cannot restore trophies after revocation or destruction',async()=>{
 for(const mode of ['revoked','destroyed'])for(const response of ['success','failure']){
  let finish,reject;
  const q=setup({onComplete:()=>new Promise((resolve,fail)=>{finish=resolve;reject=fail;})});try{
   const sections={introduction:record('Texto privado')};q.emit({ready:true,connected:true,sections,milestones:{}});q.completeButton().click();
   if(mode==='revoked')q.emit({revoked:true,error:{code:'PERMISSION_DENIED',message:'Acesso encerrado'}});else q.close();
   if(response==='success')finish(milestone());else reject(Error('Erro tardio'));await tick();
   q.emit({ready:true,connected:true,sections,milestones:{introduction:milestone()}});
   assert.equal(q.editor.hasUnsaved(),false);
   if(mode==='revoked'){assert.equal(q.count(),'0 de 10 troféus');assert.equal(q.announcement().hidden,true);assert.equal(q.field().value,'');assert.equal(q.document.querySelector('.article-trophies').hidden,true);}else assert.equal(q.document.querySelector('.article-trophy'),null);
  }finally{q.close();}
 }
});

test('disconnecting releases flush so logout can warn about a pending completion without losing text',async()=>{
 let finish;
 const q=setup({onComplete:()=>new Promise(resolve=>{finish=resolve;})});try{
  q.emit({ready:true,connected:true,sections:{introduction:record('Texto já salvo')},milestones:{}});q.completeButton().click();
  let done=false;const flushing=q.editor.flush().then(()=>{done=true;});await tick();assert.equal(done,false);
  q.emit({connected:false});await tick();assert.equal(done,true);await flushing;
  assert.equal(q.editor.hasUnsaved(),true);assert.equal(q.field().value,'Texto já salvo');assert.equal(q.count(),'0 de 10 troféus');
  await q.editor.flush();assert.equal(q.editor.hasUnsaved(),true);
  q.emit({connected:true});finish(milestone());await tick();assert.equal(q.editor.hasUnsaved(),false);assert.equal(q.count(),'1 de 10 troféus');
 }finally{q.close();}
});
