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
export function calendarIcs({groups = [],tasks = [],events = [],year = 2027,groupId = 'all',includeHolidays = true,entryType = 'all',now = new Date()} = {}) {
  const kind = ['task','event','holiday'].includes(entryType) ? entryType : 'all';
  const records = calendarEntries({groups,tasks,events,year,groupId,includeHolidays}).filter(entry => entry.date.startsWith(`${year}-`) && (kind === 'all' || entry.type === kind));
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

// Only presentation choices survive a portal redraw; records always come from
// the current authorized groups. Tests and embedded previews can supply a state.
const sharedCalendarState = {date:null,groupId:'all',selectedDay:'',showHolidays:true,view:'month',type:'all'};
const el = (tag,className,text) => {const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;};
const control = (label,className,handler) => {const button=el('button',className,label);button.type='button';button.addEventListener('click',handler);return button;};
const longDate = value => new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'long',year:'numeric'}).format(parseCalendarDate(value));
const dateStatus = (entry,today) => entry.completed?'Concluída':entry.date<today?'Em atraso':entry.date===today?'Hoje':'Pendente';
const categoryLabel = type => ({task:'Entrega',event:'Evento',holiday:'Feriado nacional'}[type]||'Registro');
const validMonthDate = value => value&&typeof value.getTime==='function'&&Number.isFinite(value.getTime())&&value.getFullYear()>=1900&&value.getFullYear()<=2100;

function calendarIcon(name) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  const paths={calendar:'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM7 3v4m10-4v4M3 10h18M7 14h2m6 0h2M7 17h2',task:'M9 5h10v16H5V5h2M9 3h6v4H9ZM8 12h8m-8 4h5',done:'m7 12 3 3 7-7M21 12a9 9 0 1 1-5-8',event:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a6 6 0 0 1 12 0v3m2-12a3 3 0 0 1 2 5m-1 3a4 4 0 0 1 2 4',holiday:'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',left:'m15 5-7 7 7 7',right:'m9 5 7 7-7 7',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',plus:'M12 5v14M5 12h14',month:'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',agenda:'M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1',empty:'M6 5h12a2 2 0 0 1 2 2v13H4V7a2 2 0 0 1 2-2ZM8 3v4m8-4v4M4 11h16m-11 4h6'};
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]||paths.calendar);svg.append(path);return svg;
}

