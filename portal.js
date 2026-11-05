'use strict';

import { createCalendarView } from './calendar.js?v=20261105-8';
import { getNotificationState, enableNotifications, disableNotifications } from './notifications.js?v=20261105-8';

const $ = selector => document.querySelector(selector);
const roleNames = {student:'Estudante',advisor:'Orientador(a)',coordinator:'Coordenação'};
const hashes = {dashboard:'inicio',groups:'grupos',invitations:'convites',calendar:'calendario',agreements:'termo',admin:'coordenacao'};
const state = {user:null,profile:null,role:'student',users:[],advisors:[],groups:[],invitations:[],ready:false,error:null};
const groupData = new Map();
const groupListeners = new Map();
const groupAccess = new Map();
const seenAdvisorConfirmations = new Set();
let sessionVersion = 0;
let service;
let sessionUnsubscribe = () => {};
let appUnsubscribe = () => {};
let agreementsUnsubscribe = () => {};
let agreementScope = '';
let agreementSubscription = 0;
let agreements = [];
let agreementsReady = false;
let agreementsError = null;
let agreementRequirement = {ready:false,fulfilled:false};
let agreementSearch = '';
let agreementFilter = 'all';
let agreementUploadBusy = false;
let notificationsBusy = false;
const AGREEMENT_YEAR = 2027;
const AGREEMENT_LIMIT = 3 * 1024 * 1024;
let currentRoute = {view:'dashboard',groupId:'',tab:'overview'};
let renderedKey = '';
let dialogHandler = null;
let dialogVersion = 0;
let dialogAccess = 'academic';
let dialogBusyText = 'Salvando…';
let groupSearch = '';
let groupAdvisorFilter = 'all';
let taskFilter = 'all';
let invitationFilter = 'incoming';
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
function isListedAdvisor(uid = state.user?.uid) { return state.advisors.some(person=>person.id===uid); }
function advisorLabel(person) { return person.name + (person.id===state.user?.uid?' (eu)':''); }
function advisorName(group) { return state.advisors.find(p => p.id === group.advisorId)?.name || state.users.find(p => p.id === group.advisorId)?.name || (group.advisorId ? 'Orientador(a) do grupo' : 'Aguardando orientador(a)'); }
function groupName(id) { return state.groups.find(g => g.id === id)?.name || 'Grupo de pesquisa'; }
function isGroupManager(group) { return state.role === 'coordinator' || (state.role === 'advisor' && group.advisorId === state.user?.uid); }
function canManage(group) { return group.status !== 'deleting' && (isGroupManager(group) || (state.role === 'student' && group.createdBy === state.user?.uid && group.members?.[state.user?.uid])); }
function canEditGroup(group) { return group.status !== 'deleting' && (isGroupManager(group) || (state.role === 'student' && group.createdBy === state.user?.uid)); }
function canManageTasks(group) { return group.status !== 'deleting' && isGroupManager(group); }
function canManageMembers(group) { return group.status !== 'deleting' && isGroupManager(group); }
function requireManagedGroup(groupId, allowDeleting = false) {
  const group=state.groups.find(item=>item.id===groupId);
  if(!group||!isGroupManager(group))throw new Error('Somente a coordenação e o orientador deste grupo podem realizar esta ação.');
  if(group.status==='deleting'&&!allowDeleting)throw new Error('Este grupo está em exclusão. Conclua a exclusão antes de continuar.');
  return group;
}
function memberName(group,uid) { return group.memberNames?.[uid]||(uid===state.user?.uid?myName():'Integrante do grupo'); }
function isPendingAdvisor() { return state.role === 'student' && state.profile?.requestedRole === 'advisor'; }
function requiresAgreement() { return Boolean(state.user && state.profile && state.role === 'student' && !isPendingAdvisor() && state.profile.onboardingRequired !== true); }
function agreementSatisfied() { return agreementsReady && !agreementsError && agreementRequirement.ready === true && agreementRequirement.fulfilled === true; }
function canAccessAcademic() {
  if(!state.user || !state.ready || !state.profile || state.profile.onboardingRequired === true || isPendingAdvisor())return false;
  return state.role === 'advisor' || state.role === 'coordinator' || (requiresAgreement() && agreementSatisfied());
}
function canCreateGroup() { return canAccessAcademic(); }
function canUseAgreements() { return state.role === 'coordinator' || (state.role === 'student' && state.profile?.requestedRole !== 'advisor'); }
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
async function action(control, callback, successText = '', busyText = '') {
  if (!service) {notice('O serviço de acesso ainda não está disponível. Recarregue a página.','error');return false;}
  const originalLabel=control?.textContent;
  if (control) {control.disabled = true;control.setAttribute('aria-busy','true');if(busyText){control.textContent=busyText;control.classList.add('is-working');}}
  try {await callback();if(successText) notice(successText);return true;}
  catch(error) {notice(errorText(error),'error',true);return false;}
  finally {if(control){control.disabled = false;control.removeAttribute('aria-busy');if(busyText){control.textContent=originalLabel;control.classList.remove('is-working');}}}
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
    currentRoute = {view:'group',groupId:id,tab:['overview','tasks','messages','evaluations'].includes(parts[2]) ? parts[2] : 'overview'};
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
  if (options.step !== undefined) field.step = options.step;
  if (options.inputMode) field.inputMode = options.inputMode;
  if (options.placeholder) field.placeholder = options.placeholder;
  if (options.value !== undefined) field.value = options.value;
  if (options.autocomplete) field.autocomplete = options.autocomplete;
  label.append(field);
  if (options.help) label.append(node('small','',options.help));
  return {label,field};
}
function openForm({title,kicker = 'MEU INIC',fields,submit = 'Salvar',danger = false,access = 'academic',busy = 'Salvando…',handler}) {
  if(state.user && access === 'academic' && !canAccessAcademic()){render();return;}
  dialogVersion++;
  dialogAccess=access;
  dialogBusyText=busy;
  $('#dialog-heading').textContent = title;
  $('#dialog-kicker').textContent = kicker;
  $('#dialog-fields').replaceChildren(...fields);
  $('#dialog-status').textContent = '';
  $('#dialog-status').classList.remove('is-loading');
  $('#dialog-status').removeAttribute('aria-busy');
  $('#dialog-submit').textContent = submit;
  $('#dialog-submit').disabled = false;
  $('#dialog-submit').removeAttribute('aria-busy');
  $('#dialog-submit').classList.toggle('danger-button',danger);
  $('#dialog-submit').classList.toggle('primary',!danger);
  dialogHandler = handler;
  $('#form-dialog').showModal();
}
document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click',() => $('#form-dialog').close()));
$('#dialog-form').addEventListener('submit',async event => {
  event.preventDefault();
  if (!dialogHandler) return;
  const submit = $('#dialog-submit');
  if(submit.disabled)return;
  const version=dialogVersion;
  const handler=dialogHandler;
  submit.disabled = true;
  submit.setAttribute('aria-busy','true');
  const status=$('#dialog-status');status.replaceChildren(bookLoader(),node('span','',dialogBusyText));status.classList.add('is-loading');status.setAttribute('aria-busy','true');
  try {
    const result = await handler(new FormData(event.currentTarget));
    if (version===dialogVersion&&result !== false) $('#form-dialog').close();
  } catch(error) {if(version===dialogVersion)$('#dialog-status').textContent = errorText(error);}
  finally {if(version===dialogVersion){submit.disabled = false;submit.removeAttribute('aria-busy');status.classList.remove('is-loading');status.removeAttribute('aria-busy');if(status.querySelector('.book-loader'))status.replaceChildren();}}
});
function confirmAction(title, description, callback, submit = 'Confirmar', busy = 'Salvando resposta…') {
  openForm({title,fields:[node('p','dialog-note',description)],submit,busy,handler:callback});
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
  openForm({title:'Recuperar acesso',access:'account',fields:[node('p','dialog-note','Informe o e-mail da sua conta. Se houver um cadastro, você receberá as instruções para redefinir a senha.'),email.label],submit:'Enviar instruções',handler:async data => {
    if (!service) throw new Error('O serviço de acesso não está disponível. Recarregue a página.');
    await service.resetPassword(String(data.get('email')).trim());
    authStatus('Se houver uma conta nesse endereço, as instruções de recuperação serão enviadas.','success');
  }});
});
$('#logout').addEventListener('click',event => action(event.currentTarget,async() => {
  try {await disableNotifications(service,state.user);} catch(error) {console.warn('Avisos:',error.code||'desativação indisponível');}
  await service.logout();
}));
$('#profile-button').addEventListener('click',showProfileForm);

function showProfileForm() {
  const name = makeField('Nome completo','name',{value:myName(),required:true,minLength:2,maxLength:100,autocomplete:'name'});
  const year = makeField('Série escolar','year',{value:state.profile?.year || '',options:[{value:'',label:'Não se aplica'},'1º ano','2º ano','3º ano']});
  const fields = [node('p','dialog-note',`Sua conta: ${state.user.email || 'Google'}. O e-mail de acesso é gerenciado pelo serviço de autenticação.`),name.label,year.label];
  if (state.role === 'student') fields.push(makeField('Perfil solicitado','requestedRole',{value:state.profile?.requestedRole || 'student',options:[{value:'student',label:'Estudante'},{value:'advisor',label:'Solicitar acesso de orientador(a)'}],help:'A coordenação precisa aprovar o acesso de orientador.'}).label);
  openForm({title:'Meu perfil',access:'profile',fields,handler:async data => {
    const patch = {name:String(data.get('name')).trim(),year:String(data.get('year'))};
    if (data.has('requestedRole')) patch.requestedRole = String(data.get('requestedRole'));
    await service.saveProfile(patch);
    notice('Perfil atualizado.');
  }});
}

