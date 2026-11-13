import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

// Exercise the actual calendar renderer with synthetic records. No Firebase,
// network, browser automation, real invitations or calendar writes are used.
const source=readFileSync(new URL('../calendar.js',import.meta.url),'utf8');
const groups=()=>[
  {id:'alpha',name:'Pesquisa Alpha de teste',status:'active'},
  {id:'beta',name:'Pesquisa Beta de teste',status:'active'},
  {id:'deleting',name:'Grupo em exclusão de teste',status:'deleting'}
];
const records=()=>({
  tasks:[
    {id:'introduction',groupId:'alpha',title:'Introdução de teste',dueDate:'2027-05-01',completed:false},
    {id:'method',groupId:'alpha',title:'Metodologia de teste',dueDate:'2027-05-01',completed:true},
    {id:'results',groupId:'alpha',title:'Resultados de teste',dueDate:'2027-05-01',completed:false},
    {id:'beta-task',groupId:'beta',title:'Entrega Beta de teste',dueDate:'2027-05-02',completed:false},
    {id:'not-accessible',groupId:'private',title:'NÃO EXIBIR: grupo sem acesso',dueDate:'2027-05-01'},
    {id:'deleted-group',groupId:'deleting',title:'NÃO EXIBIR: grupo em exclusão',dueDate:'2027-05-01'},
    {id:'invalid-date',groupId:'alpha',title:'NÃO EXIBIR: data inválida',dueDate:'2027-02-29'}
  ],
  events:[
    {id:'orientation',groupId:'alpha',title:'Orientação Alpha de teste',date:'2027-05-01',description:'Revisar as referências do artigo.'},
    {id:'beta-event',groupId:'beta',title:'Encontro Beta de teste',date:'2027-05-01'},
    {id:'foreign-event',groupId:'private',title:'NÃO EXIBIR: evento privado',date:'2027-05-01'}
  ]
});

function harness({initial=[2027,4,1],epoch='2027-01-01T01:30:00Z',options={}}={}){
  const {document,window:dom}=parseHTML('<!doctype html><html><body></body></html>');
  let focused=null,frameId=0;
  const callbacks={add:[],edit:[],task:[],notice:[]},timers=new Map(),downloads=[];
  Object.defineProperty(document,'activeElement',{configurable:true,get:()=>focused?.isConnected?focused:null});
  dom.HTMLElement.prototype.focus=function(){focused=this;};
  dom.HTMLElement.prototype.blur=function(){if(focused===this)focused=null;};
  dom.HTMLElement.prototype.scrollIntoView=function(){};
  Object.defineProperty(dom.HTMLSelectElement.prototype,'value',{configurable:true,
    get(){return [...this.options].find(item=>item.selected)?.value??this.options[0]?.value??'';},
    set(value){for(const item of this.options)item.removeAttribute('selected');[...this.options].find(item=>item.value===String(value))?.setAttribute('selected','');}
  });
  class ClockDate extends Date{
    constructor(...args){super(...(args.length?args:[epoch]));}
    static now(){return Date.parse(epoch);}
  }
  const setTimeout=fn=>{const id=++frameId;timers.set(id,fn);return id;};
  const window={document,matchMedia:()=>({matches:false}),setTimeout,clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>setTimeout(()=>fn(0)),cancelAnimationFrame:id=>timers.delete(id)};
  Object.defineProperty(document,'defaultView',{configurable:true,value:window});
  const context={document,window,Date:ClockDate,Intl,console,Event:dom.Event,TextEncoder,Blob,
    URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:calendar-test';},revokeObjectURL:()=>{}},
    setTimeout,clearTimeout:window.clearTimeout,requestAnimationFrame:window.requestAnimationFrame,
    cancelAnimationFrame:window.cancelAnimationFrame,queueMicrotask,Element:dom.Element,HTMLElement:dom.HTMLElement};
  vm.runInNewContext(source.replace(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)/gm,'')+'\nglobalThis.renderer=createCalendarView;',context,{filename:'calendar.js'});
  const fixture=records(),viewState={};
  let currentOptions={groups:groups(),...fixture,viewState,initialDate:new ClockDate(...initial,12),
    onAddEvent:(...args)=>callbacks.add.push(args),onEditEvent:record=>callbacks.edit.push(record),
    onTask:record=>callbacks.task.push(record),onNotice:(...args)=>callbacks.notice.push(args),...options};
  let root;
  function remount(next={}){currentOptions={...currentOptions,...next};const replacement=context.renderer(currentOptions);root?.remove();root=replacement;document.body.append(root);flush();return root;}
  function flush(){for(let i=0;timers.size&&i<20;i++){const pending=[...timers];timers.clear();for(const [,fn]of pending)fn();}}
  function change(element,value){assert.ok(element,'Expected a calendar control.');element.value=value;element.dispatchEvent(new dom.Event('change',{bubbles:true}));flush();}
  function click(element){assert.ok(element,'Expected a calendar button.');element.click();flush();}
  function keyboard(element,key){element.focus();const event=new dom.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(event,'key',{value:key});element.dispatchEvent(event);flush();return event;}
  function field(name){return root.querySelector(`[data-filter-key="${name}"]`);}
  function day(value){return root.querySelector(`button[data-date="${value}"]`);}
  function button(text,scope=root){return [...scope.querySelectorAll('button')].find(item=>typeof text==='string'?item.textContent.trim()===text:text.test(item.textContent));}
  function mode(value){click(root.querySelector(`button[data-view="${value}"]`));}
  function type(value){click(root.querySelector(`button[data-type="${value}"]`));}
  function item(title,scope=root){return [...scope.querySelectorAll('.inic-calendar__item')].find(card=>card.querySelector('h4')?.textContent===title);}
  remount();
  return {document,dom,callbacks,fixture,viewState,downloads,remount,change,click,keyboard,field,day,button,mode,type,item,
    get root(){return root;},selection:()=>root.querySelector('.inic-calendar__selection'),agenda:()=>root.querySelector('.inic-calendar__list')};
}