export function createCalendarView({groups=[],tasks=[],events=[],canManageGroup=()=>false,onAddEvent=()=>{},onEditEvent=()=>{},onTask=()=>{},onNotice=()=>{},initialDate=new Date(2027,0,1,12),viewState=sharedCalendarState}={}) {
  const ui=viewState&&typeof viewState==='object'?viewState:{};
  if(!validMonthDate(ui.date)){const initial=validMonthDate(initialDate)?initialDate:new Date(2027,0,1,12);ui.date=new Date(initial.getFullYear(),initial.getMonth(),1,12);}
  if(!groups.some(group=>group?.id===ui.groupId&&group.status!=='deleting'))ui.groupId='all';
  if(!['month','agenda'].includes(ui.view))ui.view='month';
  if(!['all','task','event','holiday'].includes(ui.type))ui.type='all';
  if(typeof ui.showHolidays!=='boolean')ui.showHolidays=true;
  if(!parseCalendarDate(ui.selectedDay))ui.selectedDay='';
  if(ui.type==='holiday'&&!ui.showHolidays)ui.type='all';
  const root=el('section','inic-calendar');root.setAttribute('aria-label','Calendário do INIC');
  const managed=groups.filter(group=>group?.id&&group.status!=='deleting'&&canManageGroup(group));

  function focusControl(key) {root.querySelector(`[data-filter-key="${key}"]`)?.focus({preventScroll:true});}
  function focusDay(value) {root.querySelector(`[data-date="${value}"]`)?.focus({preventScroll:true});}
  function changeMonth(year,month,focusKey) {
    const target=new Date(year,month,1,12);if(!validMonthDate(target))return;
    ui.date=target;ui.selectedDay='';draw();if(focusKey)focusControl(focusKey);
  }
  function selectDay(value,{reveal=false}={}) {
    if(!parseCalendarDate(value))return;ui.selectedDay=value;draw();focusDay(value);
    if(reveal&&typeof window!=='undefined'&&window.matchMedia?.('(max-width: 760px)').matches)root.querySelector('.inic-calendar__selection')?.scrollIntoView?.({block:'nearest',behavior:'auto'});
  }
  function dayKeyboard(event,value) {
    const date=parseCalendarDate(value);if(!date)return;
    const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-date.getDay(),End:6-date.getDay()};
    if(event.key in offsets)date.setDate(date.getDate()+offsets[event.key]);
    else if(['PageUp','PageDown'].includes(event.key)){
      const delta=event.key==='PageUp'?-1:1,day=date.getDate();date.setDate(1);date.setMonth(date.getMonth()+delta);date.setDate(Math.min(day,new Date(date.getFullYear(),date.getMonth()+1,0,12).getDate()));
    }else return;
    event.preventDefault();if(!validMonthDate(date))return;
    ui.date=new Date(date.getFullYear(),date.getMonth(),1,12);selectDay(calendarCivilDate(date));
  }
  function selectedGroup() {return ui.groupId!=='all'&&managed.some(group=>group.id===ui.groupId)?ui.groupId:managed.length===1?managed[0].id:'';}
  function addEvent(date) {onAddEvent(selectedGroup(),date||ui.selectedDay||`${ui.date.getFullYear()}-${String(ui.date.getMonth()+1).padStart(2,'0')}-01`);}
  function changeView(name) {ui.view=name;draw();root.querySelector(`[data-view="${name}"]`)?.focus({preventScroll:true});}
  function exportAgenda() {
    const year=ui.date.getFullYear(),contents=calendarIcs({groups,tasks,events,year,groupId:ui.groupId,includeHolidays:ui.showHolidays,entryType:ui.type});
    const blob=new Blob([contents],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=el('a');
    anchor.href=url;anchor.download=`Meu-INIC-${year}.ics`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
    onNotice(`Agenda de ${year} exportada com os filtros escolhidos. Importe o arquivo no seu aplicativo de calendário.`,'success');
  }
  function actionWithIcon(label,iconName,className,handler) {const button=control('',className,handler);button.append(calendarIcon(iconName),el('span','',label));return button;}
  function emptyMessage(title,description) {const area=el('div','inic-calendar__empty');const icon=el('span','inic-calendar__empty-icon');icon.append(calendarIcon('empty'));area.append(icon,el('h4','',title),el('p','',description));return area;}
  function entryCard(entry,today) {
    const card=el('article',`inic-calendar__item inic-calendar__item--${entry.type}${entry.type==='task'&&entry.completed?' is-done':''}${entry.type==='task'&&!entry.completed&&entry.date<today?' is-overdue':''}`);card.dataset.entryKey=entry.key;
    const meta=el('div','inic-calendar__item-meta'),time=el('time','',new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(parseCalendarDate(entry.date)));time.dateTime=entry.date;
    meta.append(time,el('span','inic-calendar__type',entry.type==='task'?`Entrega · ${dateStatus(entry,today)}`:categoryLabel(entry.type)));
    const copy=el('div','inic-calendar__item-copy');copy.append(el('h4','',entry.title));
    if(entry.groupName)copy.append(el('p','inic-calendar__item-group',entry.groupName));
    if(entry.description&&entry.type!=='holiday')copy.append(el('p','inic-calendar__description',entry.description));card.append(meta,copy);
    if(entry.type==='task')card.append(control('Ver entrega','button secondary compact',()=>onTask(entry.record)));
    if(entry.type==='event'&&managed.some(group=>group.id===entry.groupId))card.append(control('Editar evento','button secondary compact',()=>onEditEvent(entry.record)));
    if(entry.type==='holiday'){const source=el('a','inic-calendar__source','Fonte oficial');source.href=entry.source;source.target='_blank';source.rel='noopener noreferrer';source.setAttribute('aria-label',`Fonte oficial: ${entry.title}`);card.append(source);}
    return card;
  }
  function draw() {
    const year=ui.date.getFullYear(),month=ui.date.getMonth(),prefix=`${year}-${String(month+1).padStart(2,'0')}`,today=brazilToday();
    const monthText=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(ui.date);
    const base=calendarEntries({groups,tasks,events,year,groupId:ui.groupId,includeHolidays:ui.showHolidays});
    const entries=base.filter(entry=>ui.type==='all'||entry.type===ui.type),records=entries.filter(entry=>entry.date.startsWith(prefix));
    const gridEntries=ui.showHolidays&&(ui.type==='all'||ui.type==='holiday')?[...entries,...nationalHolidays(year-1),...nationalHolidays(year+1)]:entries;
    const byDate=new Map();for(const entry of gridEntries){if(!byDate.has(entry.date))byDate.set(entry.date,[]);byDate.get(entry.date).push(entry);}
    root.replaceChildren();root.dataset.view=ui.view;

    const heading=el('div','section-title inic-calendar__heading'),intro=el('div');
    intro.append(el('p','inic-calendar__eyebrow','CADA ETAPA, UMA DESCOBERTA'),el('h2','',`Calendário INIC ${year}`),el('p','','Organize suas entregas, encontros e próximos passos.'));
    const headerActions=el('div','inic-calendar__header-actions');
    const exportButton=actionWithIcon(`Exportar ${year}`,'download','button secondary compact',exportAgenda);exportButton.title='Exporta o ano com os filtros de grupo, tipo e feriados selecionados.';headerActions.append(exportButton);
    if(managed.length)headerActions.append(actionWithIcon('Adicionar evento','plus','button primary',()=>addEvent()));heading.append(intro,headerActions);root.append(heading);

    const summary=el('div','inic-calendar__summary');summary.setAttribute('aria-label',`Resumo de ${monthText}, conforme os filtros`);
    for(const [kind,label,value]of [['task','Entregas pendentes',records.filter(item=>item.type==='task'&&!item.completed).length],['done','Entregas concluídas',records.filter(item=>item.type==='task'&&item.completed).length],['event','Eventos',records.filter(item=>item.type==='event').length],['holiday','Feriados',records.filter(item=>item.type==='holiday').length]]){
      const card=el('div','inic-calendar__stat');card.dataset.kind=kind;const icon=el('span','inic-calendar__stat-icon');icon.append(calendarIcon(kind));const copy=el('div');copy.append(el('strong','',value),el('span','',label));card.append(icon,copy);summary.append(card);
    }root.append(summary);

    const toolbar=el('div','inic-calendar__toolbar'),navigation=el('div','inic-calendar__navigation');
    const previous=actionWithIcon('','left','button secondary compact',()=>changeMonth(year,month-1,'previous'));previous.setAttribute('aria-label','Mês anterior');previous.dataset.filterKey='previous';previous.disabled=year===1900&&month===0;
    const next=actionWithIcon('','right','button secondary compact',()=>changeMonth(year,month+1,'next'));next.setAttribute('aria-label','Próximo mês');next.dataset.filterKey='next';next.disabled=year===2100&&month===11;
    const monthTitle=el('h3','',monthText);monthTitle.setAttribute('aria-live','polite');navigation.append(previous,monthTitle,next);
    const quick=el('div','inic-calendar__quick-actions'),todayButton=control('Hoje','button secondary compact',()=>{const date=parseCalendarDate(brazilToday());ui.date=new Date(date.getFullYear(),date.getMonth(),1,12);ui.selectedDay=calendarCivilDate(date);draw();focusControl('today');});todayButton.dataset.filterKey='today';
    const editionButton=control('INIC 2027','button secondary compact',()=>changeMonth(2027,0,'edition'));editionButton.dataset.filterKey='edition';quick.append(todayButton,editionButton);
    const viewSwitch=el('div','inic-calendar__view-switch');viewSwitch.setAttribute('role','group');viewSwitch.setAttribute('aria-label','Visualização do calendário');
    for(const [name,label]of [['month','Mês'],['agenda','Agenda']]){const button=actionWithIcon(label,name,'',()=>changeView(name));button.dataset.view=name;button.setAttribute('aria-pressed',String(ui.view===name));viewSwitch.append(button);}toolbar.append(navigation,quick,viewSwitch);root.append(toolbar);

    const filters=el('div','inic-calendar__filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar calendário');
    const monthLabel=el('label','field inic-calendar__month','Ir para o mês'),monthInput=el('input');monthInput.type='month';monthInput.dataset.filterKey='month';monthInput.value=prefix;monthInput.min='1900-01';monthInput.max='2100-12';monthInput.setAttribute('aria-label','Mês');
    monthInput.addEventListener('change',()=>{if(/^\d{4}-\d{2}$/.test(monthInput.value)){const[y,m]=monthInput.value.split('-').map(Number);if(m>=1&&m<=12)changeMonth(y,m-1,'month');}});monthLabel.append(monthInput);
    const groupLabel=el('label','field inic-calendar__group','Grupo'),select=el('select');select.dataset.filterKey='group';select.setAttribute('aria-label','Grupo');
    for(const group of [{id:'all',name:'Todos os meus grupos'},...groups.filter(group=>group?.id&&group.status!=='deleting')]){const option=el('option','',group.name||'Grupo');option.value=group.id;select.append(option);}select.value=ui.groupId;if(ui.groupId!=='all')select.className='is-filtered';
    select.addEventListener('change',()=>{ui.groupId=select.value;draw();focusControl('group');});groupLabel.append(select);
    const holidayLabel=el('label','inic-calendar__holiday-toggle'),checkbox=el('input');checkbox.type='checkbox';checkbox.dataset.filterKey='holidays';checkbox.checked=ui.showHolidays;checkbox.addEventListener('change',()=>{ui.showHolidays=checkbox.checked;if(!ui.showHolidays&&ui.type==='holiday')ui.type='all';draw();focusControl('holidays');});holidayLabel.append(checkbox,el('span','','Mostrar feriados'));filters.append(monthLabel,groupLabel,holidayLabel);root.append(filters);

    const typeFilters=el('div','inic-calendar__type-filters');typeFilters.setAttribute('role','group');typeFilters.setAttribute('aria-label','Filtrar por tipo de compromisso');
    const monthBase=base.filter(item=>item.date.startsWith(prefix));
    for(const [type,label]of [['all','Todos'],['task','Entregas'],['event','Eventos'],['holiday','Feriados']]){
      const count=type==='holiday'&&!ui.showHolidays?nationalHolidays(year).filter(item=>item.date.startsWith(prefix)).length:monthBase.filter(item=>type==='all'||item.type===type).length,button=control('','',()=>{ui.type=type;if(type==='holiday')ui.showHolidays=true;draw();root.querySelector(`[data-type="${type}"]`)?.focus({preventScroll:true});});button.dataset.type=type;button.setAttribute('aria-pressed',String(ui.type===type));button.append(el('span','',label),el('b','',count));typeFilters.append(button);
    }root.append(typeFilters);

    if(ui.view==='month'){
      const workspace=el('div','inic-calendar__workspace'),pane=el('section','inic-calendar__month-pane'),grid=el('div','inic-calendar__grid');grid.setAttribute('role','group');grid.setAttribute('aria-label',`Dias de ${monthText}. Use as setas para navegar.`);
      for(const name of ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'])grid.append(el('div','inic-calendar__weekday',name));
      const first=new Date(year,month,1,12),start=new Date(first);start.setDate(first.getDate()-first.getDay());
      const selectedVisible=ui.selectedDay&&ui.selectedDay>=calendarCivilDate(start)&&ui.selectedDay<=calendarCivilDate(new Date(start.getFullYear(),start.getMonth(),start.getDate()+41,12));
      const tabDate=selectedVisible?ui.selectedDay:today.startsWith(prefix)?today:`${prefix}-01`;
      for(let i=0;i<42;i++){
        const date=new Date(start);date.setDate(start.getDate()+i);const value=calendarCivilDate(date),items=byDate.get(value)||[],isHoliday=items.some(item=>item.type==='holiday'),outside=date.getMonth()!==month;
        const kind=isHoliday?'holiday':items.some(item=>item.type==='task')?'task':items.some(item=>item.type==='event')?'event':'empty';
        const day=control('',`inic-calendar__day${outside?' is-outside':''}${value===today?' is-today':''}${isHoliday?' is-holiday':''}${value===ui.selectedDay?' is-selected':''}${items.length?' has-entries':''}`,()=>selectDay(value,{reveal:true}));day.dataset.date=value;day.dataset.kind=kind;day.tabIndex=value===tabDate?0:-1;day.disabled=!parseCalendarDate(value);
        day.setAttribute('aria-label',`${validMonthDate(date)?longDate(value):date.getDate()}${value===today?', hoje':''}${isHoliday?', feriado nacional':''}, ${items.length?`${items.length} compromisso(s)`:'sem compromissos'}`);day.setAttribute('aria-pressed',String(value===ui.selectedDay));if(value===today)day.setAttribute('aria-current','date');day.addEventListener('keydown',event=>dayKeyboard(event,value));
        const shadow=el('span','inic-calendar__day-shadow'),door=el('span','inic-calendar__day-door'),top=el('span','inic-calendar__day-top');shadow.setAttribute('aria-hidden','true');door.setAttribute('aria-hidden','true');
        if(value===today)top.append(el('small','inic-calendar__day-today','Hoje'));else top.append(el('span',''));
        if(items.length)top.append(el('span','inic-calendar__day-count',items.length));door.append(top,el('span','inic-calendar__day-number',date.getDate()));
        if(items.length){door.append(el('span','inic-calendar__day-preview',items[0].title));const markers=el('span','inic-calendar__day-markers');for(const type of ['task','event','holiday'])if(items.some(item=>item.type===type))markers.append(el('i',`inic-calendar__dot inic-calendar__dot--${type}`));door.append(markers);day.title=items.map(item=>`${categoryLabel(item.type)}: ${item.title}`).join('\n');}
        day.append(shadow,door);grid.append(day);
      }pane.append(grid);
      const legend=el('div','inic-calendar__legend');for(const [type,label]of [['task','Entregas'],['event','Eventos'],['holiday','Feriados']]){const item=el('span');item.append(el('i',`inic-calendar__dot inic-calendar__dot--${type}`),document.createTextNode(label));legend.append(item);}pane.append(legend,el('p','inic-calendar__grid-help','Toque em um dia para abrir os compromissos.'));
      const selection=el('section','inic-calendar__selection'),listHeading=el('div','inic-calendar__list-heading'),selected=ui.selectedDay?(byDate.get(ui.selectedDay)||[]):records;
      selection.setAttribute('aria-label',ui.selectedDay?`Compromissos de ${longDate(ui.selectedDay)}`:`Compromissos de ${monthText}`);
      if(ui.selectedDay){listHeading.append(el('h3','',longDate(ui.selectedDay)),control('Ver mês inteiro','text-button',()=>{ui.selectedDay='';draw();}));selection.append(el('p','inic-calendar__day-caption',new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(parseCalendarDate(ui.selectedDay))));}
      else{listHeading.append(el('h3','','Neste mês'),el('span','inic-calendar__day-caption',`${records.length} compromisso(s)`));}
      selection.append(listHeading);
      if(selected.length){const items=el('div','inic-calendar__items');items.append(...(ui.selectedDay?selected:selected.slice(0,6)).map(item=>entryCard(item,today)));selection.append(items);if(!ui.selectedDay&&selected.length>6)selection.append(control(`Ver agenda completa (${selected.length})`,'button secondary compact',()=>changeView('agenda')));}
      else selection.append(emptyMessage(ui.selectedDay?'Um dia livre por aqui':'Nenhum compromisso neste mês',ui.type==='all'?'As entregas e os eventos cadastrados aparecerão aqui.':'Experimente outro tipo ou grupo para ver mais compromissos.'));
      if(managed.length)selection.append(actionWithIcon(ui.selectedDay?'Adicionar neste dia':'Adicionar evento','plus','button secondary compact',()=>addEvent()));workspace.append(pane,selection);root.append(workspace);
    }else{
      const list=el('section','inic-calendar__list'),heading=el('div','inic-calendar__list-heading');heading.append(el('h3','',`Agenda de ${monthText}`),el('span','inic-calendar__day-caption',`${records.length} compromisso(s)`));list.append(heading);
      if(records.length){let previousDate='';for(const entry of records){if(entry.date!==previousDate){const date=el('h4','inic-calendar__agenda-date',new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'numeric',month:'long'}).format(parseCalendarDate(entry.date)));list.append(date);previousDate=entry.date;}list.append(entryCard(entry,today));}}
      else list.append(emptyMessage('Sua agenda está livre neste mês','Mude o mês ou os filtros para consultar outros compromissos.'));root.append(list);
    }
    root.append(el('p','inic-calendar__sync-note','As entregas acompanham o cronograma dos seus grupos. Eventos e alterações são sincronizados com os participantes e orientadores. Feriados locais e recessos podem ser cadastrados como eventos.'));
    const live=el('p','inic-calendar__live-region');live.setAttribute('role','status');live.setAttribute('aria-live','polite');live.textContent=ui.selectedDay?`${longDate(ui.selectedDay)}: ${(byDate.get(ui.selectedDay)||[]).length} compromisso(s).`:`${monthText}: ${records.length} compromisso(s) nos filtros escolhidos.`;root.append(live);
    return root;
  }
  return draw();
}
