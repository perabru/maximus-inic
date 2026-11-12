// Private coordination view. Data is read through authenticated service methods.
const STATUS = Object.freeze({pending:'Aguardando',approved:'Aprovado',rejected:'Reprovado',correction:'Correção pendente'});
const STATUS_ORDER = Object.keys(STATUS);
const COLORS = {pending:'var(--cd-pending)',approved:'var(--cd-approved)',rejected:'var(--cd-rejected)',correction:'var(--cd-correction)'};
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
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
function chartSvg(title,height=220){const svg=svgNode('svg',{viewBox:`0 0 640 ${height}`,role:'group','aria-label':title});svg.append(svgNode('title',{},title));return svg;}
function chartAction(node,label,handler){node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',label);node.addEventListener('click',handler);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();handler();}});return node;}
function short(value,size=27){const text=String(value||'');return text.length>size?text.slice(0,size-1)+'…':text;}
function section(title,subtitle){const box=el('section','cd-chart-card');box.append(el('h3','',title));if(subtitle)box.append(el('p','cd-chart-note',subtitle));return box;}
function noData(text='Nenhum registro neste filtro.'){return el('p','cd-empty',text);}
function field(label,name,{type='text',value='',required=false,maxLength=2000,options}={}){
  const wrapper=el('label','cd-field',label),input=el(options?'select':type==='textarea'?'textarea':'input');input.name=name;input.setAttribute('aria-label',label);
  if(options)for(const item of options){const option=el('option','',item.label);option.value=item.value;input.append(option);}else if(type!=='textarea')input.type=type;
  input.value=String(value??'');input.required=required;input.maxLength=maxLength;if(type==='textarea')input.rows=3;wrapper.append(input);return {wrapper,input};
}
function stamp(value){if(!Number.isFinite(Number(value))||Number(value)<=0)return 'Sem atualização';return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(Number(value)));}
function civilLabel(value){if(!dateValid(value))return 'Sem data';return `${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`;}