test('month tiles stay chronological across year boundaries and include leap day',()=>{
  const h=harness({initial:[2027,0,1]});
  const days=[...h.root.querySelectorAll('button[data-date]')];
  assert.equal(days.length,42);
  assert.equal(days[0].dataset.date,'2026-12-27');
  assert.equal(days.at(-1).dataset.date,'2027-02-06');
  assert.equal(days.filter(day=>!day.classList.contains('is-outside')).length,31);
  assert.ok(days.every((day,index)=>index===0||day.dataset.date>days[index-1].dataset.date));
  h.change(h.field('month'),'2028-02');
  assert.ok(h.day('2028-02-29'));
  assert.ok(!h.day('2028-02-29').classList.contains('is-outside'));
  assert.equal([...h.root.querySelectorAll('button[data-date]')].filter(day=>!day.classList.contains('is-outside')).length,29);
});

test('opening a date exposes every record, including more than three entries',()=>{
  const h=harness();h.click(h.day('2027-05-01'));
  const detail=h.selection();assert.ok(detail);
  assert.equal(h.day('2027-05-01').getAttribute('aria-pressed'),'true');
  assert.ok(h.day('2027-05-01').classList.contains('is-selected'));
  const titles=[...detail.querySelectorAll('.inic-calendar__item h4')].map(item=>item.textContent);
  for(const title of ['Dia do Trabalho','Introdução de teste','Metodologia de teste','Resultados de teste','Orientação Alpha de teste','Encontro Beta de teste'])assert.ok(titles.includes(title),title);
  assert.equal(titles.length,6);
  assert.doesNotMatch(h.root.textContent,/NÃO EXIBIR/);
  assert.equal(h.root.querySelectorAll('button button').length,0,'Calendar tiles must not nest interactive buttons.');
});

test('group and type filters survive switching between month and agenda',()=>{
  const h=harness();h.change(h.field('group'),'alpha');h.type('task');h.mode('agenda');
  assert.equal(h.field('group').value,'alpha');
  assert.equal(h.root.querySelector('button[data-type="task"]').getAttribute('aria-pressed'),'true');
  assert.match(h.agenda().textContent,/Introdução de teste|Metodologia de teste|Resultados de teste/);
  assert.doesNotMatch(h.agenda().textContent,/Orientação Alpha|Encontro Beta|Entrega Beta|Dia do Trabalho|NÃO EXIBIR/);
  assert.equal(h.agenda().querySelectorAll('.inic-calendar__item').length,3);
  h.mode('month');h.click(h.day('2027-05-01'));
  assert.equal(h.field('group').value,'alpha');
  assert.equal(h.selection().querySelectorAll('.inic-calendar__item').length,3);
  h.type('event');
  assert.match(h.selection().textContent,/Orientação Alpha de teste/);
  assert.doesNotMatch(h.selection().textContent,/Introdução de teste|Encontro Beta|Dia do Trabalho/);
});

