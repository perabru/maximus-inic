import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

// Synthetic fixtures only. The real renderer runs against a DOM; the clock,
// animation scheduler and service boundary are controlled without networking.
const source=readFileSync(new URL('../coordination-dashboard.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const state=()=>({
  user:{uid:'coord-test'},role:'coordinator',archived:false,
  users:[
    {id:'coord-test',name:'Coordenação de teste',role:'coordinator'},
    {id:'student-a',name:'Estudante de teste A',role:'student'},
    {id:'student-b',name:'Estudante de teste B',role:'student'},
    {id:'student-c',name:'Estudante de teste C',role:'student'},
    {id:'advisor-a',name:'Orientador de teste A',role:'advisor'},
    {id:'advisor-b',name:'Orientador de teste B',role:'advisor'}
  ],
  advisors:[{id:'advisor-a',name:'Orientador de teste A'},{id:'advisor-b',name:'Orientador de teste B'}],
  groups:[
    {id:'group-a',name:'Pesquisa de teste Alpha',year:2027,advisorId:'advisor-a',members:{'student-a':true,'student-b':true}},
    {id:'group-b',name:'Pesquisa de teste Beta',year:2027,advisorId:'advisor-b',members:{'student-c':true}}
  ]
});
const data=()=>({
  ready:true,connected:true,
  boards:[
    {id:'board-a',groupId:'group-a',year:2027,title:'Banca Alpha de teste',date:'2027-03-20',status:'approved',updatedAt:10},
    {id:'board-b',groupId:'group-b',year:2027,title:'Banca Beta de teste',date:'2027-05-01',status:'correction',correction:'Revisão de teste',updatedAt:11}
  ],
  results:[
    {groupId:'group-a',studentUid:'student-a',status:'approved',updatedAt:10},
    {groupId:'group-a',studentUid:'student-b',status:'pending',updatedAt:11},
    {groupId:'group-b',studentUid:'student-c',status:'correction',correction:'Revisão de teste',updatedAt:12}
  ],
  tasks:[
    {id:'task-a',groupId:'group-a',weight:1,completed:true,dueDate:'2027-03-01',updatedAt:10},
    {id:'task-b',groupId:'group-a',weight:3,completed:false,dueDate:'2027-03-02',updatedAt:11}
  ]
});

