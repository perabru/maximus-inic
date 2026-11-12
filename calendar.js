// Civil dates stay as YYYY-MM-DD. No UTC conversion is applied to school deadlines.
const HOLIDAY_LAWS = Object.freeze({
  general: 'https://www2.camara.leg.br/legin/fed/lei/2002/lei-10607-19-dezembro-2002-473572-publicacaooriginal-1-pl.html',
  aparecida: 'https://www2.camara.leg.br/legin/fed/lei/1980-1987/lei-6802-30-junho-1980-357065-publicacaooriginal-1-pl.html',
  consciencia: 'https://www2.camara.leg.br/legin/fed/lei/2023/lei-14759-21-dezembro-2023-795091-publicacaooriginal-170522-pl.html'
});
const HOLIDAYS = Object.freeze([
  ['01-01','Confraternização Universal','general'],
  ['04-21','Tiradentes','general'],
  ['05-01','Dia do Trabalho','general'],
  ['09-07','Independência do Brasil','general'],
  ['10-12','Nossa Senhora Aparecida','aparecida'],
  ['11-02','Finados','general'],
  ['11-15','Proclamação da República','general'],
  ['11-20','Dia Nacional de Zumbi e da Consciência Negra','consciencia'],
  ['12-25','Natal','general']
]);

export function parseCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year,month,day] = value.split('-').map(Number);
  if (year < 1900 || year > 2100) return null;
  const date = new Date(year,month-1,day,12);
  return date.getFullYear() === year && date.getMonth() === month-1 && date.getDate() === day ? date : null;
}
export function calendarCivilDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function brazilToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function nationalHolidays(year = 2027) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return [];
  return HOLIDAYS.map(([day,title,law]) => ({
    id:`br-${year}-${day}`,key:`holiday/${year}-${day}`,date:`${year}-${day}`,title,type:'holiday',
    description:'Feriado nacional',source:HOLIDAY_LAWS[law],groupId:'',groupName:''
  }));
}
export function calendarEntries({groups = [],tasks = [],events = [],year = 2027,groupId = 'all',includeHolidays = true} = {}) {
  const groupMap = new Map(groups.filter(group => group && group.id && group.status !== 'deleting').map(group => [group.id,group]));
  const allowed = entry => entry && groupMap.has(entry.groupId) && (groupId === 'all' || entry.groupId === groupId);
  const entries = includeHolidays ? nationalHolidays(year) : [];
  for (const task of tasks) {
    if (!allowed(task) || !parseCalendarDate(task.dueDate)) continue;
    entries.push({...task,key:`task/${task.groupId}/${task.id}`,type:'task',date:task.dueDate,groupName:groupMap.get(task.groupId).name || 'Grupo',record:task});
  }
  for (const event of events) {
    if (!allowed(event) || !parseCalendarDate(event.date)) continue;
    entries.push({...event,key:`event/${event.groupId}/${event.id}`,type:'event',groupName:groupMap.get(event.groupId).name || 'Grupo',record:event});
  }
  return entries.sort((a,b) => a.date.localeCompare(b.date) || ({holiday:0,event:1,task:2}[a.type]-{holiday:0,event:1,task:2}[b.type]) || String(a.title).localeCompare(String(b.title),'pt-BR'));
}

