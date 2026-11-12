import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';

const source=await readFile(new URL('../community.js',import.meta.url),'utf8');
const {createCommunityView,participantStatus}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function setup(options={}) {
  const {window,document}=parseHTML('<!doctype html><html lang="pt-BR"><body></body></html>');
  let focused=null;
  Object.defineProperty(document,'activeElement',{get:()=>focused,configurable:true});
  window.HTMLElement.prototype.focus=function(){focused=this;};
  globalThis.document=document;
  const invited=[],retries=[];
  const view=createCommunityView({people:[],ready:true,error:null,currentUid:'self',onInvite:person=>invited.push(person),onRetry:()=>retries.push(true),...options});
  document.body.append(view.element);
  return {window,document,view,invited,retries,close(){view.destroy();}};
}

const student=(id='student',patch={})=>({id,uid:id,name:'Ana Estudante',role:'student',requestedRole:'student',year:'2º ano',groupId:'',...patch});
const advisor=(id='advisor',patch={})=>({id,uid:id,name:'Ângelo Professor',role:'advisor',requestedRole:'advisor',listedAdvisor:true,year:'',groupId:'',...patch});
const cards=q=>[...q.document.querySelectorAll('[data-person-id]')];
const card=(q,id)=>q.document.querySelector(`[data-person-id="${id}"]`);
const invitationButton=(q,id)=>card(q,id)?.querySelector('[data-person-invite]');
function search(q,value){const field=q.document.querySelector('#community-search');assert.ok(field,'community search');field.value=value;field.dispatchEvent(new q.window.Event('input'));return field;}
function filter(q,value){const control=q.document.querySelector(`[data-people-filter="${value}"]`);assert.ok(control,'people filter '+value);control.click();return control;}

test('student availability distinguishes free profiles from students with a group',()=>{
  assert.equal(participantStatus(student()).available,true);
  assert.equal(participantStatus(student()).type,'member');
  const occupied=participantStatus(student('bound',{groupId:'g-current'}));
  assert.equal(occupied.available,false);
  assert.match(occupied.label+' '+occupied.detail,/grupo|convite/i);
});

test('a teacher remains available when already advising multiple groups',()=>{
  const status=participantStatus(advisor('teacher',{groupId:'g-first',groups:['g-first','g-second'],groupCount:2}));
  assert.equal(status.available,true);
  assert.equal(status.type,'advisor');
});

test('pending teachers cannot be invited as students or approved advisors',()=>{
  assert.equal(participantStatus(student('pending',{requestedRole:'advisor'})).available,false);
  assert.match(participantStatus(student('pending',{requestedRole:'advisor'})).label+' '+participantStatus(student('pending',{requestedRole:'advisor'})).detail,/aprova|aguard/i);
});

test('coordination is offered as teacher only when explicitly listed as advisor',()=>{
  assert.equal(participantStatus({id:'coord',role:'coordinator',listedAdvisor:false}).available,false);
  const listed=participantStatus({id:'coord-prof',role:'coordinator',listedAdvisor:true});
  assert.equal(listed.available,true);
  assert.equal(listed.type,'advisor');
});

test('a teacher without directory approval remains visible but cannot receive orientation invitations',()=>{
  const person=advisor('unlisted',{listedAdvisor:false});
  const status=participantStatus(person);
  assert.equal(status.available,false);
  assert.equal(status.type,'advisor');
  assert.equal(status.label,'Aguardando liberação para orientar');
  const q=setup({people:[person,advisor('approved')]});
  filter(q,'advisors');
  assert.ok(card(q,'unlisted'));
  assert.ok(invitationButton(q,'unlisted').disabled);
  invitationButton(q,'unlisted').click();
  assert.equal(q.invited.length,0);
  filter(q,'available');
  assert.deepEqual(cards(q).map(el=>el.dataset.personId),['approved']);
  q.close();
});

test('professor filter and count include pending teachers but exclude coordination-only historical role requests',()=>{
  const q=setup({people:[
    {id:'coord-only',uid:'coord-only',name:'Coordenação',role:'coordinator',requestedRole:'advisor',listedAdvisor:false},
    advisor('approved'),
    student('pending',{name:'Professor aguardando',requestedRole:'advisor'})
  ]});
  assert.ok(card(q,'coord-only'));
  assert.equal(q.document.querySelectorAll('.community-stat strong')[1].textContent,'2');
  filter(q,'advisors');
  assert.deepEqual(cards(q).map(el=>el.dataset.personId).sort(),['approved','pending']);
  assert.equal(card(q,'coord-only'),null);
  assert.ok(invitationButton(q,'pending').disabled);
  q.close();
});