function harness({initial=state(),reduced=false,hidden=false}={}){
  const {document,window:dom}=parseHTML('<!doctype html><html><body></body></html>');
  let now=0,id=0,focused=null,currentCallback,stops=0;
  const epoch=Date.parse('2026-11-12T22:00:00Z'),frames=new Map(),timers=new Map(),cancelled=[],subscriptions=[];
  const mediaListeners=new Set(),windowListeners=new Map();
  const media={matches:reduced,media:'(prefers-reduced-motion: reduce)',
    addEventListener(type,fn){if(type==='change')mediaListeners.add(fn);},
    removeEventListener(type,fn){if(type==='change')mediaListeners.delete(fn);},
    addListener(fn){mediaListeners.add(fn);},removeListener(fn){mediaListeners.delete(fn);}
  };
  const requestAnimationFrame=fn=>{const key=++id;frames.set(key,fn);return key;};
  const cancelAnimationFrame=key=>{cancelled.push(key);frames.delete(key);};
  const setTimeout=(fn,delay=0)=>{const key=++id;timers.set(key,{fn,at:now+Number(delay)});return key;};
  const clearTimeout=key=>timers.delete(key);
  const window={document,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,
    matchMedia:()=>media,performance:{now:()=>now},
    addEventListener(type,fn){if(!windowListeners.has(type))windowListeners.set(type,new Set());windowListeners.get(type).add(fn);},
    removeEventListener(type,fn){windowListeners.get(type)?.delete(fn);}
  };
  // These browser primitives are not implemented by linkedom. They deliberately
  // model native selection/focus rather than the dashboard's implementation.
  Object.defineProperty(document,'defaultView',{configurable:true,value:window});
  Object.defineProperty(document,'activeElement',{configurable:true,get:()=>focused});
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
  dom.HTMLElement.prototype.focus=function(){focused=this;};
  dom.HTMLElement.prototype.blur=function(){if(focused===this)focused=null;};
  dom.HTMLInputElement.prototype.setSelectionRange=function(start,end,direction='none'){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;};
  Object.defineProperty(dom.HTMLSelectElement.prototype,'value',{configurable:true,
    get(){return [...this.options].find(option=>option.selected)?.value??this.options[0]?.value??'';},
    set(value){for(const option of this.options)option.removeAttribute('selected');const chosen=[...this.options].find(option=>option.value===String(value));chosen?.setAttribute('selected','');}
  });
  class ClockDate extends Date{
    constructor(...args){super(...(args.length?args:[epoch+now]));}
    static now(){return epoch+now;}
  }
  const context={document,window,navigator:{onLine:true},requestAnimationFrame,cancelAnimationFrame,
    setTimeout,clearTimeout,performance:window.performance,matchMedia:window.matchMedia,
    Date:ClockDate,Intl,console,Event:dom.Event,queueMicrotask,AbortController,URL,
    Element:dom.Element,HTMLElement:dom.HTMLElement};
  const compiled=source.replace(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)/gm,'');
  vm.runInNewContext(compiled+'\nglobalThis.renderer=createCoordinationDashboard;',context,{filename:'coordination-dashboard.js'});
  const service={
    subscribeCoordinationMetrics(year,callback){currentCallback=callback;subscriptions.push({year,callback});return()=>stops++;},
    async saveInicBoard(){throw new Error('No writes are allowed in renderer tests.');},
    async deleteInicBoard(){throw new Error('No writes are allowed in renderer tests.');}
  };
  const view=context.renderer({service,state:initial,year:2027});
  document.body.append(view.element);
  function advance(milliseconds=16){
    now+=milliseconds;
    const batch=[...frames];frames.clear();
    for(const [,callback]of batch)callback(now);
    for(const [key,timer]of [...timers])if(timer.at<=now){timers.delete(key);timer.fn();}
  }
  function settle(){for(let count=0;frames.size&&count<120;count++)advance(16);assert.equal(frames.size,0,'Animations must end rather than loop forever.');}
  function change(element,value){element.value=value;element.dispatchEvent(new dom.Event('change',{bubbles:true}));}
  function input(element,value){element.value=value;element.dispatchEvent(new dom.Event('input',{bubbles:true}));}
  function metric(label){
    const card=[...view.element.querySelectorAll('.cd-metric')].find(node=>node.querySelector('.cd-metric-top > span')?.textContent===label);
    assert.ok(card,'Missing metric '+label);return card.querySelector('.cd-metric-value');
  }
  return {view,document,dom,frames,timers,cancelled,subscriptions,advance,settle,change,input,metric,
    emit:payload=>currentCallback(payload),badge:()=>view.element.querySelector('.cd-live'),
    time:()=>view.element.querySelector('.cd-sync-time')?.getAttribute('data-updated-at'),
    field:name=>view.element.querySelector('[name="'+name+'"]'),
    search:()=>view.element.querySelector('[aria-label="Buscar bancas"]'),
    get stops(){return stops;},
    setHidden(value){hidden=value;document.dispatchEvent(new dom.Event('visibilitychange'));},
    setReduced(value){media.matches=value;for(const fn of mediaListeners)fn({matches:value});}
  };
}

test('loading has no fabricated metrics and a real ready:false error replaces it with retry',()=>{
  const h=harness();
  assert.equal(h.view.element.querySelectorAll('.cd-metric').length,0);
  assert.match(h.view.element.textContent,/Carregando indicadores/);
  h.emit(data());h.settle();
  assert.match(h.view.element.textContent,/Banca Alpha de teste/);
  h.emit({ready:false,connected:null,error:new Error('Leitura de teste recusada')});
  assert.equal(h.badge()?.dataset.state,'error');
  assert.match(h.view.element.textContent,/Leitura de teste recusada/);
  assert.doesNotMatch(h.view.element.textContent,/Carregando indicadores|Banca Alpha de teste/);
  assert.ok([...h.view.element.querySelectorAll('button')].some(button=>button.textContent==='Tentar novamente'));
  assert.equal(h.frames.size,0);
  h.view.destroy();
});

