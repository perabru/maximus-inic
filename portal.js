'use strict';

const $ = selector => document.querySelector(selector);
const roleNames = {student:'Estudante',advisor:'Orientador(a)',coordinator:'Coordenação'};
const hashes = {dashboard:'inicio',groups:'grupos',invitations:'convites',calendar:'calendario',admin:'coordenacao'};
const state = {user:null,profile:null,role:'student',users:[],advisors:[],groups:[],invitations:[],ready:false,error:null};
const groupData = new Map();
const groupListeners = new Map();
let service;
let sessionUnsubscribe = () => {};
let appUnsubscribe = () => {};
let currentRoute = {view:'dashboard',groupId:'',tab:'overview'};
let renderedKey = '';
let dialogHandler = null;
let groupSearch = '';
let groupAdvisorFilter = 'all';
let taskFilter = 'all';
let invitationFilter = 'incoming';
let calendarDate = new Date(2027,0,1,12);
let calendarGroup = 'all';
let calendarSelected = false;
let noticeTimer;
let renderTimer;

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}
function button(text, className, handler) {
  const b = node('button',className,text);
  b.type = 'button';
  if (handler) b.addEventListener('click',handler);
  return b;
}
function link(text, href, className = '') {
  const a = node('a',className,text);
  a.href = href;
  return a;
}
function fmtNumber(value) { return new Intl.NumberFormat('pt-BR').format(value); }
function todayString() { return civilDate(new Date()); }
function civilDate(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [y,m,d] = value.split('-').map(Number);
  const date = new Date(y,m-1,d,12);
  return date.getFullYear() === y && date.getMonth() === m-1 && date.getDate() === d ? date : null;
}
function dateLabel(value, long = false) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat('pt-BR',long ? {day:'numeric',month:'long',year:'numeric'} : {day:'2-digit',month:'2-digit',year:'numeric'}).format(date) : 'Sem prazo definido';
}
function messageTime(value) {
  return typeof value === 'number' ? new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : 'Enviando…';
}
function initials(name) { return String(name || 'M').trim().split(/\s+/).slice(0,2).map(n => n.charAt(0).toUpperCase()).join(''); }
function myName() { return state.profile?.name || state.user?.displayName || 'Minha conta'; }
function advisorName(group) { return state.advisors.find(p => p.id === group.advisorId)?.name || state.users.find(p => p.id === group.advisorId)?.name || (group.advisorId ? 'Orientador(a) do grupo' : 'Aguardando orientador(a)'); }
function groupName(id) { return state.groups.find(g => g.id === id)?.name || 'Grupo de pesquisa'; }
function canManage(group) { return state.role === 'coordinator' || group.advisorId === state.user?.uid || group.createdBy === state.user?.uid; }
function canManageTasks(group) { return state.role === 'coordinator' || (state.role === 'advisor' && group.advisorId === state.user?.uid); }
function canManageMembers(group) { return state.role === 'coordinator' || group.advisorId === state.user?.uid; }
function canCreateGroup() { return Boolean(state.user) && !(state.profile?.requestedRole === 'advisor' && state.role === 'student'); }
function statusOf(task) {
  if (task.completed) return {key:'done',text:'Concluída',className:'success'};
  if (parseDate(task.dueDate) && task.dueDate < todayString()) return {key:'late',text:'Em atraso',className:'danger'};
  if (task.dueDate === todayString()) return {key:'today',text:'Hoje',className:'warning'};
  return {key:'pending',text:'Pendente',className:''};
}
function progress(tasks = []) {
  const total = tasks.reduce((sum,t) => sum + (Number(t.weight)>0 ? Number(t.weight) : 1),0);
  const complete = tasks.filter(t => t.completed).reduce((sum,t) => sum + (Number(t.weight)>0 ? Number(t.weight) : 1),0);
  return total ? Math.round(complete/total*100) : 0;
}
function allTasks() {
  return state.groups.flatMap(g => (groupData.get(g.id)?.tasks || []).map(t => ({...t,groupId:g.id,groupName:g.name})));
}
function pendingInvitations() { return state.invitations.filter(i => i.status === 'pending' && isRecipient(i)); }
function isRecipient(invite) {
  return invite.toUid === state.user?.uid || Boolean(invite.toEmail && invite.toEmail.toLowerCase() === state.user?.email?.toLowerCase());
}
function errorText(error) {
  if (service?.friendlyError) return service.friendlyError(error);
  return error?.message || 'Não foi possível concluir. Confira sua conexão e tente novamente.';
}
function notice(text, kind = 'success', persistent = false) {
  clearTimeout(noticeTimer);
  const target = $('#app-notice');
  target.textContent = text;
  target.className = `notice ${kind}`;
  target.hidden = false;
  if (!persistent) noticeTimer = setTimeout(() => target.hidden = true,9000);
}
function bookLoader() {
  const loader = node('div','book-loader');
  loader.setAttribute('aria-hidden','true');
  for (let i=0;i<9;i++) loader.append(node('div','book-loader__box box'));
  return loader;
}
function authStatus(text, kind = '', busy = false) {
  const status = $('#auth-status');
  status.replaceChildren(...(busy ? [bookLoader(),node('span','',text)] : [document.createTextNode(text)]));
  status.className = `auth-status ${kind}${busy ? ' is-loading' : ''}`;
  status.setAttribute('aria-busy',String(busy));
}
async function action(control, callback, successText = '') {
  if (!service) {notice('O serviço de acesso ainda não está disponível. Recarregue a página.','error');return false;}
  if (control) {control.disabled = true;control.setAttribute('aria-busy','true');}
  try {await callback();if(successText) notice(successText);return true;}
  catch(error) {notice(errorText(error),'error',true);return false;}
  finally {if(control){control.disabled = false;control.removeAttribute('aria-busy');}}
}
function routeHref(view, groupId, tab = 'overview') { return groupId ? `#grupo/${encodeURIComponent(groupId)}/${tab}` : `#${hashes[view] || 'inicio'}`; }
function navigate(view, groupId = '', tab = 'overview') {
  const destination = routeHref(view,groupId,tab);
  if (location.hash === destination) {currentRoute = {view,groupId,tab};renderedKey='';render();}
  else location.hash = destination;
}
function readRoute() {
  const parts = location.hash.replace(/^#/,'').split('/');
  if (parts[0] === 'grupo' && parts[1]) {
    let id;
    try {id = decodeURIComponent(parts[1]);} catch {id = '';}
    currentRoute = {view:'group',groupId:id,tab:['overview','tasks','messages'].includes(parts[2]) ? parts[2] : 'overview'};
  } else currentRoute = {view:Object.entries(hashes).find(([,hash]) => hash === parts[0])?.[0] || 'dashboard',groupId:'',tab:'overview'};
  renderedKey = '';
  render();
}
window.addEventListener('hashchange',readRoute);

function makeField(labelText, name, options = {}) {
  const label = node('label','field',labelText);
  const field = node(options.type === 'textarea' ? 'textarea' : options.options ? 'select' : 'input');
  field.name = name;
  if (!options.options && options.type !== 'textarea') field.type = options.type || 'text';
  if (options.options) options.options.forEach(option => {
    const o = node('option','',typeof option === 'string' ? option : option.label);
    o.value = typeof option === 'string' ? option : option.value;
    field.append(o);
  });
  if (options.required) field.required = true;
  if (options.maxLength) field.maxLength = options.maxLength;
  if (options.minLength) field.minLength = options.minLength;
  if (options.min !== undefined) field.min = options.min;
  if (options.max !== undefined) field.max = options.max;
  if (options.placeholder) field.placeholder = options.placeholder;
  if (options.value !== undefined) field.value = options.value;
  if (options.autocomplete) field.autocomplete = options.autocomplete;
  label.append(field);
  if (options.help) label.append(node('small','',options.help));
  return {label,field};
}
function openForm({title,kicker = 'MEU INIC',fields,submit = 'Salvar',handler}) {
  $('#dialog-heading').textContent = title;
  $('#dialog-kicker').textContent = kicker;
  $('#dialog-fields').replaceChildren(...fields);
  $('#dialog-status').textContent = '';
  $('#dialog-submit').textContent = submit;
  $('#dialog-submit').disabled = false;
  dialogHandler = handler;
  $('#form-dialog').showModal();
}
document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click',() => $('#form-dialog').close()));
$('#dialog-form').addEventListener('submit',async event => {
  event.preventDefault();
  if (!dialogHandler) return;
  const submit = $('#dialog-submit');
  submit.disabled = true;
  submit.setAttribute('aria-busy','true');
  $('#dialog-status').textContent = '';
  try {
    const result = await dialogHandler(new FormData(event.currentTarget));
    if (result !== false) $('#form-dialog').close();
  } catch(error) {$('#dialog-status').textContent = errorText(error);}
  finally {submit.disabled = false;submit.removeAttribute('aria-busy');}
});
function confirmAction(title, description, callback, submit = 'Confirmar') {
  openForm({title,fields:[node('p','dialog-note',description)],submit,handler:callback});
}

function setAuthMode(mode) {
  const registration = mode === 'register';
  $('#register-form').hidden = !registration;
  $('#login-form').hidden = registration;
  $('#register-tab').setAttribute('aria-selected',String(registration));
  $('#login-tab').setAttribute('aria-selected',String(!registration));
  $('#auth-heading').textContent = registration ? 'Criar conta' : 'Entrar no Meu INIC';
  $('.auth-subtitle').textContent = registration ? 'Cadastre-se como estudante ou solicite acesso de orientador.' : 'Acesse seus grupos, entregas e mensagens.';
  authStatus('');
}
$('#login-tab').addEventListener('click',() => setAuthMode('login'));
$('#register-tab').addEventListener('click',() => setAuthMode('register'));
$('#register-role').addEventListener('change',event => {
  const advisor = event.target.value === 'advisor';
  $('#register-year-field').hidden = advisor;
  $('#advisor-approval-note').hidden = !advisor;
});
document.querySelectorAll('[data-password]').forEach(control => control.addEventListener('click',() => {
  const field = document.getElementById(control.dataset.password);
  const shown = field.type === 'password';
  field.type = shown ? 'text' : 'password';
  control.textContent = shown ? 'Ocultar' : 'Mostrar';
  control.setAttribute('aria-label',shown ? 'Ocultar senha' : 'Mostrar senha');
}));
async function authAction(form, callback) {
  if (!service) {authStatus('Não foi possível conectar ao serviço de acesso. Recarregue a página.','error');return;}
  const buttons = [...document.querySelectorAll('#auth-screen button')];
  buttons.forEach(b => b.disabled = true);
  authStatus('Conectando…','',true);
  try {await callback();if(form) form.reset();authStatus('Acesso confirmado.','success');}
  catch(error) {authStatus(errorText(error),'error');}
  finally {buttons.forEach(b => b.disabled = false);}
}
$('#login-form').addEventListener('submit',event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  authAction(event.currentTarget,() => service.login(String(data.get('email')).trim(),String(data.get('password'))));
});
$('#register-form').addEventListener('submit',event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  authAction(event.currentTarget,() => service.register({name:String(data.get('name')).trim(),email:String(data.get('email')).trim(),password:String(data.get('password')),requestedRole:String(data.get('requestedRole')),year:data.get('requestedRole') === 'student' ? String(data.get('year')) : ''}));
});
$('#google-login').addEventListener('click',() => authAction(null,() => service.loginGoogle()));
$('#forgot-password').addEventListener('click',() => {
  const email = makeField('E-mail da sua conta','email',{type:'email',required:true,maxLength:254,value:$('#login-form input[name="email"]').value,autocomplete:'email'});
  openForm({title:'Recuperar acesso',fields:[node('p','dialog-note','Informe o e-mail da sua conta. Se houver um cadastro, você receberá as instruções para redefinir a senha.'),email.label],submit:'Enviar instruções',handler:async data => {
    if (!service) throw new Error('O serviço de acesso não está disponível. Recarregue a página.');
    await service.resetPassword(String(data.get('email')).trim());
    authStatus('Se houver uma conta nesse endereço, as instruções de recuperação serão enviadas.','success');
  }});
});
$('#logout').addEventListener('click',event => action(event.currentTarget,() => service.logout()));
$('#profile-button').addEventListener('click',showProfileForm);

