// Private coordination view. Data is read through authenticated service methods.
const STATUS = Object.freeze({pending:'Aguardando',approved:'Aprovado',rejected:'Reprovado',correction:'Correção pendente'});
const STATUS_ORDER = Object.keys(STATUS);
const COLORS = {pending:'var(--cd-pending)',approved:'var(--cd-approved)',rejected:'var(--cd-rejected)',correction:'var(--cd-correction)'};
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
let chartSequence=0;
const normalize = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const list = value => Array.isArray(value)?value:Object.entries(value||{}).map(([id,item])=>({...item,id}));
const number = value => Number.isFinite(Number(value))?Number(value):0;
const personId = person => person.id||person.uid;
const effectiveAdvisor = (group,users,advisors) => group.advisorId&&!users.get(group.advisorId)?.archived&&!advisors.get(group.advisorId)?.archived?group.advisorId:'none';
const activeGroup = group => group&&group.status!=='deleting'&&group.status!=='archived'&&group.archived!==true;
const statusOf = item => STATUS_ORDER.includes(item?.status)?item.status:'pending';
const counts = () => Object.fromEntries(STATUS_ORDER.map(status=>[status,0]));
const dateValid = value => {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
};
function todayBrazil(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function flattenRecords(raw,kind){
  if(Array.isArray(raw))return raw;
  const output=[];
  for(const [groupId,items] of Object.entries(raw||{}))for(const [id,item] of Object.entries(items||{})){
    if(item&&typeof item==='object')output.push({...item,id,groupId,...(kind==='results'?{studentUid:item.studentUid||item.uid||id}:{})});
  }
  return output;
}

export function aggregateCoordinationMetrics({state={},year=2027,boards=[],results=[],tasks=[],filters={},today=todayBrazil()}={}){
  const users=new Map(list(state.users).map(person=>[personId(person),person]));
  const advisors=new Map(list(state.advisors).map(person=>[personId(person),person]));
  const advisorFor=group=>effectiveAdvisor(group,users,advisors);
  const groupMap=new Map();
  for(const group of list(state.groups))if(group.id&&activeGroup(group)&&number(group.year||2027)===number(year))groupMap.set(group.id,group);
  let groups=[...groupMap.values()];
  if(filters.advisorId&&filters.advisorId!=='all')groups=groups.filter(group=>advisorFor(group)===filters.advisorId);
  if(filters.groupId&&filters.groupId!=='all')groups=groups.filter(group=>group.id===filters.groupId);
  groups.sort((a,b)=>(a.name||'').localeCompare(b.name||'','pt-BR'));
  const selected=new Map(groups.map(group=>[group.id,group]));
  const advisorName=id=>id==='none'?'Sem orientador':advisors.get(id)?.name||users.get(id)?.name||'Orientador(a)';
  const latest=new Map();
  for(const item of flattenRecords(results,'results')){
    const uid=item.studentUid||item.uid||item.id,key=`${item.groupId}/${uid}`;
    if(!item.groupId||!uid)continue;
    if(!latest.has(key)||number(item.updatedAt)>=number(latest.get(key).updatedAt))latest.set(key,item);
  }
  const participants=[];
  for(const group of groups)for(const [uid,member] of Object.entries(group.members||{})){
    const person=users.get(uid);
    if(member!==true||person?.archived||['advisor','coordinator'].includes(person?.role)||person?.requestedRole==='advisor')continue;
    const record=latest.get(`${group.id}/${uid}`)||null;
    participants.push({key:`${group.id}/${uid}`,uid,groupId:group.id,groupName:group.name||'Grupo',name:person?.name||group.memberNames?.[uid]||'Estudante',advisorId:advisorFor(group),advisorName:advisorName(advisorFor(group)),status:statusOf(record),correction:record?.correction||'',record});
  }
  const statusFilter=STATUS_ORDER.includes(filters.status)?filters.status:'all';
  const resultRows=participants.filter(item=>statusFilter==='all'||item.status===statusFilter);
  const uniqueBoards=new Map();
  for(const item of flattenRecords(boards,'boards')){
    if(!selected.has(item.groupId)||number(item.year||year)!==number(year))continue;
    const key=`${item.groupId}/${item.id||item.title||''}`;
    if(!uniqueBoards.has(key)||number(item.updatedAt)>=number(uniqueBoards.get(key).updatedAt))uniqueBoards.set(key,{...item,status:statusOf(item),groupName:selected.get(item.groupId).name||'Grupo'});
  }
  const boardRows=[...uniqueBoards.values()].filter(item=>statusFilter==='all'||item.status===statusFilter).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||(a.title||'').localeCompare(b.title||'','pt-BR'));
  const teacherMap=new Map();
  for(const group of groups){const id=advisorFor(group);if(!teacherMap.has(id))teacherMap.set(id,{id,name:advisorName(id),groupCount:0,results:counts()});teacherMap.get(id).groupCount++;}
  for(const item of resultRows)teacherMap.get(item.advisorId).results[item.status]++;
  const teacherRows=[...teacherMap.values()].sort((a,b)=>b.groupCount-a.groupCount||a.name.localeCompare(b.name,'pt-BR'));
  const resultCounts=counts(),boardCounts=counts();for(const item of resultRows)resultCounts[item.status]++;for(const item of boardRows)boardCounts[item.status]++;
  const months=MONTHS.map((name,index)=>({month:index+1,name,count:0}));
  for(const item of boardRows)if(dateValid(item.date)&&Number(item.date.slice(0,4))===Number(year))months[Number(item.date.slice(5,7))-1].count++;
  const uniqueTasks=new Map();
  for(const item of flattenRecords(tasks,'tasks')){
    if(!selected.has(item.groupId)||!item.id)continue;
    const key=`${item.groupId}/${item.id}`;
    if(!uniqueTasks.has(key)||number(item.updatedAt)>=number(uniqueTasks.get(key).updatedAt))uniqueTasks.set(key,item);
  }
  const taskRows=[...uniqueTasks.values()];
  const progress=groups.map(group=>{
    const rows=taskRows.filter(item=>item.groupId===group.id),total=rows.reduce((sum,item)=>sum+(number(item.weight)>0?number(item.weight):1),0),done=rows.filter(item=>item.completed===true).reduce((sum,item)=>sum+(number(item.weight)>0?number(item.weight):1),0);
    return {id:group.id,name:group.name||'Grupo',tasks:rows.length,completed:rows.filter(item=>item.completed===true).length,percent:total?Math.round(done/total*100):null};
  });
  const matrix=groups.map(group=>({id:group.id,name:group.name||'Grupo',boards:boardRows.filter(item=>item.groupId===group.id&&item.status==='correction').length,students:resultRows.filter(item=>item.groupId===group.id&&item.status==='correction').length,overdue:taskRows.filter(item=>item.groupId===group.id&&!item.completed&&dateValid(item.dueDate)&&item.dueDate<today).length}));
  const corrections=[...boardRows.filter(item=>item.status==='correction').map(item=>({kind:'Banca',groupId:item.groupId,groupName:item.groupName,title:item.title||'Banca',text:item.correction||'Pendência sem descrição.'})),...resultRows.filter(item=>item.status==='correction').map(item=>({kind:'Resultado do aluno',groupId:item.groupId,groupName:item.groupName,title:item.name,text:item.correction||'Pendência sem descrição.'}))];
  return {year:Number(year),groups,participants,resultRows,boardRows,teacherRows,resultCounts,boardCounts,months,progress,matrix,corrections,summary:{groups:groups.length,advisors:teacherRows.filter(item=>item.id!=='none').length,students:new Set(resultRows.map(item=>item.uid)).size,participations:resultRows.length,boards:boardRows.length,approved:boardCounts.approved,rejected:boardCounts.rejected,corrections:corrections.length,tasks:taskRows.length,completedTasks:taskRows.filter(item=>item.completed===true).length}};
}

