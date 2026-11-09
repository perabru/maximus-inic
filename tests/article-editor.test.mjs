import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {articleSections,articleSectionLimit,articleWordCount,articlePlainText} from '../article-content.js';
const source=readFileSync(new URL('../article-editor.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function createArticleEditor','function createArticleEditor');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const record=(text,revision=1,updatedBy='s1')=>({text,revision,updatedBy,authorName:updatedBy==='s1'?'Ana':'Orientador',updatedAt:Date.now()});
function setup({onSave,subscribe,uid='s1',saveDelay=100000}={}){
  const {document,window}=parseHTML('<html><body></body></html>');let receive,stops=0,calls=[];
  const context=vm.createContext({document,window,console,setTimeout,clearTimeout,Intl,Blob,URL,Map,articleSections,articleSectionLimit,articleWordCount,articlePlainText});vm.runInContext(source,context);
  const editor=context.createArticleEditor({group:{id:'g',name:'Equipe',topic:'Estufa',year:2027},user:{uid},saveDelay,onSave:async(...args)=>{calls.push(args);return onSave?onSave(...args):record(args[1],args[2]+1,uid);},subscribe:callback=>{receive=callback;return subscribe?subscribe(callback):()=>{stops++;};}});document.body.append(editor.element);
  return {document,window,editor,calls,get stops(){return stops;},emit(value){receive(value);},field(key='introduction'){return document.querySelector(`textarea[name=${key}]`);},input(text,key='introduction'){const input=this.field(key);input.value=text;input.dispatchEvent(new window.Event('input'));return input;},button(text){return [...document.querySelectorAll('button')].find(e=>e.textContent===text&&!e.closest('[hidden]'));},status(){return document.querySelector('.article-sync').textContent;},close(){editor.destroy();}};
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