function showProfileForm() {
  const name = makeField('Nome completo','name',{value:myName(),required:true,minLength:2,maxLength:100,autocomplete:'name'});
  const year = makeField('Série escolar','year',{value:state.profile?.year || '',options:[{value:'',label:'Não se aplica'},'1º ano','2º ano','3º ano']});
  const fields = [node('p','dialog-note',`Sua conta: ${state.user.email || 'Google'}. O e-mail de acesso é gerenciado pelo serviço de autenticação.`),name.label,year.label];
  if (state.role === 'student') fields.push(makeField('Perfil solicitado','requestedRole',{value:state.profile?.requestedRole || 'student',options:[{value:'student',label:'Estudante'},{value:'advisor',label:'Solicitar acesso de orientador(a)'}],help:'A coordenação precisa aprovar o acesso de orientador.'}).label);
  openForm({title:'Meu perfil',fields,handler:async data => {
    const patch = {name:String(data.get('name')).trim(),year:String(data.get('year'))};
    if (data.has('requestedRole')) patch.requestedRole = String(data.get('requestedRole'));
    await service.saveProfile(patch);
    notice('Perfil atualizado.');
  }});
}

function syncGroupListeners() {
  const allowed = new Set(state.groups.map(g => g.id));
  for (const [id,unsubscribe] of groupListeners) if (!allowed.has(id)) {unsubscribe();groupListeners.delete(id);groupData.delete(id);}
  state.groups.forEach(group => {
    if (groupListeners.has(group.id)) return;
    groupListeners.set(group.id,() => {});
    const unsubscribe = service.subscribeGroup(group.id,data => {
      groupData.set(group.id,{tasks:data.tasks || [],messages:data.messages || [],error:data.error});
      if (data.error) notice(errorText(data.error),'error',true);
      if (!calendarSelected) {
        const first = allTasks().filter(t => parseDate(t.dueDate) && !t.completed).sort((a,b) => a.dueDate.localeCompare(b.dueDate))[0];
        if (first) {const d=parseDate(first.dueDate);calendarDate=new Date(d.getFullYear(),d.getMonth(),1,12);}
      }
      scheduleRender();
    });
    groupListeners.set(group.id,unsubscribe || (() => {}));
  });
}
function scheduleRender() {clearTimeout(renderTimer);renderTimer = setTimeout(render,60);}
function verificationNotice() {
  let panel = $('#verification-notice');
  if (!state.user || state.user.emailVerified || state.role === 'coordinator') {panel?.remove();return;}
  if (!panel) {
    panel = node('div','notice info');
    panel.id = 'verification-notice';
    panel.append(node('strong','','Confirme seu e-mail para aceitar convites.'),node('span','','Abra a mensagem de confirmação enviada para o seu e-mail. Isso protege o acesso aos grupos.'));
    const actions = node('div','actions');
    actions.style.marginTop = '10px';
    actions.append(button('Enviar confirmação','text-button',event => action(event.currentTarget,() => service.sendVerification(),'Confirmação enviada. Confira também a caixa de spam.')),button('Já confirmei','text-button',async event => {
      const ok = await action(event.currentTarget,async () => {state.user = await service.refreshSession();});
      if(ok) {verificationNotice();notice(state.user.emailVerified ? 'E-mail confirmado. Você já pode aceitar seus convites.' : 'A confirmação ainda não foi identificada. Abra o link recebido por e-mail e tente novamente.',state.user.emailVerified?'success':'info');render();}
    }));
    actions.style.display = 'flex';actions.style.gap = '20px';actions.style.flexWrap = 'wrap';
    panel.append(actions);
    $('#view-content').before(panel);
  }
}
function sessionChanged(user) {
  appUnsubscribe();
  appUnsubscribe = () => {};
  for (const unsubscribe of groupListeners.values()) unsubscribe();
  groupListeners.clear();groupData.clear();
  Object.assign(state,{user,profile:null,role:'student',users:[],advisors:[],groups:[],invitations:[],ready:false,error:null});
  renderedKey = '';
  $('.skip-link').href = user ? '#workspace-main' : '#main';
  $('#auth-screen').hidden = Boolean(user);
  $('#app-screen').hidden = !user;
  $('#app-notice').hidden = true;
  $('#verification-notice')?.remove();
  if (!user) {authStatus('');return;}
  render();
  appUnsubscribe = service.subscribeApp(user,data => {
    state.profile = data.profile || null;
    state.role = data.role || 'student';
    state.users = data.users || [];
    state.advisors = data.advisors || [];
    state.groups = data.groups || [];
    state.invitations = data.invitations || [];
    state.error = data.error || null;
    state.ready = true;
    if (data.error) notice(errorText(data.error),'error',true);
    syncGroupListeners();
    verificationNotice();
    scheduleRender();
  }) || (() => {});
}