function el(tag,className='',text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;}
function control(label,className,handler){const button=el('button',className,label);button.type='button';button.addEventListener('click',handler);return button;}
function svgNode(tag,attributes={},text){const element=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [name,value]of Object.entries(attributes))element.setAttribute(name,String(value));if(text!==undefined)element.textContent=String(text);return element;}
function chartAction(node,label,handler){node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',label);node.addEventListener('click',handler);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();handler();}});return node;}
function section(title,subtitle){const box=el('section','cd-chart-card'),header=el('div','cd-chart-header'),copy=el('div');copy.append(el('h3','',title));if(subtitle)copy.append(el('p','cd-chart-note',subtitle));header.append(copy);box.append(header);return box;}
function noData(text='Nenhum registro neste filtro.'){const box=el('div','cd-empty');box.append(metricIcon('chart','cd-empty-icon'),el('p','',text));return box;}
function metricIcon(kind,className=''){
  const svg=svgNode('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:className});
  const paths={groups:['M3 7h7l2 2h9v11H3z','M3 7V4h7l2 3'],people:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M17 4a4 4 0 0 1 0 8','M22 21v-2a4 4 0 0 0-3-3.87'],advisor:['m3 8 9-5 9 5-9 5z','M6 10v6c4 3 8 3 12 0v-6','M21 8v7'],participants:['M4 7h16','M4 12h10','M4 17h6','m15 16 2 2 4-5'],approved:['m8 12 3 3 5-6'],rejected:['m9 9 6 6','m15 9-6 6'],corrections:['M12 8v5','M12 17h.01','M10 3 1 20h22L14 3Z'],tasks:['M9 5h11v16H4V5h2','M9 3h6v4H9z','m8 13 2 2 5-5'],chart:['M4 3v18h17','M8 16v-4','M13 16V7','M18 16v-7']};
  for(const d of paths[kind]||paths.chart)svg.append(svgNode('path',{d}));
  if(['people','approved','rejected'].includes(kind))svg.append(svgNode('circle',kind==='people'?{cx:9,cy:7,r:4}:{cx:12,cy:12,r:9}));
  return svg;
}
function setText(node,text){const next=String(text);if(node.textContent!==next)node.textContent=next;}
function syncChildren(parent,nodes){
  const current=Array.from(parent.children||[]);if(current.length===nodes.length&&current.every((node,index)=>node===nodes[index]))return;
  if(typeof parent.insertBefore!=='function'){parent.replaceChildren(...nodes);return;}
  const focused=document.activeElement;
  for(const node of current)if(!nodes.includes(node))node.remove();
  nodes.forEach((node,index)=>{if(parent.children[index]!==node)parent.insertBefore(node,parent.children[index]||null);});
  if(focused&&document.activeElement!==focused&&focused.isConnected)focused.focus?.({preventScroll:true});
}
function reconcile(parent,cache,items,key,create,update){
  const used=new Set(),nodes=[];
  for(const item of items){const id=String(key(item));used.add(id);let row=cache.get(id);if(!row){row=create(item,id);cache.set(id,row);}update(row,item,id);nodes.push(row.element);}
  for(const id of cache.keys())if(!used.has(id))cache.delete(id);
  syncChildren(parent,nodes);
}
function field(label,name,{type='text',value='',required=false,maxLength=2000,options}={}){
  const wrapper=el('label','cd-field',label),input=el(options?'select':type==='textarea'?'textarea':'input');input.name=name;input.setAttribute('aria-label',label);
  if(options)for(const item of options){const option=el('option','',item.label);option.value=item.value;input.append(option);}else if(type!=='textarea')input.type=type;
  input.value=String(value??'');input.required=required;input.maxLength=maxLength;if(type==='textarea')input.rows=3;wrapper.append(input);return {wrapper,input};
}
function stamp(value){if(!Number.isFinite(Number(value))||Number(value)<=0)return 'Sem atualização';return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(Number(value)));}
function civilLabel(value){if(!dateValid(value))return 'Sem data';return `${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`;}

export function createCoordinationDashboard({service,state={},year=2027,onNotice=()=>{}}={}){
  const root=el('section','coordination-dashboard');root.setAttribute('aria-label','Indicadores privados da coordenação');
  const actor=state.user?.uid;
  let liveState=state,stopped=false,generation=0,unsubscribe=()=>{},payload={boards:[],results:[],tasks:[]},ready=false,error=null,busy=false,modalSession=0,connected=null;
  let screen='',dashboard=null,renderedKey='',receivedKey='',receivedAt=null,frame=null;
  const animations=new Map(),values=new Map();
  const motion=typeof globalThis.matchMedia==='function'?globalThis.matchMedia('(prefers-reduced-motion: reduce)'):null;
  state=null;
  const ui={year:Number(year)||2027,advisorId:'all',groupId:'all',status:'all',search:''};
  const allowed=()=>!stopped&&liveState?.role==='coordinator'&&liveState.user?.uid===actor&&!liveState.archived;
  const reduced=()=>motion?.matches===true||document.hidden===true||typeof globalThis.requestAnimationFrame!=='function';
  const header=el('div','cd-header'),heading=el('div');
  heading.append(el('p','eyebrow','COORDENAÇÃO · INIC'),el('h2','','Indicadores do INIC'),el('p','cd-intro','Grupos, entregas e resultados. Acompanhe cada avanço da pesquisa.'));
  const headerActions=el('div','cd-header-actions'),liveBadge=el('span','cd-live','Carregando dados'),newBoard=control('Cadastrar banca +','button primary',()=>openBoard());
  liveBadge.setAttribute('data-state','loading');headerActions.append(liveBadge,newBoard);header.append(heading,headerActions);
  const syncLine=el('div','cd-sync-line'),syncTime=el('span','cd-sync-time','Aguardando a primeira atualização.'),announcement=el('p','cd-sr-only');
  announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');announcement.setAttribute('aria-atomic','true');
  syncLine.append(syncTime,el('span','cd-sync-note','Atualização automática'));
  const filterPanel=el('section','cd-filter-panel'),filterHeading=el('div','cd-filter-heading'),reset=control('Limpar filtros','cd-reset',()=>resetFilters());
  filterHeading.append(el('h3','','Explore os indicadores'),reset);
  const filters=el('div','cd-filters'),yearField=field('Edição','year',{type:'number',value:ui.year}),advisorField=field('Orientador','advisor',{options:[]}),groupField=field('Grupo','group',{options:[]}),statusField=field('Resultado','status',{options:[{value:'all',label:'Todos os resultados'},...STATUS_ORDER.map(value=>({value,label:STATUS[value]}))]});
  filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar indicadores do INIC');
  yearField.input.min='2027';yearField.input.max='2100';
  for(const item of[yearField,advisorField,groupField,statusField]){item.input.setAttribute('data-filter-key',item.input.name);filters.append(item.wrapper);}
  const filterSummary=el('div','cd-filter-summary'),filterScope=el('p'),chips=el('div','cd-filter-chips');
  filterSummary.append(filterScope,chips);filterPanel.append(filterHeading,filters,filterSummary);
  const content=el('div','cd-content'),dialog=el('dialog','cd-dialog');dialog.setAttribute('aria-label','Cadastro de banca');
  root.append(header,syncLine,filterPanel,content,announcement,dialog);

  // One animation loop per dashboard. Targets are actual values from the current snapshot.
  function stopAnimations(clear=true){
    if(frame!==null&&typeof globalThis.cancelAnimationFrame==='function')globalThis.cancelAnimationFrame(frame);
    frame=null;animations.clear();if(clear)values.clear();
  }
  function finishAnimations(){
    if(!allowed()){stopAnimations();return;}
    for(const [key,animation]of animations){animation.write(animation.target);values.set(key,animation.target);}
    stopAnimations(false);
  }
  function tick(time){
    frame=null;if(!allowed()){stopAnimations();return;}
    if(reduced()){finishAnimations();return;}
    for(const [key,animation]of animations){
      if(animation.start===null)animation.start=time;
      const ratio=Math.min(1,Math.max(0,(time-animation.start)/600)),eased=1-(1-ratio)**3;
      const value=Array.isArray(animation.target)?animation.target.map((end,index)=>animation.from[index]+(end-animation.from[index])*eased):animation.from+(animation.target-animation.from)*eased;
      animation.write(value);values.set(key,value);if(ratio===1)animations.delete(key);
    }
    if(animations.size)frame=globalThis.requestAnimationFrame(tick);
  }
  function tween(key,target,write,initial=0){
    const previous=values.has(key)?values.get(key):initial;
    if(reduced()||JSON.stringify(previous)===JSON.stringify(target)){animations.delete(key);values.set(key,target);write(target);return;}
    write(previous);animations.set(key,{from:previous,target,write,start:null});
    if(frame===null)frame=globalThis.requestAnimationFrame(tick);
  }
  function forget(prefix){for(const key of values.keys())if(key.startsWith(prefix)){values.delete(key);animations.delete(key);}}
  function cancelDetachedRows(prefix,ids){for(const key of values.keys())if(key.startsWith(prefix)&&!ids.has(key.slice(prefix.length).split('/')[0])){values.delete(key);animations.delete(key);}}
  function onVisibility(){if(document.hidden)finishAnimations();else if(allowed()&&ready&&!error)draw();}
  function onMotion(){if(motion?.matches)finishAnimations();}
  document.addEventListener?.('visibilitychange',onVisibility);motion?.addEventListener?.('change',onMotion);
  function removeMotionListeners(){document.removeEventListener?.('visibilitychange',onVisibility);motion?.removeEventListener?.('change',onMotion);}
  function clearPrivate(){
    generation++;modalSession++;unsubscribe();unsubscribe=()=>{};stopAnimations();removeMotionListeners();
    payload={boards:[],results:[],tasks:[]};ready=false;error=null;busy=false;connected=null;receivedAt=null;receivedKey='';renderedKey='';dashboard=null;
    try{dialog.close?.();}catch{}dialog.replaceChildren();content.replaceChildren();announcement.textContent='';
    advisorField.input.replaceChildren();groupField.input.replaceChildren();liveState={};root.replaceChildren(noData('Acesso exclusivo da coordenação.'));
  }
  function notice(text,kind='success'){if(allowed())onNotice(text,kind);}
  function chooseGroup(id){if(!allowed())return;ui.groupId=id||'all';groupField.input.value=ui.groupId;draw();}
  function chooseAdvisor(id){if(!allowed())return;ui.advisorId=id||'all';ui.groupId='all';refreshFilters();draw();}
  function chooseStatus(status){if(!allowed())return;ui.status=STATUS_ORDER.includes(status)?status:'all';statusField.input.value=ui.status;draw();}
  function resetFilters(){if(!allowed())return;ui.advisorId='all';ui.groupId='all';ui.status='all';ui.search='';refreshFilters();draw();}
  function options(input,items,value){
    const signature=JSON.stringify(items);
    if(input.getAttribute('data-options')!==signature){input.replaceChildren(...items.map(item=>{const option=el('option','',item.label);option.value=item.value;return option;}));input.setAttribute('data-options',signature);}
    input.value=value;
  }
  function refreshFilters(){
    if(!allowed())return;
    const groups=list(liveState.groups).filter(item=>activeGroup(item)&&number(item.year||2027)===ui.year);
    const advisors=new Map(list(liveState.advisors).map(item=>[personId(item),item])),users=new Map(list(liveState.users).map(item=>[personId(item),item]));
    const names=new Map([...advisors,...users].map(([id,item])=>[id,item.name]));
    const choices=[{value:'all',label:'Todos os orientadores'},{value:'none',label:'Sem orientador'},...[...new Set(groups.map(item=>effectiveAdvisor(item,users,advisors)).filter(id=>id!=='none'))].map(id=>({value:id,label:names.get(id)||'Orientador(a)'})).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'))];
    if(!choices.some(item=>item.value===ui.advisorId))ui.advisorId='all';
    options(advisorField.input,choices,ui.advisorId);
    const selected=groups.filter(item=>ui.advisorId==='all'||effectiveAdvisor(item,users,advisors)===ui.advisorId);
    if(!selected.some(item=>item.id===ui.groupId))ui.groupId='all';
    options(groupField.input,[{value:'all',label:'Todos os grupos'},...selected.map(item=>({value:item.id,label:item.name||'Grupo'}))],ui.groupId);statusField.input.value=ui.status;
  }
  function paintStatus(){
    const mode=error?'error':connected===false?'offline':!ready?'loading':connected===true?'live':'automatic';
    const labels={error:'Atualização interrompida',offline:'Aguardando conexão',loading:'Carregando dados',live:'Ao vivo',automatic:'Atualização automática'};
    liveBadge.setAttribute('data-state',mode);setText(liveBadge,labels[mode]);
    const time=receivedAt?new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(receivedAt)):null;
    setText(syncTime,error?'Não foi possível atualizar os indicadores.':time?`${connected===false?'Últimos dados recebidos':'Dados atualizados'} às ${time}${connected===false?' · aguardando reconexão':''}.`:'Aguardando a primeira atualização.');
    syncTime.setAttribute('data-updated-at',receivedAt===null?'':String(receivedAt));
  }
  function paintFilters(model){
    for(const input of[advisorField.input,groupField.input,statusField.input])input.className=input.value&&input.value!=='all'?'is-filtered':'';
    reset.hidden=ui.advisorId==='all'&&ui.groupId==='all'&&ui.status==='all'&&!ui.search;
    setText(filterScope,model?`${model.summary.groups} grupo(s) · edição ${ui.year}${ui.status!=='all'?' · resultado filtra bancas e participantes':''}`:`Edição ${ui.year} · selecione os filtros para explorar`);
    const selections=[['advisorId',advisorField.input,()=>chooseAdvisor('all')],['groupId',groupField.input,()=>chooseGroup('all')],['status',statusField.input,()=>chooseStatus('all')]];
    const key=JSON.stringify(selections.map(([name])=>[name,ui[name]]));
    if(chips.getAttribute('data-selection')!==key){
      chips.replaceChildren();chips.setAttribute('data-selection',key);
      for(const [name,input,clear]of selections)if(ui[name]!=='all'){
        const label=Array.from(input.children).find(option=>option.value===ui[name])?.textContent||ui[name],chip=control('','cd-filter-chip',clear);
        chip.setAttribute('aria-label',`Remover filtro: ${label}`);chip.append(el('span','',label),el('span','','×'));chips.append(chip);
      }
    }
  }
  function listen(){
    unsubscribe();unsubscribe=()=>{};const version=++generation;stopAnimations();
    payload={boards:[],results:[],tasks:[]};ready=false;error=null;connected=null;receivedKey='';receivedAt=null;renderedKey='';draw();
    if(!allowed())return;
    if(typeof service?.subscribeCoordinationMetrics!=='function'){error=new Error('Atualize a página para consultar os indicadores.');draw();return;}
    try{unsubscribe=service.subscribeCoordinationMetrics(ui.year,data=>{
      if(!allowed()||version!==generation)return;
      error=data?.error||null;ready=data?.ready!==false;connected=typeof data?.connected==='boolean'?data.connected:null;
      payload=error?{boards:[],results:[],tasks:[]}:{boards:data?.boards||[],results:data?.results||[],tasks:data?.tasks||[]};draw(true);
    })||(()=>{});}catch(cause){if(allowed()&&version===generation){error=cause;draw();}}
  }
  yearField.input.addEventListener('change',()=>{
    if(!allowed())return;const next=Number(yearField.input.value);
    if(!Number.isInteger(next)||next<2027||next>2100){yearField.input.value=String(ui.year);notice('Escolha uma edição entre 2027 e 2100.','error');return;}
    if(next===ui.year)return;ui.year=next;ui.groupId='all';ui.advisorId='all';ui.search='';modalSession++;try{dialog.close?.();}catch{}refreshFilters();listen();
  });
  advisorField.input.addEventListener('change',()=>chooseAdvisor(advisorField.input.value));groupField.input.addEventListener('change',()=>chooseGroup(groupField.input.value));statusField.input.addEventListener('change',()=>chooseStatus(statusField.input.value));

  function loadingView(){
    const shell=el('div','cd-loading-shell');shell.setAttribute('role','status');shell.append(el('p','cd-loading-label','Carregando indicadores…'));
    const cards=el('div','cd-skeleton-grid'),charts=el('div','cd-skeleton-charts');cards.setAttribute('aria-hidden','true');charts.setAttribute('aria-hidden','true');
    for(let i=0;i<4;i++)cards.append(el('div','cd-skeleton-card'));for(let i=0;i<2;i++)charts.append(el('div','cd-skeleton-chart'));
    shell.append(cards,charts);return shell;
  }
  function metricCard(label,note,icon,tone,key){
    const element=el('article','cd-metric');element.setAttribute('data-tone',tone);element.setAttribute('data-metric',key);
    const top=el('div','cd-metric-top'),iconWrap=el('span','cd-metric-icon'),value=el('strong','cd-metric-value'),counter=el('span','cd-counter');
    iconWrap.append(metricIcon(icon));top.append(el('span','',label),iconWrap);counter.setAttribute('aria-hidden','true');value.append(counter);element.append(top,value,el('small','',note));
    return {element,value,counter,label,key};
  }
  function buildDashboard(){
    const overview=el('div','cd-overview-heading'),edition=el('span','cd-chart-tag'),metricGrid=el('div','cd-metrics'),charts=el('div','cd-charts'),empty=el('div');
    overview.append(el('h3','','Panorama da edição'),edition);
    const metrics=[
      metricCard('Grupos','Ativos nesta edição','groups','primary','groups'),
      metricCard('Alunos distintos','Cada estudante contado uma vez','people','teal','students'),
      metricCard('Orientadores','Com grupos neste filtro','advisor','primary','advisors'),
      metricCard('Entregas concluídas','Etapas concluídas / total','tasks','teal','completedTasks'),
      metricCard('Participações','Vínculos de alunos com grupos','participants','primary','participations'),
      metricCard('Bancas aprovadas','Registradas pela coordenação','approved','teal','approved'),
      metricCard('Bancas reprovadas','Registradas pela coordenação','rejected','rose','rejected'),
      metricCard('Correções pendentes','Bancas e resultados de alunos','corrections','orange','corrections')
    ];
    for(const metric of metrics)metricGrid.append(metric.element);
    const views=[timelineView(),barsView(),donutView(),stackedView(),progressView(),matrixView(),correctionsView(),boardsView(),resultsView()];
    for(const view of views)charts.append(view.element);
    content.replaceChildren(overview,empty,metricGrid,charts);return {edition,empty,metrics,views};
  }
  function draw(dataUpdate=false){
    if(!allowed())return;newBoard.disabled=busy;content.setAttribute('aria-busy',String(!ready&&!error));
    // Errors may arrive with ready:false after permission loss or a failed stream.
    if(error){
      stopAnimations();dashboard=null;renderedKey='';paintStatus();paintFilters();
      const key=`error:${error.message||''}`;if(screen!==key){const box=section('Não foi possível consultar os indicadores',error.message||'Confira a conexão e tente novamente.');box.append(control('Tentar novamente','button secondary',listen));content.replaceChildren(box);screen=key;setText(announcement,'Não foi possível atualizar os indicadores. Tente novamente.');}return;
    }
    if(!ready){stopAnimations();dashboard=null;renderedKey='';paintStatus();paintFilters();if(screen!=='loading'){content.replaceChildren(loadingView());screen='loading';setText(announcement,'Carregando indicadores.');}return;}
    const sourceKey=JSON.stringify([ui.year,liveState.groups,liveState.users,liveState.advisors,payload]);
    if(dataUpdate&&sourceKey!==receivedKey){receivedKey=sourceKey;receivedAt=Date.now();}
    const model=aggregateCoordinationMetrics({state:liveState,year:ui.year,...payload,filters:ui}),key=JSON.stringify(model);
    paintStatus();paintFilters(model);
    if(!dashboard){dashboard=buildDashboard();screen='ready';renderedKey='';}
    if(key===renderedKey){dashboard.views.find(view=>view.kind==='boards')?.update(model);return;}
    renderedKey=key;setText(dashboard.edition,`INIC ${ui.year}`);
    if(model.summary.groups)dashboard.empty.replaceChildren();else if(!dashboard.empty.children.length)dashboard.empty.append(noData('Nenhum grupo ativo para esta edição ou filtro.'));
    for(const metric of dashboard.metrics){
      const target=model.summary[metric.key],suffix=metric.key==='completedTasks'?`/${model.summary.tasks}`:'';
      const exact=`${target}${suffix}`;metric.value.setAttribute('aria-label',exact);metric.element.setAttribute('aria-label',`${metric.label}: ${exact}`);
      tween(`metric/${metric.key}`,target,value=>setText(metric.counter,`${Math.round(value).toLocaleString('pt-BR')}${suffix}`));
    }
    for(const view of dashboard.views)view.update(model);
    setText(announcement,`Indicadores atualizados: ${model.summary.groups} grupos, ${model.summary.students} alunos distintos, ${model.summary.completedTasks} de ${model.summary.tasks} entregas concluídas e ${model.summary.corrections} correções pendentes.`);
  }

  function listChart(title,note,emptyMessage){
    const element=section(title,note),body=el('div','cd-chart-viewport'),rows=el('div','cd-bar-list'),empty=noData(emptyMessage);element.append(body);
    return {element,body,rows,empty,cache:new Map(),show(hasRows){syncChildren(body,[hasRows?rows:empty]);}};
  }
  function barRow(action){
    const element=control('','cd-bar-row',()=>action(row.item)),heading=el('span','cd-bar-heading'),label=el('span','cd-bar-label'),value=el('strong','cd-bar-value'),track=el('span','cd-bar-track'),fill=el('span','cd-bar-fill');
    heading.append(label,value);track.append(fill);element.append(heading,track);track.setAttribute('aria-hidden','true');
    const row={element,label,value,fill};return row;
  }
  function barsView(){
    const view=listChart('Grupos por orientador','Toque em um orientador para explorar seus grupos.','Nenhum grupo cadastrado nesta edição.');
    return {...view,update(model){
      const items=model.teacherRows,max=Math.max(1,...items.map(item=>item.groupCount));view.show(items.length>0);
      cancelDetachedRows('advisor/',new Set(items.map(item=>String(item.id))));
      reconcile(view.rows,view.cache,items,item=>item.id,()=>barRow(item=>chooseAdvisor(item.id)),(row,item,id)=>{
        row.item=item;setText(row.label,item.name);setText(row.value,item.groupCount);row.element.setAttribute('aria-label',`${item.name}: ${item.groupCount} grupo(s). Filtrar por orientador.`);
        row.element.setAttribute('aria-pressed',String(ui.advisorId===item.id));row.fill.style.setProperty('--bar-color',item.id==='none'?'var(--cd-correction)':'var(--primary)');
        tween(`advisor/${id}/width`,item.groupCount/max*100,width=>row.fill.style.setProperty('width',`${width}%`));
      });
    }};
  }
  function donutView(){
    const element=section('Situação das bancas','Resultados das bancas registrados pela coordenação.'),body=el('div'),empty=noData('Cadastre uma banca para acompanhar sua situação.'),wrap=el('div','cd-donut-wrap');
    const svg=svgNode('svg',{viewBox:'0 0 240 240',role:'group',class:'cd-donut'}),legend=el('div','cd-legend'),rings=new Map(),legendItems=new Map();
    svg.append(svgNode('circle',{cx:120,cy:120,r:82,fill:'none',stroke:'var(--surface-soft)','stroke-width':22}));
    for(const status of STATUS_ORDER){
      const ring=chartAction(svgNode('circle',{cx:120,cy:120,r:82,pathLength:100,fill:'none',stroke:COLORS[status],'stroke-width':22,'stroke-dasharray':'0 100','stroke-dashoffset':0,transform:'rotate(-90 120 120)',class:'cd-ring-segment'}),STATUS[status],()=>chooseStatus(status));
      const title=svgNode('title');ring.append(title);svg.append(ring);rings.set(status,{ring,title});
      const button=control('','cd-legend-item',()=>chooseStatus(status)),label=el('span','cd-legend-label',STATUS[status]),count=el('strong','cd-legend-count'),percent=el('span','cd-legend-percent');
      button.style.setProperty('--status-color',COLORS[status]);button.append(label,count,percent);legend.append(button);legendItems.set(status,{button,count,percent});
    }
    const totalText=svgNode('text',{x:120,y:121,'text-anchor':'middle',class:'cd-donut-total','aria-hidden':'true'});
    svg.append(totalText,svgNode('text',{x:120,y:145,'text-anchor':'middle',class:'cd-svg-label'},'bancas'));
    wrap.append(svg,legend);element.append(body);
    return {element,update(model){
      const total=model.summary.boards;syncChildren(body,[total?wrap:empty]);if(!total){forget('donut/');return;}
      svg.setAttribute('aria-label',`${total} bancas: ${STATUS_ORDER.map(status=>`${model.boardCounts[status]} ${STATUS[status]}`).join(', ')}`);
      tween('donut/total',total,value=>setText(totalText,Math.round(value)));
      let offset=0;
      for(const status of STATUS_ORDER){
        const count=model.boardCounts[status],percentage=count/total*100,{ring,title}=rings.get(status),entry=legendItems.get(status);
        ring.setAttribute('aria-label',`${STATUS[status]}: ${count}. Filtrar resultado.`);ring.setAttribute('tabindex',count?'0':'-1');ring.setAttribute('visibility',count?'visible':'hidden');
        setText(title,`${STATUS[status]}: ${count} (${Math.round(percentage)}%)`);setText(entry.count,count);setText(entry.percent,`${Math.round(percentage)}%`);
        entry.button.disabled=count===0;entry.button.setAttribute('aria-pressed',String(ui.status===status));
        tween(`donut/${status}/arc`,[Math.max(0,percentage-(percentage<100?1.4:0)),offset],parts=>{ring.setAttribute('stroke-dasharray',`${parts[0]} ${100-parts[0]}`);ring.setAttribute('stroke-dashoffset',String(-parts[1]));},[0,offset]);offset+=percentage;
      }
    }};
  }
  function statusLegend(){const legend=el('div','cd-status-legend');for(const key of STATUS_ORDER){const text=el('span','',STATUS[key]);text.style.setProperty('--status-color',COLORS[key]);legend.append(text);}return legend;}
  function stackedView(){
    const view=listChart('Resultados por orientador','Resultados informados dos alunos, separados por situação.','Nenhuma participação neste filtro.');view.element.append(statusLegend());
    return {...view,update(model){
      const items=model.teacherRows.filter(item=>Object.values(item.results).some(Boolean)),max=Math.max(1,...items.map(item=>Object.values(item.results).reduce((sum,count)=>sum+count,0)));view.show(items.length>0);
      cancelDetachedRows('results/',new Set(items.map(item=>String(item.id))));
      reconcile(view.rows,view.cache,items,item=>item.id,()=>{
        const element=el('div','cd-stacked-row'),heading=el('div','cd-bar-heading'),label=el('span','cd-bar-label'),value=el('strong','cd-bar-value'),track=el('div','cd-stacked-track'),segments=new Map(),row={element,label,value,segments};
        heading.append(label,value);element.append(heading,track);
        for(const status of STATUS_ORDER){const segment=control('','cd-stacked-segment',()=>{if(!allowed())return;ui.advisorId=row.item.id;ui.groupId='all';ui.status=status;refreshFilters();draw();});segment.style.setProperty('--status-color',COLORS[status]);track.append(segment);segments.set(status,segment);}
        return row;
      },(row,item,id)=>{
        row.item=item;setText(row.label,item.name);const total=Object.values(item.results).reduce((sum,count)=>sum+count,0);setText(row.value,`${total} aluno(s)`);
        for(const status of STATUS_ORDER){const count=item.results[status],segment=row.segments.get(status);segment.hidden=count===0;segment.disabled=count===0;segment.setAttribute('aria-label',`${item.name}: ${count} ${STATUS[status]}. Filtrar resultado e orientador.`);segment.title=`${STATUS[status]}: ${count}`;setText(segment,count);tween(`results/${id}/${status}`,count/max*100,width=>segment.style.setProperty('width',`${width}%`));}
      });
    }};
  }
  function timelineView(){
    const element=section('Bancas ao longo do ano','Distribuição mensal pela data cadastrada. Cada ponto mostra o total do mês.');element.classList.add('cd-wide');
    const body=el('div'),empty=noData('As bancas com data aparecerão nesta linha.'),plot=el('div'),summary=el('div','cd-timeline-summary'),amount=el('strong'),detail=el('span');summary.append(amount,detail);
    const svg=svgNode('svg',{viewBox:'0 0 640 240',role:'group',class:'cd-timeline'}),defs=svgNode('defs'),gradientId=`cd-area-${++chartSequence}`,gradient=svgNode('linearGradient',{id:gradientId,x1:0,y1:0,x2:0,y2:1});
    gradient.append(svgNode('stop',{offset:'0%','stop-color':'var(--primary)','stop-opacity':.2}),svgNode('stop',{offset:'100%','stop-color':'var(--primary)','stop-opacity':.015}));defs.append(gradient);svg.append(defs);
    const grid=svgNode('g',{'aria-hidden':'true'}),area=svgNode('path',{class:'cd-area',fill:`url(#${gradientId})`,'aria-hidden':'true'}),line=svgNode('path',{class:'cd-line',fill:'none',stroke:'var(--primary)','stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round','aria-hidden':'true'}),dots=[];
    svg.append(grid,area,line);
    for(let index=0;index<12;index++){
      const x=46+index*50,dot=svgNode('circle',{cx:x,cy:180,r:5,tabindex:0,role:'img',class:'cd-point',fill:'var(--primary)',stroke:'var(--surface)','stroke-width':3}),title=svgNode('title'),value=svgNode('text',{x,y:165,'text-anchor':'middle',class:'cd-svg-value','aria-hidden':'true'}),month=svgNode('text',{x,y:220,'text-anchor':'middle',class:`cd-svg-label cd-month-label${index%2?' cd-month-label--minor':''}`},MONTHS[index]);
      dot.append(title);svg.append(dot,value,month);dots.push({dot,title,value});
    }
    plot.append(summary,svg);element.append(body);
    return {element,update(model){
      const total=model.months.reduce((sum,item)=>sum+item.count,0);syncChildren(body,[total?plot:empty]);if(!total){forget('timeline/');return;}
      const max=Math.max(1,...model.months.map(item=>item.count)),peak=model.months.filter(item=>item.count===max),labels=peak.map(item=>item.name).join(', ');
      setText(amount,total);setText(detail,`banca(s) com data · maior concentração: ${labels} (${max})`);svg.setAttribute('aria-label',`Bancas por mês de ${ui.year}. ${model.months.map(item=>`${item.name}: ${item.count}`).join('; ')}.`);
      const ticks=[...new Set([0,Math.ceil(max/2),max])];grid.replaceChildren();
      for(const value of ticks){const y=180-value/max*130;grid.append(svgNode('line',{x1:38,y1:y,x2:614,y2:y,class:'cd-grid-line',stroke:'var(--border)','stroke-dasharray':value?'4 6':'none'}),svgNode('text',{x:27,y:y+4,'text-anchor':'end',class:'cd-svg-label'},value));}
      model.months.forEach((item,index)=>{const point=dots[index];setText(point.title,`${item.name} de ${ui.year}: ${item.count} banca(s)`);point.dot.setAttribute('aria-label',`${item.name} de ${ui.year}: ${item.count} banca(s)`);setText(point.value,item.count||'');});
      const targets=model.months.map(item=>180-item.count/max*130);
      tween('timeline/points',targets,ys=>{
        const d=ys.map((y,index)=>`${index?'L':'M'}${46+index*50} ${y}`).join(' ');line.setAttribute('d',d);area.setAttribute('d',`${d} L596 180 L46 180 Z`);
        ys.forEach((y,index)=>{dots[index].dot.setAttribute('cy',String(y));dots[index].value.setAttribute('y',String(y-14));});
      },Array(12).fill(180));
    }};
  }
  function progressView(){
    const view=listChart('Progresso das entregas','Avanço de cada grupo, considerando os pesos das etapas do cronograma.','Nenhum grupo neste filtro.');
    return {...view,update(model){
      view.show(model.progress.length>0);cancelDetachedRows('progress/',new Set(model.progress.map(item=>String(item.id))));
      reconcile(view.rows,view.cache,model.progress,item=>item.id,()=>{const row=barRow(item=>chooseGroup(item.id));row.note=el('small','cd-bar-note');row.element.append(row.note);return row;},(row,item,id)=>{
        row.item=item;setText(row.label,item.name);setText(row.value,item.percent===null?'Sem etapas':`${item.percent}%`);setText(row.note,`${item.completed} de ${item.tasks} entrega(s) concluída(s)`);
        row.element.setAttribute('aria-label',`${item.name}: ${item.percent===null?'sem etapas cadastradas':item.percent+' por cento'}, ${item.completed} de ${item.tasks} entregas. Filtrar por grupo.`);row.element.setAttribute('aria-pressed',String(ui.groupId===item.id));
        row.fill.style.setProperty('--bar-color',item.percent===100?'var(--cd-approved)':'var(--primary)');tween(`progress/${id}/width`,item.percent||0,width=>row.fill.style.setProperty('width',`${width}%`));
      });
    }};
  }
  function matrixView(){
    const element=section('Mapa de pendências','Correções e entregas vencidas por grupo. Prazos no horário de Brasília.'),body=el('div','cd-chart-viewport'),empty=noData(),table=el('table','cd-heatmap'),head=el('tr'),thead=el('thead'),tbody=el('tbody'),rows=new Map();
    for(const text of['Grupo','Bancas','Alunos','Vencidas']){const th=el('th','',text);th.scope='col';head.append(th);}thead.append(head);table.append(thead,tbody);element.append(body);
    return {element,update(model){
      syncChildren(body,[model.matrix.length?table:empty]);const max=Math.max(1,...model.matrix.flatMap(item=>[item.boards,item.students,item.overdue]));
      reconcile(tbody,rows,model.matrix,item=>item.id,()=>{
        const element=el('tr'),name=el('th'),row={element,cells:[]};name.scope='row';row.button=control('','cd-group-link',()=>chooseGroup(row.item.id));name.append(row.button);element.append(name);
        for(let i=0;i<3;i++){const cell=el('td');row.cells.push(cell);element.append(cell);}return row;
      },(row,item)=>{row.item=item;setText(row.button,item.name);['boards','students','overdue'].forEach((key,index)=>{const cell=row.cells[index];setText(cell,item[key]);cell.style.setProperty('--heat',String(item[key]/max));cell.setAttribute('data-empty',String(item[key]===0));cell.title=`${item.name}: ${item[key]} ${key==='boards'?'bancas com correção':key==='students'?'alunos com correção':'entregas vencidas'}`;});});
    }};
  }
  function correctionsView(){
    const element=section('O que falta corrigir','Pendências registradas em bancas e resultados dos alunos.');element.classList.add('cd-wide');
    const body=el('div'),empty=noData('Nenhuma correção pendente neste filtro.'),ul=el('ul','cd-corrections'),rows=new Map();element.append(body);
    return {element,update(model){
      syncChildren(body,[model.corrections.length?ul:empty]);
      const items=model.corrections.map((item,index)=>({...item,key:`${item.kind}/${item.groupId}/${index}`}));
      reconcile(ul,rows,items,item=>item.key,()=>{const element=el('li'),copy=el('div'),kind=el('span','cd-kicker'),title=el('h4'),text=el('p'),link=el('a','button secondary compact','Abrir grupo');copy.append(kind,title,text);element.append(copy,link);return {element,kind,title,text,link};},(row,item)=>{setText(row.kind,item.kind);setText(row.title,item.title);setText(row.text,item.text);row.link.href=`#grupo/${encodeURIComponent(item.groupId)}/evaluations`;row.link.setAttribute('aria-label',`Abrir grupo ${item.groupName}`);});
    }};
  }
  function boardsView(){
    const element=section('Bancas cadastradas','Pesquise, acompanhe e atualize os registros da coordenação.');element.classList.add('cd-wide');
    const searchField=el('label','filter-search'),searchIcon=svgNode('svg',{class:'filter-icon',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','aria-hidden':'true',focusable:'false'});searchIcon.append(svgNode('circle',{cx:10.5,cy:10.5,r:6.5}),svgNode('path',{d:'m16 16 4 4'}));
    const search=el('input','cd-search');search.type='search';search.placeholder='Buscar banca, grupo ou avaliador';search.setAttribute('aria-label','Buscar bancas');search.setAttribute('data-filter-key','boards');search.value=ui.search;
    searchField.append(searchIcon,search);const rows=el('div','cd-board-list'),cache=new Map(),empty=noData('Nenhuma banca neste filtro.');element.append(searchField,rows);let model={boardRows:[]};
    search.addEventListener('input',()=>{if(!allowed())return;ui.search=search.value;paintRows();paintFilters(model);});
    function paintRows(){
      const query=normalize(ui.search),items=model.boardRows.filter(item=>!query||normalize(`${item.title} ${item.groupName} ${item.evaluatorsText||''}`).includes(query));
      reconcile(rows,cache,items,item=>`${item.groupId}/${item.id}`,()=>{
        const element=el('article','cd-board-row'),copy=el('div'),status=el('span','cd-status'),title=el('h4'),date=el('p'),evaluators=el('p'),correction=el('p','cd-board-correction'),actions=el('div','cd-row-actions');
        const row={element,status,title,date,evaluators,correction};copy.append(status,title,date,evaluators,correction);
        actions.append(control('Editar','button secondary compact',()=>openBoard(row.item)),control('Excluir','text-button destructive-action',()=>openDelete(row.item)));element.append(copy,actions);return row;
      },(row,item)=>{row.item=item;row.status.className=`cd-status cd-status--${item.status}`;setText(row.status,STATUS[item.status]);setText(row.title,item.title||'Banca');setText(row.date,`${item.groupName} · ${civilLabel(item.date)}${item.time?' · '+item.time:''}`);row.evaluators.hidden=!item.evaluatorsText;setText(row.evaluators,item.evaluatorsText?`Avaliadores: ${item.evaluatorsText}`:'');row.correction.hidden=!item.correction;setText(row.correction,item.correction||'');});
      if(!items.length)syncChildren(rows,[empty]);
    }
    return {element,kind:'boards',update(next){model=next;if(search.value!==ui.search)search.value=ui.search;paintRows();}};
  }
  function resultsView(){
    const element=section('Resultados informados pelos participantes','Declarações dos alunos, orientadores e coordenação. Separadas das notas da disciplina.');element.classList.add('cd-wide');
    const body=el('div','cd-table-viewport'),empty=noData(),table=el('table','cd-results-table'),thead=el('thead'),head=el('tr'),tbody=el('tbody'),rows=new Map();
    for(const name of['Estudante / grupo','Orientador','Resultado','Informado por']){const th=el('th','',name);th.scope='col';head.append(th);}thead.append(head);table.append(thead,tbody);element.append(body);
    return {element,update(model){
      syncChildren(body,[model.resultRows.length?table:empty]);
      reconcile(tbody,rows,model.resultRows,item=>item.key,()=>{const element=el('tr'),person=el('td'),name=el('strong'),group=el('p'),advisor=el('td'),statusCell=el('td'),status=el('span','cd-status'),source=el('td'),author=el('span'),updated=el('p');person.append(name,group);statusCell.append(status);source.append(author,updated);element.append(person,advisor,statusCell,source);return {element,name,group,advisor,status,author,updated};},(row,item)=>{
        setText(row.name,item.name);setText(row.group,item.groupName);setText(row.advisor,item.advisorName);row.status.className=`cd-status cd-status--${item.status}`;setText(row.status,STATUS[item.status]);
        const names={student:'Aluno(a)',advisor:'Orientador(a)',coordinator:'Coordenação'};setText(row.author,item.record?(item.record.updatedByName||names[item.record.updatedByRole]||'Participante'):'Ainda não informado');setText(row.updated,item.record?`${names[item.record.updatedByRole]||'Participante'} · ${stamp(item.record.updatedAt)}`:'');row.updated.hidden=!item.record;
      });
    }};
  }

  function openModal(title){if(!allowed()||busy)return null;modalSession++;dialog.replaceChildren();const top=el('div','cd-dialog-top');const titleNode=el('h3','',title);titleNode.id='cd-dialog-title';dialog.setAttribute('aria-labelledby',titleNode.id);top.append(titleNode,control('×','icon-button',()=>dialog.close?.()));top.lastChild.setAttribute('aria-label','Fechar janela');dialog.append(top);return modalSession;}
  function showModal(){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
  function openBoard(board=null){
    const token=openModal(board?'Editar banca':'Cadastrar banca');if(token===null)return;const currentYear=ui.year,initialStamp=number(board?.updatedAt),form=el('form','cd-board-form');const groups=list(liveState.groups).filter(item=>activeGroup(item)&&number(item.year||2027)===currentYear);if(!groups.length){dialog.append(noData('Cadastre um grupo nesta edição antes de criar a banca.'));showModal();return;}
    const group=field('Grupo','groupId',{required:true,value:board?.groupId||(ui.groupId!=='all'?ui.groupId:groups[0].id),options:groups.map(item=>({value:item.id,label:item.name||'Grupo'}))}),title=field('Nome da banca','title',{required:true,value:board?.title||'',maxLength:160}),date=field('Data','date',{type:'date',value:board?.date||''}),time=field('Horário','time',{type:'time',value:board?.time||''}),evaluators=field('Avaliadores (opcional)','evaluatorsText',{value:board?.evaluatorsText||'',maxLength:500}),status=field('Situação da banca','status',{value:board?.status||'pending',options:STATUS_ORDER.map(value=>({value,label:STATUS[value]}))}),correction=field('O que precisa ser corrigido','correction',{type:'textarea',value:board?.correction||'',maxLength:2000});
    group.input.disabled=Boolean(board);const line=el('div','cd-form-row');line.append(date.wrapper,time.wrapper);form.append(group.wrapper,title.wrapper,line,evaluators.wrapper,status.wrapper,correction.wrapper);const message=el('p','cd-form-status');message.setAttribute('role','status');const actions=el('div','cd-dialog-actions'),cancel=control('Cancelar','button secondary',()=>dialog.close?.()),submit=el('button','button primary',board?'Salvar banca':'Cadastrar banca');submit.type='submit';actions.append(cancel,submit);form.append(message,actions);dialog.append(form);
    function toggle(){correction.input.required=status.input.value==='correction';correction.wrapper.hidden=status.input.value!=='correction';}status.input.addEventListener('change',toggle);toggle();
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!allowed()||busy||token!==modalSession)return;const groupId=group.input.value,name=title.input.value.trim(),decision=status.input.value,note=decision==='correction'?correction.input.value.trim():'';
      if(name.length<3){message.textContent='Informe um nome com pelo menos 3 caracteres.';return;}if(!STATUS_ORDER.includes(decision)||decision==='correction'&&note.length<3){message.textContent='Descreva a correção em pelo menos 3 caracteres.';return;}if(date.input.value&&(!dateValid(date.input.value)||Number(date.input.value.slice(0,4))!==currentYear)){message.textContent=`Escolha uma data da edição ${currentYear}.`;return;}
      if(!list(liveState.groups).some(item=>item.id===groupId&&activeGroup(item)&&number(item.year||2027)===currentYear)){message.textContent='O grupo não está disponível nesta edição.';return;}
      if(board){const latest=flattenRecords(payload.boards,'boards').find(item=>item.id===board.id&&item.groupId===board.groupId);if(!latest||number(latest.updatedAt)!==initialStamp){message.textContent='Esta banca mudou. Feche e abra o registro atual antes de salvar.';return;}}
      busy=true;submit.disabled=true;cancel.disabled=true;submit.setAttribute('aria-busy','true');message.textContent='Salvando banca…';
      try{if(typeof service?.saveInicBoard!=='function')throw new Error('Atualize a página para cadastrar bancas.');await service.saveInicBoard(groupId,{year:currentYear,...(board?{id:board.id,expectedUpdatedAt:initialStamp}:{}),title:name,date:date.input.value,time:time.input.value,evaluatorsText:evaluators.input.value.trim(),status:decision,correction:note});if(!allowed()||token!==modalSession)return;dialog.close?.();notice(board?'Banca atualizada.':'Banca cadastrada.');}
      catch(cause){if(allowed()&&token===modalSession)message.textContent=cause.message||'Não foi possível salvar a banca.';}
      finally{if(allowed()){busy=false;if(token===modalSession){submit.disabled=false;cancel.disabled=false;submit.removeAttribute('aria-busy');}draw();}}
    });showModal();
  }
  function openDelete(board){
    const token=openModal('Excluir banca');if(token===null)return;const currentYear=ui.year,stampBefore=number(board.updatedAt),form=el('form');form.append(el('p','cd-delete-note',`Excluir “${board.title||'Banca'}” do grupo “${board.groupName||board.groupId}”? O registro da banca será removido.`));const label=el('label','cd-confirm'),check=el('input');check.type='checkbox';check.required=true;label.append(check,document.createTextNode('Confirmo a exclusão desta banca.'));form.append(label);const message=el('p','cd-form-status');message.setAttribute('role','status');const actions=el('div','cd-dialog-actions'),cancel=control('Cancelar','button secondary',()=>dialog.close?.()),submit=el('button','button danger-button','Excluir banca');submit.type='submit';actions.append(cancel,submit);form.append(message,actions);dialog.append(form);
    form.addEventListener('submit',async event=>{event.preventDefault();if(!allowed()||busy||token!==modalSession||!check.checked)return;const latest=flattenRecords(payload.boards,'boards').find(item=>item.groupId===board.groupId&&item.id===board.id);if(!latest||number(latest.updatedAt)!==stampBefore){message.textContent='A banca mudou. Abra o registro atual antes de excluir.';return;}busy=true;submit.disabled=true;cancel.disabled=true;submit.setAttribute('aria-busy','true');message.textContent='Excluindo banca…';try{if(typeof service?.deleteInicBoard!=='function')throw new Error('Atualize a página para excluir bancas.');await service.deleteInicBoard(board.groupId,board.id,{year:currentYear,expectedUpdatedAt:stampBefore});if(!allowed()||token!==modalSession)return;dialog.close?.();notice('Banca excluída.');}catch(cause){if(allowed()&&token===modalSession)message.textContent=cause.message||'Não foi possível excluir a banca.';}finally{if(allowed()){busy=false;if(token===modalSession){submit.disabled=false;cancel.disabled=false;submit.removeAttribute('aria-busy');}draw();}}});showModal();
  }
  if(!actor||!allowed()){clearPrivate();stopped=true;}else{refreshFilters();listen();}
  return {element:root,updateState(next){if(stopped)return;liveState=next||{};if(!allowed()){clearPrivate();stopped=true;return;}refreshFilters();draw(true);},destroy(){if(stopped)return;clearPrivate();stopped=true;root.replaceChildren();}};
}