function syncGroupListeners() {
  if(!canAccessAcademic()){
    for(const unsubscribe of groupListeners.values())unsubscribe();
    groupListeners.clear();groupAccess.clear();groupData.clear();
    if(dialogAccess==='academic' && $('#form-dialog').open){dialogVersion++;dialogHandler=null;$('#form-dialog').close();}
    return;
  }
  const allowed = new Set(state.groups.map(g => g.id));
  for (const [id,unsubscribe] of groupListeners) if (!allowed.has(id)) {unsubscribe();groupListeners.delete(id);groupAccess.delete(id);groupData.delete(id);}
  for(const id of groupAccess.keys())if(!allowed.has(id)){groupAccess.delete(id);groupData.delete(id);}
  state.groups.forEach(group => {
    const accessKey=`${state.user.uid}/${state.role}/${state.role==='student'?'':group.advisorId||''}/${Boolean(group.members?.[state.user.uid])}/${group.status||''}`;
    if (groupListeners.has(group.id)&&groupAccess.get(group.id)===accessKey) return;
    groupListeners.get(group.id)?.();groupListeners.delete(group.id);groupData.delete(group.id);groupAccess.set(group.id,accessKey);
    if(group.status==='deleting')return;
    groupListeners.set(group.id,() => {});
    const subscribeUid=state.user.uid;const subscribeSession=sessionVersion;let confirmationBaselineReady=false;
    const unsubscribe = service.subscribeGroup(group.id,data => {
      if(subscribeSession!==sessionVersion||state.user?.uid!==subscribeUid||groupAccess.get(group.id)!==accessKey||!canAccessAcademic())return;
      const currentGroup=state.groups.find(item=>item.id===group.id);
      if(!currentGroup||currentGroup.status==='deleting')return;
      const evaluations=Array.isArray(data.memberEvaluations)?data.memberEvaluations:[];
      groupData.set(group.id,{tasks:data.tasks || [],messages:data.messages || [],events:data.events || [],groupEvaluation:data.error?null:data.groupEvaluation||null,advisorConfirmation:data.error?null:data.advisorConfirmation||null,memberEvaluations:data.error?[]:isGroupManager(currentGroup)?evaluations:evaluations.filter(item=>item.id===state.user.uid),error:data.error});
      const confirmation=data.error?null:data.advisorConfirmation;
      if(data.advisorConfirmationReady===true&&!data.error){
        if(confirmation&&state.role==='student'&&confirmation.studentUid===state.user.uid){
          const key=`${group.id}/${confirmation.invitationId||confirmation.createdAt}/${confirmation.advisorUid}`;
          if(!seenAdvisorConfirmations.has(key)){seenAdvisorConfirmations.add(key);if(confirmationBaselineReady)notice(`${confirmation.advisorName||advisorName(currentGroup)} aceitou orientar o grupo “${currentGroup.name}”.`,'success',true);}
        }
        confirmationBaselineReady=true;
      }
      if (data.error) notice(errorText(data.error),'error',true);
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
  const sessionId=++sessionVersion;seenAdvisorConfirmations.clear();
  dialogVersion++;dialogHandler=null;$('#form-dialog').close();
  appUnsubscribe();
  appUnsubscribe = () => {};
  agreementsUnsubscribe();agreementsUnsubscribe = () => {};agreementScope='';agreementSubscription++;
  agreements=[];agreementsReady=false;agreementsError=null;agreementRequirement={ready:false,fulfilled:false};agreementUploadBusy=false;agreementSearch='';agreementFilter='all';
  for (const unsubscribe of groupListeners.values()) unsubscribe();
  groupListeners.clear();groupAccess.clear();groupData.clear();
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
    if(sessionId!==sessionVersion||state.user?.uid!==user.uid)return;
    state.profile = data.profile || null;
    state.role = data.role || 'student';
    state.users = data.users || [];
    state.advisors = data.advisors || [];
    state.groups = data.groups || [];
    state.invitations = data.invitations || [];
    state.error = data.error || null;
    state.ready = true;
    if (data.error) notice(errorText(data.error),'error',true);
    syncAgreementSubscription();
    syncGroupListeners();
    verificationNotice();
    scheduleRender();
  }) || (() => {});
}

function updateShell() {
  const route = currentRoute.view === 'group' ? 'groups' : currentRoute.view;
  const titles = {dashboard:'Visão geral',groups:state.role==='coordinator'?'Todos os grupos':'Meus grupos',invitations:'Convites',calendar:'Calendário',agreements:state.role==='coordinator'?'Termos assinados':'Meu termo',admin:'Coordenação',group:'Meu grupo'};
  $('#view-title').textContent = titles[currentRoute.view] || 'Visão geral';
  $('#view-kicker').textContent = state.role === 'coordinator' ? 'ACOMPANHAMENTO DA ESCOLA' : 'SEU ESPAÇO DE PESQUISA';
  $('#user-name').textContent = myName();
  $('#user-role').textContent = state.role==='coordinator'&&isListedAdvisor()?'Coordenação e orientação':roleNames[state.role] || roleNames.student;
  $('#user-avatar').textContent = initials(myName());
  $('#admin-nav').hidden = state.role !== 'coordinator';
  $('#mobile-admin-nav').hidden = state.role !== 'coordinator';
  $('#agreements-nav').hidden = !canUseAgreements();
  $('#mobile-agreements-nav').hidden = !canUseAgreements();
  $('#agreements-nav-label').textContent = state.role === 'coordinator' ? 'Termos assinados' : 'Meu termo';
  $('#mobile-agreements-label').textContent = state.role === 'coordinator' ? 'Termos' : 'Termo';
  $('#invite-badge').hidden = !pendingInvitations().length;
  $('#invite-badge').textContent = pendingInvitations().length;
  $('#pending-advisor-note').hidden = !isPendingAdvisor();
  const academic=canAccessAcademic();
  document.querySelectorAll('[data-route]').forEach(a => {
    const permitted=a.dataset.route==='agreements'?canUseAgreements()&&state.profile?.onboardingRequired!==true:a.dataset.route==='admin'?state.role==='coordinator':academic;
    a.hidden=!permitted;
    if(a.dataset.route===route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  $('.mobile-nav').classList.toggle('is-restricted',!academic);
  $('.mobile-nav').hidden=![...document.querySelectorAll('.mobile-nav [data-route]')].some(item=>!item.hidden);
}
function render() {
  if (!state.user) return;
  if (currentRoute.view === 'admin' && state.role !== 'coordinator' && state.ready) {navigate('dashboard');return;}
  updateShell();
  if (!state.ready) {$('#view-content').replaceChildren(loadingPanel('Carregando seus grupos e convites…'));return;}
  if (state.profile?.onboardingRequired === true) {renderGoogleOnboarding();return;}
  if(!state.profile){$('#view-content').replaceChildren(loadingPanel('Carregando seu cadastro…'));return;}
  if(isPendingAdvisor()){renderAdvisorPending();return;}
  if(requiresAgreement()&&!agreementSatisfied()){
    if(currentRoute.view!=='agreements'){
      currentRoute={view:'agreements',groupId:'',tab:'overview'};
      if(location.hash!=='#termo')location.hash='#termo';
      renderedKey='';updateShell();
    }
    syncGroupListeners();renderAgreements();return;
  }
  if (currentRoute.view === 'agreements') {
    if(!canUseAgreements()){navigate('dashboard');return;}
    renderAgreements();return;
  }
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
function renderAdvisorPending() {
  $('#view-title').textContent='Aguardando aprovação';
  const key=`advisor-pending/${state.user.uid}`;
  if(renderedKey===key)return;
  renderedKey=key;
  const panel=node('section','panel access-gate');
  panel.append(node('span','badge','Cadastro de professor(a)'),node('h2','','A coordenação precisa liberar seu acesso.'),node('p','','Seu perfil de professor(a) foi solicitado. Assim que a coordenação aprovar, seus grupos, convites e calendário ficarão disponíveis.'));
  const actions=node('div','actions');
  actions.append(button('Revisar meu perfil','button secondary',showProfileForm),link('Voltar ao site','index.html','text-button'));
  panel.append(actions,node('p','gate-help','Se você é estudante, escolha “Estudante” em Meu perfil e envie o termo obrigatório.'));
  $('#view-content').replaceChildren(panel);
}
function renderGoogleOnboarding() {
  const key=`google-onboarding/${state.user.uid}`;
  $('#view-title').textContent='Complete seu cadastro';
  if(renderedKey===key)return;
  renderedKey=key;
  const panel=node('section','panel onboarding-panel');
  panel.append(node('p','eyebrow','PRIMEIRO ACESSO COM GOOGLE'),node('h2','','Você é estudante ou professor(a)?'),node('p','onboarding-intro','Escolha seu perfil para organizar o acesso à plataforma.'));
  const form=node('form','onboarding-form');
  const name=makeField('Nome completo','name',{value:myName(),required:true,minLength:2,maxLength:100,autocomplete:'name'});
  const role=makeField('Eu sou','requestedRole',{required:true,options:[{value:'',label:'Selecione seu perfil'},{value:'student',label:'Estudante'},{value:'advisor',label:'Professor(a) orientador(a)'}]});
  const year=makeField('Série escolar','year',{required:true,options:[{value:'',label:'Selecione a série'},'1º ano','2º ano','3º ano']});year.label.hidden=true;year.field.disabled=true;
  const note=node('p','form-note','O acesso de professor(a) precisa ser aprovado pela coordenação. Sua conta ficará disponível enquanto aguarda.');note.hidden=true;
  role.field.addEventListener('change',()=>{const student=role.field.value==='student';year.label.hidden=!student;year.field.disabled=!student;note.hidden=role.field.value!=='advisor';});
  const status=node('p','form-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const submit=node('button','button primary','Concluir cadastro');submit.type='submit';
  form.append(name.label,role.label,year.label,note,status,submit);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(submit.disabled)return;
    const uid=state.user?.uid;const profile={name:name.field.value.trim(),requestedRole:role.field.value,year:role.field.value==='student'?year.field.value:''};
    if(!['student','advisor'].includes(profile.requestedRole)){status.textContent='Escolha estudante ou professor(a).';return;}
    submit.disabled=true;submit.setAttribute('aria-busy','true');status.textContent='Salvando seu perfil…';
    try {
      await service.completeGoogleProfile(profile);
      if(state.user?.uid!==uid)return;
      state.profile={...state.profile,...profile,onboardingRequired:false};
      renderedKey='';syncAgreementSubscription();render();notice(profile.requestedRole==='advisor'?'Cadastro concluído. Aguarde a aprovação da coordenação para orientar grupos.':'Cadastro concluído. Envie o termo assinado para liberar o acesso aos grupos.');
    }catch(error){if(state.user?.uid===uid)status.textContent=errorText(error);}
    finally{submit.disabled=false;submit.removeAttribute('aria-busy');}
  });
  panel.append(form);$('#view-content').replaceChildren(panel);
}
function syncAgreementSubscription() {
  const scope=state.user&&state.profile&&state.profile.onboardingRequired!==true&&canUseAgreements()?`${state.user.uid}/${state.role}/${AGREEMENT_YEAR}`:'';
  if(scope===agreementScope)return;
  agreementsUnsubscribe();agreementsUnsubscribe=()=>{};agreementScope=scope;
  const version=++agreementSubscription;
  agreements=[];agreementsReady=false;agreementsError=null;agreementRequirement={ready:false,fulfilled:false};agreementUploadBusy=false;
  if(!scope)return;
  if(typeof service?.subscribeAgreements!=='function'){agreementsError=new Error('O envio de termos não está disponível. Atualize a página.');agreementsReady=true;return;}
  agreementsUnsubscribe=service.subscribeAgreements(AGREEMENT_YEAR,data=>{
    if(version!==agreementSubscription||scope!==agreementScope)return;
    agreementsError=data?.error||null;
    agreements=agreementsError?[]:(data?.agreements||[]).filter(item=>state.role==='coordinator'||(item.uid||item.id)===state.user?.uid);
    agreementRequirement={ready:!agreementsError&&data?.requirement?.ready===true,fulfilled:!agreementsError&&data?.requirement?.ready===true&&data?.requirement?.fulfilled===true};
    agreementsReady=Boolean(agreementsError||agreementRequirement.ready);
    syncGroupListeners();
    scheduleRender();
  })||(()=>{});
}
function agreementTimestamp(value) {
  return typeof value==='number'?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'Confirmando envio…';
}
function agreementSize(value) {
  return Number(value)>=1024*1024?`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(value)/(1024*1024))} MB`:`${Math.max(1,Math.ceil(Number(value||0)/1024))} KB`;
}
async function downloadAgreement(record,control) {
  const uid=state.user?.uid;const version=agreementSubscription;
  if(control){control.disabled=true;control.setAttribute('aria-busy','true');}
  try {
    const result=await service.downloadAgreement(record.uid||record.id,AGREEMENT_YEAR);
    if(state.user?.uid!==uid||version!==agreementSubscription)return;
    if(!(result?.blob instanceof Blob))throw new Error('O arquivo não pôde ser aberto. Tente novamente.');
    const url=URL.createObjectURL(result.blob);
    const download=link('',url);download.download=result.filename||record.filename||'Termo_INIC_2027.pdf';document.body.append(download);download.click();download.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch(error){if(state.user?.uid===uid&&version===agreementSubscription)notice(errorText(error),'error',true);}
  finally{if(control){control.disabled=false;control.removeAttribute('aria-busy');}}
}
function buildAgreementUpload() {
  const panel=node('section','panel agreement-upload');panel.append(node('h3','','Enviar contrato assinado'),node('p','','Fotografe com nitidez ou digitalize todas as assinaturas. A coordenação terá acesso ao arquivo.'));
  const form=node('form','agreement-upload-form');form.id='agreement-upload-form';
  const label=node('label','field','Contrato assinado');const input=node('input');input.type='file';input.name='agreement';input.required=true;input.accept='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';label.append(input,node('small','','PDF, JPG ou PNG · até 3 MB. Para várias páginas, envie um único PDF.'));
  const status=node('p','form-status');status.id='agreement-upload-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const submit=node('button','button primary','Enviar para a coordenação');submit.type='submit';submit.disabled=agreementUploadBusy;input.disabled=agreementUploadBusy;
  form.append(label,status,submit,node('p','agreement-privacy','Somente você e a coordenação podem acessar este arquivo. Um novo envio substitui a versão anterior.'));
  input.addEventListener('change',()=>{delete status.dataset.awaitingConfirmation;status.classList.remove('error');status.textContent=input.files?.[0]?`Selecionado: ${input.files[0].name}`:'';});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(agreementUploadBusy)return;
    const file=input.files?.[0];
    if(!file){status.classList.add('error');status.textContent='Selecione o contrato assinado.';return;}
    if(file.size>AGREEMENT_LIMIT){status.classList.add('error');status.textContent='O arquivo ultrapassa 3 MB. Reduza o tamanho e tente novamente.';return;}
    if(file.type&&!['application/pdf','image/jpeg','image/png'].includes(file.type)){status.classList.add('error');status.textContent='Envie um arquivo PDF, JPG ou PNG.';return;}
    const uid=state.user?.uid;const version=agreementSubscription;
    agreementUploadBusy=true;submit.disabled=true;input.disabled=true;submit.setAttribute('aria-busy','true');status.classList.remove('error');status.textContent='Enviando contrato… Aguarde a confirmação.';
    try {
      await service.uploadAgreement(file,{year:AGREEMENT_YEAR});
      if(state.user?.uid!==uid||version!==agreementSubscription)return;
      status.dataset.awaitingConfirmation=String(!agreementSatisfied());status.textContent=agreementSatisfied()?'Termo recebido e salvo para a coordenação. Seu acesso está liberado.':'Termo enviado. Confirmando o arquivo salvo para a coordenação…';input.value='';notice(agreementSatisfied()?'Termo recebido e salvo para a coordenação.':'Termo assinado enviado. Aguarde a confirmação do arquivo salvo.');
    }catch(error){if(state.user?.uid===uid&&version===agreementSubscription){status.classList.add('error');status.textContent=errorText(error);}}
    finally{
      if(state.user?.uid===uid&&version===agreementSubscription)agreementUploadBusy=false;
      submit.disabled=false;input.disabled=false;submit.removeAttribute('aria-busy');
    }
  });
  panel.append(form);return panel;
}
function renderAgreements() {
  const key=`agreements/${state.user.uid}/${state.role}`;
  if(renderedKey!==key){
    renderedKey=key;
    const fragment=document.createDocumentFragment();
    fragment.append(heading(state.role==='coordinator'?'Termos de aceite · 2027':'Termo de aceite · 2027',state.role==='coordinator'?'Acompanhe quem enviou o documento e quem ainda precisa enviar.':'Envie uma cópia completa do termo assinado para a coordenação.',[link('Ler e imprimir o termo','conformidade.html','button secondary')]));
    if(state.role!=='coordinator'){
      const gate=node('section','panel agreement-gate');gate.id='agreement-gate';
      gate.append(node('span','badge warning','Envio obrigatório'),node('h3','','Envie o termo para liberar sua participação.'),node('p','','Imprima o documento, recolha as assinaturas e envie uma cópia legível. Grupos, convites, cronograma e mensagens ficam disponíveis depois que o arquivo for salvo.'));
      const steps=node('ol','agreement-steps');['Abra o termo e preencha seus dados.','Recolha todas as assinaturas previstas no documento.','Envie abaixo um PDF ou uma foto legível do termo completo.'].forEach(text=>steps.append(node('li','',text)));gate.append(steps);fragment.append(gate,buildAgreementUpload());
      const released=node('section','notice success agreement-release');released.id='agreement-release';released.hidden=true;
      released.append(node('strong','','Termo recebido e salvo para a coordenação.'),node('span','','Seu acesso aos grupos está liberado.'),link('Continuar para os grupos','#grupos','button primary compact'));fragment.append(released);
    }else{
      const summary=node('div','agreement-summary');summary.id='agreement-summary';summary.setAttribute('aria-live','polite');fragment.append(summary);
      const search=node('input');search.type='search';search.className='agreement-search';search.placeholder='Buscar estudante, e-mail ou arquivo';search.setAttribute('aria-label','Buscar contratos assinados');search.value=agreementSearch;search.addEventListener('input',()=>{agreementSearch=search.value;paintAgreements();});
      const filters=node('div','filter-pills agreement-filters');filters.setAttribute('aria-label','Filtrar termos');
      [['all','Todos'],['pending','Pendentes'],['received','Enviados']].forEach(([value,label])=>{const filter=button(label,'',()=>{agreementFilter=value;paintAgreements();});filter.dataset.agreementFilter=value;filters.append(filter);});fragment.append(search,filters);
    }
    const list=node('section','agreement-list');list.id='agreement-list';list.setAttribute('aria-label',state.role==='coordinator'?'Situação dos termos dos estudantes':'Seu arquivo enviado');fragment.append(list);
    $('#view-content').replaceChildren(fragment);
  }
  paintAgreements();
}
function coordinationAgreementRows() {
  const submitted=new Map(agreements.map(record=>[record.uid||record.id,record]));
  const students=state.users.filter(person=>!['advisor','coordinator'].includes(person.role)&&person.requestedRole!=='advisor');
  const rows=students.map(person=>({uid:person.id,name:person.name||'Estudante',email:person.email||'',year:person.year||'',onboardingRequired:person.onboardingRequired===true,record:submitted.get(person.id)||null}));
  const known=new Set(rows.map(item=>item.uid));
  // Preserve access to documents already received even if the account's role changes.
  for(const record of agreements)if(!known.has(record.uid||record.id))rows.push({uid:record.uid||record.id,name:record.ownerName||'Estudante',email:'',year:'',record});
  return rows.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
function paintAgreements() {
  const list=$('#agreement-list');if(!list)return;
  const required=requiresAgreement()&&!agreementSatisfied();
  if($('#agreement-gate'))$('#agreement-gate').hidden=!required;
  if($('#agreement-release'))$('#agreement-release').hidden=!agreementSatisfied();
  const uploadStatus=$('#agreement-upload-status');if(agreementSatisfied()&&uploadStatus?.dataset.awaitingConfirmation==='true'){uploadStatus.textContent='Termo recebido e salvo para a coordenação. Seu acesso está liberado.';uploadStatus.classList.remove('is-loading','error');uploadStatus.removeAttribute('aria-busy');delete uploadStatus.dataset.awaitingConfirmation;}
  if(required){$('#view-title').textContent='Termo obrigatório · INIC 2027';$('#view-kicker').textContent='INIC 2027 · PARTICIPAÇÃO DOS ESTUDANTES';}
  if(!agreementsReady){list.replaceChildren(loadingPanel('Conferindo o envio do termo…'));return;}
  if(agreementsError){list.replaceChildren(emptyState('Não foi possível conferir o termo',errorText(agreementsError),[button('Tentar novamente','button secondary',()=>{agreementScope='';syncAgreementSubscription();render();})]));return;}
  const term=normalize(agreementSearch).trim();
  list.replaceChildren();
  if(state.role==='coordinator'){
    const rows=coordinationAgreementRows();const received=rows.filter(item=>item.record).length;
    const summary=$('#agreement-summary');summary?.replaceChildren(node('span','',`${rows.length} estudante(s)`),node('span','',`${received} enviado(s)`),node('span','',`${rows.length-received} pendente(s)`));
    document.querySelectorAll('[data-agreement-filter]').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.agreementFilter===agreementFilter)));
    const filtered=rows.filter(item=>(agreementFilter==='all'||(agreementFilter==='received'?Boolean(item.record):!item.record))&&(!term||normalize(`${item.name} ${item.email} ${item.record?.filename||''}`).includes(term)));
    if(!filtered.length){list.append(emptyState(rows.length?'Nenhum estudante neste filtro':'Nenhum estudante cadastrado',rows.length?'Altere a busca ou o filtro para consultar outros termos.':'Os estudantes e a situação do envio aparecerão aqui após o cadastro.'));return;}
    filtered.forEach(item=>{
      const card=node('article',`panel agreement-record${item.record?'':' agreement-record--pending'}`);const copy=node('div','agreement-record-copy');
      copy.append(node('span',`badge ${item.record?'success':'warning'}`,item.record?'Enviado':'Pendente'),node('h3','',item.name));
      if(item.email)copy.append(node('p','agreement-student-meta',[item.email,item.year].filter(Boolean).join(' · ')));
      if(item.record){copy.append(node('p','agreement-filename',item.record.filename||'Termo assinado'),node('p','agreement-file-meta',`${agreementSize(item.record.size)} · Recebido em ${agreementTimestamp(item.record.uploadedAt)}`));card.append(copy,button('Baixar arquivo','button secondary compact',event=>downloadAgreement(item.record,event.currentTarget)));}
      else {copy.append(node('p','agreement-file-meta',item.onboardingRequired?'Cadastro ainda não concluído. O envio será exigido após a escolha do perfil.':'Ainda não enviou o termo de aceite de 2027.'));card.append(copy);}
      list.append(card);
    });return;
  }
  if(!agreements.length){list.append(emptyState('Seu termo ainda não foi enviado','O envio é obrigatório. Depois da confirmação, o arquivo fica salvo para você e para a coordenação.'));return;}
  agreements.forEach(record=>{
    const card=node('article','panel agreement-record');const copy=node('div','agreement-record-copy');
    const received=agreementSatisfied();
    copy.append(node('span',`badge ${received?'success':'warning'}`,received?'Arquivo recebido':'Envio ainda não confirmado'),node('h3','','Seu termo de aceite'),node('p','agreement-filename',record.filename||'Termo assinado'),node('p','agreement-file-meta',`${agreementSize(record.size)} · Enviado em ${agreementTimestamp(record.uploadedAt)}`));
    if(!received)copy.append(node('p','agreement-file-meta','O arquivo completo precisa ser confirmado no banco. Se a pendência continuar, envie novamente.'));
    const download=button('Baixar arquivo','button secondary compact',event=>downloadAgreement(record,event.currentTarget));download.disabled=!received;card.append(copy,download);list.append(card);
  });
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
  if(group.status==='deleting')card.append(node('p','deletion-warning','Exclusão em andamento'));
  else if(groupData.has(group.id))card.append(progressBlock(tasks));else card.append(node('p','loading-task','Carregando entregas…'));
  const footer=node('div','card-footer');footer.append(node('span','',tasks.length ? `${tasks.filter(t=>t.completed).length} de ${tasks.length} etapas` : 'Organize as próximas etapas'),link('Abrir grupo',routeHref('group',group.id)));card.append(footer);return card;
}
function taskPreview(task) {
  const row=node('div','task-preview');const date=parseDate(task.dueDate);const tile=node('div','date-tile');tile.append(node('strong','',date?date.getDate():'—'),node('span','',date?new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(date).replace('.',''):'prazo'));
  const main=node('div','task-main');main.append(link(task.title,routeHref('group',task.groupId,'tasks')));main.firstChild.replaceChildren(node('h4','',task.title));main.append(node('p','',task.groupName));
  const status=statusOf(task);row.append(tile,main,node('span',`badge ${status.className}`,status.text));return row;
}
function supportCard() {
  const card=node('div','support-card');const copy=node('div');copy.append(node('h3','','Compromisso com a pesquisa, combinado em família.'),node('p','','Leia o termo, preencha os dados e leve a versão impressa à coordenação para as assinaturas. Valores e datas do evento em 2027 ainda serão confirmados.'));card.append(copy,link('Acessar o termo','conformidade.html','button secondary'));return card;
}
function renderDashboard() {
  const fragment=document.createDocumentFragment();
  const welcome=node('section','welcome');const copy=node('div');copy.append(node('p','eyebrow','O PRÓXIMO PASSO DA SUA PESQUISA'),node('h2','',`Olá, ${myName().split(' ')[0]}. Vamos construir conhecimento?`),node('p','',state.role==='coordinator'?'Acompanhe grupos, orientadores e entregas em um só lugar.':'Seu grupo, seu orientador e as próximas entregas estão aqui. Comece por um pequeno passo.'));welcome.append(copy);
  if(canCreateGroup())welcome.append(button('Criar um grupo','button orange',showCreateGroup));else welcome.append(link('Conhecer as pesquisas','index.html#artigos','button orange'));
  fragment.append(welcome);
  const tasks=allTasks();const complete=tasks.filter(t=>t.completed).length;const late=tasks.filter(t=>statusOf(t).key==='late').length;
  const stats=node('div','stats-grid');
  [[state.role==='coordinator'?'Grupos da escola':'Meus grupos',state.groups.length,'Cada pesquisa tem seu espaço'],['Etapas concluídas',`${complete}/${tasks.length}`,'Atualizadas pelo grupo'],['Entregas em atraso',late,'Prazos do planejamento interno'],['Convites recebidos',pendingInvitations().length,'Aguardando sua resposta']].forEach(([label,value,detail])=>{const stat=node('div','stat');stat.append(node('span','',label),node('strong','',value),node('p','',detail));stats.append(stat);});
  fragment.append(stats);
  const columns=node('div','two-columns');const nextPanel=node('section','panel');const nextHead=node('div','panel-heading');nextHead.append(node('h3','','Próximas entregas'),link('Ver calendário','#calendario'));nextPanel.append(nextHead);
  const next=tasks.filter(t=>!t.completed).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,4);
  nextPanel.append(...(next.length?next.map(taskPreview):[node('p','empty-small','Nenhuma entrega pendente. Crie um grupo ou organize as etapas da sua pesquisa.')]));
  const invitePanel=node('section','panel');const inviteHead=node('div','panel-heading');inviteHead.append(node('h3','','Seu próximo encontro'),link('Ver convites','#convites'));invitePanel.append(inviteHead);
  const incoming=pendingInvitations().slice(0,3);
  if(incoming.length)incoming.forEach(invite=>{const row=node('div','mini-invite');row.append(node('h4','',invite.groupName||groupName(invite.groupId)),node('p','',`${invite.senderName||'Um participante'} convidou você como ${invite.type==='advisor'?'orientador(a)':'integrante'}.`),link('Responder convite','#convites'));invitePanel.append(row);});
  else invitePanel.append(node('p','empty-small','Você está em dia com os convites. Quando alguém convidar você para um grupo, o convite aparecerá aqui.'));
  columns.append(nextPanel,invitePanel);fragment.append(columns);
  const groupsHead=heading(state.role==='coordinator'?'Pesquisas da escola':'Seus grupos','Abra um grupo para conversar e acompanhar as entregas.',[link('Ver todos','#grupos','text-button')]);groupsHead.classList.add('mt-24');fragment.append(groupsHead);
  if(state.groups.length){const grid=node('div','group-grid');grid.append(...state.groups.slice(0,3).map(groupCard));fragment.append(grid);}else fragment.append(emptyState('Sua pesquisa começa por aqui','Crie um grupo com seu tema e convide o orientador. Se já recebeu um convite, abra a área de convites.',[...(canCreateGroup()?[button('Criar grupo','button primary',showCreateGroup)]:[]),link('Ver convites','#convites','button secondary')]));
  fragment.append(supportCard());return fragment;
}
function renderGroups() {
  const fragment=document.createDocumentFragment();
  fragment.append(heading(state.role==='coordinator'?'Todos os grupos':'Cada grupo, um espaço de trabalho',state.role==='coordinator'?'Visão completa da escola. Escolha um grupo para acompanhar.':'Organize as pesquisas e mantenha cada conversa no lugar certo.',canCreateGroup()?[button('Novo grupo +','button primary',showCreateGroup)]:[]));
  const filters=node('div','search-filter');const search=node('input');search.type='search';search.placeholder='Buscar grupo, tema ou integrante';search.setAttribute('aria-label','Buscar grupos');search.value=groupSearch;
  search.addEventListener('input',event=>{groupSearch=event.target.value;paintFilteredGroups();});filters.append(search);
  if(state.role==='coordinator'){
    const select=node('select');select.setAttribute('aria-label','Filtrar por orientador');[{value:'all',label:'Todos os orientadores'},{value:'none',label:'Sem orientador'},...state.advisors.map(a=>({value:a.id,label:advisorLabel(a)}))].forEach(a=>{const o=node('option','',a.label);o.value=a.value;select.append(o);});select.value=groupAdvisorFilter;select.addEventListener('change',event=>{groupAdvisorFilter=event.target.value;paintFilteredGroups();});filters.append(select);
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

function buildAdvisorPicker() {
  const field=node('fieldset','advisor-picker');field.append(node('legend','','Orientadores para convidar'));
  field.append(node('p','advisor-picker-help','Envie convites para até 3 orientadores ao mesmo tempo. O primeiro aceite confirma a orientação.'));
  const count=node('p','advisor-picker-count','0 de 3 selecionados');count.setAttribute('role','status');count.setAttribute('aria-live','polite');
  const search=node('input','advisor-picker-search');search.type='search';search.placeholder='Buscar professor(a) pelo nome';search.setAttribute('aria-label','Buscar orientadores aprovados');
  const list=node('div','advisor-picker-list');const selected=new Set();
  const advisors=[...new Map(state.advisors.filter(person=>person.id).map(person=>[person.id,person])).values()];
  const controls=[];
  function paint(){count.textContent=`${selected.size} de 3 selecionados`;controls.forEach(({input})=>{input.disabled=selected.size>=3&&!input.checked;});}
  advisors.forEach(person=>{
    const label=node('label','advisor-choice');label.dataset.search=normalize(person.name);const input=node('input');input.type='checkbox';input.name='advisorIds';input.value=person.id;
    const avatar=node('span','avatar',initials(person.name));avatar.setAttribute('aria-hidden','true');
    const copy=node('span','advisor-choice-copy');copy.append(node('strong','',advisorLabel(person)),node('small','','Orientador(a) aprovado(a)'));
    input.addEventListener('change',()=>{if(input.checked&&selected.size>=3){input.checked=false;count.textContent='Selecione no máximo 3 orientadores.';return;}if(input.checked)selected.add(person.id);else selected.delete(person.id);paint();});
    controls.push({input,label});label.append(input,avatar,copy);list.append(label);
  });
  const empty=node('p','empty-small',advisors.length?'Nenhum orientador com esse nome.':'A coordenação ainda não liberou orientadores para convite.');empty.hidden=Boolean(advisors.length);
  search.addEventListener('input',()=>{const query=normalize(search.value).trim();let visible=0;controls.forEach(({label})=>{label.hidden=Boolean(query&&!label.dataset.search.includes(query));if(!label.hidden)visible++;});empty.hidden=visible>0;});
  field.append(search,count,list,empty,node('p','advisor-picker-help','Você também pode escolher depois, em Convites.'));
  return {field,selectedIds:()=>[...selected]};
}
function showCreateGroup() {
  if(!canCreateGroup()){render();return;}
  const name=makeField('Nome do grupo','name',{required:true,minLength:2,maxLength:100,placeholder:'Ex.: Equipe EcoPlant'});
  const topic=makeField(state.role==='student'?'Tema da proposta':'Tema da pesquisa','topic',{required:true,minLength:3,maxLength:240,placeholder:'O que vocês querem investigar?'});
  const description=makeField('Descrição da proposta','description',{type:'textarea',maxLength:3000,placeholder:'Problema, objetivo e ideia inicial da pesquisa.'});
  const year=makeField('Edição do INIC','year',{type:'number',value:2027,required:true,min:2027,max:2100});
  const student=state.role==='student';const picker=student?buildAdvisorPicker():null;
  const advisor=student?null:makeField('Orientador(a) desejado(a)','advisorId',{options:[{value:'',label:state.role==='advisor'?'Eu serei o(a) orientador(a)':'Escolher depois'},...state.advisors.map(a=>({value:a.id,label:advisorLabel(a)}))],help:state.role==='coordinator'&&isListedAdvisor()?'Escolha seu nome para orientar este novo grupo. Outros orientadores receberão um convite e precisam aceitar.':'O orientador receberá um convite e será vinculado após aceitar.'});
  openForm({title:student?'Nova proposta de TCC':'Novo grupo',kicker:'INIC 2027',fields:[name.label,topic.label,description.label,year.label,picker?.field||advisor.label,node('p','dialog-note','O grupo recebe um cronograma inicial editável. Confira as datas com seu orientador.')],submit:'Criar grupo',busy:student?'Criando proposta e enviando convites…':'Criando grupo…',handler:async data=>{
    const advisorIds=picker?.selectedIds()||[];
    if(advisorIds.length>3)throw new Error('Selecione no máximo 3 orientadores.');
    if(student&&advisorIds.some(id=>!state.advisors.some(person=>person.id===id)))throw new Error('A lista de orientadores mudou. Revise os nomes antes de enviar.');
    const payload={name:String(data.get('name')).trim(),topic:String(data.get('topic')).trim(),description:String(data.get('description')).trim(),year:Number(data.get('year')),...(student?{advisorIds}:{advisorId:String(data.get('advisorId')||'')})};
    const id=await service.createGroup(payload);
    notice(student&&advisorIds.length?'Proposta criada. Os orientadores selecionados receberam um convite.':'Grupo criado. Convide os integrantes e organize as entregas.');navigate('group',typeof id==='string'?id:id.id);
  }});
}
function showEditGroup(group) {
  if(!canEditGroup(group))return;
  const fields=[makeField('Nome do grupo','name',{value:group.name,required:true,minLength:2,maxLength:100}).label,makeField('Tema da pesquisa','topic',{value:group.topic,required:true,minLength:3,maxLength:240}).label,makeField('Descrição','description',{value:group.description||'',type:'textarea',maxLength:3000}).label,makeField('Edição do INIC','year',{type:'number',value:group.year||2027,min:2027,max:2100,required:true}).label];
  openForm({title:'Editar grupo',fields,handler:async data=>{
    const current=state.groups.find(item=>item.id===group.id);
    if(!current||!canEditGroup(current))throw new Error('Você não pode editar este grupo no momento.');
    await service.updateGroup(group.id,{name:String(data.get('name')).trim(),topic:String(data.get('topic')).trim(),description:String(data.get('description')).trim(),year:Number(data.get('year'))});notice('Informações do grupo atualizadas.');
  }});
}
function showDeleteGroup(group) {
  if(!isGroupManager(group))return;
  const description=node('p','dialog-note',`Excluir “${group.name}” remove permanentemente o grupo, seus integrantes, entregas, mensagens, convites e avaliações. As contas cadastradas continuam disponíveis.`);
  const warning=node('p','deletion-warning',group.status==='deleting'?'A exclusão foi iniciada. Confirme para concluir a remoção dos dados restantes.':'Esta ação não pode ser desfeita.');
  openForm({title:group.status==='deleting'?'Concluir exclusão do grupo':'Excluir grupo',fields:[description,warning],submit:'Excluir grupo',danger:true,handler:async()=>{
    requireManagedGroup(group.id,true);
    await service.deleteGroup(group.id);
    groupListeners.get(group.id)?.();groupListeners.delete(group.id);groupAccess.delete(group.id);groupData.delete(group.id);
    state.groups=state.groups.filter(item=>item.id!==group.id);
    state.invitations=state.invitations.filter(item=>item.groupId!==group.id);
    navigate('groups');notice('Grupo excluído.');
  }});
}
function showEditMember(group,uid) {
  if(!canManageMembers(group)||!group.members?.[uid])return;
  const name=makeField('Nome no grupo','name',{value:memberName(group,uid),required:true,minLength:2,maxLength:100,help:'Este nome identifica a pessoa neste grupo e nas mensagens.'});
  openForm({title:'Editar integrante',fields:[name.label],submit:'Salvar nome',handler:async data=>{
    const current=requireManagedGroup(group.id);
    if(!current.members?.[uid])throw new Error('Esta pessoa não faz mais parte do grupo.');
    await service.updateMember(group.id,uid,{name:String(data.get('name')).trim()});notice('Nome do integrante atualizado neste grupo.');
  }});
}
function showRemoveMember(group,uid) {
  if(!canManageMembers(group)||!group.members?.[uid])return;
  openForm({title:'Remover integrante',fields:[node('p','dialog-note',`Remover ${memberName(group,uid)} da lista de integrantes de “${group.name}” também exclui sua avaliação individual neste grupo. A conta da pessoa permanece cadastrada.`)],submit:'Remover integrante',danger:true,handler:async()=>{
    const current=requireManagedGroup(group.id);
    if(!current.members?.[uid])throw new Error('Esta pessoa não faz mais parte do grupo.');
    await service.removeMember(group.id,uid);notice('Integrante removido do grupo.');
  }});
}
function hasEvaluation(evaluation) { return Boolean(evaluation&&typeof evaluation.score==='number'&&Number.isFinite(evaluation.score)); }
function evaluationScore(evaluation) { return hasEvaluation(evaluation)?new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:2}).format(evaluation.score):'Sem nota'; }
function showEvaluationForm(group,uid = '') {
  if(!canManageMembers(group)||(uid&&!group.members?.[uid]))return;
  const data=groupData.get(group.id)||{};
  const evaluation=uid?(data.memberEvaluations||[]).find(item=>item.id===uid):data.groupEvaluation;
  const score=makeField('Nota de 0 a 10','score',{type:'number',required:true,min:0,max:10,step:'any',inputMode:'decimal',value:hasEvaluation(evaluation)?evaluation.score:'',placeholder:'Ex.: 8,5'});
  const feedback=makeField('Comentário (opcional)','feedback',{type:'textarea',maxLength:3000,value:evaluation?.feedback||'',placeholder:'Registre o retorno sobre o trabalho.'});
  openForm({title:uid?`Nota de ${memberName(group,uid)}`:'Nota do grupo',kicker:'AVALIAÇÕES',fields:[node('p','dialog-note',uid?'Esta nota será visível para este integrante, o orientador e a coordenação.':'Esta nota e o comentário ficam disponíveis para todo o grupo.'),score.label,feedback.label],submit:'Salvar avaliação',handler:async form=>{
    const current=requireManagedGroup(group.id);
    if(uid&&!current.members?.[uid])throw new Error('Esta pessoa não faz mais parte do grupo.');
    const raw=String(form.get('score')??'').trim();const value=Number(raw.replace(',','.'));
    if(!raw||!Number.isFinite(value)||value<0||value>10)throw new Error('Informe uma nota entre 0 e 10.');
    const payload={score:value,feedback:String(form.get('feedback')||'').trim()};
    if(uid)await service.saveMemberEvaluation(group.id,uid,payload);else await service.saveEvaluation(group.id,payload);
    notice('Avaliação salva.');
  }});
}
function showDeleteEvaluation(group,uid = '') {
  if(!canManageMembers(group)||(uid&&!group.members?.[uid]))return;
  const title=uid?`a nota de ${memberName(group,uid)}`:'a nota do grupo';
  openForm({title:'Excluir avaliação',fields:[node('p','dialog-note',`Excluir ${title} remove a nota e o comentário. Você poderá registrar uma nova avaliação depois.`)],submit:'Excluir avaliação',danger:true,handler:async()=>{
    const current=requireManagedGroup(group.id);
    if(uid&&!current.members?.[uid])throw new Error('Esta pessoa não faz mais parte do grupo.');
    await service.deleteEvaluation(group.id,uid||undefined);notice('Avaliação excluída.');
  }});
}
function evaluationCard(group,title,evaluation,uid = '') {
  const card=node('article','panel evaluation-card');const head=node('div','evaluation-heading');head.append(node('h3','',title));
  const score=node('p',`evaluation-score${hasEvaluation(evaluation)?'':' is-empty'}`,evaluationScore(evaluation));
  if(hasEvaluation(evaluation))score.append(node('span','',' / 10'));
  card.append(head,score);
  if(evaluation?.feedback)card.append(node('p','evaluation-feedback',evaluation.feedback));
  else card.append(node('p','evaluation-feedback is-empty',hasEvaluation(evaluation)?'Sem comentário.':'A avaliação ainda não foi registrada.'));
  if(hasEvaluation(evaluation)){
    const by=evaluation.evaluatorName?`Por ${evaluation.evaluatorName}`:'';
    const date=typeof evaluation.updatedAt==='number'?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(evaluation.updatedAt)):'';
    if(by||date)card.append(node('p','evaluation-audit',[by,date].filter(Boolean).join(' · ')));
  }
  if(canManageMembers(group)){
    const actions=node('div','evaluation-actions');
    actions.append(button(hasEvaluation(evaluation)?'Editar nota':'Lançar nota','button secondary compact',()=>showEvaluationForm(group,uid)));
    if(hasEvaluation(evaluation))actions.append(button('Excluir nota','text-button destructive-action',()=>showDeleteEvaluation(group,uid)));
    card.append(actions);
  }
  return card;
}
function renderGroupEvaluations(group,data) {
  const fragment=document.createDocumentFragment();
  fragment.append(heading('Avaliações',isGroupManager(group)?'Registre a nota do trabalho e as avaliações individuais.':'Consulte a avaliação do grupo e sua nota individual.'));
  if(data.error){
    fragment.append(emptyState('Não foi possível carregar as avaliações',errorText(data.error),[button('Tentar novamente','button secondary',()=>{groupListeners.get(group.id)?.();groupListeners.delete(group.id);groupAccess.delete(group.id);groupData.delete(group.id);syncGroupListeners();render();})]));
    $('#group-panel').replaceChildren(fragment);return;
  }
  const groupGrade=evaluationCard(group,'Nota do grupo',data.groupEvaluation);groupGrade.classList.add('evaluation-card--group');fragment.append(groupGrade);
  const section=node('section','individual-evaluations');section.append(node('h3','',isGroupManager(group)?'Notas individuais':'Sua nota individual'));
  const members=isGroupManager(group)?Object.keys(group.members||{}).filter(uid=>group.members[uid]):group.members?.[state.user.uid]?[state.user.uid]:[];
  const grid=node('div','evaluation-grid');
  members.sort((a,b)=>memberName(group,a).localeCompare(memberName(group,b),'pt-BR')).forEach(uid=>{
    const evaluation=(data.memberEvaluations||[]).find(item=>item.id===uid);
    grid.append(evaluationCard(group,uid===state.user.uid?'Você':memberName(group,uid),evaluation,uid));
  });
  if(members.length)section.append(grid);else section.append(node('p','empty-small','Não há integrantes para avaliar.'));
  fragment.append(section);$('#group-panel').replaceChildren(fragment);
}
function pendingAdvisorInvitations(groupId) {
  return state.invitations.filter(invite=>invite.groupId===groupId&&invite.type==='advisor'&&invite.status==='pending');
}
function showInviteForm(initialGroupId = '', initialType = 'member') {
  const manageable=state.groups.filter(canManage);
  if(!manageable.length){
    if(canCreateGroup())openForm({title:'Crie um grupo para enviar convites',fields:[node('p','dialog-note',state.role==='advisor'?'Você ainda não orienta um grupo. Crie o grupo e convide os estudantes pelo e-mail. Convites para orientar aparecem na aba Recebidos.':'Crie a proposta e depois convide integrantes ou orientadores.')],submit:'Criar grupo',handler:()=>{showCreateGroup();return false;}});
    return;
  }
  const group=makeField('Grupo','groupId',{required:true,value:initialGroupId||manageable[0].id,options:manageable.map(g=>({value:g.id,label:g.name}))});
  const type=makeField('Convidar como','type',{value:initialType,options:[{value:'member',label:'Estudante / integrante'},{value:'advisor',label:'Orientador(a)'}]});
  const advisor=makeField('Orientador(a) cadastrado(a)','toUid',{options:[{value:'',label:'Selecione o orientador'},...state.advisors.map(p=>({value:p.id,label:advisorLabel(p)}))]});advisor.label.hidden=true;
  const email=makeField('E-mail de quem receberá','toEmail',{type:'email',required:true,maxLength:254,placeholder:'email@exemplo.com',help:'A pessoa verá o convite ao entrar com este mesmo e-mail.'});
  const guidance=node('p','form-note');guidance.id='advisor-invite-guidance';guidance.setAttribute('role','status');guidance.setAttribute('aria-live','polite');guidance.hidden=true;
  advisor.field.setAttribute('aria-describedby',guidance.id);
  function toggle(){
    const isAdvisor=type.field.value==='advisor';const current=state.groups.find(item=>item.id===group.field.value);const pending=pendingAdvisorInvitations(group.field.value);
    const blocked=isAdvisor&&(Boolean(current?.advisorId)||pending.length>=3);
    advisor.label.hidden=!isAdvisor;advisor.field.disabled=blocked;advisor.field.required=isAdvisor&&!blocked;email.label.hidden=isAdvisor;email.field.required=!isAdvisor;email.field.disabled=isAdvisor;guidance.hidden=!isAdvisor;
    guidance.textContent=current?.advisorId?'Este grupo já tem orientador(a). Novos convites de orientação não estão disponíveis.':pending.length>=3?'Há 3 convites de orientação aguardando resposta. Aguarde uma resposta antes de enviar outro convite.':`Envie convites para até 3 orientadores ao mesmo tempo. O primeiro aceite confirma a orientação. ${pending.length} de 3 convites pendentes.`;
    [...advisor.field.options].forEach(option=>{option.disabled=Boolean(option.value&&pending.some(invite=>invite.toUid===option.value));});
    if(advisor.field.selectedOptions?.[0]?.disabled)advisor.field.value='';
    const submit=$('#dialog-submit');if(submit&&!submit.hasAttribute('aria-busy'))submit.disabled=blocked;
  }
  type.field.addEventListener('change',toggle);group.field.addEventListener('change',toggle);
  openForm({title:'Convidar para o grupo',fields:[group.label,type.label,advisor.label,email.label,guidance,node('p','dialog-note','O destinatário precisa aceitar o convite para entrar no grupo.')],submit:'Enviar convite',busy:'Enviando convite…',handler:async data=>{
    const groupId=String(data.get('groupId'));const inviteType=String(data.get('type'));const current=state.groups.find(item=>item.id===groupId);
    if(!current||!canManage(current))throw new Error('Você não pode enviar convites para este grupo.');
    const toUid=String(data.get('toUid')||'');
    if(inviteType==='advisor'){
      if(current.advisorId)throw new Error('Este grupo já tem orientador(a). Novos convites de orientação não estão disponíveis.');
      const pending=pendingAdvisorInvitations(groupId);
      if(pending.length>=3)throw new Error('Este grupo já tem 3 convites de orientação aguardando resposta.');
      if(pending.some(invite=>invite.toUid===toUid))throw new Error('Este orientador já tem um convite pendente para o grupo.');
      if(!toUid||!state.advisors.some(person=>person.id===toUid))throw new Error('Selecione um orientador aprovado pela coordenação.');
    }
    await service.invite({groupId,type:inviteType,...(inviteType==='advisor'?{toUid}:{toEmail:String(data.get('toEmail')||'').trim()})});notice('Convite enviado. Acompanhe os convites pendentes na aba Enviados.');
  }});toggle();
}