test('loading does not expose cached people or invite actions',()=>{
  const q=setup({people:[student()],ready:false});
  assert.equal(cards(q).length,0);
  assert.match(q.view.element.textContent,/carregando|consultando/i);
  assert.equal(q.document.querySelector('[data-person-invite]'),null);
  q.close();
});

test('empty directory provides an honest empty state',()=>{
  const q=setup();
  assert.equal(cards(q).length,0);
  assert.match(q.view.element.textContent,/nenhum|ninguém|ainda não|aparecerão aqui/i);
  q.close();
});

test('people cards show names and roles without exposing email or private profile data',()=>{
  const q=setup({people:[student('ana',{email:'private@example.invalid',password:'never-display',agreement:{filename:'private-term.pdf'}}),advisor()]});
  assert.equal(cards(q).length,2);
  assert.match(q.view.element.textContent,/Ana Estudante/);
  assert.match(q.view.element.textContent,/Ângelo Professor/);
  assert.match(q.view.element.textContent,/2º ano/);
  assert.doesNotMatch(q.view.element.textContent,/private@example|never-display|private-term/);
  q.close();
});

test('search matches accented names without accents and keeps the original display name',()=>{
  const q=setup({people:[student(),advisor()]});
  search(q,'ANGELO');
  assert.deepEqual(cards(q).map(el=>el.dataset.personId),['advisor']);
  assert.match(card(q,'advisor').textContent,/Ângelo Professor/);
  q.close();
});

test('role filters separate students and teachers and expose their selected state',()=>{
  const q=setup({people:[student(),advisor(),{id:'coord-prof',uid:'coord-prof',name:'Bruno',role:'coordinator',listedAdvisor:true}]});
  const teachers=filter(q,'advisors');
  assert.equal(teachers.getAttribute('aria-pressed'),'true');
  assert.deepEqual(cards(q).map(el=>el.dataset.personId).sort(),['advisor','coord-prof']);
  const students=filter(q,'students');
  assert.equal(students.getAttribute('aria-pressed'),'true');
  assert.deepEqual(cards(q).map(el=>el.dataset.personId),['student']);
  q.close();
});

test('available filter excludes occupied students and teachers pending approval',()=>{
  const q=setup({people:[student('free'),student('bound',{groupId:'g'}),student('pending',{requestedRole:'advisor'}),advisor()]});
  filter(q,'available');
  assert.deepEqual(cards(q).map(el=>el.dataset.personId).sort(),['advisor','free']);
  q.close();
});

test('an occupied student has a visible explanation and cannot be invited',()=>{
  const q=setup({people:[student('bound',{groupId:'g'})]});
  assert.match(card(q,'bound').textContent,/grupo|convite/i);
  const button=invitationButton(q,'bound');
  assert.ok(!button||button.disabled);
  button?.click();
  assert.equal(q.invited.length,0);
  q.close();
});

test('invitation callback cannot override the occupied-student restriction',()=>{
  const q=setup({people:[student('bound',{groupId:'g'})],invitationState:()=>({label:'Convidar',disabled:false})});
  const button=invitationButton(q,'bound');
  assert.ok(!button||button.disabled);
  button?.click();
  assert.equal(q.invited.length,0);
  q.close();
});

test('pending invitation feedback prevents a duplicate action while leaving teacher availability intact',()=>{
  const q=setup({people:[advisor()],invitationState:()=>({label:'Convite enviado',disabled:true,detail:'Aguardando resposta deste professor.'})});
  const button=invitationButton(q,'advisor');
  assert.ok(button?.disabled);
  assert.match(card(q,'advisor').textContent,/Convite enviado|Aguardando resposta/);
  button.click();
  assert.equal(q.invited.length,0);
  assert.equal(participantStatus(advisor()).available,true);
  q.close();
});

test('explicit invite action returns the selected profile and never sends on render',()=>{
  const person=student('target');
  const q=setup({people:[person]});
  assert.equal(q.invited.length,0);
  const button=invitationButton(q,'target');
  assert.ok(button&&!button.disabled);
  button.click();
  assert.equal(q.invited.length,1);
  assert.equal(q.invited[0].id,'target');
  q.close();
});

test('the current account cannot invite itself',()=>{
  const q=setup({people:[student('self'),advisor()]});
  const button=invitationButton(q,'self');
  assert.ok(!button||button.disabled);
  button?.click();
  assert.equal(q.invited.length,0);
  q.close();
});