function updateShell() {
  const route = currentRoute.view === 'group' ? 'groups' : currentRoute.view;
  const titles = {dashboard:'Visão geral',groups:state.role==='coordinator'?'Todos os grupos':'Meus grupos',invitations:'Convites',calendar:'Calendário',admin:'Coordenação',group:'Meu grupo'};
  $('#view-title').textContent = titles[currentRoute.view] || 'Visão geral';
  $('#view-kicker').textContent = state.role === 'coordinator' ? 'ACOMPANHAMENTO DA ESCOLA' : 'SEU ESPAÇO DE PESQUISA';
  $('#user-name').textContent = myName();
  $('#user-role').textContent = roleNames[state.role] || roleNames.student;
  $('#user-avatar').textContent = initials(myName());
  $('#admin-nav').hidden = state.role !== 'coordinator';
  $('#mobile-admin-nav').hidden = state.role !== 'coordinator';
  $('#invite-badge').hidden = !pendingInvitations().length;
  $('#invite-badge').textContent = pendingInvitations().length;
  $('#pending-advisor-note').hidden = !(state.role === 'student' && state.profile?.requestedRole === 'advisor');
  document.querySelectorAll('[data-route]').forEach(a => {if(a.dataset.route===route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
}
function render() {
  if (!state.user) return;
  if (currentRoute.view === 'admin' && state.role !== 'coordinator' && state.ready) {navigate('dashboard');return;}
  updateShell();
  if (!state.ready) {$('#view-content').replaceChildren(loadingPanel('Carregando seus grupos e convites…'));return;}
  if (currentRoute.view === 'group') {renderGroup();return;}
  renderedKey = currentRoute.view;
  const views = {dashboard:renderDashboard,groups:renderGroups,invitations:renderInvitations,calendar:renderCalendar,admin:renderAdmin};
  $('#view-content').replaceChildren((views[currentRoute.view] || renderDashboard)());
}
function loadingPanel(text) {const panel=node('div','loading-panel');panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');panel.setAttribute('aria-busy','true');panel.append(bookLoader(),node('p','',text));return panel;}
function emptyState(title, text, actions = []) {
  const panel = node('div','empty-state');
  panel.append(node('span','empty-icon','＋'),node('h3','',title),node('p','',text));
  if (actions.length) {const area=node('div','actions');area.append(...actions);panel.append(area);}
  return panel;
}
function heading(title, description, actions = []) {
  const section=node('div','section-title');const copy=node('div');copy.append(node('h2','',title));if(description)copy.append(node('p','',description));section.append(copy);
  if(actions.length){const area=node('div','actions');area.append(...actions);section.append(area);}return section;
}
function progressBlock(tasks, label = 'Entregas concluídas') {
  const wrap=node('div','progress-block');const top=node('div','progress-head');top.append(node('span','',label),node('strong','',`${progress(tasks)}%`));
  const track=node('div','progress-track');track.setAttribute('role','progressbar');track.setAttribute('aria-label',label);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(progress(tasks)));
  const fill=node('span');fill.style.width=`${progress(tasks)}%`;track.append(fill);wrap.append(top,track);return wrap;
}
function groupCard(group) {
  const tasks=groupData.get(group.id)?.tasks || [];
  const card=node('article','group-card');const top=node('div','card-top');top.append(node('span','badge',`INIC ${group.year || 2027}`),node('span','count-label',`${Object.values(group.members || {}).filter(Boolean).length} integrante(s)`));
  card.append(top,node('h3','',group.name),node('p','group-topic',group.topic || 'Tema em definição'),node('p','advisor-line',`Orientação: ${advisorName(group)}`));
  if(groupData.has(group.id))card.append(progressBlock(tasks));else card.append(node('p','loading-task','Carregando entregas…'));
  const footer=node('div','card-footer');footer.append(node('span','',tasks.length ? `${tasks.filter(t=>t.completed).length} de ${tasks.length} etapas` : 'Organize as próximas etapas'),link('Abrir grupo →',routeHref('group',group.id)));card.append(footer);return card;
}
function taskPreview(task) {
  const row=node('div','task-preview');const date=parseDate(task.dueDate);const tile=node('div','date-tile');tile.append(node('strong','',date?date.getDate():'—'),node('span','',date?new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(date).replace('.',''):'prazo'));
  const main=node('div','task-main');main.append(link(task.title,routeHref('group',task.groupId,'tasks')));main.firstChild.replaceChildren(node('h4','',task.title));main.append(node('p','',task.groupName));
  const status=statusOf(task);row.append(tile,main,node('span',`badge ${status.className}`,status.text));return row;
}
function supportCard() {
  const card=node('div','support-card');const copy=node('div');copy.append(node('h3','','Compromisso com a pesquisa, combinado em família.'),node('p','','Leia o termo, preencha os dados e leve a versão impressa à coordenação para as assinaturas. Valores e datas do evento em 2027 ainda serão confirmados.'));card.append(copy,link('Acessar o termo →','conformidade.html','button secondary'));return card;
}
function renderDashboard() {
  const fragment=document.createDocumentFragment();
  const welcome=node('section','welcome');const copy=node('div');copy.append(node('p','eyebrow','O PRÓXIMO PASSO DA SUA PESQUISA'),node('h2','',`Olá, ${myName().split(' ')[0]}. Vamos construir conhecimento?`),node('p','',state.role==='coordinator'?'Acompanhe grupos, orientadores e entregas em um só lugar.':'Seu grupo, seu orientador e as próximas entregas estão aqui. Comece por um pequeno passo.'));welcome.append(copy);
  if(canCreateGroup())welcome.append(button('Criar um grupo →','button orange',showCreateGroup));else welcome.append(link('Conhecer as pesquisas →','index.html#artigos','button orange'));
  fragment.append(welcome);
  const tasks=allTasks();const complete=tasks.filter(t=>t.completed).length;const late=tasks.filter(t=>statusOf(t).key==='late').length;
  const stats=node('div','stats-grid');
  [[state.role==='coordinator'?'Grupos da escola':'Meus grupos',state.groups.length,'Cada pesquisa tem seu espaço'],['Etapas concluídas',`${complete}/${tasks.length}`,'Atualizadas pelo grupo'],['Entregas em atraso',late,'Prazos do planejamento interno'],['Convites recebidos',pendingInvitations().length,'Aguardando sua resposta']].forEach(([label,value,detail])=>{const stat=node('div','stat');stat.append(node('span','',label),node('strong','',value),node('p','',detail));stats.append(stat);});
  fragment.append(stats);
  const columns=node('div','two-columns');const nextPanel=node('section','panel');const nextHead=node('div','panel-heading');nextHead.append(node('h3','','Próximas entregas'),link('Ver calendário →','#calendario'));nextPanel.append(nextHead);
  const next=tasks.filter(t=>!t.completed).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,4);
  nextPanel.append(...(next.length?next.map(taskPreview):[node('p','empty-small','Nenhuma entrega pendente. Crie um grupo ou organize as etapas da sua pesquisa.')]));
  const invitePanel=node('section','panel');const inviteHead=node('div','panel-heading');inviteHead.append(node('h3','','Seu próximo encontro'),link('Ver convites →','#convites'));invitePanel.append(inviteHead);
  const incoming=pendingInvitations().slice(0,3);
  if(incoming.length)incoming.forEach(invite=>{const row=node('div','mini-invite');row.append(node('h4','',invite.groupName||groupName(invite.groupId)),node('p','',`${invite.senderName||'Um participante'} convidou você como ${invite.type==='advisor'?'orientador(a)':'integrante'}.`),link('Responder convite →','#convites'));invitePanel.append(row);});
  else invitePanel.append(node('p','empty-small','Você está em dia com os convites. Quando alguém convidar você para um grupo, o convite aparecerá aqui.'));
  columns.append(nextPanel,invitePanel);fragment.append(columns);
  const groupsHead=heading(state.role==='coordinator'?'Pesquisas da escola':'Seus grupos','Abra um grupo para conversar e acompanhar as entregas.',[link('Ver todos →','#grupos','text-button')]);groupsHead.classList.add('mt-24');fragment.append(groupsHead);
  if(state.groups.length){const grid=node('div','group-grid');grid.append(...state.groups.slice(0,3).map(groupCard));fragment.append(grid);}else fragment.append(emptyState('Sua pesquisa começa por aqui','Crie um grupo com seu tema e convide o orientador. Se já recebeu um convite, abra a área de convites.',[...(canCreateGroup()?[button('Criar grupo','button primary',showCreateGroup)]:[]),link('Ver convites','#convites','button secondary')]));
  fragment.append(supportCard());return fragment;
}
function renderGroups() {
  const fragment=document.createDocumentFragment();
  fragment.append(heading(state.role==='coordinator'?'Todos os grupos':'Cada grupo, um espaço de trabalho',state.role==='coordinator'?'Visão completa da escola. Escolha um grupo para acompanhar.':'Organize as pesquisas e mantenha cada conversa no lugar certo.',canCreateGroup()?[button('Novo grupo +','button primary',showCreateGroup)]:[]));
  const filters=node('div','search-filter');const search=node('input');search.type='search';search.placeholder='Buscar grupo, tema ou integrante';search.setAttribute('aria-label','Buscar grupos');search.value=groupSearch;
  search.addEventListener('input',event=>{groupSearch=event.target.value;paintFilteredGroups();});filters.append(search);
  if(state.role==='coordinator'){
    const select=node('select');select.setAttribute('aria-label','Filtrar por orientador');[{value:'all',label:'Todos os orientadores'},{value:'none',label:'Sem orientador'},...state.advisors.map(a=>({value:a.id,label:a.name}))].forEach(a=>{const o=node('option','',a.label);o.value=a.value;select.append(o);});select.value=groupAdvisorFilter;select.addEventListener('change',event=>{groupAdvisorFilter=event.target.value;paintFilteredGroups();});filters.append(select);
  }
  fragment.append(filters,node('div','group-grid'));fragment.lastChild.id='filtered-groups';
  const count=node('p','count-label');count.id='groups-count';count.style.marginTop='16px';fragment.append(count);
  queueMicrotask(paintFilteredGroups);return fragment;
}
function paintFilteredGroups() {
  const area=$('#filtered-groups');if(!area)return;
  const query=normalize(groupSearch).trim();
  const filtered=state.groups.filter(g=>(!query||normalize([g.name,g.topic,g.description,...Object.values(g.memberNames||{})].join(' ')).includes(query))&&(groupAdvisorFilter==='all'||(groupAdvisorFilter==='none'?!g.advisorId:g.advisorId===groupAdvisorFilter)));
  area.className=filtered.length?'group-grid':'';
  area.replaceChildren(...(filtered.length?filtered.map(groupCard):[emptyState(state.groups.length?'Nenhum grupo com esses filtros':'Você ainda não participa de um grupo',state.groups.length?'Tente outro tema ou nome.':'Crie um grupo ou aceite um convite para começar a organizar a pesquisa.',canCreateGroup()?[button('Criar grupo','button primary',showCreateGroup)]:[])]));
  $('#groups-count').textContent=`${filtered.length} ${filtered.length===1?'grupo encontrado':'grupos encontrados'}`;
}

function showCreateGroup() {
  const name=makeField('Nome do grupo','name',{required:true,minLength:2,maxLength:100,placeholder:'Ex.: Equipe EcoPlant'});
  const topic=makeField('Tema da pesquisa','topic',{required:true,minLength:3,maxLength:240,placeholder:'O que vocês querem investigar?'});
  const description=makeField('Conte um pouco sobre a ideia','description',{type:'textarea',maxLength:3000,placeholder:'Qual problema vocês querem compreender ou resolver?'});
  const year=makeField('Edição do INIC','year',{type:'number',value:2027,required:true,min:2027,max:2100});
  const advisor=makeField('Orientador(a) desejado(a)','advisorId',{options:[{value:'',label:state.role==='advisor'?'Eu serei o(a) orientador(a)':'Escolher depois'},...state.advisors.map(a=>({value:a.id,label:a.name}))],help:'O orientador receberá um convite e será vinculado após aceitar.'});
  openForm({title:'Vamos criar seu grupo',kicker:'DA IDEIA AO PROJETO',fields:[name.label,topic.label,description.label,year.label,advisor.label,node('p','dialog-note','O grupo recebe um cronograma inicial de trabalho, com etapas que podem ser ajustadas. Datas oficiais de 2027 ainda não estão confirmadas.')],submit:'Criar grupo',handler:async data=>{
    const id=await service.createGroup({name:String(data.get('name')).trim(),topic:String(data.get('topic')).trim(),description:String(data.get('description')).trim(),year:Number(data.get('year')),advisorId:String(data.get('advisorId'))});
    notice('Grupo criado. Organize as etapas e convide os integrantes.');navigate('group',typeof id==='string'?id:id.id);
  }});
}
function showEditGroup(group) {
  const fields=[makeField('Nome do grupo','name',{value:group.name,required:true,minLength:2,maxLength:100}).label,makeField('Tema da pesquisa','topic',{value:group.topic,required:true,minLength:3,maxLength:240}).label,makeField('Descrição','description',{value:group.description||'',type:'textarea',maxLength:3000}).label,makeField('Edição do INIC','year',{type:'number',value:group.year||2027,min:2027,max:2100,required:true}).label];
  openForm({title:'Editar grupo',fields,handler:async data=>{
    await service.updateGroup(group.id,{name:String(data.get('name')).trim(),topic:String(data.get('topic')).trim(),description:String(data.get('description')).trim(),year:Number(data.get('year'))});notice('Informações do grupo atualizadas.');
  }});
}
function showInviteForm(initialGroupId = '') {
  const manageable=state.groups.filter(canManage);
  if(!manageable.length){notice('Crie um grupo ou abra um grupo que você orienta para enviar convites.','info');return;}
  const group=makeField('Grupo','groupId',{required:true,value:initialGroupId||manageable[0].id,options:manageable.map(g=>({value:g.id,label:g.name}))});
  const type=makeField('Convidar como','type',{options:[{value:'member',label:'Estudante / integrante'},{value:'advisor',label:'Orientador(a)'}]});
  const advisor=makeField('Orientador(a) cadastrado(a)','toUid',{options:[{value:'',label:'Selecione o orientador'},...state.advisors.map(p=>({value:p.id,label:p.name}))]});advisor.label.hidden=true;
  const email=makeField('E-mail de quem receberá','toEmail',{type:'email',required:true,maxLength:254,placeholder:'email@exemplo.com',help:'A pessoa verá o convite ao entrar com este mesmo e-mail.'});
  function toggle(){const isAdvisor=type.field.value==='advisor';advisor.label.hidden=!isAdvisor;advisor.field.required=isAdvisor;email.label.hidden=isAdvisor;email.field.required=!isAdvisor;}
  type.field.addEventListener('change',toggle);advisor.field.addEventListener('change',toggle);
  openForm({title:'Convidar para o grupo',fields:[group.label,type.label,advisor.label,email.label,node('p','dialog-note','Os convites ficam disponíveis dentro do aplicativo. O destinatário precisa aceitar para entrar no grupo. Orientadores devem estar cadastrados e aprovados pela coordenação; integrantes confirmam o e-mail de acesso.')],submit:'Enviar convite',handler:async data=>{
    const useUid=data.get('type')==='advisor'&&data.get('toUid');
    await service.invite({groupId:String(data.get('groupId')),type:String(data.get('type')),...(useUid?{toUid:String(data.get('toUid'))}:{toEmail:String(data.get('toEmail')).trim()})});notice('Convite enviado. Acompanhe a resposta na área de convites.');
  }});
}

function renderGroup() {
  const group=state.groups.find(g=>g.id===currentRoute.groupId);
  if(!group){$('#view-content').replaceChildren(emptyState('Este grupo não está disponível','Você precisa fazer parte do grupo, orientá-lo ou ter acesso da coordenação. Se acabou de aceitar um convite, aguarde a sincronização.',[link('Meus grupos','#grupos','button secondary'),link('Ver convites','#convites','button primary')]));renderedKey='';return;}
  const key=`group/${group.id}/${currentRoute.tab}`;
  if(renderedKey!==key){
    const fragment=document.createDocumentFragment();fragment.append(link('← Voltar aos grupos','#grupos','back-link'));
    const head=node('div','group-detail-header');const copy=node('div');copy.append(node('span','badge',`INIC ${group.year||2027}`),node('h2','',group.name),node('p','',group.topic||'Tema em definição'));copy.id='group-heading-copy';
    const meta=node('div','group-summary-meta');meta.id='group-meta';copy.append(meta);head.append(copy);
    const actions=node('div','actions');actions.id='group-header-actions';head.append(actions);fragment.append(head);
    const prog=node('div','group-progress-panel');prog.id='group-progress';fragment.append(prog);
    const tabs=node('nav','group-tabs');tabs.setAttribute('aria-label','Áreas do grupo');[['overview','Resumo'],['tasks','Entregas'],['messages','Mensagens']].forEach(([tab,label])=>{const a=link(label,routeHref('group',group.id,tab));if(tab===currentRoute.tab)a.setAttribute('aria-current','page');tabs.append(a);});fragment.append(tabs);
    const content=node('div');content.id='group-panel';fragment.append(content);$('#view-content').replaceChildren(fragment);renderedKey=key;
    if(currentRoute.tab==='messages')buildMessagesView(group);
  }
  const copy=$('#group-heading-copy');copy.querySelector('.badge').textContent=`INIC ${group.year||2027}`;copy.querySelector('h2').textContent=group.name;copy.querySelector('p').textContent=group.topic||'Tema em definição';
  $('#group-meta').replaceChildren(node('span','',`Orientação: ${advisorName(group)}`),node('span','',`${Object.values(group.members||{}).filter(Boolean).length} integrante(s)`));
  const actions=$('#group-header-actions');actions.replaceChildren();if(canManage(group)){actions.append(button('Editar grupo','button secondary compact',()=>showEditGroup(group)),button('Convidar +','button primary compact',()=>showInviteForm(group.id)));}
  const data=groupData.get(group.id);const tasks=data?.tasks||[];const prog=$('#group-progress');prog.replaceChildren(progressBlock(tasks,'Progresso da pesquisa'),node('p','',`${tasks.filter(t=>t.completed).length} de ${tasks.length} entregas concluídas.`));
  const late=tasks.filter(t=>statusOf(t).key==='late').length;prog.append(node('div','due-summary',late?`${late} ${late===1?'etapa precisa':'etapas precisam'} de atenção.`:'Um passo de cada vez. Mantenha o grupo em dia.'));
  if(!data){$('#group-panel').replaceChildren(loadingPanel('Carregando as entregas e mensagens do grupo…'));return;}
  if(currentRoute.tab==='overview')renderGroupOverview(group,tasks);
  else if(currentRoute.tab==='tasks')renderGroupTasks(group,tasks);
  else {if(!$('#messages-list'))buildMessagesView(group);paintMessages(data.messages||[]);}
}
function renderGroupOverview(group,tasks) {
  const columns=node('div','two-columns');const about=node('section','panel');const top=node('div','panel-heading');top.append(node('h3','','Sobre a pesquisa'));about.append(top,node('p','group-description',group.description||'Registre aqui a ideia, o problema e o caminho que o grupo quer investigar.'));
  const facts=node('div','group-facts');[['Tema',group.topic||'Em definição'],['Orientação',advisorName(group)],['Edição',String(group.year||2027)]].forEach(([label,value])=>{const line=node('div');line.append(node('span','',`${label}: `),node('strong','',value));facts.append(line);});about.append(facts);
  const team=node('section','panel');const teamHeading=node('div','panel-heading');teamHeading.append(node('h3','','Pessoas do grupo'));team.append(teamHeading);
  if(group.advisorId){const row=node('div','team-member');row.append(node('span','avatar',initials(advisorName(group))));const info=node('div','member-info');info.append(node('strong','',advisorName(group)),node('p','','Orientador(a)'));row.append(info);team.append(row);}
  Object.entries(group.members||{}).filter(([,member])=>member).forEach(([uid])=>{
    const name=group.memberNames?.[uid]||(uid===state.user.uid?myName():'Integrante do grupo');const row=node('div','team-member');row.append(node('span','avatar',initials(name)));const info=node('div','member-info');info.append(node('strong','',name),node('p','',uid===group.createdBy?'Criou o grupo':'Integrante'));row.append(info);
    if(canManageMembers(group)&&uid!==group.createdBy&&uid!==state.user.uid)row.append(button('Remover','text-button',()=>confirmAction('Remover integrante?',`${name} deixará de acessar este grupo. Um novo convite será necessário para retornar.`,async()=>{if(service.removeMember)await service.removeMember(group.id,uid);else await service.updateGroup(group.id,{[`members/${uid}`]:null,[`memberNames/${uid}`]:null});notice('Integrante removido do grupo.');})));
    team.append(row);
  });
  if(!Object.values(group.members||{}).some(Boolean))team.append(node('p','empty-small','Ainda não há integrantes cadastrados. Envie um convite para começar.'));
  columns.append(about,team);
  const fragment=document.createDocumentFragment();fragment.append(columns);
  const next=tasks.filter(t=>!t.completed).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,3);
  const nextPanel=node('section','panel mt-24');const head=node('div','panel-heading');head.append(node('h3','','Próximos passos'),link('Todas as entregas →',routeHref('group',group.id,'tasks')));nextPanel.append(head);
  if(next.length)nextPanel.append(...next.map(t=>taskPreview({...t,groupId:group.id,groupName:group.name})));else nextPanel.append(node('p','empty-small',tasks.length?'Todas as etapas deste grupo foram concluídas.':'O cronograma ainda não tem etapas. Abra “Entregas” para começar.'));
  fragment.append(nextPanel,supportCard());$('#group-panel').replaceChildren(fragment);
}
function renderGroupTasks(group,tasks) {
  const fragment=document.createDocumentFragment();const toolbar=node('div','tasks-toolbar');const pills=node('div','filter-pills');
  [['all','Todas'],['pending','Pendentes'],['late','Em atraso'],['done','Concluídas']].forEach(([value,label])=>{const b=button(label,'',()=>{taskFilter=value;renderGroupTasks(group,groupData.get(group.id)?.tasks||[]);});b.setAttribute('aria-pressed',String(value===taskFilter));pills.append(b);});toolbar.append(pills);
  if(canManageTasks(group))toolbar.append(button('Adicionar entrega +','button secondary compact',()=>showTaskForm(group)));
  fragment.append(toolbar);
  const filtered=tasks.filter(t=>taskFilter==='all'||(taskFilter==='pending'?!t.completed:statusOf(t).key===taskFilter)).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
  const list=node('div','task-list');
  filtered.forEach(task=>{
    const row=node('article',`task-row${task.completed?' completed':''}`);const label=node('label','task-toggle');const check=node('input');check.type='checkbox';check.checked=Boolean(task.completed);check.setAttribute('aria-label',`${task.completed?'Marcar como pendente':'Concluir entrega'}: ${task.title}`);check.addEventListener('change',async()=>{const completed=check.checked;const ok=await action(check,()=>service.updateTask(group.id,task.id,{completed}));if(!ok)check.checked=!completed;});label.append(check);
    const info=node('div','task-info');info.append(node('h3','',task.title),node('p','',`Prazo: ${dateLabel(task.dueDate)}`));const status=statusOf(task);const options=node('div','task-options');options.append(node('span',`badge ${status.className}`,status.text));if(canManageTasks(group)){const edit=button('✎','icon-button',()=>showTaskForm(group,task));edit.setAttribute('aria-label',`Editar entrega: ${task.title}`);options.append(edit);}row.append(label,info,options);list.append(row);
  });
  if(!filtered.length) {
    const actions=[];
    if(!tasks.length&&canManage(group))actions.push(button('Criar etapas sugeridas','button primary',event=>action(event.currentTarget,()=>service.createDefaultSchedule(group.id,Number(group.year)||2027),'Cronograma inicial criado. Confira e ajuste os prazos do seu grupo.')));
    list.append(emptyState(tasks.length?'Nenhuma etapa neste filtro':'Vamos organizar as entregas?',tasks.length?'As etapas aparecerão aqui conforme o status selecionado.':'Crie as etapas sugeridas ou adicione entregas com os prazos combinados entre o grupo e o orientador.',actions));
  }
  fragment.append(list,node('p','schedule-note','Os prazos são do planejamento interno da escola. O calendário oficial do INIC 2027 e os valores de inscrição e impressão ainda serão confirmados. O progresso é calculado automaticamente pelas entregas concluídas.'));
  $('#group-panel').replaceChildren(fragment);
}
function showTaskForm(group,task) {
  const title=makeField('Nome da entrega','title',{required:true,minLength:2,maxLength:160,value:task?.title||'',placeholder:'Ex.: Revisão da primeira versão do artigo'});
  const due=makeField('Prazo combinado','dueDate',{type:'date',required:true,value:task?.dueDate||todayString()});
  const fields=[title.label,due.label,node('p','dialog-note','Ao salvar uma data, a entrega aparece automaticamente no calendário deste grupo. Alterar o prazo não muda as datas oficiais do evento.')];
  if(task&&canManageTasks(group))fields.push(button('Excluir esta entrega','text-button',()=>{confirmAction('Excluir entrega?',`“${task.title}” será removida do cronograma e do cálculo de progresso.`,async()=>{await service.deleteTask(group.id,task.id);notice('Entrega excluída.');},'Excluir entrega');}));
  openForm({title:task?'Editar entrega':'Nova entrega',fields,handler:async data=>{
    const payload={title:String(data.get('title')).trim(),dueDate:String(data.get('dueDate'))};
    if(task)await service.updateTask(group.id,task.id,payload);else await service.addTask(group.id,payload);notice(task?'Entrega atualizada.':'Entrega adicionada ao cronograma.');
  }});
}
function buildMessagesView(group) {
  const panel=node('section','panel message-panel');const head=node('div','message-panel-head');const copy=node('div');copy.append(node('h3','','Conversa do grupo'),node('p','','Recados e orientações, no mesmo lugar.'));head.append(copy,node('span','badge','Em tempo real'));panel.append(head);
  const messages=node('div','messages');messages.id='messages-list';messages.setAttribute('role','log');messages.setAttribute('aria-label','Mensagens do grupo');messages.setAttribute('aria-live','polite');messages.setAttribute('aria-relevant','additions');panel.append(messages);
  const form=node('form','message-compose');const label=node('label','field','Sua mensagem');const textarea=node('textarea');textarea.id='message-draft';textarea.name='message';textarea.maxLength=2000;textarea.required=true;textarea.placeholder='Escreva uma pergunta ou compartilhe o próximo passo…';textarea.rows=2;label.append(textarea);const send=node('button','button primary','Enviar →');send.type='submit';form.append(label,send);panel.append(form,node('p','compose-footer','Máximo de 2.000 caracteres. Ctrl + Enter também envia. Mensagens ficam visíveis aos integrantes, ao orientador e à coordenação.'));
  form.addEventListener('submit',async event=>{
    event.preventDefault();const text=textarea.value.trim();if(!text)return;
    const ok=await action(send,()=>service.sendMessage(group.id,text));if(ok){textarea.value='';textarea.focus();}
  });
  textarea.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();form.requestSubmit();}});
  $('#group-panel').replaceChildren(panel);
}
function paintMessages(messages) {
  const list=$('#messages-list');if(!list)return;
  const signature=messages.map(m=>`${m.id}:${m.createdAt}`).join('|');
  if(list.dataset.signature===signature)return;
  const wasNearEnd=list.scrollHeight-list.scrollTop-list.clientHeight<100||!list.dataset.signature;
  list.dataset.signature=signature;
  const sorted=messages.slice().sort((a,b)=>(Number(a.createdAt)||0)-(Number(b.createdAt)||0));
  const ids=new Set(sorted.map(message=>message.id));
  const existing=new Map([...list.children].filter(item=>item.dataset.messageId).map(item=>[item.dataset.messageId,item]));
  for(const item of [...list.children])if(!item.dataset.messageId||!ids.has(item.dataset.messageId))item.remove();
  sorted.forEach(message=>{
    let item=existing.get(message.id);
    if(!item){
      item=node('article',`message${message.senderId===state.user.uid?' mine':''}`);
      item.dataset.messageId=message.id;
      item.append(node('span','message-author',message.senderId===state.user.uid?'Você':message.senderName||'Participante'),node('p','message-text',message.text),node('time','message-time',messageTime(message.createdAt)));
      list.append(item);
    }
    const time=item.querySelector('time');
    const formatted=messageTime(message.createdAt);
    if(time.textContent!==formatted)time.textContent=formatted;
    if(typeof message.createdAt==='number')time.dateTime=new Date(message.createdAt).toISOString();
  });
  if(!sorted.length)list.append(node('p','empty-small','A conversa ainda não começou. Compartilhe uma pergunta ou combine a próxima entrega com o grupo.'));
  if(wasNearEnd)list.scrollTop=list.scrollHeight;
}