function renderGroup() {
  const group=state.groups.find(g=>g.id===currentRoute.groupId);
  if(!group){$('#view-content').replaceChildren(emptyState('Este grupo não está disponível','Você precisa fazer parte do grupo, orientá-lo ou ter acesso da coordenação. Se acabou de aceitar um convite, aguarde a sincronização.',[link('Meus grupos','#grupos','button secondary'),link('Ver convites','#convites','button primary')]));renderedKey='';return;}
  if(group.status==='deleting'){
    const actions=[link('Voltar aos grupos','#grupos','button secondary')];
    if(isGroupManager(group))actions.push(button('Concluir exclusão','button danger-button',()=>showDeleteGroup(group)));
    $('#view-content').replaceChildren(emptyState('Exclusão em andamento',`O grupo “${group.name}” está sendo removido. ${isGroupManager(group)?'Se a exclusão foi interrompida, use “Concluir exclusão” para tentar novamente.':'A coordenação ou o orientador concluirá a exclusão.'}`,actions));renderedKey='';return;
  }
  const key=`group/${group.id}/${currentRoute.tab}`;
  if(renderedKey!==key){
    const fragment=document.createDocumentFragment();fragment.append(link('Voltar aos grupos','#grupos','back-link'));
    const head=node('div','group-detail-header');const copy=node('div');copy.append(node('span','badge',`INIC ${group.year||2027}`),node('h2','',group.name),node('p','',group.topic||'Tema em definição'));copy.id='group-heading-copy';
    const meta=node('div','group-summary-meta');meta.id='group-meta';copy.append(meta);head.append(copy);
    const actions=node('div','actions');actions.id='group-header-actions';head.append(actions);fragment.append(head);
    const prog=node('div','group-progress-panel');prog.id='group-progress';fragment.append(prog);
    const tabs=node('nav','group-tabs');tabs.setAttribute('aria-label','Áreas do grupo');[['overview','Resumo'],['tasks','Entregas'],['messages','Mensagens'],['evaluations','Avaliações']].forEach(([tab,label])=>{const a=link(label,routeHref('group',group.id,tab));if(tab===currentRoute.tab)a.setAttribute('aria-current','page');tabs.append(a);});fragment.append(tabs);
    const content=node('div');content.id='group-panel';fragment.append(content);$('#view-content').replaceChildren(fragment);renderedKey=key;
    if(currentRoute.tab==='messages')buildMessagesView(group);
  }
  const copy=$('#group-heading-copy');copy.querySelector('.badge').textContent=`INIC ${group.year||2027}`;copy.querySelector('h2').textContent=group.name;copy.querySelector('p').textContent=group.topic||'Tema em definição';
  $('#group-meta').replaceChildren(node('span','',`Orientação: ${advisorName(group)}`),node('span','',`${Object.values(group.members||{}).filter(Boolean).length} integrante(s)`));
  const actions=$('#group-header-actions');actions.replaceChildren();
  if(canEditGroup(group))actions.append(button('Editar grupo','button secondary compact',()=>showEditGroup(group)));
  if(canManage(group))actions.append(button('Convidar +','button primary compact',()=>showInviteForm(group.id)));
  if(isGroupManager(group))actions.append(button('Excluir grupo','text-button destructive-action',()=>showDeleteGroup(group)));
  const data=groupData.get(group.id);const tasks=data?.tasks||[];const prog=$('#group-progress');prog.replaceChildren(progressBlock(tasks,'Progresso da pesquisa'),node('p','',`${tasks.filter(t=>t.completed).length} de ${tasks.length} entregas concluídas.`));
  const late=tasks.filter(t=>statusOf(t).key==='late').length;prog.append(node('div','due-summary',late?`${late} ${late===1?'etapa precisa':'etapas precisam'} de atenção.`:'Um passo de cada vez. Mantenha o grupo em dia.'));
  if(!data){$('#group-panel').replaceChildren(loadingPanel('Carregando as entregas e mensagens do grupo…'));return;}
  if(currentRoute.tab==='overview')renderGroupOverview(group,tasks);
  else if(currentRoute.tab==='tasks')renderGroupTasks(group,tasks);
  else if(currentRoute.tab==='evaluations')renderGroupEvaluations(group,data);
  else {if(!$('#messages-list'))buildMessagesView(group);paintMessages(data.messages||[]);}
}
function renderGroupOverview(group,tasks) {
  const columns=node('div','two-columns');const about=node('section','panel');const top=node('div','panel-heading');top.append(node('h3','','Sobre a pesquisa'));about.append(top,node('p','group-description',group.description||'Registre aqui a ideia, o problema e o caminho que o grupo quer investigar.'));
  const facts=node('div','group-facts');[['Tema',group.topic||'Em definição'],['Orientação',advisorName(group)],['Edição',String(group.year||2027)]].forEach(([label,value])=>{const line=node('div');line.append(node('span','',`${label}: `),node('strong','',value));facts.append(line);});about.append(facts);
  const team=node('section','panel');const teamHeading=node('div','panel-heading');teamHeading.append(node('h3','','Pessoas do grupo'));team.append(teamHeading);
  if(group.advisorId){const row=node('div','team-member');row.append(node('span','avatar',initials(advisorName(group))));const info=node('div','member-info');info.append(node('strong','',advisorName(group)),node('p','','Orientador(a)'));row.append(info);team.append(row);}
  Object.entries(group.members||{}).filter(([,member])=>member).forEach(([uid])=>{
    const name=memberName(group,uid);const row=node('div','team-member');row.append(node('span','avatar',initials(name)));const info=node('div','member-info');info.append(node('strong','',name),node('p','',uid===group.createdBy?'Criou o grupo':'Integrante'));row.append(info);
    if(canManageMembers(group)){
      const actions=node('div','member-actions');
      const edit=button('Editar','button secondary compact',()=>showEditMember(group,uid));edit.setAttribute('aria-label',`Editar nome de ${name} neste grupo`);
      const grade=button('Nota','button secondary compact',()=>showEvaluationForm(group,uid));grade.setAttribute('aria-label',`Avaliar ${name}`);
      const remove=button('Remover','text-button destructive-action',()=>showRemoveMember(group,uid));remove.setAttribute('aria-label',`Remover ${name} deste grupo`);
      actions.append(edit,grade,remove);row.append(actions);
    }
    team.append(row);
  });
  if(!Object.values(group.members||{}).some(Boolean))team.append(node('p','empty-small','Ainda não há integrantes cadastrados. Envie um convite para começar.'));
  columns.append(about,team);
  const fragment=document.createDocumentFragment();
  const confirmation=groupData.get(group.id)?.advisorConfirmation;
  if(confirmation&&group.advisorId===confirmation.advisorUid){
    const confirmed=node('section','panel advisor-confirmation');confirmed.setAttribute('aria-label','Orientação confirmada');
    confirmed.append(node('span','badge success','Orientação confirmada'),node('h3','',`${confirmation.advisorName||advisorName(group)} aceitou orientar este grupo.`),node('p','',`Aceite registrado em ${agreementTimestamp(confirmation.createdAt)}.`));fragment.append(confirmed);
  }else if(!group.advisorId&&group.advisorRequestPolicy==='first-accept-v1'){
    const pending=pendingAdvisorInvitations(group.id);const waiting=node('section','panel advisor-confirmation is-waiting');
    waiting.append(node('span','badge warning','Escolha de orientação'),node('h3','',pending.length?`${pending.length} convite(s) aguardando resposta`:'Convide um(a) orientador(a)'),node('p','','Envie convites para até 3 orientadores ao mesmo tempo. O primeiro aceite confirma a orientação.'));
    if(canManage(group))waiting.append(button('Convidar orientador(a)','button secondary compact',()=>showInviteForm(group.id,'advisor')));fragment.append(waiting);
  }
  fragment.append(columns);
  const next=tasks.filter(t=>!t.completed).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,3);
  const nextPanel=node('section','panel mt-24');const head=node('div','panel-heading');head.append(node('h3','','Próximos passos'),link('Todas as entregas',routeHref('group',group.id,'tasks')));nextPanel.append(head);
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
  const form=node('form','message-compose');const label=node('label','field','Sua mensagem');const textarea=node('textarea');textarea.id='message-draft';textarea.name='message';textarea.maxLength=2000;textarea.required=true;textarea.placeholder='Escreva uma pergunta ou compartilhe o próximo passo…';textarea.rows=2;label.append(textarea);const send=node('button','button primary','Enviar');send.type='submit';form.append(label,send);panel.append(form,node('p','compose-footer','Máximo de 2.000 caracteres. Ctrl + Enter também envia. Mensagens ficam visíveis aos integrantes, ao orientador e à coordenação.'));
  form.addEventListener('submit',async event=>{
    event.preventDefault();const text=textarea.value.trim();if(!text)return;
    const ok=await action(send,()=>service.sendMessage(group.id,text));if(ok){textarea.value='';textarea.focus();}
  });
  textarea.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();form.requestSubmit();}});
  $('#group-panel').replaceChildren(panel);
}
function paintMessages(messages) {
  const list=$('#messages-list');if(!list)return;
  const group=state.groups.find(item=>item.id===currentRoute.groupId);
  const senderName=message=>message.senderId===state.user.uid?'Você':group?.memberNames?.[message.senderId]||message.senderName||'Participante';
  const signature=JSON.stringify(messages.map(message=>[message.id,message.createdAt,senderName(message)]));
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
      item.append(node('span','message-author',senderName(message)),node('p','message-text',message.text),node('time','message-time',messageTime(message.createdAt)));
      list.append(item);
    }
    const author=item.querySelector('.message-author');
    if(author.textContent!==senderName(message))author.textContent=senderName(message);
    const time=item.querySelector('time');
    const formatted=messageTime(message.createdAt);
    if(time.textContent!==formatted)time.textContent=formatted;
    if(typeof message.createdAt==='number')time.dateTime=new Date(message.createdAt).toISOString();
  });
  if(!sorted.length)list.append(node('p','empty-small','A conversa ainda não começou. Compartilhe uma pergunta ou combine a próxima entrega com o grupo.'));
  if(wasNearEnd)list.scrollTop=list.scrollHeight;
}