test('directory renders at most twelve cards and applies search to the full collection',()=>{
  const people=Array.from({length:27},(_,i)=>student('student-'+i,{name:'Aluno '+String(i).padStart(2,'0')}));
  people[26].name='Registro único';
  const q=setup({people});
  assert.equal(cards(q).length,12);
  search(q,'registro unico');
  assert.equal(cards(q).length,1);
  assert.equal(cards(q)[0].dataset.personId,'student-26');
  q.close();
});

test('pagination visits the complete directory and a search resets to the first matching page',()=>{
  const people=Array.from({length:27},(_,i)=>student('student-'+i,{name:'Aluno '+String(i).padStart(2,'0')}));
  const q=setup({people});
  const next=q.document.querySelector('[data-people-page="next"]');
  assert.ok(next&&!next.disabled);next.click();
  assert.equal(cards(q).length,12);
  assert.equal(cards(q)[0].dataset.personId,'student-12');
  next.click();
  assert.equal(cards(q).length,3);
  assert.equal(cards(q)[0].dataset.personId,'student-24');
  assert.ok(next.disabled);
  search(q,'Aluno 0');
  assert.equal(cards(q).length,10);
  assert.equal(cards(q)[0].dataset.personId,'student-0');
  assert.ok(q.document.querySelector('[data-people-page="previous"]').disabled);
  q.close();
});

test('live removals clamp an existing page instead of leaving an empty directory',()=>{
  const people=Array.from({length:25},(_,i)=>student('student-'+i,{name:'Aluno '+String(i).padStart(2,'0')}));
  const q=setup({people});
  q.document.querySelector('[data-people-page="next"]').click();
  q.document.querySelector('[data-people-page="next"]').click();
  q.view.update({people:people.slice(0,13)});
  assert.equal(cards(q).length,1);
  assert.equal(cards(q)[0].dataset.personId,'student-12');
  q.close();
});

test('live updates preserve the search node and focused input while refreshing availability',()=>{
  const q=setup({people:[student('target')]});
  const input=search(q,'ana');input.focus();
  q.view.update({people:[student('target',{groupId:'g'})],ready:true,error:null});
  assert.equal(q.document.querySelector('#community-search'),input);
  assert.equal(q.document.activeElement,input);
  assert.equal(input.value,'ana');
  const button=invitationButton(q,'target');
  assert.ok(!button||button.disabled);
  q.close();
});

test('error state clears cards and offers retry without displaying private technical details',()=>{
  const q=setup({people:[student()]});
  q.view.update({ready:false,error:new Error('Falha de conexão')});
  assert.equal(cards(q).length,0);
  const retry=[...q.view.element.querySelectorAll('button')].find(button=>/Tentar novamente/i.test(button.textContent));
  assert.ok(retry);retry.click();
  assert.equal(q.retries.length,1);
  q.close();
});

test('a detached invite button cannot act after loading fails or readiness is revoked',()=>{
  for(const patch of [{ready:false},{ready:false,error:new Error('Sem acesso')}]){
    const q=setup({people:[student('target')]});
    const button=invitationButton(q,'target');
    q.view.update(patch);button.click();
    assert.equal(q.invited.length,0);
    q.close();
  }
});

test('stale buttons recheck changed availability and pending invitation state before acting',()=>{
  const q=setup({people:[student('target')]});
  const button=invitationButton(q,'target');
  q.view.update({people:[student('target',{groupId:'g'})]});button.click();
  assert.equal(q.invited.length,0);
  q.view.update({people:[student('target')],invitationState:()=>({disabled:true,label:'Convite enviado'})});button.click();
  assert.equal(q.invited.length,0);
  q.close();
});

test('a changed current account cannot use an old button to invite itself',()=>{
  const q=setup({people:[student('target')]});
  const button=invitationButton(q,'target');
  q.view.update({currentUid:'target'});button.click();
  assert.equal(q.invited.length,0);
  q.close();
});

test('hostile profile names are rendered literally without injecting markup',()=>{
  const q=setup({people:[student('hostile',{name:'<img src=x onerror=alert(1)>'})]});
  assert.match(card(q,'hostile').textContent,/<img src=x/);
  assert.equal(card(q,'hostile').querySelector('img'),null);
  assert.equal(card(q,'hostile').querySelector('script'),null);
  q.close();
});

test('destroy removes rendered people and prevents actions from detached controls',()=>{
  const q=setup({people:[student('target')]});
  const button=invitationButton(q,'target');
  q.close();
  assert.doesNotMatch(q.view.element.textContent,/Ana Estudante/);
  button.click();
  assert.equal(q.invited.length,0);
});
