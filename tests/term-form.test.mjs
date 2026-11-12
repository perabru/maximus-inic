import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

const STUDENT_PNG='data:image/png;base64,c3R1ZGVudA==';
const GUARDIAN_PNG='data:image/png;base64,Z3VhcmRpYW4=';
const flush=async()=>{await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function page({generate}={}){
  const html=readFileSync(new URL('../conformidade.html',import.meta.url),'utf8');
  const {document,window:dom}=parseHTML(html);
  const form=document.getElementById('compliance-form');
  const defaults=new Map([...form.querySelectorAll('input')].map(input=>[input,input.getAttribute('value')||'']));
  let focused=null,loads=0,printCalls=0,nextUrl=0;
  const handlers=new Map(),pads=new Map(),payloads=[],downloads=[],revoked=[],timers=[],decoded=[],printed=[];
  const field=name=>form.querySelector('[name="'+name+'"]');
  const control=id=>document.getElementById(id);
  const preview=role=>form.querySelector('[data-signature-preview="'+role+'"]');
  for(const input of form.querySelectorAll('input,canvas'))input.focus=()=>{focused=input;};
  form.reset=()=>{for(const [input,value]of defaults)input.value=value;};
  for(const image of form.querySelectorAll('[data-signature-preview]'))image.decode=async()=>{decoded.push(image.getAttribute('src'));};
  dom.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,filename:this.download});};
  function fireWindow(type,extra={}){
    const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};
    for(const handler of handlers.get(type)||[])handler(event);
    return event;
  }
  const window={
    addEventListener(type,handler){const list=handlers.get(type)||[];list.push(handler);handlers.set(type,list);},
    setTimeout(callback,delay){timers.push({callback,delay});return timers.length;},
    print(){
      printCalls++;
      fireWindow('beforeprint');
      printed.push({locked:form.inert,student:preview('student').getAttribute('src'),guardian:preview('guardian').getAttribute('src')});
    }
  };
  function createSignaturePad(canvas,options){
    const role=canvas.dataset.signatureCanvas;
    const state={image:'',exports:0,failAt:0,destroyed:0,clears:0,undos:0,options};
    const api={
      isEmpty:()=>!state.image,
      toPng(){state.exports++;if(state.failAt===state.exports){const error=new Error('Falha ao preparar PNG de teste.');options.onError(error);throw error;}return state.image;},
      clear(){state.clears++;state.image='';options.onChange({empty:true,canUndo:false});},
      undo(){state.undos++;state.image='';options.onChange({empty:true,canUndo:false});},
      destroy(){state.destroyed++;state.image='';}
    };
    pads.set(role,{state,api});
    // Match the real pad: this callback happens before the controller stores api.
    options.onChange({empty:true,canUndo:false});
    return api;
  }
  const loadPdfModule=async()=>{
    loads++;
    return {createFilledTermPdf:async payload=>{
      payloads.push(JSON.parse(JSON.stringify(payload)));
      if(generate)return generate(payload);
      return {blob:new Blob(['test-only PDF'],{type:'application/pdf'}),filename:'termo-teste.pdf'};
    }};
  };
  let source=readFileSync(new URL('../term-form.js',import.meta.url),'utf8');
  assert.match(source,/^import \{ createSignaturePad \} from /);
  source=source.replace(/^import \{ createSignaturePad \} from [^\n]+\n/,'');
  assert.match(source,/await import\('\.\/term-pdf\.js\?v=[^']+'\)/);
  source=source.replace(/await import\('\.\/term-pdf\.js\?v=[^']+'\)/,'await loadPdfModule()');
  vm.runInNewContext(source,{document,window,createSignaturePad,loadPdfModule,Blob,URL:{
    createObjectURL(){return 'blob:term-test-'+(++nextUrl);},
    revokeObjectURL(url){revoked.push(url);}
  }},{filename:'term-form.js'});
  function click(id){control(id).dispatchEvent(new dom.Event('click',{bubbles:true,cancelable:true}));}
  function fill(name,value){field(name).value=value;field(name).dispatchEvent(new dom.Event('input',{bubbles:true}));}
  function draw(role,{active=false}={}){
    const {state}=pads.get(role);state.image=role==='student'?STUDENT_PNG:GUARDIAN_PNG;
    if(!active)state.options.onChange({empty:false,canUndo:true});
  }
  return {document,form,field,control,preview,click,fill,draw,pads,fireWindow,payloads,downloads,revoked,timers,decoded,printed,
    status:()=>control('term-status').textContent,focus:()=>focused,loads:()=>loads,printCalls:()=>printCalls};
}

test('synchronous pad initialization keeps the form usable and institutional identity fixed',()=>{
  const p=page();
  assert.equal(p.pads.size,2);
  assert.equal(p.control('download-filled-document').disabled,false);
  assert.equal(p.preview('student').hidden,true);
  assert.equal(p.preview('guardian').hidden,true);
  assert.equal(p.field('teacher').value,'Prof. Esp. Bruno Michel Pera');
  assert.equal(p.field('teacher').hasAttribute('readonly'),true);
  assert.equal(p.fireWindow('beforeunload').defaultPrevented,false);
  assert.match(p.status(),/assinaturas desenhadas/i);
});

test('PDF captures an active stroke, locks editing during generation and points to the existing upload flow',async()=>{
  const pending=deferred(),p=page({generate:()=>pending.promise});
  p.fill('student','Aluno de teste');p.fill('guardian','Responsável de teste');p.fill('group','Pesquisa de teste');
  p.draw('student',{active:true});p.draw('guardian',{active:true});
  p.click('download-filled-document');await flush();
  assert.equal(p.form.inert,true);
  assert.equal(p.form.getAttribute('aria-busy'),'true');
  assert.equal(p.control('download-filled-document').disabled,true);
  assert.equal(p.control('print-document').disabled,true);
  assert.equal(p.control('clear-document').disabled,true);
  assert.deepEqual(p.payloads[0].signatures,{student:STUDENT_PNG,guardian:GUARDIAN_PNG});
  assert.equal(p.payloads[0].fields.guardian,'Responsável de teste');
  p.click('download-filled-document');p.click('clear-document');await flush();
  assert.equal(p.loads(),1);assert.equal(p.field('student').value,'Aluno de teste');
  pending.resolve({blob:new Blob(['test']),filename:'termo-teste.pdf'});await flush();
  assert.equal(p.form.inert,false);assert.equal(p.control('download-filled-document').disabled,false);
  assert.deepEqual(p.downloads,[{href:'blob:term-test-1',filename:'termo-teste.pdf'}]);
  assert.match(p.status(),/envie em Meu termo/);
  assert.equal(p.fireWindow('beforeunload').defaultPrevented,true,'starting a download does not prove that the user saved it');
});

test('each drawn signature requires its corresponding name before PDF generation',async()=>{
  for(const role of ['student','guardian']){
    const p=page();if(role==='guardian')p.fill('student','Aluno de teste');p.draw(role);p.click('download-filled-document');await flush();
    assert.equal(p.loads(),0);assert.equal(p.downloads.length,0);
    assert.equal(p.focus()?.getAttribute('name'),role);
    assert.match(p.status(),role==='student'?/nome do aluno/:/nome completo do responsável/);
    assert.equal(p.pads.get(role).api.isEmpty(),false);
    assert.equal(p.form.inert,false);
  }
});

test('PNG export errors stop PDF and print instead of silently omitting a signature',async()=>{
  for(const action of ['download-filled-document','print-document']){
    const p=page();p.fill('student','Aluno de teste');p.draw('student');
    const state=p.pads.get('student').state;state.failAt=state.exports+1;
    p.click(action);await flush();
    assert.equal(p.loads(),0);assert.equal(p.printCalls(),0);assert.equal(p.downloads.length,0);
    assert.match(p.status(),/Falha ao preparar PNG/);assert.equal(p.form.inert,false);
    assert.equal(p.pads.get('student').api.isEmpty(),false);
  }
});

test('clear removes both drawings and editable data, preserving Bruno and clearing the leave warning',()=>{
  const p=page();p.fill('student','Aluno de teste');p.fill('guardian','Responsável de teste');p.fill('advisor','Orientador de teste');
  p.draw('student');p.draw('guardian');
  assert.equal(p.fireWindow('beforeunload').defaultPrevented,true);
  p.click('clear-document');
  for(const name of ['student','guardian','advisor'])assert.equal(p.field(name).value,'');
  for(const role of ['student','guardian']){
    assert.equal(p.pads.get(role).api.isEmpty(),true);
    assert.equal(p.preview(role).getAttribute('src'),null);assert.equal(p.preview(role).hidden,true);
  }
  assert.equal(p.field('teacher').value,'Prof. Esp. Bruno Michel Pera');
  assert.equal(p.fireWindow('beforeunload').defaultPrevented,false);
  assert.equal(p.focus()?.getAttribute('name'),'student');
});

test('printing uses one validated PNG snapshot and beforeprint cannot replace it while locked',async()=>{
  const p=page();p.fill('student','Aluno de teste');p.fill('guardian','Responsável de teste');
  p.draw('student',{active:true});p.draw('guardian',{active:true});
  for(const {state}of p.pads.values())state.failAt=state.exports+2;
  const exportsBefore=[...p.pads.values()].map(pad=>pad.state.exports);
  p.click('print-document');await flush();
  assert.equal(p.printCalls(),1);
  assert.deepEqual(p.printed,[{locked:true,student:STUDENT_PNG,guardian:GUARDIAN_PNG}]);
  assert.deepEqual([...p.pads.values()].map(pad=>pad.state.exports),exportsBefore.map(count=>count+1));
  assert.deepEqual(p.decoded,[STUDENT_PNG,GUARDIAN_PNG]);
  assert.equal(p.form.querySelector('[data-guardian-name]').textContent,'Responsável de teste');
  assert.equal(p.form.inert,false);
});

test('PDF generation failure unlocks the form without losing handwriting or the leave warning',async()=>{
  const p=page({generate:async()=>{throw new Error('Modelo indisponível para teste.');}});
  p.fill('student','Aluno de teste');p.draw('student');p.click('download-filled-document');await flush();
  assert.equal(p.downloads.length,0);assert.equal(p.form.inert,false);
  assert.equal(p.field('student').value,'Aluno de teste');assert.equal(p.pads.get('student').api.isEmpty(),false);
  assert.equal(p.fireWindow('beforeunload').defaultPrevented,true);
  assert.match(p.status(),/Modelo indisponível/);
});

test('page cleanup preserves history restoration and releases drawings and download URLs on real exit',async()=>{
  const p=page();p.click('download-filled-document');await flush();
  p.fireWindow('pagehide',{persisted:true});
  assert.equal(p.pads.get('student').state.destroyed,0);assert.equal(p.revoked.length,0);
  p.fireWindow('pagehide',{persisted:false});
  assert.equal(p.pads.get('student').state.destroyed,1);assert.equal(p.pads.get('guardian').state.destroyed,1);
  assert.deepEqual(p.revoked,['blob:term-test-1']);
});