function renderInvitations() {
  const fragment=document.createDocumentFragment();fragment.append(heading('Convites',state.role==='advisor'?'Envie convites aos estudantes e responda aos convites para orientar grupos.':'Convide pessoas para seu grupo e responda aos convites recebidos.',[button('Enviar convite +','button primary',()=>showInviteForm())]));
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
      const actions=node('div','invitation-card__actions');const accept=button('Aceitar convite','button primary',event=>action(event.currentTarget,()=>service.respondInvitation(invite.id,true),invite.type==='advisor'?'Orientação confirmada. O grupo está disponível em Meus grupos.':'Convite aceito. O grupo está disponível em Meus grupos.',invite.type==='advisor'?'Confirmando orientação…':'Entrando no grupo…'));const requiresVerification=Boolean(invite.toEmail&&!state.user.emailVerified);const requiresApproval=invite.type==='advisor'&&!['advisor','coordinator'].includes(state.role);if(requiresVerification||requiresApproval){accept.disabled=true;accept.title=requiresApproval?'Aguarde a aprovação da coordenação para orientar.':'Confirme seu e-mail primeiro';}
      actions.append(accept,button('Recusar','button secondary',()=>confirmAction('Recusar convite?',`O convite para “${invite.groupName||'este grupo'}” será recusado. Um novo convite poderá ser enviado depois.`,async()=>{await service.respondInvitation(invite.id,false);notice('Convite recusado.');},'Recusar convite')));card.append(actions);
      if(requiresVerification)card.append(node('p','invitation-card__notice','Confirme seu e-mail para aceitar. Use “Enviar confirmação” no aviso acima.'));
      if(requiresApproval)card.append(node('p','invitation-card__notice','A coordenação precisa aprovar seu perfil de professor(a) antes do aceite.'));
    } else if(invite.status==='pending')card.append(node('p','invitation-card__notice','Aguardando o aceite do destinatário.'));
    grid.append(card);
  });fragment.append(grid);return fragment;
}

