import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../calendar.js',import.meta.url),'utf8');
const {parseCalendarDate,calendarCivilDate,brazilToday,nationalHolidays,calendarEntries,calendarIcs}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const groups=[{id:'my-group',name:'Grupo da escola',status:'active'},{id:'deleting',name:'Em exclusão',status:'deleting'}];
const tasks=[
  {id:'article',groupId:'my-group',title:'Artigo final',dueDate:'2027-07-31',completed:false},
  {id:'old',groupId:'my-group',title:'Entrega anterior',dueDate:'2026-12-31',completed:true},
  {id:'leak',groupId:'other-group',title:'Grupo sem acesso',dueDate:'2027-07-31'},
  {id:'locked',groupId:'deleting',title:'Grupo em exclusão',dueDate:'2027-07-31'},
  {id:'invalid',groupId:'my-group',title:'Data inválida',dueDate:'2027-02-29'}
];
const events=[{id:'meeting',groupId:'my-group',title:'Orientação',date:'2027-07-31',description:'Levar o artigo.'}];

test('datas civis não aceitam datas inexistentes e preservam dia/mês',()=>{
  for(const invalid of ['2027-02-29','2027-04-31','2027-13-01','2027-00-01','2027-01-00','2027-1-1','31/07/2027','2027-07-31T00:00:00Z'])assert.equal(parseCalendarDate(invalid),null,invalid);
  assert.equal(calendarCivilDate(parseCalendarDate('2027-07-31')),'2027-07-31');
  assert.equal(calendarCivilDate(parseCalendarDate('2028-02-29')),'2028-02-29');
});
test('Hoje usa o dia civil de São Paulo mesmo perto da meia-noite UTC',()=>{
  assert.equal(brazilToday(new Date('2027-01-01T01:30:00Z')),'2026-12-31');
  assert.equal(brazilToday(new Date('2027-01-01T04:00:00Z')),'2027-01-01');
});
test('2027 contém os nove feriados nacionais federais, incluindo 20 de novembro',()=>{
  const days=nationalHolidays(2027);
  assert.equal(days.length,9);
  assert.deepEqual(days.map(h=>h.date),['2027-01-01','2027-04-21','2027-05-01','2027-09-07','2027-10-12','2027-11-02','2027-11-15','2027-11-20','2027-12-25']);
  assert.ok(days.every(h=>h.type==='holiday'&&h.source.startsWith('https://www2.camara.leg.br/')));
  assert.ok(!days.some(h=>/Carnaval|Corpus Christi|Paixão/.test(h.title)));
});
test('calendário cruza os registros com os grupos acessíveis e ignora grupo em exclusão',()=>{
  const records=calendarEntries({groups,tasks,events,year:2027});
  assert.equal(records.filter(r=>r.type==='task').length,2);
  assert.equal(records.filter(r=>r.type==='event').length,1);
  assert.ok(!records.some(r=>['leak','locked','invalid'].includes(r.id)));
  assert.equal(records.find(r=>r.id==='meeting').groupName,'Grupo da escola');
  assert.deepEqual(records.filter(r=>r.date==='2027-07-31').map(r=>r.type),['event','task']);
});
test('filtro por grupo não inclui tarefas ou eventos de outros grupos e mantém feriados',()=>{
  const records=calendarEntries({groups,tasks,events,year:2027,groupId:'other-group'});
  assert.equal(records.length,9);
  assert.ok(records.every(r=>r.type==='holiday'));
  assert.equal(calendarEntries({groups,tasks,events,year:2027,groupId:'other-group',includeHolidays:false}).length,0);
});
test('ICS do ano inclui feriados, evento e entrega, sem registros fora do escopo',()=>{
  const ics=calendarIcs({groups,tasks,events,year:2027,now:new Date('2026-11-05T15:00:00Z')});
  const unfolded=ics.replace(/\r\n /g,'');
  assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,11);
  assert.ok(unfolded.includes('SUMMARY:Artigo final\r\n'));
  assert.ok(unfolded.includes('SUMMARY:Orientação\r\n'));
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20270731\r\nDTEND;VALUE=DATE:20270801'));
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20271225\r\nDTEND;VALUE=DATE:20271226'));
  assert.ok(!/Grupo sem acesso|Grupo em exclusão|Data inválida|Entrega anterior/.test(unfolded));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});
test('ICS escapa conteúdo de aluno/professor e dobra linhas UTF-8 sem quebrar caracteres',()=>{
  const malicious=[{id:'meeting',groupId:'my-group',title:'Reunião, ação; revisão\\artigo\nEND:VEVENT\r\nBEGIN:VEVENT',date:'2027-12-31',description:'çã😀'.repeat(100)}];
  const ics=calendarIcs({groups,events:malicious,year:2027,includeHolidays:false});
  assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,2); // the second is escaped inline, not a line injection
  assert.equal((ics.match(/\r\nBEGIN:VEVENT\r\n/g)||[]).length,1);
  assert.ok(ics.includes('DTEND;VALUE=DATE:20280101'));
  assert.ok(ics.includes('Reunião\\, ação\\; revisão\\\\artigo\\nEND:VEVENT\\n'));
  for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75,`Linha longa: ${Buffer.byteLength(line,'utf8')}`);
  assert.ok(!ics.includes('\uFFFD'));
  assert.ok(ics.replace(/\r\n /g,'').includes('çã😀'.repeat(100)));
});