test('live status requires Firebase connection and readiness, preserving data while offline',()=>{
  const h=harness();
  h.emit({...data(),ready:false});
  assert.notEqual(h.badge()?.dataset.state,'live');
  h.emit(data());h.settle();
  assert.equal(h.badge()?.dataset.state,'live');
  const priorTime=h.time(),firstCard=h.view.element.querySelector('.cd-chart-card');
  h.advance(5000);h.emit({...data(),connected:false});
  assert.equal(h.badge()?.dataset.state,'offline');
  assert.match(h.view.element.textContent,/Banca Alpha de teste/);
  assert.equal(h.view.element.querySelector('.cd-chart-card'),firstCard);
  assert.equal(h.time(),priorTime,'A connection event alone is not a data update.');
  h.emit({...data(),connected:null});
  assert.equal(h.badge()?.dataset.state,'automatic');
  h.emit(data());
  assert.equal(h.badge()?.dataset.state,'live');
  h.view.destroy();
});

test('new real records update filtered counts and preserve the search, focus and selection',()=>{
  const h=harness();h.emit(data());h.settle();
  h.change(h.field('advisor'),'advisor-a');h.settle();
  const search=h.search();h.input(search,'Alpha');search.focus();search.setSelectionRange(1,4);
  assert.equal(h.metric('Grupos').textContent,'1');
  assert.equal(h.metric('Bancas aprovadas').textContent,'1');
  const next=data();
  next.boards.push({id:'board-a2',groupId:'group-a',year:2027,title:'Banca Alpha nova de teste',date:'2027-03-21',status:'approved',updatedAt:20});
  next.tasks[1]={...next.tasks[1],completed:true,updatedAt:21};
  h.advance(5000);h.emit(next);h.settle();
  assert.equal(h.field('advisor').value,'advisor-a');
  assert.equal(h.metric('Grupos').textContent,'1');
  assert.equal(h.metric('Bancas aprovadas').textContent,'2');
  assert.equal(h.search().value,'Alpha');
  assert.equal(h.document.activeElement,h.search());
  assert.equal(h.search().selectionStart,1);assert.equal(h.search().selectionEnd,4);
  assert.match(h.view.element.textContent,/Banca Alpha nova de teste/);
  assert.doesNotMatch(h.view.element.querySelector('.cd-board-list')?.textContent||'',/Banca Beta/);
  assert.ok([...h.view.element.querySelectorAll('[aria-label]')].some(node=>/Mar.*2 banca/i.test(node.getAttribute('aria-label'))),'The monthly chart must reflect the additional March board.');
  h.view.destroy();
});

test('duplicate snapshots do not replace charts, replay animations or advance the update clock',()=>{
  const h=harness();h.emit(data());h.settle();
  const cards=[...h.view.element.querySelectorAll('.cd-chart-card')],priorTime=h.time();
  assert.ok(cards.length>=6);assert.ok(priorTime);
  h.advance(7000);h.emit(clone(data()));
  const after=[...h.view.element.querySelectorAll('.cd-chart-card')];
  assert.equal(after.length,cards.length);after.forEach((card,index)=>assert.equal(card,cards[index]));
  assert.equal(h.time(),priorTime);
  assert.equal(h.frames.size,0);
  h.view.destroy();
});

test('the update clock changes only for a new complete data snapshot, not animation frames',()=>{
  const h=harness();h.emit(data());h.settle();
  const previous=h.time();h.advance(5000);
  const next=data();next.boards[0]={...next.boards[0],status:'pending',updatedAt:30};
  h.emit(next);const actual=h.time();
  assert.notEqual(actual,previous);
  h.settle();assert.equal(h.time(),actual);
  assert.equal(h.metric('Bancas aprovadas').textContent,'0');
  h.view.destroy();
});