function renderCalendar() {
  const fragment=document.createDocumentFragment();
  const events=state.groups.flatMap(group=>(groupData.get(group.id)?.events||[]).map(event=>({...event,groupId:group.id,groupName:group.name})));
  const calendar=createCalendarView({groups:state.groups.filter(group=>group.status!=='deleting'),tasks:allTasks(),events,canManageGroup:group=>canManageTasks(group),onAddEvent:(groupId,date)=>showEventForm(groupId,date),onEditEvent:event=>showEventForm(event.groupId,event.date,event),onTask:showCalendarTask,onNotice:notice,initialDate:new Date(2027,0,1,12)});
  fragment.append(calendar,buildNotificationPanel());
  return fragment;
}
function showEventForm(initialGroupId='',initialDate=todayString(),event=null) {
  const manageable=state.groups.filter(canManageTasks);
  if(!manageable.length){notice('A coordenação e os orientadores podem criar eventos dos grupos.','info');return;}
  const initial=manageable.find(group=>group.id===initialGroupId)||manageable[0];
  const group=makeField('Grupo','groupId',{value:initial.id,required:true,options:manageable.map(item=>({value:item.id,label:item.name}))});
  if(event)group.field.disabled=true;
  const title=makeField('Nome do evento','title',{value:event?.title||'',required:true,minLength:2,maxLength:160,placeholder:'Ex.: Encontro de orientação'});
  const date=makeField('Data do evento','date',{value:event?.date||initialDate||todayString(),required:true,type:'date'});
  const description=makeField('Descrição (opcional)','description',{value:event?.description||'',type:'textarea',maxLength:2000,placeholder:'Local, materiais ou orientações para o encontro.'});
  const fields=[group.label,title.label,date.label,description.label,node('p','dialog-note','O evento será visível aos integrantes, ao orientador e à coordenação. Feriados oficiais são apenas de consulta.')];
  if(event)fields.push(button('Excluir evento','text-button destructive-action',()=>confirmAction('Excluir evento?',`“${event.title}” será removido do calendário deste grupo.`,async()=>{requireManagedGroup(event.groupId);await service.deleteEvent(event.groupId,event.id);notice('Evento excluído.');},'Excluir evento')));
  openForm({title:event?'Editar evento':'Novo evento',fields,submit:event?'Salvar evento':'Criar evento',handler:async data=>{
    const groupId=event?.groupId||String(data.get('groupId'));requireManagedGroup(groupId);
    const payload={title:String(data.get('title')).trim(),date:String(data.get('date')),description:String(data.get('description')||'').trim()};
    if(event)await service.updateEvent(groupId,event.id,payload);else await service.addEvent({groupId,...payload});
    notice(event?'Evento atualizado.':'Evento criado no calendário do grupo.');
  }});
}
function buildNotificationPanel() {
  const uid=state.user?.uid;const panel=node('section','panel notification-panel');
  const copy=node('div');copy.append(node('h3','','Avisos neste aparelho'),node('p','','Receba lembretes de entregas e avisos dos grupos. O envio pode levar alguns minutos.'));
  const status=node('p','notification-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Verificando disponibilidade…';
  const control=button('Ativar avisos','button secondary compact',async()=>{
    if(control.disabled||notificationsBusy||state.user?.uid!==uid)return;
    notificationsBusy=true;
    control.disabled=true;control.setAttribute('aria-busy','true');
    let result;
    try {
      result=control.dataset.enabled==='true'?await disableNotifications(service,state.user):await enableNotifications(service,state.user);
      if(state.user?.uid!==uid||!panel.isConnected)return;
      paint(result);
    }catch(error){if(state.user?.uid===uid&&panel.isConnected)status.textContent=errorText(error);}
    finally{
      notificationsBusy=false;control.removeAttribute('aria-busy');
      if(state.user?.uid===uid){if(panel.isConnected){if(result)paint(result);else control.disabled=false;}else if(currentRoute.view==='calendar')scheduleRender();}
    }
  });control.disabled=true;
  function paint(result){status.textContent=result.message||'';control.dataset.enabled=String(Boolean(result.enabled));control.textContent=result.enabled?'Desativar avisos':result.setupRequired?'Ativação pendente':'Ativar avisos';control.disabled=notificationsBusy||(!result.enabled&&(!result.supported||Boolean(result.needsInstall)||Boolean(result.setupRequired)||result.permission==='denied'));}
  const actions=node('div','notification-actions');actions.append(control,link('Como instalar no celular','instalar.html','text-button'));panel.append(copy,status,actions);
  getNotificationState().then(result=>{if(state.user?.uid===uid&&panel.isConnected)paint(result);}).catch(()=>{if(panel.isConnected){status.textContent='Não foi possível verificar os avisos. Atualize a página para tentar novamente.';control.disabled=false;}});
  return panel;
}
function showCalendarTask(task) {
  const detail=node('div','dialog-details');detail.append(node('strong','',task.title),node('span','',`Grupo: ${task.groupName}`),node('span','',`Prazo: ${dateLabel(task.dueDate,true)}`),node('span','',`Situação: ${statusOf(task).text}`));
  const fields=[detail];const group=state.groups.find(item=>item.id===task.groupId);
  if(group&&canManageTasks(group))fields.push(button('Alterar prazo ou nome da entrega','button secondary',()=>showTaskForm(group,task)));
  openForm({title:'Entrega do cronograma',fields,submit:'Abrir grupo',handler:()=>{navigate('group',task.groupId,'tasks');}});
}
function renderAdmin() {
  const fragment=document.createDocumentFragment();const intro=node('section','admin-intro');intro.append(node('h3','','Acompanhe toda a escola'),node('p','','A coordenação tem acesso a todos os grupos, orientadores, cronogramas e conversas. Aprove os cadastros de professores e abra um grupo para acompanhar cada pesquisa.'));fragment.append(intro);
  intro.append(link('Consultar contratos assinados','#termo','button secondary compact'));
  const pending=state.users.filter(p=>p.requestedRole==='advisor'&&p.role!=='advisor'&&p.role!=='coordinator');const panel=node('section','panel');const head=node('div','panel-heading');head.append(node('h3','','Solicitações de orientadores'),node('span','badge',pending.length));panel.append(head);
  pending.forEach(person=>{const row=node('div','approval-row');const copy=node('div');copy.append(node('strong','',person.name||'Professor(a)'),node('p','',person.email||''));row.append(copy,button('Aprovar acesso','button primary compact',event=>action(event.currentTarget,()=>service.approveAdvisor(person.id),'Acesso de orientador liberado.')));panel.append(row);});
  if(!pending.length)panel.append(node('p','empty-small','Nenhum cadastro de orientador aguardando aprovação.'));fragment.append(panel);
  const usersPanel=node('section','panel mt-24');const usersHead=node('div','panel-heading');usersHead.append(node('h3','','Pessoas cadastradas'),node('span','count-label',`${state.users.length} conta(s)`));usersPanel.append(usersHead);
  const wrap=node('div','user-table-wrap');const table=node('table','user-table');const thead=node('thead');const header=node('tr');['Nome','E-mail','Série','Acesso'].forEach(label=>header.append(node('th','',label)));thead.append(header);table.append(thead);const tbody=node('tbody');
  state.users.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','pt-BR')).forEach(person=>{
    const row=node('tr');const name=node('td');name.append(node('strong','',person.name||'Sem nome'));row.append(name,node('td','',person.email||'—'),node('td','',person.year||'—'));const role=node('td');
    if(person.role==='coordinator')role.append(node('span','badge',isListedAdvisor(person.id)?'Coordenação e orientação':'Coordenação'));
    else {
      const select=node('select');select.setAttribute('aria-label',`Acesso de ${person.name||person.email||'usuário'}`);[{value:'student',label:'Estudante'},{value:'advisor',label:'Orientador(a)'}].forEach(item=>{const option=node('option','',item.label);option.value=item.value;select.append(option);});select.value=person.role||'student';select.addEventListener('change',async()=>{const oldRole=person.role||'student';const newRole=select.value;const ok=await action(select,()=>service.setUserRole(person.id,newRole),'Permissão atualizada.');if(!ok)select.value=oldRole;});role.append(select);
    }row.append(role);tbody.append(row);
  });table.append(tbody);wrap.append(table);usersPanel.append(wrap);fragment.append(usersPanel,supportCard());return fragment;
}

window.addEventListener('offline',()=>{const banner=$('#connection-banner');banner.textContent='Você está sem conexão. Grupos, convites e mensagens serão atualizados quando a conexão voltar.';banner.hidden=false;});
window.addEventListener('online',()=>{$('#connection-banner').hidden=true;});

readRoute();
try {
  service = await import('./firebase-service.js?v=20261105-9');
  authStatus('Verificando acesso…','',true);
  sessionUnsubscribe = service.onSession(sessionChanged) || (() => {});
} catch(error) {
  authStatus('Não foi possível conectar ao serviço de acesso. Confira a conexão e recarregue esta página.','error');
  const retry=button('Tentar novamente','text-button',()=>location.reload());$('#auth-status').append(document.createTextNode(' '),retry);
}
window.addEventListener('pagehide',event=>{if(!event.persisted){sessionUnsubscribe();appUnsubscribe();agreementsUnsubscribe();for(const unsubscribe of groupListeners.values())unsubscribe();}});