test('holiday visibility affects dates and agenda without hiding group deadlines',()=>{
  const h=harness();h.click(h.day('2027-05-01'));
  assert.ok(h.day('2027-05-01').classList.contains('is-holiday'));
  const toggle=h.field('holidays');toggle.checked=false;toggle.dispatchEvent(new h.dom.Event('change',{bubbles:true}));
  h.click(h.day('2027-05-01'));
  assert.ok(!h.day('2027-05-01').classList.contains('is-holiday'));
  assert.doesNotMatch(h.selection().textContent,/Dia do Trabalho/);
  assert.match(h.selection().textContent,/Introdução de teste/);
  h.mode('agenda');assert.doesNotMatch(h.agenda().textContent,/Dia do Trabalho/);
  assert.equal(h.field('holidays').checked,false);
});

test('the holiday category enables holidays and disabling them restores the all category',()=>{
  const h=harness();const toggle=h.field('holidays');toggle.checked=false;toggle.dispatchEvent(new h.dom.Event('change',{bubbles:true}));
  h.type('holiday');h.mode('agenda');
  assert.equal(h.field('holidays').checked,true);
  assert.match(h.agenda().textContent,/Dia do Trabalho/);
  assert.doesNotMatch(h.agenda().textContent,/Introdução de teste|Orientação Alpha/);
  const enabled=h.field('holidays');enabled.checked=false;enabled.dispatchEvent(new h.dom.Event('change',{bubbles:true}));
  assert.equal(h.root.querySelector('button[data-type="all"]').getAttribute('aria-pressed'),'true');
  assert.match(h.agenda().textContent,/Introdução de teste/);
  assert.doesNotMatch(h.agenda().textContent,/Dia do Trabalho/);
});

test('Hoje uses the São Paulo date before midnight UTC rolls over locally',()=>{
  const h=harness({initial:[2027,4,1],epoch:'2027-01-01T01:30:00Z'});
  h.click(h.button('Hoje'));
  assert.equal(h.field('month').value,'2026-12');
  assert.equal(h.day('2026-12-31').getAttribute('aria-current'),'date');
  assert.equal(h.day('2026-12-31').getAttribute('aria-pressed'),'true');
  assert.ok(h.day('2026-12-31').classList.contains('is-today'));
});

test('students can open tasks but cannot create or edit group events',()=>{
  const h=harness();h.click(h.day('2027-05-01'));
  assert.equal(h.button(/Adicionar evento/),undefined);
  assert.equal(h.button(/Editar evento/),undefined);
  h.click(h.button('Ver entrega',h.item('Introdução de teste',h.selection())));
  assert.equal(h.callbacks.task.length,1);
  assert.equal(h.callbacks.task[0],h.fixture.tasks[0]);
  assert.equal(h.callbacks.edit.length,0);assert.equal(h.callbacks.add.length,0);
});

test('event actions are limited to managed groups and use the selected civil date',()=>{
  const h=harness({options:{canManageGroup:group=>group.id==='alpha'}});h.click(h.day('2027-05-01'));
  h.click(h.button('Editar evento',h.item('Orientação Alpha de teste',h.selection())));
  assert.equal(h.callbacks.edit[0],h.fixture.events[0]);
  assert.equal(h.button('Editar evento',h.item('Encontro Beta de teste',h.selection())),undefined);
  h.click(h.button('Adicionar neste dia',h.selection()));
  assert.deepEqual(h.callbacks.add[0],['alpha','2027-05-01']);
  assert.doesNotMatch(h.root.textContent,/NÃO EXIBIR/);
});