test('successive real updates during an animation settle on the newest counters and chart data',()=>{
  const h=harness();h.emit(data());h.settle();
  const second=data();second.boards.push({id:'board-a2',groupId:'group-a',year:2027,title:'Segunda banca de teste',date:'2027-03-21',status:'approved',updatedAt:30});
  h.emit(second);h.advance(100);
  const third=clone(second);third.boards.push({id:'board-a3',groupId:'group-a',year:2027,title:'Terceira banca de teste',date:'2027-03-22',status:'approved',updatedAt:31});
  h.emit(third);h.settle();
  assert.equal(h.metric('Bancas aprovadas').textContent,'3');
  assert.ok([...h.view.element.querySelectorAll('[aria-label]')].some(node=>/Mar.*3 banca/i.test(node.getAttribute('aria-label'))));
  h.view.destroy();
});

test('reduced motion and hidden documents receive final values without scheduling animation',()=>{
  for(const options of [{reduced:true},{hidden:true}]){
    const h=harness(options);h.emit(data());
    assert.equal(h.metric('Bancas aprovadas').textContent,'1');
    assert.equal(h.frames.size,0);
    const next=data();next.boards.push({id:'board-a2',groupId:'group-a',year:2027,title:'Banca de teste adicional',date:'2027-03-21',status:'approved',updatedAt:30});
    h.emit(next);
    assert.equal(h.metric('Bancas aprovadas').textContent,'2');
    assert.equal(h.frames.size,0);
    h.view.destroy();
  }
});

test('destroy and access loss cancel active frames and stale work cannot restore private content',()=>{
  for(const action of ['destroy','role','account','year']){
    const h=harness();h.emit(data());h.settle();
    const next=data();next.boards.push({id:'board-a2',groupId:'group-a',year:2027,title:'Banca de teste adicional',date:'2027-03-21',status:'approved',updatedAt:30});
    h.emit(next);assert.ok(h.frames.size>0,'Changed data should animate when motion is enabled.');
    const queued=[...h.frames.values()],oldCallback=h.subscriptions[0].callback;
    if(action==='destroy')h.view.destroy();
    if(action==='role')h.view.updateState({...state(),role:'student'});
    if(action==='account')h.view.updateState({...state(),user:{uid:'another-account'}});
    if(action==='year')h.change(h.field('year'),'2028');
    assert.equal(h.frames.size,0,'All old animation frames must be cancelled.');
    assert.ok(h.cancelled.length>0);
    for(const fn of queued)fn(100000);
    oldCallback(data());h.settle();
    assert.doesNotMatch(h.view.element.textContent,/Banca Alpha de teste|Banca de teste adicional|Pesquisa de teste Alpha/);
    assert.equal(h.stops,1);
    if(action==='destroy')assert.equal(h.view.element.textContent,'');
    h.view.destroy();
  }
});

test('an empty edition stays empty and missing task schedules are not presented as fabricated progress',()=>{
  const h=harness({initial:{...state(),groups:[]},reduced:true});
  h.emit({ready:true,connected:true,boards:[],results:[],tasks:[]});
  assert.match(h.view.element.textContent,/Nenhum grupo ativo/);
  assert.equal(h.metric('Grupos').textContent,'0');
  assert.doesNotMatch(h.view.element.textContent,/NaN|Infinity|Banca Alpha|Pesquisa de teste/);
  assert.equal(h.frames.size,0);h.view.destroy();
  const missing=harness({reduced:true});missing.emit({...data(),tasks:[]});
  assert.match(missing.view.element.textContent,/Sem etapas|Sem entregas|sem cronograma/i);
  assert.doesNotMatch(missing.view.element.textContent,/NaN|Infinity/);
  missing.view.destroy();
});