function escapeIcs(value) {
  return String(value ?? '').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
}
function nextCivilDay(value) {
  const [year,month,day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year,month-1,day+1,12));
  return `${next.getUTCFullYear()}${String(next.getUTCMonth()+1).padStart(2,'0')}${String(next.getUTCDate()).padStart(2,'0')}`;
}
// RFC 5545 folds at 75 UTF-8 octets; do not split a multibyte character.
function foldIcsLine(value) {
  const encoder = new TextEncoder();
  const lines = [];
  let line = '',length = 0;
  for (const char of value) {
    const bytes = encoder.encode(char).length;
    if (length + bytes > 75) {lines.push(line);line = ' ';length = 1;}
    line += char;length += bytes;
  }
  lines.push(line);
  return lines.join('\r\n');
}
export function calendarIcs({groups = [],tasks = [],events = [],year = 2027,groupId = 'all',includeHolidays = true,now = new Date()} = {}) {
  const records = calendarEntries({groups,tasks,events,year,groupId,includeHolidays}).filter(entry => entry.date.startsWith(`${year}-`));
  const stamp = now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Maximus//Meu INIC//PT-BR','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:Meu INIC ${year} - Máximu’s`];
  for (const item of records) {
    const description = [item.type === 'holiday' ? 'Feriado nacional' : item.type === 'task' ? 'Entrega do cronograma' : 'Evento do grupo',item.groupName && `Grupo: ${item.groupName}`,item.description,item.type === 'task' ? (item.completed ? 'Situação: concluída' : 'Situação: pendente') : '',item.source].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT',`UID:${encodeURIComponent(item.key)}@maximus-inic`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${item.date.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${nextCivilDay(item.date)}`,`SUMMARY:${escapeIcs(item.title)}`,`DESCRIPTION:${escapeIcs(description)}`,`CATEGORIES:${item.type === 'holiday' ? 'Feriado nacional' : item.type === 'task' ? 'Entrega' : 'Evento'}`);
    if (item.source) lines.push(`URL:${item.source}`);
    lines.push('TRANSP:TRANSPARENT','END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n')+'\r\n';
}

const ui = {date:null,groupId:'all',selectedDay:'',showHolidays:true};
const el = (tag,className,text) => {const element = document.createElement(tag);if(className)element.className=className;if(text !== undefined)element.textContent=String(text);return element;};
const control = (label,className,handler) => {const button=el('button',className,label);button.type='button';button.addEventListener('click',handler);return button;};
const longDate = value => new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'long',year:'numeric'}).format(parseCalendarDate(value));
const dateStatus = entry => entry.completed ? 'Concluída' : entry.date < brazilToday() ? 'Em atraso' : entry.date === brazilToday() ? 'Hoje' : 'Pendente';