function renderInvitations() {
  const fragment=document.createDocumentFragment();fragment.append(heading('Convites','Entre em um grupo ou convide integrantes e orientadores.',state.groups.some(canManage)?[button('Enviar convite +','button primary',()=>showInviteForm())]:[]));
  const filters=node('div','filter-pills invite-tabs');[['incoming','Recebidos'],['sent','Enviados'],['history','Histórico']].forEach(([value,label])=>{const b=button(label,'',()=>{invitationFilter=value;render();});b.setAttribute('aria-pressed',String(value===invitationFilter));filters.append(b);});fragment.append(filters);
  const invitations=state.invitations.filter(i=>invitationFilter==='incoming'?i.status==='pending'&&isRecipient(i):invitationFilter==='sent'?i.senderId===state.user.uid&&i.status==='pending':i.status!=='pending').sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  if(!invitations.length){fragment.append(emptyState(invitationFilter==='incoming'?'Nenhum convite aguardando resposta':invitationFilter==='sent'?'Nenhum convite pendente enviado':'O histórico aparece aqui',invitationFilter==='incoming'?'Quando um orientador ou grupo convidar você, o convite aparecerá aqui. Confira se está usando o mesmo e-mail informado.':'Você poderá acompanhar o grupo, o destinatário e a situação de cada convite.'));return fragment;}
  const grid=node('div','invite-grid');
  invitations.forEach(invite=>{
    const name=invite.groupName||groupName(invite.groupId);
    const card=node('article','invitation-card');const border=node('div','invitation-card__border-top');border.setAttribute('aria-hidden','true');
    const avatar=node('div','invitation-card__avatar',initials(name));avatar.setAttribute('aria-hidden','true');
    const recipient=invite.toEmail||state.advisors.find(a=>a.id===invite.toUid)?.name||(invite.toUid===state.user.uid?myName():'Orientador(a) convidado(a)');
    const date=typeof invite.createdAt==='number'?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(invite.createdAt)):'';
    const status={pending:'Aguardando resposta',accepted:'Aceito',declined:'Recusado',cancelled:'Cancelado'}[invite.status]||invite.status;
    card.append(border,avatar,node('h3','invitation-card__name',name),node('p','invitation-card__role',invite.type==='advisor'?'Convite para orientar o grupo':'Convite para participar do grupo'),node('p','invitation-card__details',`De: ${invite.senderName||'Participante'}\nPara: ${recipient}${date?'\nEnviado em '+date:''}`),node('span','invitation-card__status',status));
    if(invite.status==='pending'&&isRecipient(invite)) {
      const actions=node('div','invitation-card__actions');const accept=button('Aceitar convite','button primary',event=>action(event.currentTarget,()=>service.respondInvitation(invite.id,true),'Convite aceito. O grupo ficará disponível em “Meus grupos”.'));const requiresVerification=Boolean(invite.toEmail&&!state.user.emailVerified);if(requiresVerification){accept.disabled=true;accept.title='Confirme seu e-mail primeiro';}
      actions.append(accept,button('Recusar','button secondary',()=>confirmAction('Recusar convite?',`O convite para “${invite.groupName||'este grupo'}” será recusado. Um novo convite poderá ser enviado depois.`,async()=>{await service.respondInvitation(invite.id,false);notice('Convite recusado.');},'Recusar convite')));card.append(actions);
      if(requiresVerification)card.append(node('p','invitation-card__notice','Confirme seu e-mail para aceitar. Use “Enviar confirmação” no aviso acima.'));
    } else if(invite.status==='pending')card.append(node('p','invitation-card__notice','Aguardando o aceite do destinatário.'));
    grid.append(card);
  });fragment.append(grid);return fragment;
}