test('keyboard date navigation crosses months and restores focus to the selected tile',()=>{
  const h=harness({initial:[2027,0,1]});h.click(h.day('2027-01-31'));
  const moved=h.keyboard(h.day('2027-01-31'),'ArrowRight');
  assert.equal(moved.defaultPrevented,true);
  assert.equal(h.field('month').value,'2027-02');
  assert.equal(h.document.activeElement,h.day('2027-02-01'));
  assert.equal(h.day('2027-02-01').getAttribute('aria-pressed'),'true');
  h.keyboard(h.day('2027-02-01'),'ArrowDown');
  assert.equal(h.document.activeElement,h.day('2027-02-08'));
  h.keyboard(h.day('2027-02-08'),'ArrowLeft');
  assert.equal(h.document.activeElement,h.day('2027-02-07'));
  // linkedom reflects the tabIndex setter to the attribute, but its getter
  // incorrectly returns -1 for tabindex="0". Assert the rendered DOM contract.
  assert.equal(h.root.querySelectorAll('button[data-date][tabindex="0"]').length,1);
  h.change(h.field('month'),'2027-01');h.click(h.day('2027-01-31'));
  h.keyboard(h.day('2027-01-31'),'PageDown');
  assert.equal(h.document.activeElement,h.day('2027-02-28'),'The 31st must clamp to the last day of February.');
  h.keyboard(h.day('2027-02-28'),'End');
  assert.equal(h.document.activeElement,h.day('2027-03-06'),'End selects Saturday, including across the month boundary.');
});

test('an explicit view state retains filters and selection when data is refreshed',()=>{
  const h=harness();h.change(h.field('group'),'alpha');h.type('event');h.click(h.day('2027-05-01'));h.mode('agenda');
  const next={id:'new-event',groupId:'alpha',title:'Novo encontro após atualização',date:'2027-05-03'};
  h.remount({events:[...h.fixture.events,next]});
  assert.equal(h.field('month').value,'2027-05');assert.equal(h.field('group').value,'alpha');
  assert.equal(h.root.querySelector('button[data-view="agenda"]').getAttribute('aria-pressed'),'true');
  assert.equal(h.root.querySelector('button[data-type="event"]').getAttribute('aria-pressed'),'true');
  assert.match(h.agenda().textContent,/Novo encontro após atualização/);
  h.mode('month');assert.equal(h.day('2027-05-01').getAttribute('aria-pressed'),'true');
});

test('access removal clears inaccessible group choices and prevents stale records from reappearing',()=>{
  const h=harness();h.change(h.field('group'),'alpha');h.click(h.day('2027-05-01'));
  h.remount({groups:[{id:'beta',name:'Pesquisa Beta de teste',status:'active'}]});
  assert.equal(h.field('group').value,'all');
  assert.equal(h.field('group').querySelector('option[value="alpha"]'),null);
  h.mode('agenda');
  assert.doesNotMatch(h.agenda().textContent,/Introdução de teste|Metodologia de teste|Resultados de teste|Orientação Alpha|NÃO EXIBIR/);
  assert.match(h.agenda().textContent,/Encontro Beta de teste|Entrega Beta de teste/);
});

test('titles and descriptions render as text and empty dates offer an honest empty state',()=>{
  const title='<img src=x onerror=alert(1)> & artigo de teste';
  const description='<script>window.stolen=true</script> Texto de teste';
  const h=harness({options:{events:[{id:'text',groupId:'alpha',title,description,date:'2027-05-01'}],tasks:[]}});
  h.click(h.day('2027-05-01'));
  assert.ok(h.item(title,h.selection()));
  assert.match(h.selection().textContent,/<script>window\.stolen=true<\/script>/);
  assert.equal(h.root.querySelector('img'),null);assert.equal(h.root.querySelector('script'),null);
  h.click(h.day('2027-05-08'));
  assert.equal(h.selection().querySelectorAll('.inic-calendar__item').length,0);
  assert.match(h.selection().textContent,/dia livre|nenhum|sem (?:registro|compromisso|evento)/i);
});

test('exported ICS respects the selected year, group and category',async()=>{
  const h=harness();h.change(h.field('group'),'alpha');h.type('event');
  h.click(h.button('Exportar 2027'));
  assert.equal(h.downloads.length,1);
  const ics=(await h.downloads[0].text()).replace(/\r\n /g,'');
  assert.equal((ics.match(/\r\nBEGIN:VEVENT\r\n/g)||[]).length,1);
  assert.match(ics,/SUMMARY:Orientação Alpha de teste\r\n/);
  assert.match(ics,/DTSTART;VALUE=DATE:20270501\r\n/);
  assert.doesNotMatch(ics,/Dia do Trabalho|Encontro Beta|Introdução de teste|NÃO EXIBIR/);
  assert.equal(h.callbacks.notice.at(-1)?.[1],'success');
});