export function createCalendarView({groups = [],tasks = [],events = [],canManageGroup = () => false,onAddEvent = () => {},onEditEvent = () => {},onTask = () => {},onNotice = () => {},initialDate = new Date(2027,0,1,12)} = {}) {
  if (!ui.date) ui.date = initialDate instanceof Date && !Number.isNaN(initialDate.getTime()) ? new Date(initialDate.getFullYear(),initialDate.getMonth(),1,12) : new Date(2027,0,1,12);
  if (!groups.some(group => group.id === ui.groupId && group.status !== 'deleting')) ui.groupId='all';
  const root = el('section','inic-calendar');
  const managed = groups.filter(group => group.status !== 'deleting' && canManageGroup(group));

  function changeMonth(year,month) {const target=new Date(year,month,1,12);if(target.getFullYear()<1900||target.getFullYear()>2100)return;ui.date=target;ui.selectedDay='';draw();}
  function restoreFilterFocus(key) {root.querySelector(`[data-filter-key="${key}"]`)?.focus({preventScroll:true});}
  function selectedGroup() {return ui.groupId !== 'all' && managed.some(group => group.id === ui.groupId) ? ui.groupId : managed.length===1 ? managed[0].id : '';}
  function addEvent(date) {onAddEvent(selectedGroup(),date || ui.selectedDay || `${ui.date.getFullYear()}-${String(ui.date.getMonth()+1).padStart(2,'0')}-01`);}
  function exportAgenda() {
    const year=ui.date.getFullYear();
    const contents=calendarIcs({groups,tasks,events,year,groupId:ui.groupId,includeHolidays:ui.showHolidays});
    const blob=new Blob([contents],{type:'text/calendar;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const anchor=el('a');anchor.href=url;anchor.download=`Meu-INIC-${year}.ics`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
    onNotice(`Agenda de ${year} exportada. Importe o arquivo no aplicativo de calendário.`,'success');
  }
  function entryCard(entry) {
    const card=el('article',`inic-calendar__item inic-calendar__item--${entry.type}`);
    const meta=el('div','inic-calendar__item-meta');
    const time=el('time','',new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(parseCalendarDate(entry.date)));time.dateTime=entry.date;
    meta.append(time,el('span','inic-calendar__type',entry.type==='holiday'?'Feriado nacional':entry.type==='task'?`Entrega · ${dateStatus(entry)}`:'Evento'));
    const copy=el('div','inic-calendar__item-copy');copy.append(el('h4','',entry.title));
    if(entry.groupName)copy.append(el('p','',entry.groupName));
    if(entry.description && entry.type!=='holiday')copy.append(el('p','inic-calendar__description',entry.description));
    card.append(meta,copy);
    if(entry.type==='task')card.append(control('Ver entrega','button secondary compact',()=>onTask(entry.record)));
    if(entry.type==='event' && managed.some(group=>group.id===entry.groupId))card.append(control('Editar evento','button secondary compact',()=>onEditEvent(entry.record)));
    if(entry.type==='holiday') {const source=el('a','inic-calendar__source','Lei federal');source.href=entry.source;source.target='_blank';source.rel='noopener noreferrer';source.setAttribute('aria-label',`Fonte oficial: ${entry.title}`);card.append(source);}
    return card;
  }
  function draw() {
    const year=ui.date.getFullYear(),month=ui.date.getMonth();
    root.replaceChildren();
    const heading=el('div','section-title inic-calendar__heading');const intro=el('div');intro.append(el('h2','',`Calendário ${year}`),el('p','','Entregas do cronograma, eventos e feriados nacionais.'));
    heading.append(intro);if(managed.length)heading.append(control('Adicionar evento +','button primary',()=>addEvent()));root.append(heading);
    const toolbar=el('div','inic-calendar__toolbar');
    const navigation=el('div','inic-calendar__navigation');
    const previous=control('Anterior','button secondary compact',()=>changeMonth(year,month-1));previous.setAttribute('aria-label','Mês anterior');
    const next=control('Próximo','button secondary compact',()=>changeMonth(year,month+1));next.setAttribute('aria-label','Próximo mês');
    const monthTitle=el('h3','',new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(ui.date));monthTitle.setAttribute('aria-live','polite');navigation.append(previous,monthTitle,next);toolbar.append(navigation);
    const actions=el('div','inic-calendar__quick-actions');
    actions.append(control('Ir para 2027','button secondary compact',()=>changeMonth(2027,0)),control('Hoje','button secondary compact',()=>{const today=parseCalendarDate(brazilToday());changeMonth(today.getFullYear(),today.getMonth());}),control(`Exportar ${year}`,'button secondary compact',exportAgenda));toolbar.append(actions);root.append(toolbar);
    const filters=el('div','inic-calendar__filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar calendário');
    const monthLabel=el('label','field inic-calendar__month','Mês');const monthInput=el('input');monthInput.type='month';monthInput.setAttribute('data-filter-key','month');monthInput.value=`${year}-${String(month+1).padStart(2,'0')}`;monthInput.min='1900-01';monthInput.max='2100-12';monthInput.addEventListener('change',()=>{if(/^\d{4}-\d{2}$/.test(monthInput.value)){const [y,m]=monthInput.value.split('-').map(Number);if(m>=1&&m<=12){changeMonth(y,m-1);restoreFilterFocus('month');}}});monthLabel.append(monthInput);
    const groupLabel=el('label','field inic-calendar__group','Grupo');const select=el('select');select.setAttribute('data-filter-key','group');
    for(const group of [{id:'all',name:'Todos os meus grupos'},...groups.filter(group=>group.status!=='deleting')]){const option=el('option','',group.name);option.value=group.id;select.append(option);}select.value=ui.groupId;select.className=ui.groupId==='all'?'':'is-filtered';select.addEventListener('change',()=>{ui.groupId=select.value;ui.selectedDay='';draw();restoreFilterFocus('group');});groupLabel.append(select);
    const holidaysLabel=el('label','inic-calendar__holiday-toggle');const checkbox=el('input');checkbox.type='checkbox';checkbox.setAttribute('data-filter-key','holidays');checkbox.checked=ui.showHolidays;checkbox.addEventListener('change',()=>{ui.showHolidays=checkbox.checked;draw();restoreFilterFocus('holidays');});holidaysLabel.append(checkbox,document.createTextNode('Feriados nacionais'));filters.append(monthLabel,groupLabel,holidaysLabel);root.append(filters);

    const entries=calendarEntries({groups,tasks,events,year,groupId:ui.groupId,includeHolidays:ui.showHolidays});
    const gridEntries=ui.showHolidays?[...entries,...nationalHolidays(year-1),...nationalHolidays(year+1)]:entries;
    const byDate=new Map();for(const entry of gridEntries){if(!byDate.has(entry.date))byDate.set(entry.date,[]);byDate.get(entry.date).push(entry);}
    const first=new Date(year,month,1,12),start=new Date(first);start.setDate(first.getDate()-first.getDay());
    const grid=el('div','inic-calendar__grid');grid.setAttribute('aria-label',`Calendário de ${monthTitle.textContent}`);
    for(const name of ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'])grid.append(el('div','inic-calendar__weekday',name));
    for(let i=0;i<42;i++){
      const date=new Date(start);date.setDate(start.getDate()+i);const value=calendarCivilDate(date),items=byDate.get(value)||[],isHoliday=items.some(item=>item.type==='holiday');
      const day=el('div',`inic-calendar__day${date.getMonth()!==month?' is-outside':''}${value===brazilToday()?' is-today':''}${isHoliday?' is-holiday':''}${value===ui.selectedDay?' is-selected':''}`);
      const number=control(date.getDate(),'inic-calendar__day-number',()=>{ui.selectedDay=value;draw();root.querySelector('.inic-calendar__selection')?.scrollIntoView({block:'nearest',behavior:'auto'});});number.setAttribute('aria-label',`${longDate(value)}${isHoliday?', feriado nacional':''}${items.length?`, ${items.length} registro(s)`:''}`);number.setAttribute('aria-pressed',String(value===ui.selectedDay));if(value===brazilToday())number.setAttribute('aria-current','date');day.append(number);
      for(const item of items.slice(0,3)){
        const chip=control(item.title,`inic-calendar__chip inic-calendar__chip--${item.type}${item.type==='task'&&item.completed?' is-done':''}`,()=>{if(item.type==='task')onTask(item.record);else if(item.type==='event'&&managed.some(group=>group.id===item.groupId))onEditEvent(item.record);else{ui.selectedDay=value;draw();root.querySelector('.inic-calendar__selection')?.scrollIntoView({block:'nearest',behavior:'auto'});}});
        chip.title=`${item.title}${item.groupName?' · '+item.groupName:''}`;chip.setAttribute('aria-label',`${item.type==='holiday'?'Feriado nacional':item.type==='task'?'Entrega':'Evento'}: ${item.title}, ${longDate(value)}${item.groupName?', grupo '+item.groupName:''}`);day.append(chip);
      }
      if(items.length>3)day.append(control(`+${items.length-3} registro(s)`,'inic-calendar__more',()=>{ui.selectedDay=value;draw();root.querySelector('.inic-calendar__selection')?.scrollIntoView({block:'nearest',behavior:'auto'});}));
      grid.append(day);
    }
    root.append(grid);
    const legend=el('div','inic-calendar__legend');for(const [kind,label] of [['holiday','Feriado nacional'],['task','Entrega'],['event','Evento']]){const item=el('span');item.append(el('i',`inic-calendar__dot inic-calendar__dot--${kind}`),document.createTextNode(label));legend.append(item);}root.append(legend);
    if(ui.selectedDay){
      const section=el('section','inic-calendar__selection');const header=el('div','inic-calendar__list-heading');header.append(el('h3','',longDate(ui.selectedDay)),control('Ver mês inteiro','text-button',()=>{ui.selectedDay='';draw();}));section.append(header);const selected=byDate.get(ui.selectedDay)||[];if(selected.length)section.append(...selected.map(entryCard));else section.append(el('p','empty-small','Nenhum registro neste dia.'));if(managed.length)section.append(control('Adicionar evento neste dia +','button secondary compact',()=>addEvent(ui.selectedDay)));root.append(section);
    }
    const list=el('section','inic-calendar__list');list.append(el('h3','',`Agenda de ${monthTitle.textContent}`));const prefix=`${year}-${String(month+1).padStart(2,'0')}`;const records=entries.filter(entry=>entry.date.startsWith(prefix));
    if(records.length)list.append(...records.map(entryCard));else list.append(el('p','empty-small','Sem entregas, eventos ou feriados neste mês.'));root.append(list);
    const note=el('p','schedule-note','As entregas entram no calendário ao salvar o cronograma. Feriados nacionais seguem as leis federais; feriados locais e recessos da escola podem ser cadastrados como eventos.');root.append(note);
    return root;
  }
  return draw();
}