function renderCalendar() {
  if(calendarGroup!=='all'&&!state.groups.some(g=>g.id===calendarGroup))calendarGroup='all';
  const fragment=document.createDocumentFragment();fragment.append(heading('Um calendário para não perder o próximo passo','As entregas dos grupos aparecem aqui automaticamente.'));
  const toolbar=node('div','calendar-toolbar');const monthNav=node('div','calendar-nav');const previous=button('←','icon-button',()=>{calendarSelected=true;calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()-1,1,12);render();});previous.setAttribute('aria-label','Mês anterior');const next=button('→','icon-button',()=>{calendarSelected=true;calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+1,1,12);render();});next.setAttribute('aria-label','Próximo mês');monthNav.append(previous,node('h3','',new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(calendarDate)),next);toolbar.append(monthNav);
  const actions=node('div','actions');const select=node('select','calendar-group-filter');select.setAttribute('aria-label','Filtrar calendário por grupo');[{id:'all',name:'Todos os meus grupos'},...state.groups].forEach(g=>{const option=node('option','',g.name);option.value=g.id;select.append(option);});select.value=calendarGroup;select.addEventListener('change',event=>{calendarGroup=event.target.value;render();});
  actions.append(button('Hoje','button secondary compact',()=>{const now=new Date();calendarDate=new Date(now.getFullYear(),now.getMonth(),1,12);calendarSelected=true;render();}),button('Exportar agenda ↓','button secondary compact',exportCalendar));toolbar.append(actions);fragment.append(toolbar,select);select.style.marginBottom='20px';
  const tasks=allTasks().filter(t=>calendarGroup==='all'||t.groupId===calendarGroup);
  const first=new Date(calendarDate.getFullYear(),calendarDate.getMonth(),1,12);const start=new Date(first);start.setDate(first.getDate()-first.getDay());
  const grid=node('div','calendar-grid');grid.setAttribute('aria-label','Calendário mensal de entregas');['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].forEach(day=>grid.append(node('div','weekday',day)));
  for(let i=0;i<42;i++){
    const date=new Date(start);date.setDate(start.getDate()+i);const dateString=civilDate(date);const outside=date.getMonth()!==calendarDate.getMonth();const day=node('div',`calendar-day${outside?' outside':''}${dateString===todayString()?' today':''}`);day.append(node('span','day-number',date.getDate()));
    tasks.filter(t=>t.dueDate===dateString).forEach(task=>{const status=statusOf(task);const event=button(task.title,`calendar-event ${status.key==='done'?'done':status.key==='late'?'late':''}`,()=>showCalendarTask(task));event.title=`${task.groupName}: ${task.title}`;event.setAttribute('aria-label',`${dateLabel(task.dueDate,true)}: ${task.title}, grupo ${task.groupName}, ${status.text}`);day.append(event);});grid.append(day);
  }
  fragment.append(grid);const legend=node('div','calendar-legend');[['','Pendente'],['done','Concluída'],['late','Em atraso']].forEach(([className,text])=>{const item=node('span');item.append(node('i',`legend-dot ${className}`),document.createTextNode(text));legend.append(item);});fragment.append(legend,node('p','schedule-note','Calendário de trabalho da escola. Datas de inscrição, apresentação e impressão previstas para 2027 são estimativas internas e devem ser ajustadas após a divulgação do evento.'));
  const monthPrefix=`${calendarDate.getFullYear()}-${String(calendarDate.getMonth()+1).padStart(2,'0')}`;const monthTasks=tasks.filter(t=>(t.dueDate||'').startsWith(monthPrefix)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));const list=node('section','calendar-list');list.append(node('h3','','Entregas do mês'));
  if(monthTasks.length)list.append(...monthTasks.map(taskPreview));else list.append(node('p','empty-small','Nenhuma entrega neste mês. Use as setas para explorar o cronograma ou selecione outro grupo.'));fragment.append(list);return fragment;
}
function showCalendarTask(task) {
  const detail=node('div','dialog-details');detail.append(node('strong','',task.title),node('span','',`Grupo: ${task.groupName}`),node('span','',`Prazo: ${dateLabel(task.dueDate,true)}`),node('span','',`Situação: ${statusOf(task).text}`));
  openForm({title:'Entrega do cronograma',fields:[detail],submit:'Abrir grupo',handler:()=>{navigate('group',task.groupId,'tasks');}});
}
function exportCalendar() {
  const tasks=allTasks().filter(t=>parseDate(t.dueDate)&&(calendarGroup==='all'||t.groupId===calendarGroup));
  if(!tasks.length){notice('Não há entregas com data para exportar neste filtro.','info');return;}
  const escape=value=>String(value||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Maximus//Meu INIC//PT-BR','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Meu INIC - Máximu’s'];
  tasks.forEach(task=>{
    const end=parseDate(task.dueDate);end.setDate(end.getDate()+1);
    lines.push('BEGIN:VEVENT',`UID:${escape(task.id)}-${escape(task.groupId)}@maximus-inic`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${task.dueDate.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${civilDate(end).replace(/-/g,'')}`,`SUMMARY:${escape(task.title)}`,`DESCRIPTION:${escape(`Grupo: ${task.groupName}\nSituação: ${statusOf(task).text}\nPlanejamento interno da escola; datas oficiais do evento a confirmar.`)}`,`URL:${new URL(routeHref('group',task.groupId,'tasks'),location.href).href}`,'END:VEVENT');
  });lines.push('END:VCALENDAR');
  const fold=line=>{let output='',bytes=0;const encoder=new TextEncoder();for(const character of line){const size=encoder.encode(character).length;if(bytes+size>75){output+='\r\n ';bytes=1;}output+=character;bytes+=size;}return output;};
  const url=URL.createObjectURL(new Blob([lines.map(fold).join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'}));const download=link('','');download.href=url;download.download='Meu_INIC_Calendario.ics';document.body.append(download);download.click();download.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Agenda exportada. Abra o arquivo .ics no calendário de sua preferência.');
}

function renderAdmin() {
  const fragment=document.createDocumentFragment();const intro=node('section','admin-intro');intro.append(node('h3','','Acompanhe toda a escola'),node('p','','A coordenação tem acesso a todos os grupos, orientadores, cronogramas e conversas. Aprove os cadastros de professores e abra um grupo para acompanhar cada pesquisa.'));fragment.append(intro);
  const pending=state.users.filter(p=>p.requestedRole==='advisor'&&p.role!=='advisor'&&p.role!=='coordinator');const panel=node('section','panel');const head=node('div','panel-heading');head.append(node('h3','','Solicitações de orientadores'),node('span','badge',pending.length));panel.append(head);
  pending.forEach(person=>{const row=node('div','approval-row');const copy=node('div');copy.append(node('strong','',person.name||'Professor(a)'),node('p','',person.email||''));row.append(copy,button('Aprovar acesso','button primary compact',event=>action(event.currentTarget,()=>service.approveAdvisor(person.id),'Acesso de orientador liberado.')));panel.append(row);});
  if(!pending.length)panel.append(node('p','empty-small','Nenhum cadastro de orientador aguardando aprovação.'));fragment.append(panel);
  const usersPanel=node('section','panel mt-24');const usersHead=node('div','panel-heading');usersHead.append(node('h3','','Pessoas cadastradas'),node('span','count-label',`${state.users.length} conta(s)`));usersPanel.append(usersHead);
  const wrap=node('div','user-table-wrap');const table=node('table','user-table');const thead=node('thead');const header=node('tr');['Nome','E-mail','Série','Acesso'].forEach(label=>header.append(node('th','',label)));thead.append(header);table.append(thead);const tbody=node('tbody');
  state.users.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','pt-BR')).forEach(person=>{
    const row=node('tr');const name=node('td');name.append(node('strong','',person.name||'Sem nome'));row.append(name,node('td','',person.email||'—'),node('td','',person.year||'—'));const role=node('td');
    if(person.role==='coordinator')role.append(node('span','badge','Coordenação'));
    else {
      const select=node('select');select.setAttribute('aria-label',`Acesso de ${person.name||person.email||'usuário'}`);[{value:'student',label:'Estudante'},{value:'advisor',label:'Orientador(a)'}].forEach(item=>{const option=node('option','',item.label);option.value=item.value;select.append(option);});select.value=person.role||'student';select.addEventListener('change',async()=>{const oldRole=person.role||'student';const newRole=select.value;const ok=await action(select,()=>service.setUserRole(person.id,newRole),'Permissão atualizada.');if(!ok)select.value=oldRole;});role.append(select);
    }row.append(role);tbody.append(row);
  });table.append(tbody);wrap.append(table);usersPanel.append(wrap);fragment.append(usersPanel,supportCard());return fragment;
}

window.addEventListener('offline',()=>{const banner=$('#connection-banner');banner.textContent='Você está sem conexão. Grupos, convites e mensagens serão atualizados quando a conexão voltar.';banner.hidden=false;});
window.addEventListener('online',()=>{$('#connection-banner').hidden=true;});

readRoute();
try {
  service = await import('./firebase-service.js');
  authStatus('Verificando acesso…','',true);
  sessionUnsubscribe = service.onSession(sessionChanged) || (() => {});
} catch(error) {
  authStatus('Não foi possível conectar ao serviço de acesso. Confira a conexão e recarregue esta página.','error');
  const retry=button('Tentar novamente','text-button',()=>location.reload());$('#auth-status').append(document.createTextNode(' '),retry);
}
window.addEventListener('pagehide',event=>{if(!event.persisted){sessionUnsubscribe();appUnsubscribe();for(const unsubscribe of groupListeners.values())unsubscribe();}});