export function createCoordinationDashboard({service,state={},year=2027,onNotice=()=>{}}={}){
  const root=el('section','coordination-dashboard');root.setAttribute('aria-label','Indicadores privados da coordenação');
  const actor=state.user?.uid;let liveState=state,stopped=false,generation=0,unsubscribe=()=>{},payload={boards:[],results:[],tasks:[]},ready=false,error=null,busy=false,modalSession=0;
  state=null;
  const ui={year:Number(year)||2027,advisorId:'all',groupId:'all',status:'all',search:''};
  const allowed=()=>!stopped&&liveState?.role==='coordinator'&&liveState.user?.uid===actor&&!liveState.archived;
  const header=el('div','cd-header'),heading=el('div');heading.append(el('p','eyebrow','COORDENAÇÃO · ACESSO RESTRITO'),el('h2','','Indicadores do INIC'),el('p','cd-intro','Bancas, orientadores e correções pendentes.'));
  const newBoard=control('Cadastrar banca +','button primary',()=>openBoard());header.append(heading,newBoard);
  const filters=el('div','cd-filters'),yearField=field('Edição','year',{type:'number',value:ui.year}),advisorField=field('Orientador','advisor',{options:[]}),groupField=field('Grupo','group',{options:[]}),statusField=field('Resultado','status',{options:[{value:'all',label:'Todos os resultados'},...STATUS_ORDER.map(value=>({value,label:STATUS[value]}))]});
  filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar indicadores do INIC');
  yearField.input.min='2027';yearField.input.max='2100';for(const item of[yearField,advisorField,groupField,statusField]){item.input.setAttribute('data-filter-key',item.input.name);filters.append(item.wrapper);}
  const content=el('div','cd-content');content.setAttribute('aria-live','polite');
  const dialog=el('dialog','cd-dialog');dialog.setAttribute('aria-label','Cadastro de banca');
  root.append(header,filters,content,dialog);
  function clearPrivate(){generation++;modalSession++;unsubscribe();unsubscribe=()=>{};payload={boards:[],results:[],tasks:[]};ready=false;error=null;busy=false;try{dialog.close?.();}catch{}dialog.replaceChildren();content.replaceChildren();advisorField.input.replaceChildren();groupField.input.replaceChildren();liveState={};root.replaceChildren(noData('Acesso exclusivo da coordenação.'));}
  function notice(text,kind='success'){if(allowed())onNotice(text,kind);}
  function chooseGroup(id){if(!allowed())return;ui.groupId=id||'all';groupField.input.value=ui.groupId;draw();}
  function chooseAdvisor(id){if(!allowed())return;ui.advisorId=id||'all';ui.groupId='all';refreshFilters();draw();}
  function refreshFilters(){
    if(!allowed())return;
    const groups=list(liveState.groups).filter(item=>activeGroup(item)&&number(item.year||2027)===ui.year);
    const advisors=new Map(list(liveState.advisors).map(item=>[personId(item),item])),users=new Map(list(liveState.users).map(item=>[personId(item),item]));
    const names=new Map([...advisors,...users].map(([id,item])=>[id,item.name]));
    const choices=[{value:'all',label:'Todos os orientadores'},{value:'none',label:'Sem orientador'},...[...new Set(groups.map(item=>effectiveAdvisor(item,users,advisors)).filter(id=>id!=='none'))].map(id=>({value:id,label:names.get(id)||'Orientador(a)'})).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'))];
    if(!choices.some(item=>item.value===ui.advisorId))ui.advisorId='all';
    advisorField.input.replaceChildren(...choices.map(item=>{const option=el('option','',item.label);option.value=item.value;return option;}));advisorField.input.value=ui.advisorId;
    const selected=groups.filter(item=>ui.advisorId==='all'||effectiveAdvisor(item,users,advisors)===ui.advisorId);
    if(!selected.some(item=>item.id===ui.groupId))ui.groupId='all';
    groupField.input.replaceChildren(...[{value:'all',label:'Todos os grupos'},...selected.map(item=>({value:item.id,label:item.name||'Grupo'}))].map(item=>{const option=el('option','',item.label);option.value=item.value;return option;}));groupField.input.value=ui.groupId;statusField.input.value=ui.status;
  }
  function listen(){
    unsubscribe();unsubscribe=()=>{};const version=++generation;payload={boards:[],results:[],tasks:[]};ready=false;error=null;draw();
    if(!allowed())return;
    if(typeof service?.subscribeCoordinationMetrics!=='function'){error=new Error('Atualize a página para consultar os indicadores.');ready=true;draw();return;}
    try{unsubscribe=service.subscribeCoordinationMetrics(ui.year,data=>{if(!allowed()||version!==generation)return;error=data?.error||null;ready=data?.ready!==false;payload=error?{boards:[],results:[],tasks:[]}:{boards:data?.boards||[],results:data?.results||[],tasks:data?.tasks||[]};draw();})||(()=>{});}catch(cause){if(allowed()&&version===generation){error=cause;ready=true;draw();}}
  }
  yearField.input.addEventListener('change',()=>{if(!allowed())return;const next=Number(yearField.input.value);if(!Number.isInteger(next)||next<2027||next>2100){yearField.input.value=String(ui.year);notice('Escolha uma edição entre 2027 e 2100.','error');return;}ui.year=next;ui.groupId='all';ui.advisorId='all';modalSession++;try{dialog.close?.();}catch{}refreshFilters();listen();});
  advisorField.input.addEventListener('change',()=>chooseAdvisor(advisorField.input.value));groupField.input.addEventListener('change',()=>chooseGroup(groupField.input.value));statusField.input.addEventListener('change',()=>{if(!allowed())return;ui.status=statusField.input.value;draw();});
  function bars(model){
    const box=section('Grupos por orientador','Selecione uma barra para filtrar os dados.');if(!model.teacherRows.length){box.append(noData('Nenhum grupo cadastrado nesta edição.'));return box;}
    const height=34*model.teacherRows.length+25,svg=chartSvg('Quantidade de grupos por orientador',height),max=Math.max(1,...model.teacherRows.map(item=>item.groupCount));
    model.teacherRows.forEach((item,index)=>{const y=index*34+10,g=chartAction(svgNode('g'),`${item.name}: ${item.groupCount} grupo(s)`,()=>chooseAdvisor(item.id));g.append(svgNode('title',{},`${item.name}: ${item.groupCount} grupo(s)`),svgNode('text',{x:0,y:y+16,class:'cd-svg-label'},short(item.name)),svgNode('rect',{x:210,y,width:Math.max(3,item.groupCount/max*360),height:21,rx:5,fill:item.id==='none'?'var(--orange)':'var(--primary)'}),svgNode('text',{x:582,y:y+16,class:'cd-svg-value'},item.groupCount));svg.append(g);});
    const viewport=el('div','cd-chart-viewport');viewport.append(svg);box.append(viewport);return box;
  }
  function donut(model){
    const box=section('Situação das bancas','Registros preenchidos pela coordenação.');const total=model.boardRows.length;if(!total){box.append(noData('Cadastre uma banca para acompanhar sua situação.'));return box;}
    const wrap=el('div','cd-donut-wrap'),svg=svgNode('svg',{viewBox:'0 0 240 240',role:'group','aria-label':`${total} bancas: ${STATUS_ORDER.map(key=>`${model.boardCounts[key]} ${STATUS[key]}`).join(', ')}`,class:'cd-donut'});let offset=0;const circumference=2*Math.PI*75;
    svg.append(svgNode('circle',{cx:120,cy:120,r:75,fill:'none',stroke:'var(--surface-soft)','stroke-width':27}));
    for(const key of STATUS_ORDER){const amount=model.boardCounts[key],length=amount/total*circumference;if(amount){const circle=chartAction(svgNode('circle',{cx:120,cy:120,r:75,fill:'none',stroke:COLORS[key],'stroke-width':27,'stroke-dasharray':`${length} ${circumference-length}`,'stroke-dashoffset':-offset,transform:'rotate(-90 120 120)'}),`${STATUS[key]}: ${amount}`,()=>{ui.status=key;statusField.input.value=key;draw();});circle.append(svgNode('title',{},`${STATUS[key]}: ${amount}`));svg.append(circle);}offset+=length;}
    svg.append(svgNode('text',{x:120,y:122,'text-anchor':'middle',class:'cd-donut-total'},total),svgNode('text',{x:120,y:145,'text-anchor':'middle',class:'cd-svg-label'},'bancas'));
    const legend=el('div','cd-legend');for(const key of STATUS_ORDER){const item=control(`${STATUS[key]} · ${model.boardCounts[key]}`,'cd-legend-item',()=>{ui.status=key;statusField.input.value=key;draw();});item.style.setProperty('--status-color',COLORS[key]);legend.append(item);}wrap.append(svg,legend);box.append(wrap);return box;
  }
  function stacked(model){
    const box=section('Resultados por orientador','Participações de alunos · resultado informado no aplicativo.');if(!model.resultRows.length){box.append(noData('Nenhuma participação neste filtro.'));return box;}
    const rows=model.teacherRows.filter(item=>Object.values(item.results).some(Boolean)),height=rows.length*37+28,svg=chartSvg('Resultados declarados dos alunos por orientador',height),max=Math.max(1,...rows.map(item=>Object.values(item.results).reduce((a,b)=>a+b,0)));
    rows.forEach((item,index)=>{const y=index*37+12;svg.append(svgNode('text',{x:0,y:y+16,class:'cd-svg-label'},short(item.name)));let x=205;for(const key of STATUS_ORDER){const amount=item.results[key],width=amount/max*360;if(amount){const rect=chartAction(svgNode('rect',{x,y,width,height:23,fill:COLORS[key]}),`${item.name}: ${amount} ${STATUS[key]}`,()=>{ui.advisorId=item.id;ui.status=key;ui.groupId='all';refreshFilters();draw();});rect.append(svgNode('title',{},`${item.name}: ${amount} ${STATUS[key]}`));svg.append(rect);}x+=width;}svg.append(svgNode('text',{x:582,y:y+17,class:'cd-svg-value'},Object.values(item.results).reduce((a,b)=>a+b,0)));});
    const viewport=el('div','cd-chart-viewport');viewport.append(svg);box.append(viewport,statusLegend());return box;
  }
  function statusLegend(){const legend=el('div','cd-status-legend');for(const key of STATUS_ORDER){const text=el('span','',STATUS[key]);text.style.setProperty('--status-color',COLORS[key]);legend.append(text);}return legend;}
  function timeline(model){
    const box=section('Bancas ao longo do ano','Quantidade por mês da data cadastrada.');if(!model.months.some(item=>item.count)){box.append(noData('As bancas com data aparecerão nesta linha.'));return box;}
    const svg=chartSvg(`Bancas por mês de ${ui.year}`,225),max=Math.max(1,...model.months.map(item=>item.count));svg.append(svgNode('line',{x1:32,y1:175,x2:614,y2:175,stroke:'var(--border)'}));const points=model.months.map((item,index)=>`${35+index*51.5},${175-item.count/max*135}`).join(' ');svg.append(svgNode('polyline',{points,fill:'none',stroke:'var(--primary)','stroke-width':3}));
    for(const [index,item]of model.months.entries()){const x=35+index*51.5,y=175-item.count/max*135;const dot=svgNode('circle',{cx:x,cy:y,r:5,fill:'var(--orange)',tabindex:0,role:'img','aria-label':`${item.name}: ${item.count} banca(s)`});dot.append(svgNode('title',{},`${item.name}: ${item.count} banca(s)`));svg.append(dot,svgNode('text',{x,y:y-13,'text-anchor':'middle',class:'cd-svg-value'},item.count),svgNode('text',{x,y:201,'text-anchor':'middle',class:'cd-svg-label'},item.name));}const viewport=el('div','cd-chart-viewport');viewport.append(svg);box.append(viewport);return box;
  }
  function progressChart(model){
    const box=section('Progresso das entregas','Percentual ponderado do cronograma de cada grupo.');if(!model.progress.length){box.append(noData());return box;}const svg=chartSvg('Progresso de entregas por grupo',model.progress.length*39+25);
    model.progress.forEach((item,index)=>{const y=index*39+10,g=chartAction(svgNode('g'),`${item.name}: ${item.percent===null?'sem entregas':item.percent+' por cento'}`,()=>chooseGroup(item.id));g.append(svgNode('title',{},`${item.name}: ${item.completed}/${item.tasks} entregas`),svgNode('text',{x:0,y:y+15,class:'cd-svg-label'},short(item.name)),svgNode('rect',{x:210,y,width:335,height:20,rx:5,fill:'var(--surface-soft)'}));if(item.percent!==null)g.append(svgNode('rect',{x:210,y,width:item.percent/100*335,height:20,rx:5,fill:'var(--primary)'}));g.append(svgNode('text',{x:560,y:y+15,class:'cd-svg-value'},item.percent===null?'Sem etapas':`${item.percent}%`));svg.append(g);});const viewport=el('div','cd-chart-viewport');viewport.append(svg);box.append(viewport);return box;
  }
  function matrix(model){
    const box=section('Mapa de pendências','Contagens por grupo; entregas vencidas usam o dia de Brasília.');if(!model.matrix.length){box.append(noData());return box;}const table=el('table','cd-heatmap'),head=el('tr');for(const text of['Grupo','Bancas','Alunos','Entregas vencidas'])head.append(el('th','',text));const thead=el('thead');thead.append(head);table.append(thead);const tbody=el('tbody'),max=Math.max(1,...model.matrix.flatMap(item=>[item.boards,item.students,item.overdue]));
    for(const item of model.matrix){const row=el('tr'),name=el('th');name.scope='row';name.append(control(item.name,'cd-group-link',()=>chooseGroup(item.id)));row.append(name);for(const key of['boards','students','overdue']){const cell=el('td','',item[key]);cell.style.setProperty('--heat',String(item[key]/max));cell.title=`${item.name}: ${item[key]} ${key==='boards'?'bancas com correção':key==='students'?'alunos com correção':'entregas vencidas'}`;row.append(cell);}tbody.append(row);}table.append(tbody);const viewport=el('div','cd-chart-viewport');viewport.append(table);box.append(viewport);return box;
  }
  function correctionList(model){const box=section('O que falta corrigir','Pendências registradas em bancas e resultados dos alunos.');box.classList.add('cd-wide');if(!model.corrections.length){box.append(noData('Nenhuma correção pendente neste filtro.'));return box;}const ul=el('ul','cd-corrections');for(const item of model.corrections){const li=el('li');const copy=el('div');copy.append(el('span','cd-kicker',item.kind),el('h4','',item.title),el('p','',item.text));const link=el('a','button secondary compact','Abrir grupo');link.href=`#grupo/${encodeURIComponent(item.groupId)}/evaluations`;link.setAttribute('aria-label',`Abrir grupo ${item.groupName}`);li.append(copy,link);ul.append(li);}box.append(ul);return box;}
  function boardList(model){
    const box=section('Bancas cadastradas','Preenchimento e manutenção exclusivos da coordenação.');box.classList.add('cd-wide');
    const searchField=el('label','filter-search'),searchIcon=svgNode('svg',{class:'filter-icon',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'});searchIcon.append(svgNode('circle',{cx:10.5,cy:10.5,r:6.5}),svgNode('path',{d:'m16 16 4 4'}));
    const search=el('input','cd-search');search.type='search';search.placeholder='Buscar banca, grupo ou avaliador';search.setAttribute('aria-label','Buscar bancas');search.setAttribute('data-filter-key','boards');search.value=ui.search;search.addEventListener('input',()=>{ui.search=search.value;paintRows();});searchField.append(searchIcon,search);box.append(searchField);const rows=el('div','cd-board-list');box.append(rows);
    function paintRows(){rows.replaceChildren();const query=normalize(ui.search);const items=model.boardRows.filter(item=>!query||normalize(`${item.title} ${item.groupName} ${item.evaluatorsText||''}`).includes(query));if(!items.length){rows.append(noData('Nenhuma banca neste filtro.'));return;}
      for(const item of items){const row=el('article','cd-board-row'),copy=el('div');copy.append(el('span',`cd-status cd-status--${item.status}`,STATUS[item.status]),el('h4','',item.title||'Banca'),el('p','',`${item.groupName} · ${civilLabel(item.date)}${item.time?' · '+item.time:''}`));if(item.evaluatorsText)copy.append(el('p','',`Avaliadores: ${item.evaluatorsText}`));if(item.correction)copy.append(el('p','cd-board-correction',item.correction));const actions=el('div','cd-row-actions');actions.append(control('Editar','button secondary compact',()=>openBoard(item)),control('Excluir','text-button destructive-action',()=>openDelete(item)));row.append(copy,actions);rows.append(row);}}
    paintRows();return box;
  }
  function resultTable(model){const box=section('Resultados informados pelos participantes','O resultado pode ser informado pelo próprio aluno, por seu orientador ou pela coordenação.');box.classList.add('cd-wide');if(!model.resultRows.length){box.append(noData());return box;}const table=el('table','cd-results-table'),thead=el('thead'),head=el('tr');for(const name of['Estudante / grupo','Orientador','Resultado','Informado por'])head.append(el('th','',name));thead.append(head);table.append(thead);const body=el('tbody');for(const item of model.resultRows){const row=el('tr'),person=el('td');person.append(el('strong','',item.name),el('p','',item.groupName));const source=el('td');if(item.record){const names={student:'Aluno(a)',advisor:'Orientador(a)',coordinator:'Coordenação'};source.append(el('span','',item.record.updatedByName||names[item.record.updatedByRole]||'Participante'),el('p','',`${names[item.record.updatedByRole]||'Participante'} · ${stamp(item.record.updatedAt)}`));}else source.textContent='Ainda não informado';const status=el('td');status.append(el('span',`cd-status cd-status--${item.status}`,STATUS[item.status]));row.append(person,el('td','',item.advisorName),status,source);body.append(row);}table.append(body);const viewport=el('div','cd-table-viewport');viewport.append(table);box.append(viewport);return box;}
  function draw(){
    if(!allowed())return;newBoard.disabled=busy;content.replaceChildren();
    for(const input of[advisorField.input,groupField.input,statusField.input])input.className=input.value&&input.value!=='all'?'is-filtered':'';
    if(!ready){const loading=el('div','cd-loading','Carregando indicadores…');loading.setAttribute('role','status');content.append(loading);return;}
    if(error){const box=section('Não foi possível consultar os indicadores',error.message||'Confira a conexão e tente novamente.');box.append(control('Tentar novamente','button secondary',listen));content.append(box);return;}
    const model=aggregateCoordinationMetrics({state:liveState,year:ui.year,...payload,filters:ui});const metrics=el('div','cd-metrics');
    for(const [label,value,note]of[['Grupos',model.summary.groups,'Ativos nesta edição'],['Orientadores',model.summary.advisors,'Com grupos neste filtro'],['Alunos distintos',model.summary.students,'Sem repetir o estudante'],['Participações',model.summary.participations,'Aluno × grupo'],['Bancas aprovadas',model.summary.approved,'Registro da coordenação'],['Bancas reprovadas',model.summary.rejected,'Registro da coordenação'],['Correções pendentes',model.summary.corrections,'Bancas e resultados'],['Entregas concluídas',`${model.summary.completedTasks}/${model.summary.tasks}`,'Cronogramas dos grupos']]){const card=el('div','cd-metric');card.append(el('span','',label),el('strong','',value),el('small','',note));metrics.append(card);}content.append(metrics);
    const charts=el('div','cd-charts');charts.append(bars(model),donut(model),stacked(model),timeline(model),progressChart(model),matrix(model),correctionList(model),boardList(model),resultTable(model));content.append(charts);
    if(!model.summary.groups)content.prepend(noData('Nenhum grupo ativo para esta edição ou filtro.'));
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
  return {element:root,updateState(next){if(stopped)return;liveState=next||{};if(!allowed()){clearPrivate();stopped=true;return;}refreshFilters();draw();},destroy(){if(stopped)return;clearPrivate();stopped=true;root.replaceChildren();}};
}
