'use strict';

import { createCoordinationDashboard } from './coordination-dashboard.js?v=20261112-13';
import { createProposalEditor, createProposalView } from './tcc-proposal.js?v=20261112-8';
import { createCalendarView } from './calendar.js?v=20261113-1';
import { getNotificationState, enableNotifications, disableNotifications } from './notifications.js?v=20261105-8';
import { createArticleEditor } from './article-editor.js?v=20261112-4';
import { createCommunityView, participantStatus } from './community.js?v=20261112-9';

const $ = selector => document.querySelector(selector);
const roleNames = {student:'Estudante',advisor:'Orientador(a)',coordinator:'Coordenação'};
const SCHOOL_YEARS = ['1º ano','2º ano','3º ano'];
const hashes = {dashboard:'inicio',people:'pessoas',groups:'grupos',invitations:'convites',calendar:'calendario',agreements:'termo',admin:'coordenacao',indicators:'indicadores'};
const state = {user:null,profile:null,role:'student',users:[],usersReady:false,usersError:null,people:[],peopleReady:false,peopleError:null,advisors:[],groups:[],invitations:[],orientationNotices:[],ready:false,error:null,archived:false,archive:null};
const groupData = new Map();
const groupListeners = new Map();
const groupAccess = new Map();
const articleEditors = new Map();
const seenAdvisorConfirmations = new Set();
const invitationSchoolYears = new Map();
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
let agreementReviewsReady = false;
let agreementReviewError = null;
let agreementSignaturesReady = false;
let agreementSignatureError = null;
let advisorAgreementGroupId = '';
let agreementReviewBaselineReady = false;
const seenAgreementReviews = new Set();
let agreementSearch = '';
let agreementFilter = 'all';
let agreementUploadBusy = false;
let notificationsBusy = false;
let proposalDraft = null;
const AGREEMENT_YEAR = 2027;
const AGREEMENT_LIMIT = 3 * 1024 * 1024;
let currentRoute = {view:'dashboard',groupId:'',tab:'overview'};
let renderedKey = '';
let dialogHandler = null;
let dialogGuard = null;
let dialogCleanup = null;
let dialogLiveUpdate = null;
let dialogVersion = 0;
let dialogAccess = 'academic';
let dialogBusyText = 'Salvando…';
let groupSearch = '';
let groupAdvisorFilter = 'all';
let taskFilter = 'all';
let invitationFilter = 'incoming';
let userSearch = '';
let userFilter = 'all';
let userPage = 1;
const USERS_PER_PAGE = 10;
let coordinationDashboard = null;
let communityView = null;
let calendarViewState = {};
let orientationNoticeBaselineReady=false;
const seenOrientationNotices=new Set();
const proposalUrls=new Set();
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
function filterButton(label, icon, selected, handler, controls) {
  const control=button('','filter-choice',handler);
  control.setAttribute('aria-pressed',String(selected));
  if(controls)control.setAttribute('aria-controls',controls);
  control.append(peopleToolIcon(icon),node('span','filter-label',label));
  return control;
}
function filterSearch(input) {
  const field=node('label','filter-search');
  field.append(peopleToolIcon('search'),input);
  return field;
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
function isGroupManager(group) { return !state.archived && (state.role === 'coordinator' || (state.role === 'advisor' && group.advisorId === state.user?.uid)); }
function canManage(group) { return group.status !== 'deleting' && (isGroupManager(group) || (state.role === 'student' && group.createdBy === state.user?.uid && group.members?.[state.user?.uid])); }
function canEditGroup(group) { return group.status !== 'deleting' && !state.archived && (isGroupManager(group) || (state.role === 'student' && group.createdBy === state.user?.uid && group.members?.[state.user?.uid]===true)); }
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
  if(state.archived)return false;
  if(!state.user || !state.ready || !state.profile || state.profile.onboardingRequired === true || isPendingAdvisor())return false;
  return state.role === 'advisor' || state.role === 'coordinator' || (requiresAgreement() && agreementSatisfied());
}
function canBrowseCommunity() { return Boolean(!state.archived&&state.user&&state.ready&&state.profile&&state.profile.onboardingRequired!==true&&!isPendingAdvisor()); }
function isSchoolYear(value) { return SCHOOL_YEARS.includes(value); }
function studentGroupId() {return state.role==='student'?(state.people.find(person=>person.id===state.user?.uid)?.groupId||state.groups.find(group=>group.members?.[state.user?.uid]===true)?.id||''):'';}
function canCreateGroup() { return canAccessAcademic()&&(state.role!=='student'||isSchoolYear(state.profile?.year)&&state.peopleReady&&!state.peopleError&&!studentGroupId()); }
function canPrepareProposal() { return Boolean(canBrowseCommunity() && state.role === 'student' && isSchoolYear(state.profile?.year) && state.peopleReady && !state.peopleError && !studentGroupId()); }
function canInviteToGroup(group) {return Boolean(canAccessAcademic()&&group&&group.status!=='deleting'&&group.status!=='archived'&&group.archived!==true&&(isGroupManager(group)||state.role==='student'&&group.members?.[state.user?.uid]===true));}
function canUseAgreements() { return !state.archived && (state.role === 'coordinator' || state.role === 'advisor' || (state.role === 'student' && state.profile?.requestedRole !== 'advisor')); }
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
function notice(text, kind = 'success', persistent = false, options = {}) {
  if(state.archived)return;
  clearTimeout(noticeTimer);
  const target = $('#app-notice');
  const variant=['success','error','info'].includes(kind)?kind:'info';
  const dismiss=()=>{clearTimeout(noticeTimer);target.hidden=true;};
  const header=node('div','notice-card-header');
  const icon=node('span','notice-card-icon',variant==='error'?'!':variant==='success'?'✓':'i');
  icon.setAttribute('aria-hidden','true');
  const title=node('strong','notice-card-title',options.title||(variant==='error'?'Confira esta informação':variant==='success'?'Tudo certo':'Meu INIC'));
  const close=button('×','notice-card-close',dismiss);close.setAttribute('aria-label','Fechar notificação');
  header.append(icon,title,close);
  const actions=node('div','notice-card-actions');
  if(typeof options.href==='string'&&/^#(?:grupo\/[^/]+\/(?:overview|messages)|convites|grupos|termo)$/.test(options.href)){
    const destination=link(options.label||'Ver detalhes',options.href,'button primary');destination.addEventListener('click',dismiss);actions.append(destination);
  } else actions.append(button('Entendi','button primary',dismiss));
  target.replaceChildren(header,node('p','notice-card-message',text),actions);
  target.className = `notice ${variant}`;
  target.setAttribute('role',variant==='error'?'alert':'status');
  target.setAttribute('aria-live',variant==='error'?'assertive':'polite');
  target.setAttribute('aria-atomic','true');
  target.hidden = false;
  if (!persistent) noticeTimer = setTimeout(dismiss,9000);
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
  if(currentRoute.view==='group'&&currentRoute.tab==='article')articleEditors.get(currentRoute.groupId)?.editor.flush();
  const parts = location.hash.replace(/^#/,'').split('/');
  if (parts[0] === 'grupo' && parts[1]) {
    let id;
    try {id = decodeURIComponent(parts[1]);} catch {id = '';}
    currentRoute = {view:'group',groupId:id,tab:['overview','tasks','article','messages','evaluations'].includes(parts[2]) ? parts[2] : 'overview'};
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
function cleanupDialog() {const cleanup=dialogCleanup;dialogCleanup=null;dialogLiveUpdate=null;cleanup?.();}
function openForm({title,kicker = 'MEU INIC',fields,submit = 'Salvar',danger = false,access = 'academic',busy = 'Salvando…',guard=null,cleanup=null,onUpdate=null,handler}) {
  if(state.user && access === 'academic' && !canAccessAcademic()){render();return;}
  if(access === 'draft' && !canPrepareProposal()){render();return;}
  if(access === 'admin' && (state.role !== 'coordinator'||state.archived)){render();return;}
  if(state.archived){render();return;}
  if(access === 'review' && state.role !== 'coordinator'){render();return;}
  if(access === 'signature' && !['advisor','coordinator'].includes(state.role)){render();return;}
  if(guard&&!guard()){render();return;}
  cleanupDialog();dialogCleanup=cleanup;dialogLiveUpdate=onUpdate;
  dialogVersion++;
  dialogGuard=guard;
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
$('#form-dialog').addEventListener('close',()=>{if(!$('#form-dialog').open){cleanupDialog();revokeProposalUrls();$('#dialog-fields').replaceChildren();}});
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
  finally {if(version===dialogVersion){submit.disabled = false;submit.removeAttribute('aria-busy');status.classList.remove('is-loading');status.removeAttribute('aria-busy');if(status.querySelector('.book-loader'))status.replaceChildren();if($('#form-dialog').open)dialogLiveUpdate?.();}}
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
  await Promise.all([...articleEditors.values()].map(({editor})=>editor.flush()));
  if([...articleEditors.values()].some(({editor})=>editor.hasUnsaved())&&!window.confirm('Ainda há texto do artigo sem confirmação de salvamento. Sair agora descarta esse texto pendente. Deseja sair mesmo assim?'))return;
  try {await disableNotifications(service,state.user);} catch(error) {console.warn('Avisos:',error.code||'desativação indisponível');}
  await service.logout();
}));
$('#profile-button').addEventListener('click',showProfileForm);

function showProfileForm() {
  if(state.archived){render();return;}
  const name = makeField('Nome completo','name',{value:myName(),required:true,minLength:2,maxLength:100,autocomplete:'name'});
  const year = makeField('Série escolar','year',{value:state.profile?.year || '',options:[{value:'',label:'Não se aplica'},...SCHOOL_YEARS],help:state.role==='student'?'Sua série define quais colegas podem participar do seu grupo. Ela não pode mudar enquanto você estiver em um grupo.':''});
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
  pruneArticleEditors();
  if(!canAccessAcademic()){
    for(const unsubscribe of groupListeners.values())unsubscribe();
    groupListeners.clear();groupAccess.clear();groupData.clear();
    if(dialogAccess==='academic' && $('#form-dialog').open){dialogVersion++;dialogHandler=null;$('#form-dialog').close();}
    return;
  }
  const readableGroups=state.groups.filter(group=>state.role!=='advisor'||group.advisorId===state.user.uid);
  const allowed = new Set(readableGroups.map(g => g.id));
  for (const [id,unsubscribe] of groupListeners) if (!allowed.has(id)) {unsubscribe();groupListeners.delete(id);groupAccess.delete(id);groupData.delete(id);}
  for(const id of groupAccess.keys())if(!allowed.has(id)){groupAccess.delete(id);groupData.delete(id);}
  readableGroups.forEach(group => {
    const accessKey=`${state.user.uid}/${state.role}/${state.role==='student'?'':group.advisorId||''}/${Boolean(group.members?.[state.user.uid])}/${group.status||''}/${group.year||2027}`;
    if (groupListeners.has(group.id)&&groupAccess.get(group.id)===accessKey) return;
    groupListeners.get(group.id)?.();groupListeners.delete(group.id);groupData.delete(group.id);groupAccess.set(group.id,accessKey);
    if(group.status==='deleting'||group.status==='archived'||group.archived===true)return;
    groupListeners.set(group.id,() => {});
    const subscribeUid=state.user.uid;const subscribeSession=sessionVersion;let confirmationBaselineReady=false;
    const unsubscribe = service.subscribeGroup(group.id,data => {
      if(subscribeSession!==sessionVersion||state.user?.uid!==subscribeUid||groupAccess.get(group.id)!==accessKey||!canAccessAcademic())return;
      const currentGroup=state.groups.find(item=>item.id===group.id);
      if(!currentGroup||currentGroup.status==='deleting')return;
      const evaluations=Array.isArray(data.memberEvaluations)?data.memberEvaluations:[];
      groupData.set(group.id,{tasks:data.tasks || [],messages:data.messages || [],events:data.events || [],groupEvaluation:data.error?null:data.groupEvaluation||null,advisorConfirmation:data.error?null:data.advisorConfirmation||null,memberEvaluations:data.error?[]:isGroupManager(currentGroup)?evaluations:evaluations.filter(item=>item.id===state.user.uid),inicResults:data.inicResults||[],inicResultsReady:data.inicResultsReady===true,inicResultsError:data.inicResultsError||null,error:data.error});
      const confirmation=data.error?null:data.advisorConfirmation;
      if(data.advisorConfirmationReady===true&&!data.error){
        if(confirmation&&state.role==='student'&&confirmation.studentUid===state.user.uid){
          const key=`${group.id}/${confirmation.invitationId||confirmation.createdAt}/${confirmation.advisorUid}`;
          if(!seenAdvisorConfirmations.has(key)){seenAdvisorConfirmations.add(key);if(confirmationBaselineReady)notice(`${confirmation.advisorName||advisorName(currentGroup)} aceitou orientar o grupo “${currentGroup.name}”.`,'success',true,{title:'Orientação confirmada',href:routeHref('group',currentGroup.id),label:'Ver meu grupo'});}
        }
        confirmationBaselineReady=true;
      }
      if (data.error&&!state.archived) notice(errorText(data.error),'error',true);
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
  calendarViewState = {};
  for(const {editor}of articleEditors.values())editor.destroy();articleEditors.clear();
  destroyIndicators();destroyCommunity();revokeProposalUrls();orientationNoticeBaselineReady=false;seenOrientationNotices.clear();
  const sessionId=++sessionVersion;invitationSchoolYears.clear();seenAdvisorConfirmations.clear();seenAgreementReviews.clear();agreementReviewsReady=false;agreementReviewError=null;agreementReviewBaselineReady=false;agreementSignaturesReady=false;agreementSignatureError=null;advisorAgreementGroupId='';groupAdvisorFilter='all';userSearch='';userFilter='all';userPage=1;
  proposalDraft=null;
  cleanupDialog();$('#dialog-fields').replaceChildren();
  dialogVersion++;dialogHandler=null;dialogGuard=null;$('#form-dialog').close();
  appUnsubscribe();
  appUnsubscribe = () => {};
  agreementsUnsubscribe();agreementsUnsubscribe = () => {};agreementScope='';agreementSubscription++;
  agreements=[];agreementsReady=false;agreementsError=null;agreementRequirement={ready:false,fulfilled:false};agreementUploadBusy=false;agreementSearch='';agreementFilter='all';
  for (const unsubscribe of groupListeners.values()) unsubscribe();
  groupListeners.clear();groupAccess.clear();groupData.clear();
  Object.assign(state,{user,profile:null,role:'student',users:[],usersReady:false,usersError:null,people:[],peopleReady:false,peopleError:null,advisors:[],groups:[],invitations:[],orientationNotices:[],ready:false,error:null,archived:false,archive:null});
  renderedKey = '';
  $('#view-content').replaceChildren();
  $('.skip-link').href = user ? '#workspace-main' : '#main';
  $('#auth-screen').hidden = Boolean(user);
  $('#app-screen').hidden = !user;
  $('#app-notice').hidden = true;
  $('#verification-notice')?.remove();
  if (!user) {authStatus('');return;}
  render();
  appUnsubscribe = service.subscribeApp(user,data => {
    if(sessionId!==sessionVersion||state.user?.uid!==user.uid)return;
    state.archived = data.archived === true;
    state.archive = data.archive || null;
    state.profile = data.profile || null;
    state.role = data.role || 'student';
    state.usersReady = !state.archived&&state.role==='coordinator'&&data.usersReady===true;
    state.usersError = !state.archived&&state.role==='coordinator'?(data.usersError||null):null;
    state.users = state.usersReady&&!state.usersError?(data.users||[]):[];
    state.peopleReady = !state.archived&&data.peopleReady===true;
    state.peopleError = !state.archived?(data.peopleError||null):null;
    state.people = state.peopleReady&&!state.peopleError?(data.people||[]):[];
    state.advisors = data.advisors || [];
    state.groups = data.groups || [];
    state.invitations = data.invitations || [];
    state.orientationNotices = data.orientationNotices || [];
    state.error = data.error || null;
    state.ready = true;
    if(state.archived){
      state.profile=null;state.users=[];state.people=[];state.peopleReady=false;state.advisors=[];state.groups=[];state.invitations=[];state.orientationNotices=[];proposalDraft=null;destroyCommunity();
      cleanupDialog();revokeProposalUrls();$('#dialog-fields').replaceChildren();
      dialogVersion++;dialogHandler=null;$('#form-dialog').close();$('#app-notice').hidden=true;$('#verification-notice')?.remove();
    }
    if(!canManagePeople()){
      userPage=1;
      if($('#admin-user-list')){renderedKey='';$('#view-content').replaceChildren(loadingPanel('Atualizando acesso…'));}
    }else if(!state.usersReady||state.usersError){paintManagedUsers();paintPendingAdvisors();}
    if(coordinationDashboard&&(state.role!=='coordinator'||!canAccessAcademic())){destroyIndicators();$('#view-content').replaceChildren(loadingPanel('Atualizando acesso…'));}
    else coordinationDashboard?.updateState(state);
    if(communityView&&!canBrowseCommunity())destroyCommunity();
    else communityView?.update(communityOptions());
    if(data.orientationNoticesError)orientationNoticeBaselineReady=false;
    else if(!state.archived&&data.orientationNoticesReady===true){const fresh=[];state.orientationNotices.forEach(item=>{const key=`${item.id}/${item.createdAt}`;if(!seenOrientationNotices.has(key)){seenOrientationNotices.add(key);if(!item.read)fresh.push(item);}});if(orientationNoticeBaselineReady&&fresh.length){const newest=fresh.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];notice(orientationNoticeCopy(newest),'info',true,{title:'Aviso de orientação',href:'#convites',label:'Ver aviso'});}orientationNoticeBaselineReady=true;}
    if(dialogGuard&&!dialogGuard()&&$('#form-dialog').open){dialogVersion++;dialogHandler=null;dialogGuard=null;$('#form-dialog').close();}
    if($('#form-dialog').open)dialogLiveUpdate?.();
    if(dialogAccess==='admin'&&(state.role!=='coordinator'||state.archived)&&$('#form-dialog').open){dialogVersion++;dialogHandler=null;$('#form-dialog').close();}
    if(dialogAccess==='signature'&&!['advisor','coordinator'].includes(state.role)&&$('#form-dialog').open){dialogVersion++;dialogHandler=null;$('#form-dialog').close();}
    if(dialogAccess==='review'&&state.role!=='coordinator'&&$('#form-dialog').open){dialogVersion++;dialogHandler=null;$('#form-dialog').close();}
    if(!canPrepareProposal()){
      proposalDraft=null;
      if(dialogAccess==='draft'&&$('#form-dialog').open){dialogVersion++;dialogHandler=null;$('#form-dialog').close();}
    }
    if (data.error&&!state.archived) notice(errorText(data.error),'error',true);
    syncAgreementSubscription();
    syncGroupListeners();
    if(!state.archived)verificationNotice();
    if(state.archived)render();else scheduleRender();
  }) || (() => {});
}

function updateShell() {
  if(!$('#indicators-nav')){const entry=link('','#indicadores');entry.id='indicators-nav';entry.dataset.route='indicators';const icon=node('span','','▥');icon.setAttribute('aria-hidden','true');entry.append(icon,node('span','','Indicadores INIC'));$('#admin-nav').before(entry);}
  const route = currentRoute.view === 'group' ? 'groups' : currentRoute.view;
  const titles = {dashboard:'Visão geral',people:'Comunidade INIC',groups:state.role==='coordinator'?'Todos os grupos':'Meus grupos',invitations:'Convites',calendar:'Calendário',agreements:state.role==='coordinator'?'Termos e assinaturas':state.role==='advisor'?'Termos para assinar':'Meu termo',admin:'Coordenação',indicators:'Indicadores INIC',group:'Meu grupo'};
  $('#view-title').textContent = titles[currentRoute.view] || 'Visão geral';
  $('#view-kicker').textContent = state.role === 'coordinator' ? 'ACOMPANHAMENTO DA ESCOLA' : 'SEU ESPAÇO DE PESQUISA';
  $('#profile-button').hidden=state.archived;
  $('#user-name').textContent = myName();
  $('#user-role').textContent = state.role==='coordinator'&&isListedAdvisor()?'Coordenação e orientação':roleNames[state.role] || roleNames.student;
  $('#user-avatar').textContent = initials(myName());
  $('#admin-nav').hidden = state.role !== 'coordinator';
  $('#mobile-admin-nav').hidden = state.role !== 'coordinator';
  $('#agreements-nav').hidden = !canUseAgreements();
  $('#mobile-agreements-nav').hidden = !canUseAgreements();
  $('#agreements-nav-label').textContent = state.role === 'coordinator' ? 'Termos e assinaturas' : state.role==='advisor'?'Termos para assinar':'Meu termo';
  $('#mobile-agreements-label').textContent = state.role === 'coordinator' || state.role==='advisor' ? 'Termos' : 'Termo';
  const groupsLabel=state.role==='coordinator'?'Todos os grupos':'Meus grupos';
  document.querySelectorAll('[data-route="groups"]').forEach(item=>{
    const label=item.querySelector('span:not([aria-hidden])');
    if(label)label.textContent=groupsLabel;
    else {const text=[...item.childNodes].find(child=>child.nodeType===3);if(text)text.textContent=groupsLabel;}
  });
  const unreadNotices=(state.orientationNotices||[]).filter(item=>!item.read).length;
  $('#invite-badge').hidden = !(pendingInvitations().length+unreadNotices);
  $('#invite-badge').textContent = pendingInvitations().length+unreadNotices;
  $('#pending-advisor-note').hidden = !isPendingAdvisor();
  const academic=canAccessAcademic();
  document.querySelectorAll('[data-route]').forEach(a => {
    const permitted=!state.archived&&(a.dataset.route==='people'?canBrowseCommunity():a.dataset.route==='agreements'?canUseAgreements()&&state.profile?.onboardingRequired!==true:['admin','indicators'].includes(a.dataset.route)?state.role==='coordinator':academic);
    a.hidden=!permitted;
    if(a.dataset.route===route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  $('.mobile-nav').classList.toggle('is-restricted',!academic);
  $('.mobile-nav').hidden=![...document.querySelectorAll('.mobile-nav [data-route]')].some(item=>!item.hidden);
}
function render() {
  pruneArticleEditors();
  if (!state.user) return;
  if(currentRoute.view!=='indicators')destroyIndicators();
  if(currentRoute.view!=='people')destroyCommunity();
  if(state.archived){renderAccountArchived();return;}
  if (['admin','indicators'].includes(currentRoute.view) && state.role !== 'coordinator' && state.ready) {navigate('dashboard');return;}
  updateShell();
  if (!state.ready) {$('#view-content').replaceChildren(loadingPanel('Carregando seus grupos e convites…'));return;}
  if (state.profile?.onboardingRequired === true) {renderGoogleOnboarding();return;}
  if(!state.profile){$('#view-content').replaceChildren(loadingPanel('Carregando seu cadastro…'));return;}
  if(isPendingAdvisor()){renderAdvisorPending();return;}
  if(currentRoute.view==='people'&&canBrowseCommunity()){renderPeople();return;}
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
  if (currentRoute.view === 'indicators') {renderIndicators();return;}
  if (currentRoute.view === 'people') {renderPeople();return;}
  if(currentRoute.view==='admin'&&renderedKey==='admin'&&$('#admin-user-list')){paintManagedUsers();paintPendingAdvisors();return;}
  renderedKey = currentRoute.view;
  const views = {dashboard:renderDashboard,groups:renderGroups,invitations:renderInvitations,calendar:renderCalendar,admin:renderAdmin};
  $('#view-content').replaceChildren((views[currentRoute.view] || renderDashboard)());
}
function renderAccountArchived() {
  updateShell();
  $('#view-title').textContent='Cadastro excluído';$('#view-kicker').textContent='ACESSO À PLATAFORMA';
  $('#pending-advisor-note').hidden=true;
  const panel=node('section','panel account-archived');
  panel.append(node('span','badge warning','Acesso bloqueado'),node('h2','','O acesso desta conta está bloqueado.'),node('p','','Procure a coordenação para conferir a situação do seu cadastro.'),button('Sair da conta','button primary',()=>$('#logout').click()));
  $('#view-content').replaceChildren(panel);renderedKey='archived';
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
  const advisor=state.role==='advisor';
  const assigned=state.groups.filter(group=>group.status!=='deleting'&&group.advisorId===state.user?.uid);
  if(advisor&&!assigned.some(group=>group.id===advisorAgreementGroupId))advisorAgreementGroupId=assigned[0]?.id||'';
  const scope=state.user&&state.profile&&state.profile.onboardingRequired!==true&&canUseAgreements()?`${state.user.uid}/${state.role}/${AGREEMENT_YEAR}${advisor?'/'+(advisorAgreementGroupId||'none'):''}`:'';
  if(scope===agreementScope)return;
  if(dialogAccess==='signature'&&$('#form-dialog').open){dialogVersion++;dialogHandler=null;$('#form-dialog').close();}
  agreementsUnsubscribe();agreementsUnsubscribe=()=>{};agreementScope=scope;
  const version=++agreementSubscription;
  agreements=[];agreementsReady=false;agreementsError=null;agreementRequirement={ready:false,fulfilled:false};agreementUploadBusy=false;agreementReviewsReady=false;agreementReviewError=null;agreementReviewBaselineReady=false;agreementSignaturesReady=false;agreementSignatureError=null;
  if(!scope)return;
  if(advisor&&!advisorAgreementGroupId){agreementsReady=true;agreementReviewsReady=true;agreementSignaturesReady=true;agreementRequirement={ready:true,fulfilled:true};return;}
  if(typeof service?.subscribeAgreements!=='function'){agreementsError=new Error('O envio de termos não está disponível. Atualize a página.');agreementsReady=true;return;}
  const subscribe=advisor?callback=>service.subscribeAdvisorAgreements(advisorAgreementGroupId,AGREEMENT_YEAR,callback):callback=>service.subscribeAgreements(AGREEMENT_YEAR,callback);
  if(advisor&&typeof service.subscribeAdvisorAgreements!=='function'){agreementsError=new Error('Atualize a página para consultar os termos dos seus grupos.');agreementsReady=true;return;}
  agreementsUnsubscribe=subscribe(data=>{
    if(version!==agreementSubscription||scope!==agreementScope)return;
    agreementsError=data?.error||null;
    agreements=agreementsError?[]:(data?.agreements||[]).filter(item=>state.role==='coordinator'||(state.role==='advisor'?Boolean(state.groups.find(group=>group.id===advisorAgreementGroupId&&group.status!=='deleting'&&group.advisorId===state.user?.uid)?.members?.[item.uid||item.id]):(item.uid||item.id)===state.user?.uid));
    agreementRequirement={ready:!agreementsError&&data?.requirement?.ready===true,fulfilled:!agreementsError&&data?.requirement?.ready===true&&data?.requirement?.fulfilled===true};
    agreementsReady=Boolean(agreementsError||agreementRequirement.ready);
    agreementSignatureError=data?.signatureError||null;
    agreementSignaturesReady=!agreementsError&&!agreementSignatureError&&data?.signatureReady===true;
    agreementReviewError=data?.reviewError||null;
    agreementReviewsReady=!agreementsError&&!agreementReviewError&&data?.reviewReady===true;
    if(agreementsError)agreementReviewBaselineReady=false;
    if(requiresAgreement()&&agreementReviewsReady&&agreementRequirement.ready){
      const own=agreements.find(record=>(record.uid||record.id)===state.user?.uid),review=currentAgreementReview(own);
      if(review){
        const key=`${own.uid||own.id}/${own.uploadVersion||own.uploadedAt}/${review.status}/${review.reviewedAt}`;
        if(!seenAgreementReviews.has(key)){seenAgreementReviews.add(key);if(agreementReviewBaselineReady)notice(review.status==='approved'?'Seu termo foi conferido pela coordenação. Está tudo certo.':`Seu termo foi devolvido. Pendência: ${review.reason}`,review.status==='approved'?'success':'info',true,{title:review.status==='approved'?'Termo conferido':'Ajuste seu termo',href:'#termo',label:'Ver meu termo'});}
      }
      agreementReviewBaselineReady=true;
    }
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
    const result=state.role==='advisor'?await service.downloadSigningAgreement(record.uid||record.id,{year:AGREEMENT_YEAR,role:'advisor',groupId:advisorAgreementGroupId}):await service.downloadAgreement(record.uid||record.id,AGREEMENT_YEAR);
    if(state.user?.uid!==uid||version!==agreementSubscription)return;
    if(!(result?.blob instanceof Blob))throw new Error('O arquivo não pôde ser aberto. Tente novamente.');
    const url=URL.createObjectURL(result.blob);
    const download=link('',url);download.download=result.filename||record.filename||'Termo_INIC_2027.pdf';document.body.append(download);download.click();download.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch(error){if(state.user?.uid===uid&&version===agreementSubscription)notice(errorText(error),'error',true);}
  finally{if(control){control.disabled=false;control.removeAttribute('aria-busy');}}
}
function buildAgreementUpload() {
  const panel=node('section','panel agreement-upload');panel.append(node('span','term-step','02 · ENVIO'),node('h3','','Enviar termo assinado'));
  const form=node('form','agreement-upload-form');form.id='agreement-upload-form';
  const label=node('label','field','Arquivo assinado');const input=node('input');input.type='file';input.name='agreement';input.required=true;input.accept='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';label.append(input,node('small','','Envie um único arquivo. O PDF preenchido já reúne o termo e as assinaturas do aluno e do responsável. PDF, JPG ou PNG · até 3 MB.'));
  const status=node('p','form-status');status.id='agreement-upload-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const submit=node('button','button primary','Enviar para a coordenação');submit.type='submit';submit.disabled=agreementUploadBusy;input.disabled=agreementUploadBusy;
  form.append(label,status,submit,node('p','agreement-privacy','Acesso privado: você e a coordenação.'));
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
      status.dataset.awaitingConfirmation=String(!agreementSatisfied());status.textContent=agreementSatisfied()?'Arquivo salvo. Aguardando conferência da coordenação.':'Termo enviado. Confirmando o arquivo salvo para a coordenação…';input.value='';notice(agreementSatisfied()?'Arquivo enviado. Aguardando conferência da coordenação.':'Termo assinado enviado. Aguarde a confirmação do arquivo salvo.');
    }catch(error){if(state.user?.uid===uid&&version===agreementSubscription){status.classList.add('error');status.textContent=errorText(error);}}
    finally{
      if(state.user?.uid===uid&&version===agreementSubscription)agreementUploadBusy=false;
      submit.disabled=false;input.disabled=false;submit.removeAttribute('aria-busy');
    }
  });
  panel.append(form);return panel;
}
function proposalCallout() {
  const panel=node('section','proposal-callout');panel.id='proposal-callout';
  const copy=node('div','proposal-callout-copy');copy.append(node('span','term-step','SEU GRUPO'),node('h3','','Monte sua equipe e envie os convites.'),node('p','','Anexe a proposta e escolha colegas e até 3 professores cadastrados para convidar.'));
  const actions=node('div','proposal-callout-actions');const control=button('Montar meu grupo','button orange',()=>canCreateGroup()?showCreateGroup():showProposalDraft());control.id='proposal-callout-button';
  const status=node('p','proposal-callout-status');status.id='proposal-callout-status';actions.append(control,status);panel.append(copy,actions);return panel;
}
function paintProposalCallout() {
  const control=$('#proposal-callout-button'),status=$('#proposal-callout-status');if(!control||!status)return;
  const draft=proposalDraft?.uid===state.user?.uid;
  const copy=$('#proposal-callout .proposal-callout-copy');if(copy){copy.querySelector('h3').textContent='Monte sua equipe e envie os convites.';copy.querySelector('p').textContent='Estudantes de todos os anos podem escolher até 3 professores. Anexe sua proposta e selecione colegas disponíveis na comunidade.';}
  control.textContent=canCreateGroup()?(draft?'Enviar proposta e convites':'Montar meu grupo'):(draft?'Revisar meu grupo':'Montar meu grupo');
  status.textContent=canCreateGroup()?(draft?'Rascunho pronto. Revise e confirme o envio.':'Opcional · você também pode entrar por convite.'):(draft?'Rascunho salvo nesta sessão. Envie o termo para concluir.':'Você pode preparar agora. Envie o termo antes de concluir.');
  control.disabled=!canCreateGroup()&&!canPrepareProposal();
  if(studentGroupId())status.textContent='Você já participa de um grupo. Cada aluno pode participar de apenas um grupo.';
  else if(!state.peopleReady||state.peopleError)status.textContent=state.peopleError?'Não foi possível consultar seu grupo. Tente novamente em Pessoas.':'Consultando sua participação nos grupos…';
}
function renderAgreements() {
  const key=`agreements/${state.user.uid}/${state.role}/${state.role==='advisor'?advisorAgreementGroupId:''}`;
  if(renderedKey!==key){
    renderedKey=key;
    const fragment=document.createDocumentFragment();
    if(state.role==='coordinator')fragment.append(heading('Termos de aceite · 2027','Acompanhe os arquivos recebidos e as pendências.',[link('Visualizar o termo','conformidade.html','button secondary')]));
    if(state.role==='student'){
      const grid=node('div','term-action-grid');
      const download=node('section','term-download');download.append(node('span','term-step','01 · DOCUMENTO'),node('h2','','Termo de aceite · 2027'),node('p','','Preencha e desenhe as assinaturas do aluno e do responsável na tela, ou baixe o modelo para assinar no papel.'));
      const pdf=link('Baixar termo em PDF','documentos/Termo_Compromisso_INIC_2027_Maximus.pdf','button term-download-button');pdf.download='Termo_Compromisso_INIC_2027_Maximus.pdf';
      download.append(pdf,link('Preencher e assinar na tela','conformidade.html','term-preview-link term-fill-link'));
      const gate=node('p','agreement-gate agreement-gate--compact');gate.id='agreement-gate';gate.append(node('span','badge warning','Envio obrigatório'),document.createTextNode(' Envie o termo assinado para liberar sua participação.'));download.append(gate);
      grid.append(download,buildAgreementUpload());fragment.append(grid);
      const reviewSlot=node('div','agreement-review-slot');reviewSlot.id='agreement-review-slot';fragment.append(reviewSlot,proposalCallout());
    }else if(state.role==='advisor'){
      fragment.append(heading('Termos para assinar','Documentos conferidos dos estudantes dos seus grupos.'));
      const groups=state.groups.filter(group=>group.status!=='deleting'&&group.advisorId===state.user.uid);
      if(groups.length){const selector=makeField('Grupo orientado','advisorAgreementGroup',{value:advisorAgreementGroupId,options:groups.map(group=>({value:group.id,label:group.name}))});selector.label.classList.add('filter-field','agreement-group-filter');selector.field.setAttribute('aria-controls','agreement-list');selector.field.addEventListener('change',()=>{advisorAgreementGroupId=selector.field.value;agreementScope='';syncAgreementSubscription();renderedKey='';render();document.querySelector('[name="advisorAgreementGroup"]')?.focus({preventScroll:true});});fragment.append(selector.label);}
    }else{
      const summary=node('div','agreement-summary');summary.id='agreement-summary';summary.setAttribute('aria-live','polite');fragment.append(summary);
      const search=node('input');search.type='search';search.className='agreement-search';search.placeholder='Buscar estudante, e-mail ou arquivo';search.setAttribute('aria-label','Buscar contratos assinados');search.setAttribute('aria-controls','agreement-list');search.value=agreementSearch;search.addEventListener('input',()=>{agreementSearch=search.value;paintAgreements();});
      const filters=node('div','filter-pills agreement-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar termos');
      [['all','Todos','list'],['pending','Sem envio','pending'],['awaiting','Aguardando conferência','clock'],['approved','Conferidos','done'],['returned','Devolvidos','returned'],['received','Todos os enviados','incoming']].forEach(([value,label,icon])=>{const filter=filterButton(label,icon,value===agreementFilter,()=>{agreementFilter=value;paintAgreements();},'agreement-list');filter.dataset.agreementFilter=value;filters.append(filter);});fragment.append(filterSearch(search),filters);
    }
    const list=node('section','agreement-list');list.id='agreement-list';list.setAttribute('aria-label',state.role==='coordinator'?'Situação dos termos dos estudantes':state.role==='advisor'?'Termos aprovados do grupo orientado':'Seu arquivo enviado');fragment.append(list);
    $('#view-content').replaceChildren(fragment);
  }
  paintAgreements();
}
function currentAgreementReview(record) {
  const review=record?.review;
  if(!record||!review||!['approved','returned'].includes(review.status)||review.uploadedAt!==record.uploadedAt||String(review.uploadVersion||'')!==String(record.uploadVersion||'')||!Number.isFinite(review.reviewedAt)||review.reviewedAt<=0)return null;
  if(review.status==='returned'&&(typeof review.reason!=='string'||!review.reason.trim()))return null;
  return review;
}
function agreementReviewState(record) {
  if(!record)return {key:'pending',label:'Sem envio',badge:'warning'};
  if(agreementReviewError)return {key:'unavailable',label:'Conferência indisponível',badge:'warning'};
  if(!agreementReviewsReady)return {key:'loading',label:'Conferindo situação…',badge:''};
  const review=currentAgreementReview(record);
  return review?.status==='approved'?{key:'approved',label:'Conferido pela coordenação',badge:'success'}:review?.status==='returned'?{key:'returned',label:'Devolvido com pendência',badge:'warning'}:{key:'awaiting',label:'Aguardando conferência',badge:''};
}
function studentAgreementReviewCard() {
  if(!requiresAgreement()||!agreementSatisfied())return null;
  const record=agreements.find(item=>(item.uid||item.id)===state.user.uid);if(!record)return null;
  const status=agreementReviewState(record),review=agreementReviewsReady?currentAgreementReview(record):null;
  const card=node('section',`panel agreement-review-card agreement-review-card--${status.key}`);card.dataset.reviewStatus=status.key;card.setAttribute('aria-label','Resposta da coordenação sobre seu termo');
  const icon=node('span','agreement-review-icon',status.key==='approved'?'✓':status.key==='returned'?'!':'◷');icon.setAttribute('aria-hidden','true');
  const copy=node('div','agreement-review-copy');copy.append(node('span',`badge ${status.badge}`,status.label),node('h3','',status.key==='approved'?'Tudo certo com seu termo.':status.key==='returned'?'Seu termo precisa de um ajuste.':status.key==='loading'?'Conferindo a resposta da coordenação…':status.key==='unavailable'?'Não foi possível consultar a conferência.':'Arquivo enviado para a coordenação.'));
  if(status.key==='approved')copy.append(node('p','','A coordenação conferiu seu arquivo e confirmou o recebimento.'));
  else if(status.key==='returned'){
    copy.append(node('strong','agreement-review-pending-label','Pendência informada:'),node('p','agreement-review-reason',review.reason),node('p','','Corrija o documento e envie uma nova cópia para conferência.'));
  }else if(status.key==='awaiting')copy.append(node('p','','Aguarde a conferência. O resultado aparecerá aqui.'));
  else if(status.key==='unavailable')copy.append(node('p','','Seu arquivo permanece salvo. Tente consultar a resposta novamente.'));
  if(review)copy.append(node('p','agreement-review-audit',`${review.reviewerName||'Coordenação'} · ${agreementTimestamp(review.reviewedAt)}`));
  const actions=node('div','agreement-review-actions');
  if(status.key==='unavailable')actions.append(button('Tentar novamente','button secondary compact',()=>{agreementScope='';syncAgreementSubscription();render();}));
  else if(status.key==='returned')actions.append(button('Enviar nova cópia','button primary compact',()=>{navigate('agreements');queueMicrotask(()=>{$('#agreement-upload-form')?.scrollIntoView?.({behavior:'smooth',block:'center'});$('#agreement-upload-form input[type=file]')?.focus();});}));
  else if(currentRoute.view!=='agreements')actions.append(link('Ver meu termo','#termo','button secondary compact'));
  card.append(icon,copy);if(actions.childNodes.length)card.append(actions);return card;
}
function eligibleAdvisorGroups(record) {
  const uid=record?.uid||record?.id;
  return state.groups.filter(group=>group.status!=='deleting'&&group.advisorId===state.user?.uid&&group.members?.[uid]===true);
}
function currentAgreementSignatures(record) {
  const review=currentAgreementReview(record);if(review?.status!=='approved')return [];
  return (Array.isArray(record?.signatures)?record.signatures:[]).filter(signature=>signature&&['advisor','coordinator'].includes(signature.role)&&typeof signature.signerUid==='string'&&signature.signerUid&&typeof signature.signerName==='string'&&signature.signerName&&Number.isFinite(signature.signedAt)&&signature.signedAt>0&&signature.consent===true&&signature.uploadedAt===record.uploadedAt&&String(signature.uploadVersion||'')===String(record.uploadVersion||'')&&signature.reviewedAt===review.reviewedAt&&/^[a-f0-9]{64}$/i.test(signature.documentSha256||''));
}
function isAgreementOwnerArchived(record) { return Boolean(record&&state.users.some(person=>person.id===(record.uid||record.id)&&person.archived)); }
function canSignAgreement(record,role,groupId='') {
  if(isAgreementOwnerArchived(record)||state.archived)return false;
  if(!state.user||!agreementReviewsReady||!agreementSignaturesReady||currentAgreementReview(record)?.status!=='approved')return false;
  if(role==='coordinator')return state.role==='coordinator';
  return role==='advisor'&&['advisor','coordinator'].includes(state.role)&&eligibleAdvisorGroups(record).some(group=>!groupId||group.id===groupId);
}
function signingContext(record) {
  return state.role==='advisor'?{role:'advisor',groupId:advisorAgreementGroupId}:state.role==='coordinator'?{role:'coordinator',groupId:''}:{role:'student',groupId:''};
}
function agreementSignaturePanel(record) {
  const panel=node('section','agreement-signatures');panel.setAttribute('aria-label','Assinaturas eletrônicas do termo');
  panel.append(node('h4','','Assinaturas eletrônicas'));
  if(!agreementReviewsReady){panel.append(node('p','','Consulte a conferência atual para acessar as assinaturas.'));return panel;}
  if(!agreementSignaturesReady){panel.append(node('p','',agreementSignatureError?'Não foi possível consultar as assinaturas.':'Consultando assinaturas…'));if(agreementSignatureError)panel.append(button('Tentar novamente','text-button',()=>{agreementScope='';syncAgreementSubscription();render();}));return panel;}
  const signatures=currentAgreementSignatures(record),list=node('div','agreement-signature-list');
  for(const [role,label] of [['advisor','Professor orientador'],['coordinator','Coordenação']]){
    const row=node('div','agreement-signature-role');const signed=signatures.filter(signature=>signature.role===role);
    row.append(node('strong','',label));
    if(signed.length)signed.forEach(signature=>row.append(node('p','signature-signed',`✓ ${signature.signerName} · ${agreementTimestamp(signature.signedAt)}`)));
    else row.append(node('p','signature-awaiting','Aguardando assinatura'));
    list.append(row);
  }
  panel.append(list);
  const actions=node('div','agreement-signature-controls');
  for(const role of ['advisor','coordinator'])if(canSignAgreement(record,role)){
    const own=signatures.some(signature=>signature.role===role&&signature.signerUid===state.user.uid);
    const label=role==='coordinator'?'Assinar como coordenação':'Assinar como orientador(a)';
    const sign=button(own?(role==='coordinator'?'✓ Assinado como coordenação':'✓ Assinado como orientador(a)'):label,'button secondary compact',()=>openAgreementSignature(record,role));sign.dataset.agreementSign=role;sign.disabled=own;actions.append(sign);
  }
  if(signatures.length){const download=button('Baixar termo com assinaturas','button primary compact',event=>downloadSignedAgreement(record,event.currentTarget));download.dataset.agreementSignedPdf='true';actions.append(download);}
  panel.append(actions,node('p','signature-method-note','Assinatura eletrônica vinculada à conta autenticada do Meu INIC. O arquivo original permanece preservado.'));
  return panel;
}
function createSignatureDrawing() {
  const field=node('div','signature-drawing');field.append(node('p','field-label','Desenho da assinatura (opcional)'));
  const canvas=node('canvas','signature-canvas');canvas.width=700;canvas.height=210;canvas.setAttribute('aria-label','Área opcional para desenhar sua assinatura');
  let context=null;try{context=canvas.getContext?.('2d')||null;}catch{}let drawing=false,drawn=false;
  function reset(){if(context){context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.strokeStyle='#232540';context.lineWidth=2.4;context.lineCap='round';context.lineJoin='round';}drawn=false;}
  const position=event=>{const bounds=canvas.getBoundingClientRect();return {x:(event.clientX-bounds.left)*canvas.width/(bounds.width||canvas.width),y:(event.clientY-bounds.top)*canvas.height/(bounds.height||canvas.height)};};
  canvas.addEventListener('pointerdown',event=>{if(!context)return;event.preventDefault();drawing=true;const point=position(event);context.beginPath();context.moveTo(point.x,point.y);try{canvas.setPointerCapture?.(event.pointerId);}catch{}});
  canvas.addEventListener('pointermove',event=>{if(!drawing||!context)return;event.preventDefault();const point=position(event);context.lineTo(point.x,point.y);context.stroke();drawn=true;});
  for(const eventName of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(eventName,()=>{drawing=false;});
  reset();
  const clear=button('Limpar desenho','text-button',reset);clear.disabled=!context;
  const note=node('p','signature-method-note',context?'Use o mouse ou o dedo. O desenho é opcional; a confirmação abaixo é obrigatória.':'Você pode assinar com sua conta e a confirmação abaixo, mesmo sem desenhar.');
  field.append(canvas,clear,note);
  return {field,image(){if(!drawn)return '';const png=canvas.toDataURL?.('image/png')||'';if(!png.startsWith('data:image/png;base64,')||png.length>180000)throw new Error('Reduza o desenho ou use Limpar desenho para assinar com sua conta.');return png;}};
}
function openAgreementSignature(record,role) {
  if(!canSignAgreement(record,role))return;
  const actor=state.user.uid,session=sessionVersion,scope=agreementSubscription,uid=record.uid||record.id;
  const review=currentAgreementReview(record),expectedUploadVersion=record.uploadVersion||'',expectedUploadedAt=record.uploadedAt,expectedReviewedAt=review.reviewedAt;
  const details=node('div','dialog-details');details.append(node('strong','',record.ownerName||'Estudante'),node('span','',record.filename||'Termo assinado'),node('span','',role==='coordinator'?'Assinatura da coordenação':'Assinatura do professor orientador'));
  const account=makeField('Nome da conta que assina','signerName',{value:myName()});account.field.readOnly=true;
  const groups=role==='advisor'?eligibleAdvisorGroups(record):[];
  const group=groups.length>1?makeField('Grupo orientado','signatureGroupId',{value:state.role==='advisor'?advisorAgreementGroupId:groups[0].id,options:groups.map(item=>({value:item.id,label:item.name}))}):null;
  const drawing=createSignatureDrawing();
  const consent=node('label','agreement-signature-consent');const check=node('input');check.type='checkbox';check.name='consent';check.value='true';check.required=true;
  consent.append(check,node('span','',`Li este termo e confirmo minha assinatura eletrônica como ${role==='coordinator'?'coordenação':'professor(a) orientador(a)'}, com minha conta ${myName()}.`));
  const original=button('Baixar arquivo para leitura','button secondary compact',event=>downloadAgreement(record,event.currentTarget));
  openForm({title:'Assinar eletronicamente',kicker:'TERMO CONFERIDO · INIC 2027',access:'signature',guard:()=>canSignAgreement(record,role),fields:[details,original,account.label,...(group?[group.label]:[]),drawing.field,consent,node('p','dialog-note','A assinatura será registrada com sua conta, papel e data para esta versão do documento.')],submit:'Confirmar minha assinatura',busy:'Registrando sua assinatura…',handler:async data=>{
    if(state.user?.uid!==actor||sessionVersion!==session||agreementSubscription!==scope)return;
    const current=agreements.find(item=>(item.uid||item.id)===uid);const selectedGroup=role==='advisor'?(group?String(data.get('signatureGroupId')||''):groups[0]?.id||''):'';
    if(!current||current.uploadedAt!==expectedUploadedAt||String(current.uploadVersion||'')!==String(expectedUploadVersion)||currentAgreementReview(current)?.reviewedAt!==expectedReviewedAt)throw new Error('O termo ou a conferência mudou. Abra a versão atual antes de assinar.');
    if(!canSignAgreement(current,role,selectedGroup))throw new Error('Seu acesso a este termo mudou. Consulte seus grupos antes de assinar.');
    if(!data.has('consent'))throw new Error('Leia o termo e marque a confirmação para assinar eletronicamente.');
    if(currentAgreementSignatures(current).some(signature=>signature.role===role&&signature.signerUid===actor))throw new Error('Sua assinatura já está registrada nesta versão.');
    if(typeof service.signAgreement!=='function')throw new Error('Atualize a página para assinar eletronicamente.');
    const signaturePng=drawing.image();
    try{await service.signAgreement(uid,{year:AGREEMENT_YEAR,role,groupId:selectedGroup,expectedUploadVersion,expectedUploadedAt,expectedReviewedAt,consent:true,signaturePng});}
    catch(error){if(state.user?.uid===actor&&sessionVersion===session&&agreementSubscription===scope)throw error;return;}
    if(state.user?.uid!==actor||sessionVersion!==session||agreementSubscription!==scope)return;
    const latest=agreements.find(item=>(item.uid||item.id)===uid);
    if(!latest||currentAgreementReview(latest)?.status!=='approved'||currentAgreementReview(latest)?.reviewedAt!==expectedReviewedAt||latest.uploadedAt!==expectedUploadedAt||String(latest.uploadVersion||'')!==String(expectedUploadVersion))return;
    notice('Sua assinatura eletrônica foi registrada para esta versão do termo.','success',true,{title:'Assinatura registrada',href:'#termo',label:'Ver termo e assinaturas'});
  }});
}
async function downloadSignedAgreement(record,control) {
  const actor=state.user?.uid,session=sessionVersion,scope=agreementSubscription,uid=record.uid||record.id,review=currentAgreementReview(record);
  if(!actor||!agreementReviewsReady||review?.status!=='approved'||!agreementSignaturesReady||!currentAgreementSignatures(record).length)return;
  const current=()=>state.user?.uid===actor&&sessionVersion===session&&agreementSubscription===scope;
  const context=signingContext(record),oldLabel=control?.textContent;
  if(control){control.disabled=true;control.setAttribute('aria-busy','true');control.textContent='Preparando PDF…';}
  try{
    if(typeof service.downloadSigningAgreement!=='function')throw new Error('Atualize a página para baixar o termo com assinaturas.');
    const snapshot=await service.downloadSigningAgreement(uid,{year:AGREEMENT_YEAR,...context});if(!current())return;
    if(!(snapshot?.blob instanceof Blob)||snapshot.metadata?.uploadedAt!==record.uploadedAt||String(snapshot.metadata?.uploadVersion||'')!==String(record.uploadVersion||'')||snapshot.review?.status!=='approved'||snapshot.review?.reviewedAt!==review.reviewedAt)throw new Error('O termo foi atualizado. Abra a versão atual e tente baixar novamente.');
    const module=await import('./signed-term-pdf.js?v=20261105-11');if(!current())return;
    const result=await module.createSignedTermPdf({originalBlob:snapshot.blob,filename:snapshot.filename||snapshot.metadata.filename,studentName:snapshot.metadata.ownerName,year:snapshot.metadata.year,review:snapshot.review,signatures:snapshot.signatures,uploadVersion:snapshot.metadata.uploadVersion||'',uploadedAt:snapshot.metadata.uploadedAt});if(!current())return;
    const latest=agreements.find(item=>(item.uid||item.id)===uid);
    if(!latest||latest.uploadedAt!==record.uploadedAt||String(latest.uploadVersion||'')!==String(record.uploadVersion||'')||currentAgreementReview(latest)?.status!=='approved'||currentAgreementReview(latest)?.reviewedAt!==review.reviewedAt)throw new Error('O termo foi atualizado. Baixe a versão atual novamente.');
    if(!(result?.blob instanceof Blob))throw new Error('Não foi possível gerar o PDF. Tente novamente.');
    const url=URL.createObjectURL(result.blob);const download=link('',url);download.download=result.filename||'Termo_INIC_2027_assinaturas.pdf';document.body.append(download);download.click();download.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch(error){if(current())notice(errorText(error),'error',true);}
  finally{if(control){control.disabled=false;control.removeAttribute('aria-busy');control.textContent=oldLabel;}}
}

function openAgreementReview(record,status,studentName) {
  if(state.role!=='coordinator'||!agreementReviewsReady||isAgreementOwnerArchived(record))return;
  const actor=state.user?.uid,session=sessionVersion,scope=agreementSubscription,uid=record.uid||record.id;
  const expectedUploadVersion=record.uploadVersion||'',expectedUploadedAt=record.uploadedAt,expectedReviewedAt=currentAgreementReview(record)?.reviewedAt||0;
  const details=node('div','dialog-details');details.append(node('strong','',studentName||record.ownerName||'Estudante'),node('span','',record.filename||'Termo assinado'));
  const reason=status==='returned'?makeField('Pendência para o estudante','reason',{type:'textarea',required:true,minLength:3,maxLength:2000,placeholder:'Ex.: falta a assinatura do responsável na segunda página.'}):null;
  if(reason)reason.field.rows=4;
  const note=node('p','dialog-note',status==='approved'?'Confirme após conferir o arquivo. O estudante verá que está tudo certo.':'Descreva o que precisa ser corrigido. O estudante receberá essa pendência e poderá reenviar.');
  openForm({title:status==='approved'?'Confirmar recebimento':'Devolver termo',kicker:'COORDENAÇÃO · TERMO 2027',access:'review',guard:()=>state.role==='coordinator'&&!state.archived&&!isAgreementOwnerArchived(record),fields:[details,note,...(reason?[reason.label]:[])],submit:status==='approved'?'Confirmar recebimento':'Devolver com pendência',busy:status==='approved'?'Confirmando recebimento…':'Enviando pendência…',handler:async data=>{
    if(state.user?.uid!==actor||sessionVersion!==session||agreementSubscription!==scope)return;
    if(state.role!=='coordinator')throw new Error('Somente a coordenação pode conferir os termos.');
    if(!agreementReviewsReady)throw new Error('A conferência está indisponível. Consulte a situação atual antes de continuar.');
    const current=agreements.find(item=>(item.uid||item.id)===uid);
    if(!current||current.uploadedAt!==expectedUploadedAt||String(current.uploadVersion||'')!==String(expectedUploadVersion))throw new Error('O estudante enviou outra versão. Baixe o arquivo atualizado antes de conferir.');
    if((currentAgreementReview(current)?.reviewedAt||0)!==expectedReviewedAt)throw new Error('A conferência foi atualizada por outra pessoa. Revise a situação atual antes de continuar.');
    const pending=status==='returned'?String(data.get('reason')||'').trim():'';
    if(status==='returned'&&(pending.length<3||pending.length>2000))throw new Error('Descreva a pendência com 3 a 2000 caracteres.');
    if(typeof service.reviewAgreement!=='function')throw new Error('Atualize a página para conferir o termo.');
    try{await service.reviewAgreement(uid,{year:AGREEMENT_YEAR,status,reason:pending,expectedUploadVersion,expectedUploadedAt,expectedReviewedAt});}
    catch(error){if(state.user?.uid===actor&&sessionVersion===session&&agreementSubscription===scope)throw error;return;}
    if(state.user?.uid!==actor||sessionVersion!==session||agreementSubscription!==scope)return;
    notice(status==='approved'?'Recebimento confirmado. O estudante foi informado.':'Termo devolvido com a pendência informada.');
  }});
}
function coordinationAgreementRows() {
  const submitted=new Map(agreements.map(record=>[record.uid||record.id,record]));
  const students=state.users.filter(person=>!person.archived&&!['advisor','coordinator'].includes(person.role)&&person.requestedRole!=='advisor');
  const rows=students.map(person=>({uid:person.id,name:person.name||'Estudante',email:person.email||'',year:person.year||'',onboardingRequired:person.onboardingRequired===true,record:submitted.get(person.id)||null}));
  const known=new Set(rows.map(item=>item.uid));
  // Preserve access to documents already received even if the account's role changes.
  for(const record of agreements)if(!known.has(record.uid||record.id)){const person=state.users.find(item=>item.id===(record.uid||record.id));rows.push({uid:record.uid||record.id,name:record.ownerName||'Estudante',email:person?.email||'',year:person?.year||'',archived:person?.archived===true,record});}
  return rows.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
function paintAgreements() {
  const list=$('#agreement-list');if(!list)return;
  const required=requiresAgreement()&&!agreementSatisfied();
  if($('#agreement-gate'))$('#agreement-gate').hidden=!required;
  const reviewSlot=$('#agreement-review-slot');if(reviewSlot){const card=studentAgreementReviewCard();reviewSlot.replaceChildren(...(card?[card]:[]));}
  paintProposalCallout();
  const uploadStatus=$('#agreement-upload-status');if(agreementSatisfied()&&uploadStatus?.dataset.awaitingConfirmation==='true'){uploadStatus.textContent='Arquivo salvo. Aguardando conferência da coordenação.';uploadStatus.classList.remove('is-loading','error');uploadStatus.removeAttribute('aria-busy');delete uploadStatus.dataset.awaitingConfirmation;}
  if(required){$('#view-title').textContent='Termo obrigatório · INIC 2027';$('#view-kicker').textContent='INIC 2027 · PARTICIPAÇÃO DOS ESTUDANTES';}
  if(!agreementsReady){list.replaceChildren(loadingPanel('Conferindo o envio do termo…'));return;}
  if(agreementsError){list.replaceChildren(emptyState('Não foi possível conferir o termo',errorText(agreementsError),[button('Tentar novamente','button secondary',()=>{agreementScope='';syncAgreementSubscription();render();})]));return;}
  const term=normalize(agreementSearch).trim();
  list.replaceChildren();
  if(state.role==='coordinator'){
    if(agreementReviewError)list.append(emptyState('Não foi possível consultar as conferências','Os arquivos continuam disponíveis. Tente novamente para confirmar ou devolver um termo.',[button('Tentar novamente','button secondary compact',()=>{agreementScope='';syncAgreementSubscription();render();})]));
    const rows=coordinationAgreementRows();const received=rows.filter(item=>item.record).length;
    const approved=rows.filter(item=>agreementReviewState(item.record).key==='approved').length,returned=rows.filter(item=>agreementReviewState(item.record).key==='returned').length;
    const summary=$('#agreement-summary');summary?.replaceChildren(node('span','',`${rows.length} estudante(s)`),node('span','',`${received} enviado(s)`),node('span','',`${rows.length-received} pendente(s) de envio`),node('span','',`${approved} conferido(s)`),node('span','',`${returned} devolvido(s)`));
    document.querySelectorAll('[data-agreement-filter]').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.agreementFilter===agreementFilter)));
    const filtered=rows.filter(item=>(agreementFilter==='all'||(agreementFilter==='received'?Boolean(item.record):agreementReviewState(item.record).key===agreementFilter))&&(!term||normalize(`${item.name} ${item.email} ${item.record?.filename||''}`).includes(term)));
    if(!filtered.length){list.append(emptyState(rows.length?'Nenhum estudante neste filtro':'Nenhum estudante cadastrado',rows.length?'Altere a busca ou o filtro para consultar outros termos.':'Os estudantes e a situação do envio aparecerão aqui após o cadastro.'));return;}
    filtered.forEach(item=>{
      const status=agreementReviewState(item.record),review=agreementReviewsReady?currentAgreementReview(item.record):null;
      const card=node('article',`panel agreement-record${item.record?'':' agreement-record--pending'}`);card.dataset.reviewStatus=status.key;
      const copy=node('div','agreement-record-copy');copy.append(node('span',`badge ${status.badge}`,status.label),node('h3','',item.name));
      if(item.archived)copy.append(node('span','badge warning','Cadastro excluído · histórico preservado'));
      if(item.email)copy.append(node('p','agreement-student-meta',[item.email,item.year].filter(Boolean).join(' · ')));
      if(item.record){
        copy.append(node('p','agreement-filename',item.record.filename||'Termo assinado'),node('p','agreement-file-meta',`${agreementSize(item.record.size)} · Recebido em ${agreementTimestamp(item.record.uploadedAt)}`));
        if(review){if(review.status==='returned')copy.append(node('p','agreement-review-reason',review.reason));copy.append(node('p','agreement-review-audit',`${review.reviewerName||'Coordenação'} · ${agreementTimestamp(review.reviewedAt)}`));}
        const actions=node('div','agreement-record-actions');actions.append(button('Baixar arquivo','button secondary compact',event=>downloadAgreement(item.record,event.currentTarget)));
        const confirm=button(status.key==='approved'?'✓ Recebimento confirmado':'✓ Confirmar recebimento','button primary compact',()=>openAgreementReview(item.record,'approved',item.name));confirm.dataset.agreementReview='approved';confirm.disabled=!agreementReviewsReady||status.key==='approved'||item.archived===true;
        const sendBack=button('Devolver','button secondary compact',()=>openAgreementReview(item.record,'returned',item.name));sendBack.dataset.agreementReview='returned';sendBack.disabled=!agreementReviewsReady||item.archived===true;
        actions.append(confirm,sendBack);card.append(copy,actions);if(status.key==='approved'){card.classList.add('agreement-signing-record');card.append(agreementSignaturePanel(item.record));}
      }else {copy.append(node('p','agreement-file-meta',item.onboardingRequired?'Cadastro ainda não concluído. O envio será exigido após a escolha do perfil.':'Ainda não enviou o termo de aceite de 2027.'));card.append(copy);}
      list.append(card);
    });return;
  }
  if(state.role==='advisor'){
    const records=agreements.filter(record=>eligibleAdvisorGroups(record).some(group=>group.id===advisorAgreementGroupId)&&currentAgreementReview(record)?.status==='approved');
    if(!records.length){list.append(emptyState('Nenhum termo aprovado neste grupo',advisorAgreementGroupId?'Os termos aparecem aqui após a conferência da coordenação.':'Você precisa estar vinculado como orientador de um grupo para consultar seus termos.'));return;}
    records.forEach(record=>{const card=node('article','panel agreement-record agreement-signing-record');const copy=node('div','agreement-record-copy');copy.append(node('span','badge success','Conferido pela coordenação'),node('h3','',record.ownerName||'Estudante'),node('p','agreement-filename',record.filename||'Termo assinado'));const actions=node('div','agreement-record-actions');actions.append(button('Baixar arquivo original','button secondary compact',event=>downloadAgreement(record,event.currentTarget)));card.append(copy,actions);card.append(agreementSignaturePanel(record));list.append(card);});return;
  }
  if(!agreements.length){list.append(node('p','agreement-empty-status','Seu termo ainda não foi enviado.'));return;}
  agreements.forEach(record=>{
    const card=node('article','panel agreement-record');const copy=node('div','agreement-record-copy');
    const received=agreementSatisfied();
    copy.append(node('span',`badge ${received?'success':'warning'}`,received?'Arquivo salvo no aplicativo':'Envio ainda não confirmado'),node('h3','','Seu termo de aceite'),node('p','agreement-filename',record.filename||'Termo assinado'),node('p','agreement-file-meta',`${agreementSize(record.size)} · Enviado em ${agreementTimestamp(record.uploadedAt)}`));
    if(!received)copy.append(node('p','agreement-file-meta','O arquivo completo precisa ser confirmado no banco. Se a pendência continuar, envie novamente.'));
    const download=button('Baixar arquivo','button secondary compact',event=>downloadAgreement(record,event.currentTarget));download.disabled=!received;card.append(copy,download);if(received&&agreementReviewsReady&&currentAgreementReview(record)?.status==='approved'){card.classList.add('agreement-signing-record');card.append(agreementSignaturePanel(record));}list.append(card);
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
  card.append(top,node('h3','',group.name),node('p','group-topic',group.topic || 'Tema em definição'),node('p','advisor-line',`Série: ${isSchoolYear(group.schoolYear)?group.schoolYear:'aguardando atualização'}`),node('p','advisor-line',`Orientação: ${advisorName(group)}`));
  if(group.status==='deleting')card.append(node('p','deletion-warning','Exclusão em andamento'));
  else if(groupData.has(group.id))card.append(progressBlock(tasks));else card.append(node('p','loading-task','Carregando entregas…'));
  const footer=node('div','card-footer');footer.append(node('span','',tasks.length ? `${tasks.filter(t=>t.completed).length} de ${tasks.length} etapas` : 'Organize as próximas etapas'),link('Abrir grupo',routeHref('group',group.id)));card.append(footer);
  const actions=node('div','group-card-actions');
  if(canAssignGroupAdvisor(group)){const assign=button('Atribuir orientador','button primary compact',()=>showAssignAdvisor(group));assign.dataset.groupAssign=group.id;actions.append(assign);}
  if(canChatGroup(group))actions.append(link('Abrir chat do grupo',routeHref('group',group.id,'messages'),'button secondary compact'));
  if(group.status==='deleting'&&isGroupManager(group))actions.append(button('Concluir exclusão','button danger-button compact',()=>showDeleteGroup(group)));
  else if(group.status!=='archived'&&group.archived!==true){
    if(isGroupManager(group))actions.append(button('Editar grupo','text-button',()=>showEditGroup(group)),button('Excluir grupo','text-button destructive-action',()=>showDeleteGroup(group)));
  }
  if(actions.childElementCount)card.append(actions);return card;
}
function canChatGroup(group) { return Boolean(canAccessAcademic()&&group&&group.status!=='deleting'&&group.status!=='archived'&&group.archived!==true&&(isGroupManager(group)||state.role==='student'&&group.members?.[state.user?.uid]===true)); }
function taskPreview(task) {
  const row=node('div','task-preview');const date=parseDate(task.dueDate);const tile=node('div','date-tile');tile.append(node('strong','',date?date.getDate():'—'),node('span','',date?new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(date).replace('.',''):'prazo'));
  const main=node('div','task-main');main.append(link(task.title,routeHref('group',task.groupId,'tasks')));main.firstChild.replaceChildren(node('h4','',task.title));main.append(node('p','',task.groupName));
  const status=statusOf(task);row.append(tile,main,node('span',`badge ${status.className}`,status.text));return row;
}
function supportCard() {
  const card=node('div','support-card');const copy=node('div');copy.append(node('h3','','Compromisso com a pesquisa, combinado em família.'),node('p','','Preencha o termo e assine na tela com seu responsável. Baixe o PDF único e envie em Meu termo. Você também pode assinar no papel.'));card.append(copy,link('Acessar o termo','conformidade.html','button secondary'));return card;
}
function renderDashboard() {
  const fragment=document.createDocumentFragment();
  const welcome=node('section','welcome');const copy=node('div');copy.append(node('p','eyebrow','O PRÓXIMO PASSO DA SUA PESQUISA'),node('h2','',`Olá, ${myName().split(' ')[0]}. Vamos construir conhecimento?`),node('p','',state.role==='coordinator'?'Acompanhe grupos, orientadores e entregas em um só lugar.':'Seu grupo, seu orientador e as próximas entregas estão aqui. Comece por um pequeno passo.'));welcome.append(copy);
  if(canCreateGroup())welcome.append(button(state.role==='student'?'Montar meu grupo e convidar':'Criar um grupo','button orange',showCreateGroup));else welcome.append(link('Conhecer as pesquisas','index.html#artigos','button orange'));
  fragment.append(welcome);
  const communityLink=node('section','community-dashboard-link'),communityCopy=node('div');communityCopy.append(node('h3','','Conheça a comunidade INIC'),node('p','','Encontre alunos disponíveis, escolha professores e envie convites pelo perfil.'));communityLink.append(communityCopy,link('Encontrar pessoas','#pessoas','button primary'));fragment.append(communityLink);
  const reviewCard=studentAgreementReviewCard();if(reviewCard)fragment.append(reviewCard);
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
  const filters=node('div','search-filter');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar grupos');const search=node('input');search.type='search';search.placeholder='Buscar grupo, tema ou integrante';search.setAttribute('aria-label','Buscar grupos');search.setAttribute('aria-controls','filtered-groups');search.value=groupSearch;
  search.addEventListener('input',event=>{groupSearch=event.target.value;paintFilteredGroups();});filters.append(filterSearch(search));
  if(state.role==='coordinator'){
    const select=node('select');select.setAttribute('aria-label','Filtrar por orientador');select.setAttribute('aria-controls','filtered-groups');[{value:'all',label:'Todos os orientadores'},{value:'mine',label:'Grupos que eu oriento'},{value:'none',label:'Sem orientador'},...state.advisors.map(a=>({value:a.id,label:advisorLabel(a)}))].forEach(a=>{const o=node('option','',a.label);o.value=a.value;select.append(o);});select.value=groupAdvisorFilter;select.classList.toggle('is-filtered',groupAdvisorFilter!=='all');select.addEventListener('change',event=>{groupAdvisorFilter=event.target.value;select.classList.toggle('is-filtered',groupAdvisorFilter!=='all');paintFilteredGroups();});const field=node('label','filter-field');field.append(node('span','','Orientação'),select);filters.append(field);
  }
  fragment.append(filters,node('div','group-grid'));fragment.lastChild.id='filtered-groups';
  const count=node('p','count-label');count.id='groups-count';count.setAttribute('role','status');count.setAttribute('aria-live','polite');count.style.marginTop='16px';fragment.append(count);
  queueMicrotask(paintFilteredGroups);return fragment;
}
function paintFilteredGroups() {
  const area=$('#filtered-groups');if(!area)return;
  const query=normalize(groupSearch).trim();
  const filtered=state.groups.filter(g=>(!query||normalize([g.name,g.topic,g.description,...Object.values(g.memberNames||{})].join(' ')).includes(query))&&(state.role!=='coordinator'||groupAdvisorFilter==='all'||(groupAdvisorFilter==='mine'?g.advisorId===state.user?.uid:groupAdvisorFilter==='none'?!g.advisorId:g.advisorId===groupAdvisorFilter)));
  area.className=filtered.length?'group-grid':'';
  area.replaceChildren(...(filtered.length?filtered.map(groupCard):[emptyState(state.groups.length?'Nenhum grupo com esses filtros':'Você ainda não participa de um grupo',state.groups.length?'Tente outro tema ou nome.':'Crie um grupo ou aceite um convite para começar a organizar a pesquisa.',canCreateGroup()?[button('Criar grupo','button primary',showCreateGroup)]:[])]));
  $('#groups-count').textContent=`${filtered.length} ${filtered.length===1?'grupo encontrado':'grupos encontrados'}`;
}

function buildAdvisorPicker(initialIds = []) {
  const field=node('fieldset','advisor-picker');field.append(node('legend','','Orientadores para convidar'));
  field.append(node('p','advisor-picker-help','Envie convites para até 3 orientadores ao mesmo tempo. O primeiro aceite confirma a orientação.'));
  const count=node('p','advisor-picker-count','0 de 3 selecionados');count.setAttribute('role','status');count.setAttribute('aria-live','polite');
  const search=node('input','advisor-picker-search');search.type='search';search.placeholder='Buscar professor(a) pelo nome';search.setAttribute('aria-label','Buscar orientadores aprovados');
  const list=node('div','advisor-picker-list'),empty=node('p','empty-small');
  const selected=new Set(initialIds.slice(0,3));let controls=[],advisorCount=0,disposed=false;
  function paintSelection(){count.textContent=`${selected.size} de 3 selecionados`;controls.forEach(({input})=>{input.disabled=selected.size>=3&&!input.checked;});}
  function filterChoices(){
    const query=normalize(search.value).trim();let visible=0;
    controls.forEach(({label})=>{label.hidden=Boolean(query&&!label.dataset.search.includes(query));if(!label.hidden)visible++;});
    empty.hidden=visible>0;empty.textContent=advisorCount?'Nenhum orientador com esse nome.':'A coordenação ainda não liberou orientadores para convite.';
  }
  function paint(){
    if(disposed)return;
    const focusedUid=list.contains(document.activeElement)?document.activeElement?.value:null,scrollTop=list.scrollTop;
    const advisors=[...new Map(state.advisors.filter(person=>person.id).map(person=>[person.id,person])).values()];advisorCount=advisors.length;
    for(const id of selected)if(!advisors.some(person=>person.id===id))selected.delete(id);
    controls=[];list.replaceChildren();
    advisors.forEach(person=>{
      const label=node('label','advisor-choice');label.dataset.search=normalize(person.name);const input=node('input');input.type='checkbox';input.name='advisorIds';input.value=person.id;input.checked=selected.has(person.id);
      const avatar=node('span','avatar',initials(person.name));avatar.setAttribute('aria-hidden','true');
      const copy=node('span','advisor-choice-copy');copy.append(node('strong','',advisorLabel(person)),node('small','','Orientador(a) aprovado(a) · pode orientar vários grupos'));
      input.addEventListener('change',()=>{if(disposed||input.disabled)return;if(input.checked&&selected.size>=3&&!selected.has(person.id)){input.checked=false;count.textContent='Selecione no máximo 3 orientadores.';return;}if(input.checked)selected.add(person.id);else selected.delete(person.id);paintSelection();});
      controls.push({input,label});label.append(input,avatar,copy);list.append(label);
    });
    paintSelection();filterChoices();list.scrollTop=scrollTop;
    if(focusedUid)(controls.find(({input})=>input.value===focusedUid&&!input.disabled)?.input||search).focus({preventScroll:true});
  }
  search.addEventListener('input',()=>{if(!disposed)filterChoices();});
  field.append(search,count,list,empty,node('p','advisor-picker-help','Você também pode escolher depois, em Convites.'));
  paint();
  return {field,selectedIds:()=>[...selected],update:paint,destroy(){disposed=true;selected.clear();list.replaceChildren();}};
}
function showCreateGroup(invitedPerson=null) {
  if(!canCreateGroup()){if(studentGroupId())notice('Você já participa de um grupo. Cada aluno pode participar de apenas um grupo.','info');else render();return;}
  openProposalForm(false,{invitedPerson:invitedPerson?.id?invitedPerson:null});
}
function showProposalDraft() {
  if(!canPrepareProposal()){render();return;}
  if(canCreateGroup()){showCreateGroup();return;}
  openProposalForm(true);
}
function openProposalForm(draftOnly,{invitedPerson=null}={}) {
  const uid=state.user?.uid,session=sessionVersion;
  const student=state.role==='student';const saved=student&&proposalDraft?.uid===uid?proposalDraft:{};
  const name=makeField('Nome do grupo','name',{value:saved.name||'',required:true,minLength:2,maxLength:100,placeholder:'Ex.: Equipe EcoPlant'});
  const topic=makeField(student?'Tema da proposta':'Tema da pesquisa','topic',{value:saved.topic||'',required:true,minLength:3,maxLength:240,placeholder:'O que vocês querem investigar?'});
  const year=makeField('Edição do INIC','year',{type:'number',value:saved.year||2027,required:true,min:2027,max:2100});
  const schoolYear=makeField('Série dos alunos','schoolYear',student?{value:state.profile.year,help:'Seu grupo terá apenas alunos da sua série. A série é definida pelo seu cadastro.'}:{required:true,value:invitedPerson&&participantStatus(invitedPerson).type==='member'&&isSchoolYear(invitedPerson.year)?invitedPerson.year:'',options:[{value:'',label:'Selecione a série do grupo'},...SCHOOL_YEARS],help:'Todos os alunos do grupo devem ser desta série. Professores podem orientar grupos de diferentes séries.'});
  if(student)schoolYear.field.readOnly=true;
  const selectedSchoolYear=()=>student?state.profile?.year:schoolYear.field.value;
  const proposalEditor=student?createProposalEditor({value:saved.proposal||null,proposalFile:saved.proposalFile||null}):null;
  const picker=student?buildAdvisorPicker(invitedPerson&&participantStatus(invitedPerson).type==='advisor'?[invitedPerson.id]:(saved.advisorIds||[])):null;
  const members=buildStudentPicker({multiple:true,selectedIds:invitedPerson&&participantStatus(invitedPerson).type==='member'?[invitedPerson.id]:(saved.memberUids||[]),schoolYear:selectedSchoolYear});
  schoolYear.field.addEventListener('change',()=>members.update());
  const advisor=student?null:makeField('Orientador(a) desejado(a)','advisorId',{options:[{value:'',label:state.role==='advisor'?'Eu serei o(a) orientador(a)':'Escolher depois'},...state.advisors.map(a=>({value:a.id,label:advisorLabel(a)}))],help:state.role==='coordinator'&&isListedAdvisor()?'Escolha seu nome para orientar este novo grupo. Outros orientadores receberão um convite e precisam aceitar.':'O orientador receberá um convite e será vinculado após aceitar.'});
  const fields=[name.label,topic.label,year.label,schoolYear.label,...(proposalEditor?[proposalEditor.element]:[]),members.field,picker?.field||advisor.label,node('p','dialog-note',draftOnly?'Rascunho nesta sessão. Envie o termo assinado antes de criar o grupo e enviar os convites.':student?'O anexo, o grupo e os convites são salvos juntos. Cada aluno pode participar de apenas um grupo, sempre da sua série. O professor será vinculado após aceitar.':'O professor pode orientar vários grupos. Os alunos convidados só entram após aceitar e devem ser da série escolhida.')];
  openForm({title:draftOnly?'Preparar meu grupo':student?'Meu grupo e proposta':'Novo grupo',kicker:draftOnly?'RASCUNHO · INIC 2027':'INIC 2027',access:draftOnly?'draft':'academic',fields,onUpdate:()=>{if(student)schoolYear.field.value=state.profile?.year||'';members.update();picker?.update();},cleanup:()=>{proposalEditor?.destroy();members.destroy();picker?.destroy();},submit:draftOnly?'Salvar rascunho':student?'Criar grupo e enviar convites':'Criar grupo',busy:draftOnly?'Salvando rascunho…':student?'Criando grupo e enviando convites…':'Criando grupo…',handler:async data=>{
    if(state.user?.uid!==uid||sessionVersion!==session)return;
    if(student&&(state.role!=='student'||isPendingAdvisor()))throw new Error('Seu perfil mudou. Abra a proposta novamente para conferir a orientação.');
    if(draftOnly&&!canPrepareProposal())throw new Error('Seu perfil mudou. Confira seu cadastro antes de continuar.');
    if(student&&studentGroupId())throw new Error('Você já participa de um grupo. Cada aluno pode participar de apenas um grupo.');
    if(!draftOnly&&!canCreateGroup())throw new Error('Confira seu termo e aguarde o carregamento das pessoas antes de criar o grupo.');
    const schoolYear=selectedSchoolYear();
    if(!isSchoolYear(schoolYear))throw new Error(student?'Informe sua série no cadastro antes de criar o grupo.':'Escolha a série dos alunos deste grupo.');
    const advisorIds=picker?.selectedIds()||[];
    if(advisorIds.length>3)throw new Error('Selecione no máximo 3 orientadores.');
    if(student&&advisorIds.some(id=>!state.advisors.some(person=>person.id===id)))throw new Error('A lista de orientadores mudou. Revise os nomes antes de enviar.');
    const memberUids=members.selectedIds();
    if(!state.peopleReady||state.peopleError)throw new Error('Aguarde o carregamento das pessoas antes de enviar os convites.');
    const selectedPeople=memberUids.map(id=>state.people.find(person=>person.id===id));
    if(selectedPeople.some(person=>person?.groupId))throw new Error('Um dos alunos selecionados já entrou em um grupo. Confira a lista antes de continuar.');
    if(selectedPeople.some(person=>!person||participantStatus(person).type!=='member'||!participantStatus(person).available))throw new Error('Um dos cadastros selecionados não está mais disponível. Confira a lista antes de continuar.');
    if(selectedPeople.some(person=>person.year!==schoolYear))throw new Error(`O grupo só pode ter alunos do ${schoolYear}. Um dos alunos selecionados é de outra série; confira a lista antes de continuar.`);
    const payload={name:String(data.get('name')).trim(),topic:String(data.get('topic')).trim(),description:'',year:Number(data.get('year')),schoolYear,memberUids,...(student?{advisorIds,...proposalEditor.read()}:{advisorId:String(data.get('advisorId')||'')})};
    if(student)proposalDraft={uid,...payload};
    if(draftOnly){paintProposalCallout();notice('Rascunho preparado. Envie o termo assinado para concluir a proposta.');return;}
    const id=await service.createGroup(payload);
    if(state.user?.uid!==uid||sessionVersion!==session)return;
    proposalDraft=null;
    const count=memberUids.length+advisorIds.length;
    notice(student?(count?`Proposta criada. ${count} convite(s) enviado(s) para os colegas e orientadores selecionados.`:'Proposta criada. Você pode enviar convites na área do grupo.'):'Grupo criado. Convide os integrantes e organize as entregas.');navigate('group',typeof id==='string'?id:id.id);
  }});
}
function revokeProposalUrls() {for(const url of proposalUrls)URL.revokeObjectURL(url);proposalUrls.clear();}
function canReadProposal(groupId,invitationId='') {
  if(!canAccessAcademic())return false;
  const group=state.groups.find(item=>item.id===groupId);if(canChatGroup(group))return true;
  const invite=state.invitations.find(item=>item.id===invitationId);
  return Boolean(['advisor','coordinator'].includes(state.role)&&invite?.groupId===groupId&&invite.type==='advisor'&&invite.status==='pending'&&isRecipient(invite));
}
function downloadProposal(groupId,proposal,control,invitationId='',viewGuard=()=>true) {
  const actor=state.user?.uid,session=sessionVersion;const current=()=>state.user?.uid===actor&&sessionVersion===session&&canReadProposal(groupId,invitationId)&&viewGuard();
  return action(control,async()=>{
    if(!current())return;
    if(typeof service.getProposal!=='function'||typeof service.getProposalFile!=='function')throw new Error('Atualize a página para consultar a proposta.');
    try{
      const latest=await service.getProposal(groupId);if(!current())return;
      if(!proposal?.version||latest?.version!==proposal.version)throw new Error('A proposta foi atualizada. Abra novamente para consultar a versão atual.');
      const file=await service.getProposalFile(groupId);if(!current())return;
      const confirmed=await service.getProposal(groupId);if(!current())return;
      if(confirmed?.version!==proposal.version)throw new Error('A proposta foi atualizada durante o download. Abra a versão atual.');
      if(!file?.blob)throw new Error('O arquivo da proposta ainda não está disponível.');
      const url=URL.createObjectURL(file.blob);proposalUrls.add(url);
      const anchor=link('',url);anchor.download=file.filename||proposal.filename||'Proposta_TCC.pdf';document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>{if(proposalUrls.delete(url))URL.revokeObjectURL(url);},1000);
    }catch(error){if(current())throw error;}
  });
}
function showEditProposal(group) {
  if(!canManage(group)||group.status==='archived'||group.archived)return;
  const actor=state.user.uid,session=sessionVersion,expectedVersion=group.proposal?.version||null;
  let inFlight=false;
  const editor=createProposalEditor({value:group.proposal||null});
  const authorized=()=>{const latest=state.groups.find(item=>item.id===group.id);return Boolean(state.user?.uid===actor&&sessionVersion===session&&canAccessAcademic()&&latest&&canManage(latest)&&latest.status!=='archived'&&!latest.archived);};
  const current=()=>{if(!authorized())return false;const latest=state.groups.find(item=>item.id===group.id);return (latest.proposal?.version||null)===expectedVersion||Boolean(inFlight&&latest.proposal?.updatedByUid===actor&&(latest.proposal.previousVersion||null)===expectedVersion);};
  openForm({title:group.proposal?'Atualizar proposta de TCC':'Adicionar proposta de TCC',fields:[node('p','dialog-note',`Grupo: ${group.name}. O orientador convidado poderá consultar esta proposta antes de responder.`),editor.element],submit:'Salvar proposta',busy:'Salvando proposta…',guard:current,cleanup:()=>editor.destroy(),handler:async()=>{
    if(!current())throw new Error('A proposta ou seu acesso mudou. Abra o grupo novamente.');
    if(typeof service.saveProposal!=='function')throw new Error('Atualize a página para salvar a proposta.');
    const payload=editor.read();inFlight=true;try{await service.saveProposal(group.id,{...payload,expectedVersion});}catch(error){if(authorized())throw error;return;}finally{inFlight=false;}
    if(state.user?.uid===actor&&sessionVersion===session&&canReadProposal(group.id))notice('Proposta de TCC salva.');
  }});
}
async function showInvitationProposal(invitation) {
  const actor=state.user?.uid,session=sessionVersion;const current=()=>state.user?.uid===actor&&sessionVersion===session&&canReadProposal(invitation.groupId,invitation.id);
  if(!current())return;
  openForm({title:`Proposta · ${invitation.groupName||'Grupo de TCC'}`,fields:[loadingPanel('Consultando proposta do grupo…')],submit:'Fechar',guard:current,handler:()=>{}});
  const version=dialogVersion;
  try{
    if(typeof service.getProposal!=='function')throw new Error('Atualize a página para consultar a proposta.');
    const proposal=await service.getProposal(invitation.groupId);if(!current()||version!==dialogVersion||!$('#form-dialog').open)return;
    $('#dialog-fields').replaceChildren(createProposalView({proposal,onDownload:event=>downloadProposal(invitation.groupId,proposal,event.currentTarget,invitation.id,()=>version===dialogVersion&&$('#form-dialog').open)}));
  }catch(error){if(current()&&version===dialogVersion&&$('#form-dialog').open)$('#dialog-fields').replaceChildren(node('p','agreement-review-reason',errorText(error)),button('Tentar novamente','button secondary',()=>showInvitationProposal(invitation)));}
}
function canAssignGroupAdvisor(group) { return Boolean(state.user&&!state.archived&&state.ready&&state.role==='coordinator'&&group&&group.status!=='deleting'&&group.status!=='archived'&&group.archived!==true&&!group.advisorId); }
function canReplaceGroupAdvisor(group) { return Boolean(state.user&&!state.archived&&state.role==='coordinator'&&group?.advisorId&&group.status!=='deleting'&&group.status!=='archived'&&group.archived!==true); }
function canWithdrawGroupAdvisor(group) { return Boolean(state.user&&!state.archived&&['advisor','coordinator'].includes(state.role)&&group?.advisorId===state.user.uid&&group.status!=='deleting'&&group.status!=='archived'&&group.archived!==true); }
function buildOrientationPicker(excludeUid='') {
  const field=node('fieldset','advisor-picker orientation-picker');field.append(node('legend','','Professor(a) orientador(a)'));
  const search=node('input');search.type='search';search.placeholder='Buscar professor(a) pelo nome';search.setAttribute('aria-label','Buscar orientador para atribuir');
  const list=node('div','advisor-picker-list');const rows=[];
  state.advisors.filter(person=>person.id!==excludeUid).forEach(person=>{const label=node('label','advisor-choice');const input=node('input');input.type='radio';input.name='advisorUid';input.value=person.id;input.required=true;label.dataset.search=normalize(person.name);const copy=node('span');copy.append(node('strong','',advisorLabel(person)),node('small','','Orientador(a) aprovado(a)'));label.append(input,node('span','avatar',initials(person.name)),copy);list.append(label);rows.push(label);});
  const empty=node('p','advisor-picker-empty',rows.length?'Nenhum orientador com esse nome.':'Nenhum outro orientador aprovado disponível.');empty.hidden=Boolean(rows.length);
  search.addEventListener('input',()=>{const query=normalize(search.value).trim();let visible=0;rows.forEach(row=>{row.hidden=Boolean(query&&!row.dataset.search.includes(query));if(!row.hidden)visible++;});empty.hidden=visible>0;});field.append(search,list,empty);return field;
}
function showAssignAdvisor(group) {openOrientationForm(group,'assign');}
function showReplaceAdvisor(group) {openOrientationForm(group,'replace');}
function showWithdrawAdvisor(group) {openOrientationForm(group,'withdraw');}
function openOrientationForm(group,mode) {
  if(!(mode==='assign'?canAssignGroupAdvisor(group):mode==='replace'?canReplaceGroupAdvisor(group):canWithdrawGroupAdvisor(group)))return;
  const actor=state.user.uid,session=sessionVersion,expectedAdvisorUid=group.advisorId||'',expectedRevision=Number(group.orientationRevision)||0;
  let inFlightAdvisor='';let inFlight=false;
  const details=node('div','dialog-details');details.append(node('strong','',group.name),node('span','',group.topic||'Tema em definição'),node('span','',`Orientação atual: ${expectedAdvisorUid?advisorName(group):'Sem orientador(a)'}`));
  const fields=[details];if(mode!=='withdraw'){
    const picker=buildOrientationPicker(mode==='replace'?expectedAdvisorUid:'');const summary=node('p','orientation-change-summary','Selecione o professor que assumirá a orientação.');summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');
    picker.addEventListener('change',()=>{const selected=picker.querySelector('input[name="advisorUid"]:checked');const person=state.advisors.find(item=>item.id===selected?.value);summary.textContent=person?(mode==='replace'?`Substituir ${advisorName(group)} por ${person.name} no grupo “${group.name}”.`:`Atribuir ${person.name} ao grupo “${group.name}”.`):'Selecione o professor que assumirá a orientação.';});fields.push(picker,summary);
  }
  const reason=mode!=='assign'?makeField(mode==='withdraw'?'Motivo da saída (opcional)':'Motivo da substituição','reason',{type:'textarea',required:mode==='replace',minLength:mode==='replace'?3:undefined,maxLength:2000,help:'Visível ao grupo, à coordenação e aos professores envolvidos. Informe somente o que for necessário.'}):null;if(reason)fields.push(reason.label);
  fields.push(node('p','dialog-note',mode==='assign'?'Ao confirmar, o professor será vinculado diretamente e o grupo aparecerá para ele e para os integrantes. Convites pendentes de orientação serão encerrados.':mode==='replace'?'O professor escolhido assume a orientação. O orientador anterior será informado e perderá esse vínculo com o grupo.':'Você deixará a orientação. O grupo, os integrantes e as entregas serão preservados, e a coordenação poderá atribuir outro professor.'));
  if(mode!=='assign'){const confirm=makeField(mode==='replace'?'Confirmo a substituição do orientador deste grupo.':'Confirmo minha saída da orientação deste grupo.','confirmOrientation',{type:'checkbox',required:true});confirm.label.classList.add('admin-confirmation');fields.push(confirm.label);}
  const permitted=()=>{
    if(state.user?.uid!==actor||sessionVersion!==session||state.archived)return false;
    const current=state.groups.find(item=>item.id===group.id);
    if(inFlight&&mode==='withdraw'&&!current)return ['advisor','coordinator'].includes(state.role);
    if(!current||current.status==='deleting'||current.status==='archived'||current.archived)return false;
    if(inFlight&&current.advisorAssignment?.assignedBy===actor&&current.advisorId===inFlightAdvisor)return mode==='withdraw'?['advisor','coordinator'].includes(state.role):state.role==='coordinator';
    return (Number(current.orientationRevision)||0)===expectedRevision&&(current.advisorId||'')===expectedAdvisorUid&&(mode==='assign'?canAssignGroupAdvisor(current):mode==='replace'?canReplaceGroupAdvisor(current):canWithdrawGroupAdvisor(current));
  };
  openForm({title:mode==='assign'?'Atribuir orientador':mode==='replace'?'Substituir orientador':'Sair da orientação',kicker:mode==='withdraw'?'ORIENTAÇÃO DO GRUPO':'COORDENAÇÃO · ORIENTAÇÃO',access:mode==='withdraw'?'academic':'admin',fields,submit:mode==='assign'?'Atribuir orientador':mode==='replace'?'Confirmar substituição':'Confirmar saída',busy:mode==='withdraw'?'Registrando sua saída…':'Atualizando orientação…',danger:mode!=='assign',guard:permitted,handler:async data=>{
    if(!permitted())throw new Error('A orientação deste grupo mudou. Confira a situação atual antes de continuar.');
    const next=mode==='withdraw'?'':String(data.get('advisorUid')||'');
    if(mode!=='withdraw'&&(!next||!state.advisors.some(person=>person.id===next)))throw new Error('Escolha um orientador aprovado na lista atual.');
    if(mode==='replace'&&next===expectedAdvisorUid)throw new Error('Escolha um orientador diferente do atual.');
    const note=mode==='assign'?'':String(data.get('reason')||'').trim();if(mode==='replace'&&note.length<3)throw new Error('Informe o motivo da substituição.');if(note.length>2000)throw new Error('Use até 2.000 caracteres para o motivo.');
    if(mode!=='assign'&&!data.has('confirmOrientation'))throw new Error('Marque a confirmação para continuar.');
    const method=mode==='assign'?'assignAdvisor':mode==='replace'?'replaceAdvisor':'withdrawAdvisor';if(typeof service[method]!=='function')throw new Error('Atualize a página para gerenciar a orientação.');
    inFlight=true;inFlightAdvisor=next;
    try{if(mode==='assign')await service.assignAdvisor(group.id,next);else if(mode==='replace')await service.replaceAdvisor(group.id,next,{reason:note,expectedAdvisorUid,expectedRevision});else await service.withdrawAdvisor(group.id,{reason:note,expectedAdvisorUid,expectedRevision});}
    catch(error){if(state.user?.uid===actor&&sessionVersion===session&&!state.archived)throw error;return;}
    finally{inFlight=false;}
    if(state.user?.uid!==actor||sessionVersion!==session||state.archived)return;
    if(mode==='withdraw'){navigate('groups');notice('Saída da orientação registrada. A coordenação foi informada.');}
    else if(state.role==='coordinator'){
      const latest=state.groups.find(item=>item.id===group.id);
      if(!latest||latest.status==='deleting'||latest.status==='archived'||latest.archived||(latest.advisorId&&latest.advisorId!==next))return;
      notice(mode==='assign'?'Orientador atribuído. O vínculo está disponível para o professor e os integrantes.':'Orientador substituído. O professor anterior foi informado.');
    }
  }});
}
function orientationNoticeCopy(item) {
  if(item.type==='unavailable')return `O grupo “${item.groupName||'Grupo de TCC'}” já possui orientador(a): ${item.newAdvisorName||'orientação confirmada'}.`;
  if(item.type==='withdrawn')return `${item.oldAdvisorName||'O(a) professor(a)'} deixou a orientação do grupo “${item.groupName||'Grupo de TCC'}”.`;
  if(item.type==='replaced')return `A orientação do grupo “${item.groupName||'Grupo de TCC'}” passou de ${item.oldAdvisorName||'orientador anterior'} para ${item.newAdvisorName||'novo(a) orientador(a)'}.`;
  return `${item.newAdvisorName||'Um(a) professor(a)'} foi vinculado(a) à orientação do grupo “${item.groupName||'Grupo de TCC'}”.`;
}
function orientationNoticesPanel() {
  const notices=state.orientationNotices||[];if(!notices.length)return null;
  const panel=node('section','orientation-notices');panel.setAttribute('aria-label','Avisos de orientação');panel.append(node('h3','','Avisos de orientação'));
  notices.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).forEach(item=>{
    const card=node('article','panel orientation-notice-card');card.dataset.orientationNotice=item.id;card.append(node('span',`badge ${item.read?'':'warning'}`,item.read?'Lido':'Novo aviso'),node('h4','',item.type==='unavailable'?'Grupo com orientação confirmada':item.type==='withdrawn'?'Saída da orientação':item.type==='replaced'?'Orientação substituída':'Orientador atribuído'),node('p','',orientationNoticeCopy(item)));
    if(item.reason)card.append(node('p','orientation-notice-reason',item.reason));card.append(node('p','orientation-notice-time',agreementTimestamp(item.createdAt)));
    const actions=node('div','actions');const group=state.groups.find(group=>group.id===item.groupId);if(canChatGroup(group))actions.append(link('Abrir grupo',routeHref('group',group.id),'button secondary compact'));
    if(!item.read){const actor=state.user?.uid,session=sessionVersion;actions.append(button('Marcar como lido','text-button',event=>action(event.currentTarget,async()=>{if(state.user?.uid!==actor||sessionVersion!==session||state.archived)return;if(typeof service.markOrientationNoticeRead!=='function')throw new Error('Atualize a página para marcar o aviso.');try{await service.markOrientationNoticeRead(item.id);}catch(error){if(state.user?.uid===actor&&sessionVersion===session&&!state.archived)throw error;}})));}
    card.append(actions);panel.append(card);
  });return panel;
}

const inicResultLabels={pending:'Aguardando resultado',approved:'Aprovado no INIC',rejected:'Reprovado no INIC',correction:'Correção pendente'};
function inicResultFor(group,uid) {return (groupData.get(group.id)?.inicResults||[]).find(item=>(item.studentUid||item.uid||item.id)===uid&&(!item.year||Number(item.year)===(Number(group.year)||2027)))||null;}
function canEditInicResult(group,uid) {const data=groupData.get(group?.id);return Boolean(canAccessAcademic()&&group&&data?.inicResultsReady===true&&!data.inicResultsError&&!data.error&&group.status!=='deleting'&&group.status!=='archived'&&group.archived!==true&&group.members?.[uid]===true&&!state.users.some(person=>person.id===uid&&person.archived)&&(state.role==='coordinator'||state.role==='advisor'&&group.advisorId===state.user?.uid||state.role==='student'&&uid===state.user?.uid));}
function inicResultPanel(group) {
  const panel=node('section','panel inic-result-panel');panel.setAttribute('aria-label','Resultados do INIC');const heading=node('div','panel-heading');heading.append(node('h3','',`INIC ${group.year||2027} · resultado`));panel.append(heading);
  panel.append(node('p','inic-result-help','Resultado informado pelo estudante, orientador ou coordenação. Não substitui a confirmação oficial do evento nem as notas da disciplina.'));
  const data=groupData.get(group.id)||{};if(data.inicResultsError||data.error){panel.append(node('p','agreement-review-reason','Não foi possível consultar os resultados. Abra o grupo novamente antes de atualizar.'));return panel;}if(data.inicResultsReady!==true){panel.append(loadingPanel('Consultando resultados do INIC…'));return panel;}
  const students=Object.keys(group.members||{}).filter(uid=>group.members[uid]===true&&uid!==group.advisorId&&!state.advisors.some(person=>person.id===uid)&&!state.users.some(person=>person.id===uid&&['advisor','coordinator'].includes(person.role))&&(state.role!=='student'||uid===state.user?.uid));
  students.forEach(uid=>{const result=inicResultFor(group,uid),status=result?.status||'pending',row=node('article','inic-result-row');row.dataset.inicStudent=uid;const copy=node('div');copy.append(node('strong','',memberName(group,uid)),node('span',`badge ${status==='approved'?'success':status==='rejected'||status==='correction'?'warning':''}`,inicResultLabels[status]||inicResultLabels.pending));if(result?.correction)copy.append(node('p','orientation-notice-reason',result.correction));copy.append(node('p','inic-result-audit',result?.updatedAt?`Informado por ${result.updatedByName||'participante'} · ${roleNames[result.updatedByRole]||'Participante'} · ${agreementTimestamp(result.updatedAt)}`:'Ainda não informado.'));row.append(copy);if(canEditInicResult(group,uid)){const edit=button(result?'Atualizar resultado':'Informar resultado','button secondary compact',()=>showInicResultForm(group,uid));edit.dataset.inicResult=uid;row.append(edit);}panel.append(row);});
  if(!students.length)panel.append(node('p','empty-small','Nenhum estudante para registrar resultado neste grupo.'));return panel;
}
function showInicResultForm(group,uid) {
  if(!canEditInicResult(group,uid))return;
  const actor=state.user.uid,session=sessionVersion,year=Number(group.year)||2027,previous=inicResultFor(group,uid),expectedUpdatedAt=previous?.updatedAt||0;
  const status=makeField('Resultado no INIC','status',{value:previous?.status||'pending',options:Object.entries(inicResultLabels).map(([value,label])=>({value,label})),required:true});
  const correction=makeField('Pendência ou correção','correction',{type:'textarea',maxLength:2000,value:previous?.correction||'',help:'Obrigatória para Correção pendente. Informe apenas o necessário para os ajustes do trabalho.'});correction.field.rows=4;
  const paint=()=>{const needs=status.field.value==='correction';correction.label.hidden=!needs&&status.field.value!=='rejected';correction.field.required=needs;};status.field.addEventListener('change',paint);paint();
  const current=()=>{const latest=state.groups.find(item=>item.id===group.id);return Boolean(state.user?.uid===actor&&sessionVersion===session&&latest&&(Number(latest.year)||2027)===year&&canEditInicResult(latest,uid));};
  openForm({title:'Resultado do INIC',kicker:`INIC ${year} · ${memberName(group,uid)}`,fields:[node('p','dialog-note',`Grupo: ${group.name}. O registro identifica quem informou o resultado.`),status.label,correction.label],submit:'Salvar resultado',busy:'Salvando resultado…',guard:current,handler:async data=>{
    if(!current())throw new Error('Seu acesso a este resultado mudou. Abra o grupo novamente.');
    const nextStatus=String(data.get('status')||'pending');if(!Object.hasOwn(inicResultLabels,nextStatus))throw new Error('Escolha um resultado da lista.');const note=['correction','rejected'].includes(nextStatus)?String(data.get('correction')||'').trim():'';if(nextStatus==='correction'&&note.length<3)throw new Error('Descreva a correção pendente.');
    if(typeof service.saveInicResult!=='function')throw new Error('Atualize a página para registrar o resultado.');
    try{await service.saveInicResult(group.id,uid,{year,status:nextStatus,correction:note,expectedUpdatedAt});}catch(error){if(current())throw error;return;}
    if(current())notice('Resultado do INIC registrado.');
  }});
}
function destroyIndicators() {coordinationDashboard?.destroy();coordinationDashboard=null;}
function renderIndicators() {
  if(state.role!=='coordinator'||!canAccessAcademic()){destroyIndicators();navigate('dashboard');return;}
  if(!coordinationDashboard)coordinationDashboard=createCoordinationDashboard({service,state,year:2027,onNotice:(text,kind='success')=>notice(text,kind)});else coordinationDashboard.updateState(state);
  $('#view-content').replaceChildren(coordinationDashboard.element);renderedKey='indicators';
}

function showEditGroup(group) {
  if(!canEditGroup(group))return;
  const actor=state.user?.uid,session=sessionVersion,actorRole=state.role;
  const fields=[makeField('Nome do grupo','name',{value:group.name,required:true,minLength:2,maxLength:100}).label,makeField('Tema da pesquisa','topic',{value:group.topic,required:true,minLength:3,maxLength:240}).label,makeField('Descrição','description',{value:group.description||'',type:'textarea',maxLength:3000}).label,makeField('Edição do INIC','year',{type:'number',value:group.year||2027,min:2027,max:2100,required:true}).label];
  openForm({title:'Editar grupo',fields,guard:()=>{const current=state.groups.find(item=>item.id===group.id);return Boolean(current&&canEditGroup(current));},handler:async data=>{
    if(state.user?.uid!==actor||sessionVersion!==session||state.role!==actorRole)return;
    const current=state.groups.find(item=>item.id===group.id);
    if(!current||!canEditGroup(current))throw new Error('Você não pode editar este grupo no momento.');
    await service.updateGroup(group.id,{name:String(data.get('name')).trim(),topic:String(data.get('topic')).trim(),description:String(data.get('description')).trim(),year:Number(data.get('year'))});if(state.user?.uid!==actor||sessionVersion!==session||state.role!==actorRole||state.archived||!canAccessAcademic())return;const latest=state.groups.find(item=>item.id===group.id);if(!latest||!canEditGroup(latest))return;notice('Informações do grupo atualizadas.');
  }});
}
function showDeleteGroup(group) {
  if(!isGroupManager(group))return;
  const actor=state.user?.uid,session=sessionVersion,actorRole=state.role;
  const description=node('p','dialog-note',`Excluir “${group.name}” remove permanentemente o grupo, seus integrantes, entregas, mensagens, convites e avaliações. As contas cadastradas continuam disponíveis.`);
  const warning=node('p','deletion-warning',group.status==='deleting'?'A exclusão foi iniciada. Confirme para concluir a remoção dos dados restantes.':'Esta ação não pode ser desfeita.');
  openForm({title:group.status==='deleting'?'Concluir exclusão do grupo':'Excluir grupo',fields:[description,warning],submit:'Excluir grupo',danger:true,guard:()=>{const current=state.groups.find(item=>item.id===group.id);return Boolean(current&&isGroupManager(current));},handler:async()=>{
    if(state.user?.uid!==actor||sessionVersion!==session||state.role!==actorRole)return;
    requireManagedGroup(group.id,true);
    await service.deleteGroup(group.id);
    if(state.user?.uid!==actor||sessionVersion!==session||state.role!==actorRole||state.archived||!canAccessAcademic())return;
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
function studentYearAvailability(person,schoolYear,existingGroup=false) {
  if(!isSchoolYear(person?.year))return {available:false,label:'Série não informada',detail:'O aluno precisa ter uma série válida no cadastro antes de entrar em um grupo.'};
  if(!isSchoolYear(schoolYear))return {available:false,label:existingGroup?'Série do grupo pendente':state.role==='student'?'Confira sua série':'Escolha a série',detail:existingGroup?'A série deste grupo ainda precisa ser confirmada pela coordenação antes de convidar alunos.':state.role==='student'?'Informe sua série no cadastro antes de convidar colegas.':'Escolha a série do grupo para ver quais alunos podem ser convidados.'};
  if(person.year!==schoolYear)return {available:false,label:'Outra série',detail:`Este aluno é do ${person.year}. O grupo só pode ter alunos do ${schoolYear}, sem misturar séries.`};
  return {available:true};
}
function personInviteAvailability(person,group) {
  if(!state.peopleReady||state.peopleError)return {available:false,label:'Consultando disponibilidade',detail:'Aguarde o carregamento das pessoas para enviar o convite.'};
  if(!person)return {available:false,label:'Cadastro indisponível',detail:'O cadastro não está mais disponível. Atualize a lista de pessoas.'};
  const status=participantStatus(person);
  if(person.id===state.user?.uid)return {available:false,label:'Seu perfil',detail:'Você não precisa enviar um convite para si.'};
  if(status.type==='member'&&state.role==='student'){const yearStatus=studentYearAvailability(person,state.profile?.year);if(!yearStatus.available)return yearStatus;}
  if(!status.available)return status;
  if(!group||!canInviteToGroup(group))return {available:false,label:'Escolha seu grupo',detail:'Escolha um grupo em que você pode enviar convites.'};
  if(status.type==='member'){const yearStatus=studentYearAvailability(person,group.schoolYear,true);if(!yearStatus.available)return yearStatus;}
  if(status.type==='member'&&group.members?.[person.id])return {available:false,label:'Já está no grupo',detail:'Este aluno já participa do grupo. Cada aluno pode participar de apenas um grupo.'};
  if(status.type==='advisor'&&group.advisorId)return {available:false,label:group.advisorId===person.id?'Já orienta este grupo':'Grupo já tem orientador',detail:group.advisorId===person.id?'Este professor já aceitou orientar este grupo. Ele pode orientar outros grupos também.':'Este grupo já tem um orientador confirmado. Não é necessário enviar outro convite.'};
  if(state.invitations.some(invite=>invite.groupId===group.id&&invite.type===status.type&&invite.toUid===person.id&&invite.status==='pending'))return {available:false,label:'Convite enviado',detail:'Já existe um convite para este grupo aguardando a resposta desta pessoa.'};
  if(status.type==='advisor'&&pendingAdvisorInvitations(group.id).length>=3)return {available:false,label:'Aguardando respostas',detail:'Este grupo já tem 3 convites de orientação pendentes. Aguarde uma resposta.'};
  return {available:true,label:status.type==='advisor'?'Convidar para orientar':'Convidar para meu grupo',detail:status.detail};
}
function communityInvitationState(person) {
  if(participantStatus(person).type==='member'){
    if(!isSchoolYear(person?.year))return {disabled:true,label:'Série não informada',detail:'O aluno precisa informar a série no cadastro antes de receber um convite.'};
    if(state.role==='student'){const yearStatus=studentYearAvailability(person,state.profile?.year);if(!yearStatus.available)return {disabled:true,label:yearStatus.label,detail:yearStatus.detail};}
  }
  if(!canAccessAcademic())return {disabled:true,label:'Envie seu termo',detail:'Você pode conhecer as pessoas agora. Envie seu termo assinado para criar o grupo e enviar convites.'};
  const manageable=state.groups.filter(canInviteToGroup);
  if(!manageable.length)return {disabled:!canCreateGroup(),label:canCreateGroup()?'Criar grupo e convidar':'Sem grupo para convidar',detail:canCreateGroup()?'Crie seu grupo para enviar o convite.':'Os convites são enviados por participantes de um grupo.'};
  const options=manageable.map(group=>personInviteAvailability(person,group));
  const available=options.find(option=>option.available);
  return available?{disabled:false,label:available.label,detail:available.detail}:{disabled:true,label:options[0].label,detail:options[0].detail};
}
function communityOptions() {
  return {people:state.people,ready:state.peopleReady,error:state.peopleError,currentUid:state.user?.uid||'',currentRole:state.role,currentYear:state.profile?.year||'',invitationState:communityInvitationState,onRetry:()=>{if(state.user)sessionChanged(state.user);},onInvite:person=>{
    if(!state.peopleReady||state.peopleError)return;
    const latest=state.people.find(item=>item.id===person.id);if(!latest||!participantStatus(latest).available)return;
    const permission=communityInvitationState(latest);if(permission.disabled){notice(permission.detail,'info');return;}
    const manageable=state.groups.filter(canInviteToGroup),group=manageable.find(item=>personInviteAvailability(latest,item).available);
    if(!manageable.length&&canCreateGroup()){showCreateGroup(latest);return;}
    if(!group){notice(communityInvitationState(latest).detail,'info');return;}
    showInviteForm(group.id,participantStatus(latest).type,latest.id);
  }};
}
function destroyCommunity(){communityView?.destroy();communityView=null;}
function renderPeople(){
  if(!canBrowseCommunity())return;
  if(!communityView){communityView=createCommunityView(communityOptions());$('#view-content').replaceChildren(communityView.element);}else communityView.update(communityOptions());
  let note=$('#community-access-note');
  if(!canAccessAcademic()){
    if(!note){note=node('section','panel');note.id='community-access-note';communityView.element.before(note);}
    note.replaceChildren(node('h3','','Conheça seus colegas'),node('p','muted','Você pode ver os alunos e professores cadastrados. Para criar seu grupo e enviar convites, primeiro envie o termo assinado.'),link('Enviar meu termo','#termo','button secondary'));
  }else note?.remove();
  renderedKey='people';
}
function buildStudentPicker({multiple=false,selectedIds=[],onChange=()=>{},group=()=>null,schoolYear=()=>state.profile?.year}={}) {
  const field=node('fieldset','advisor-picker member-picker');field.append(node('legend','',multiple?'Convidar colegas (opcional)':'Escolha o aluno'));
  const search=node('input','advisor-picker-search');search.type='search';search.placeholder='Buscar aluno pelo nome ou série';search.setAttribute('aria-label',multiple?'Buscar colegas para o grupo':'Buscar aluno para convidar');search.autocomplete='off';
  const list=node('div','advisor-picker-list'),status=node('p','member-picker-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const selected=new Set(selectedIds);let active=true,disposed=false;
  function available(person){const current=group();if(current)return personInviteAvailability(person,current);const status=participantStatus(person),yearStatus=studentYearAvailability(person,schoolYear());return !yearStatus.available?yearStatus:{...status,available:status.available&&person.id!==state.user?.uid};}
  function paint(){
    if(disposed)return;
    const focusUid=list.contains(document.activeElement)?document.activeElement?.value:null;
    list.replaceChildren();
    if(!state.peopleReady||state.peopleError){search.disabled=true;list.append(node('p','empty-small',state.peopleError?'Não foi possível carregar os alunos. Feche o formulário e tente novamente em Pessoas.':'Carregando alunos e disponibilidade…'));status.textContent='Aguarde a consulta antes de selecionar.';return;}
    search.disabled=!active;
    const students=state.people.filter(person=>participantStatus(person).type==='member'&&person.id!==state.user?.uid).sort((a,b)=>Number(available(b).available)-Number(available(a).available)||a.name.localeCompare(b.name,'pt-BR'));
    for(const uid of selected)if(!students.some(person=>person.id===uid&&available(person).available))selected.delete(uid);
    const query=normalize(search.value).trim(),matches=students.filter(person=>!query||normalize(`${person.name} ${person.year||''}`).includes(query));
    for(const person of matches){
      const option=available(person),label=node('label',`advisor-choice${option.available?'':' is-unavailable'}`),input=node('input'),copy=node('span','advisor-choice-copy');
      input.type=multiple?'checkbox':'radio';input.name=multiple?'memberUids':'memberUid';input.value=person.id;input.checked=selected.has(person.id);input.disabled=!active||!option.available;label.dataset.memberUid=person.id;
      const avatar=node('span','avatar',initials(person.name));avatar.setAttribute('aria-hidden','true');
      copy.append(node('strong','',person.name),node('small','',[person.year,option.available?'Disponível para convite':option.label].filter(Boolean).join(' · ')));
      if(!option.available)copy.append(node('small','',option.detail));
      input.addEventListener('change',()=>{if(disposed||input.disabled)return;const latest=state.people.find(item=>item.id===person.id);if(!state.peopleReady||state.peopleError||!latest||!available(latest).available){input.checked=false;selected.delete(person.id);paint();onChange();return;}if(input.checked){if(multiple&&selected.size>=20&&!selected.has(person.id)){input.checked=false;status.textContent='Selecione no máximo 20 colegas.';return;}if(!multiple){selected.clear();list.querySelectorAll('input').forEach(other=>{if(other!==input)other.checked=false;});}selected.add(person.id);}else selected.delete(person.id);paintStatus();onChange();});
      label.append(input,avatar,copy);list.append(label);
    }
    if(!matches.length)list.append(node('p','empty-small',students.length?'Nenhum aluno com esse nome ou série.':'Ainda não há outros alunos cadastrados. Os colegas aparecerão após criar a conta.'));
    paintStatus();if(focusUid)[...list.querySelectorAll('input')].find(input=>input.value===focusUid&&!input.disabled)?.focus({preventScroll:true});
  }
  function paintStatus(){const selectedYear=group()?.schoolYear||schoolYear();status.textContent=(multiple?`${selected.size} de 20 colegas selecionados. `:'')+(isSchoolYear(selectedYear)?`Somente alunos do ${selectedYear} podem entrar neste grupo. `:'Escolha a série antes de convidar alunos. ')+'Quem já participa de um grupo aparece como indisponível.';}
  search.addEventListener('input',paint);field.append(search,list,status);paint();
  return {field,selectedIds:()=>[...selected],update(){paint();},setActive(value){active=value;field.hidden=!value;paint();},destroy(){disposed=true;selected.clear();list.replaceChildren();}};
}
function showInviteForm(initialGroupId = '', initialType = 'member', initialUid = '') {
  const actor=state.user?.uid,session=sessionVersion;
  const manageable=state.groups.filter(canInviteToGroup);
  if(!manageable.length){
    if(canCreateGroup())openForm({title:'Crie seu grupo para convidar',fields:[node('p','dialog-note','Dê um nome à sua equipe, anexe a proposta e escolha as pessoas cadastradas que você quer convidar.')],submit:'Criar grupo',handler:()=>{showCreateGroup(state.people.find(person=>person.id===initialUid));return false;}});
    else notice(studentGroupId()?'Você já participa de um grupo. Abra seu grupo para consultar os integrantes e os convites.':'Aguarde seu grupo ficar disponível para enviar convites.','info');
    return;
  }
  const initialGroup=manageable.find(item=>item.id===initialGroupId)||manageable[0];
  const group=makeField('Grupo do convite','groupId',manageable.length===1?{type:'hidden',value:initialGroup.id}:{required:true,value:initialGroup.id,options:manageable.map(g=>({value:g.id,label:`${g.name} · ${isSchoolYear(g.schoolYear)?g.schoolYear:'Série pendente'}`}))});
  const currentGroup=()=>state.groups.find(item=>item.id===group.field.value);
  const groupContext=node('div','invite-group-context');groupContext.append(node('small','','CONVITE PARA O GRUPO'),node('strong','',initialGroup.name),node('span','',isSchoolYear(initialGroup.schoolYear)?`Alunos do ${initialGroup.schoolYear}`:'Série aguardando confirmação da coordenação'));groupContext.hidden=manageable.length!==1;
  const type=node('fieldset','invite-type-picker');type.append(node('legend','','Quem você quer convidar?'));
  const typeChoices=[];
  for(const [value,title,help]of [['member','Aluno ou colega','Somente alunos da série do grupo.'],['advisor','Professor(a)','Pode orientar vários grupos.']]){
    const choice=node('label','invite-type-choice'),input=node('input'),copy=node('span','invite-type-copy');input.type='radio';input.name='type';input.value=value;input.checked=value===(initialType==='advisor'?'advisor':'member');copy.append(node('strong','',title),node('small','',help));choice.append(input,copy);type.append(choice);typeChoices.push(input);input.addEventListener('change',toggle);
  }
  const inviteType=()=>typeChoices.find(input=>input.checked)?.value||'member';
  const memberPicker=buildStudentPicker({selectedIds:initialType==='member'&&initialUid?[initialUid]:[],group:currentGroup,onChange:updateSummary});
  const advisor=node('fieldset','advisor-picker invite-advisor-picker');advisor.append(node('legend','','Escolha o professor'));
  const search=node('input','advisor-picker-search');search.type='search';search.placeholder='Digite o nome do professor';search.setAttribute('aria-label','Buscar orientador para convidar');search.autocomplete='off';
  const advisorList=node('div','advisor-picker-list'),advisorEmpty=node('p','empty-small');let selectedAdvisorId=initialType==='advisor'?initialUid:'';
  const guidance=node('p','form-note');guidance.id='advisor-invite-guidance';guidance.setAttribute('role','status');guidance.setAttribute('aria-live','polite');advisor.setAttribute('aria-describedby',guidance.id);
  advisor.append(search,advisorList,advisorEmpty);
  const proposalSlot=node('div','invite-proposal-slot');let proposalEditor=null,proposalEditorGroup='';
  const summary=node('div','invite-summary');summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');summary.setAttribute('aria-atomic','true');
  function selectedPerson(){const uid=inviteType()==='advisor'?selectedAdvisorId:memberPicker.selectedIds()[0];return state.people.find(person=>person.id===uid);}
  function updateSummary(){
    const person=selectedPerson(),current=currentGroup(),isAdvisor=inviteType()==='advisor';
    const available=personInviteAvailability(person,current);
    summary.replaceChildren(node('strong','','Confira o convite'),node('p','',person?available.available?`${person.name} receberá um convite para ${isAdvisor?'orientar':'participar do'} grupo “${current?.name||initialGroup.name}”.`:available.detail:isAdvisor?'Selecione um professor disponível na lista acima.':'Selecione um aluno disponível na lista acima.'),node('small','','A pessoa recebe o convite no Meu INIC e só entra no grupo após aceitar.'));
    const submit=$('#dialog-submit');if(submit&&!submit.hasAttribute('aria-busy'))submit.disabled=!person||!available.available;
  }
  function paintAdvisors(){
    const focused=advisorList.contains(document.activeElement)?document.activeElement?.value:null;
    advisorList.replaceChildren();
    const people=state.people.filter(person=>participantStatus(person).type==='advisor').sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    const query=normalize(search.value).trim(),current=currentGroup();
    if(selectedAdvisorId&&!people.some(person=>person.id===selectedAdvisorId&&personInviteAvailability(person,current).available))selectedAdvisorId='';
    let visible=0;
    for(const person of people){
      const availability=personInviteAvailability(person,current),label=node('label','advisor-choice'),input=node('input'),copy=node('span','advisor-choice-copy');input.type='radio';input.name='toUid';input.value=person.id;input.checked=selectedAdvisorId===person.id;input.disabled=inviteType()!=='advisor'||!availability.available;label.hidden=Boolean(query&&!normalize(person.name).includes(query));if(!label.hidden)visible++;
      copy.append(node('strong','',advisorLabel(person)),node('small','',availability.available?'Disponível · pode orientar vários grupos':availability.label));if(!availability.available)copy.append(node('small','',availability.detail));
      const avatar=node('span','avatar',initials(person.name));avatar.setAttribute('aria-hidden','true');label.append(input,avatar,copy);advisorList.append(label);
      input.addEventListener('change',()=>{if(!input.checked||input.disabled)return;selectedAdvisorId=person.id;advisorList.querySelectorAll('input').forEach(other=>{if(other!==input)other.checked=false;});updateSummary();});
    }
    advisorEmpty.hidden=visible>0;advisorEmpty.textContent=state.peopleError?'Não foi possível carregar os professores. Feche o formulário e tente novamente em Pessoas.':!state.peopleReady?'Carregando professores e disponibilidade…':people.length?'Nenhum professor com esse nome.':'A coordenação ainda não liberou professores para convite.';
    if(focused)[...advisorList.querySelectorAll('input')].find(input=>input.value===focused&&!input.disabled)?.focus({preventScroll:true});
  }
  function toggle(){
    const isAdvisor=inviteType()==='advisor',current=currentGroup(),pending=pendingAdvisorInvitations(group.field.value);
    memberPicker.setActive(!isAdvisor);advisor.hidden=!isAdvisor;guidance.hidden=!isAdvisor;search.disabled=!isAdvisor||!state.peopleReady||Boolean(state.peopleError);paintAdvisors();
    guidance.textContent=current?.advisorId?'Este grupo já tem um orientador confirmado. O professor pode orientar outros grupos.':pending.length>=3?'Há 3 convites de orientação aguardando resposta. Aguarde uma resposta para enviar outro.':`Escolha até 3 professores por grupo. O primeiro aceite confirma a orientação. ${pending.length} de 3 convites pendentes.`;
    const needsProposal=isAdvisor&&!current?.advisorId&&pending.length<3&&!current?.proposal;
    proposalSlot.hidden=!needsProposal;
    if(needsProposal&&proposalEditorGroup!==current?.id){proposalEditor?.destroy();proposalEditor=createProposalEditor({});proposalEditorGroup=current?.id||'';proposalSlot.replaceChildren(proposalEditor.element);}
    updateSummary();
  }
  search.addEventListener('input',paintAdvisors);group.field.addEventListener('change',toggle);
  const sameSession=()=>state.user?.uid===actor&&sessionVersion===session&&canAccessAcademic();
  openForm({title:'Enviar convite',fields:[manageable.length===1?group.field:group.label,groupContext,type,memberPicker.field,advisor,guidance,proposalSlot,summary],submit:'Enviar convite',busy:'Enviando convite…',guard:()=>sameSession()&&state.groups.some(canInviteToGroup),onUpdate:toggle,cleanup:()=>{memberPicker.destroy();proposalEditor?.destroy();},handler:async data=>{
    if(!sameSession())return;
    const groupId=String(data.get('groupId')),type=String(data.get('type')),current=state.groups.find(item=>item.id===groupId);
    if(!current||!canInviteToGroup(current))throw new Error('Você não pode enviar convites para este grupo.');
    if(!['member','advisor'].includes(type))throw new Error('Escolha aluno ou professor para enviar o convite.');
    const toUid=type==='advisor'?selectedAdvisorId:memberPicker.selectedIds()[0],person=state.people.find(item=>item.id===toUid);
    const availability=personInviteAvailability(person,current);
    if(!person||participantStatus(person).type!==type)throw new Error('Selecione uma pessoa cadastrada para enviar o convite.');
    if(!availability.available)throw new Error(availability.detail);
    if(type==='advisor'&&!current.proposal){
      if(proposalEditorGroup!==groupId||!proposalEditor)throw new Error('Anexe a proposta antes de convidar o professor.');
      if(typeof service.saveProposal!=='function')throw new Error('Atualize a página para anexar a proposta.');
      try{await service.saveProposal(groupId,{...proposalEditor.read(),expectedVersion:null});}catch(error){if(sameSession())throw error;return;}
      if(!sameSession())return;
      const refreshed=personInviteAvailability(state.people.find(item=>item.id===toUid),state.groups.find(item=>item.id===groupId));if(!refreshed.available)throw new Error(refreshed.detail);
    }
    try{await service.invite({groupId,type,toUid});}catch(error){if(sameSession())throw error;return;}
    if(sameSession()){invitationFilter='sent';if(currentRoute.view==='invitations')render();notice(`Convite enviado para ${person.name}. A pessoa poderá aceitar na aba Convites do Meu INIC.`,'success',true,{title:'Convite enviado',href:'#convites',label:'Ver convites enviados'});}
  }});toggle();
}

function renderGroup() {
  const group=state.groups.find(g=>g.id===currentRoute.groupId);
  if(!group||state.role==='advisor'&&group.advisorId!==state.user.uid){$('#view-content').replaceChildren(emptyState('Este grupo não está disponível','Você precisa fazer parte do grupo, orientá-lo ou ter acesso da coordenação. Se acabou de aceitar um convite, aguarde a sincronização.',[link('Meus grupos','#grupos','button secondary'),link('Ver convites','#convites','button primary')]));renderedKey='';return;}
  if(group.status==='archived'||group.archived===true){$('#view-content').replaceChildren(emptyState('Grupo indisponível','O chat e as entregas deste grupo não estão disponíveis.',[link('Voltar aos grupos','#grupos','button secondary')]));renderedKey='';return;}
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
    const tabs=node('nav','group-tabs');tabs.setAttribute('aria-label','Áreas do grupo');[['overview','Resumo'],['tasks','Entregas'],['article','Artigo INIC'],['messages','Chat do grupo'],['evaluations','Avaliações']].forEach(([tab,label])=>{const a=link(label,routeHref('group',group.id,tab));if(tab===currentRoute.tab)a.setAttribute('aria-current','page');tabs.append(a);});fragment.append(tabs);
    const content=node('div');content.id='group-panel';fragment.append(content);$('#view-content').replaceChildren(fragment);renderedKey=key;
    if(currentRoute.tab==='messages')buildMessagesView(group);
  }
  const copy=$('#group-heading-copy');copy.querySelector('.badge').textContent=`INIC ${group.year||2027}`;copy.querySelector('h2').textContent=group.name;copy.querySelector('p').textContent=group.topic||'Tema em definição';
  $('#group-meta').replaceChildren(node('span','',`Orientação: ${advisorName(group)}`),node('span','',`${Object.values(group.members||{}).filter(Boolean).length} integrante(s)`));
  const actions=$('#group-header-actions');actions.replaceChildren();
  if(canAssignGroupAdvisor(group)){const assign=button('Atribuir orientador','button primary compact',()=>showAssignAdvisor(group));assign.dataset.groupAssign=group.id;actions.append(assign);}
  if(canReplaceGroupAdvisor(group))actions.append(button('Substituir orientador','button secondary compact',()=>showReplaceAdvisor(group)));
  if(canWithdrawGroupAdvisor(group))actions.append(button('Sair da orientação','text-button destructive-action',()=>showWithdrawAdvisor(group)));
  if(canEditGroup(group))actions.append(button('Editar grupo','button secondary compact',()=>showEditGroup(group)));
  if(canInviteToGroup(group))actions.append(button('Convidar +','button primary compact',()=>showInviteForm(group.id)));
  if(isGroupManager(group))actions.append(button('Excluir grupo','text-button destructive-action',()=>showDeleteGroup(group)));
  const data=groupData.get(group.id);const tasks=data?.tasks||[];const prog=$('#group-progress');prog.replaceChildren(progressBlock(tasks,'Progresso da pesquisa'),node('p','',`${tasks.filter(t=>t.completed).length} de ${tasks.length} entregas concluídas.`));
  const late=tasks.filter(t=>statusOf(t).key==='late').length;prog.append(node('div','due-summary',late?`${late} ${late===1?'etapa precisa':'etapas precisam'} de atenção.`:'Um passo de cada vez. Mantenha o grupo em dia.'));
  if(currentRoute.tab==='article'){renderGroupArticle(group);return;}
  if(!data){$('#group-panel').replaceChildren(loadingPanel('Carregando as entregas e mensagens do grupo…'));return;}
  if(currentRoute.tab==='overview')renderGroupOverview(group,tasks);
  else if(currentRoute.tab==='tasks')renderGroupTasks(group,tasks);
  else if(currentRoute.tab==='evaluations')renderGroupEvaluations(group,data);
  else {if(!$('#messages-list'))buildMessagesView(group);paintMessages(data.messages||[]);}
}
function articleScope(group){return `${state.user?.uid}/${state.role}/${state.role==='advisor'?group.advisorId||'':''}/${state.role==='student'?Boolean(group.members?.[state.user?.uid]):''}/${group.status||''}/${group.year||2027}`;}
function pruneArticleEditors(){
  for(const [id,entry]of articleEditors){const group=state.groups.find(item=>item.id===id);if(!canAccessAcademic()||!group||['deleting','archived'].includes(group.status)||group.archived===true||state.role==='advisor'&&group.advisorId!==state.user?.uid||state.role==='student'&&group.members?.[state.user?.uid]!==true||entry.scope!==articleScope(group)){entry.editor.destroy();articleEditors.delete(id);}}
}
function renderGroupArticle(group){
  if(!articleEditors.has(group.id)){
    if(typeof service.subscribeArticle!=='function'||typeof service.saveArticleSection!=='function'){$('#group-panel').replaceChildren(emptyState('Atualize o aplicativo','Recarregue a página para abrir o editor do artigo.'));return;}
    const actor=state.user.uid,session=sessionVersion,scope=articleScope(group);
    const editor=createArticleEditor({group,user:{uid:actor},subscribe:callback=>service.subscribeArticle(group.id,callback),onSave:(key,text,revision)=>{
      const current=state.groups.find(item=>item.id===group.id);
      if(state.user?.uid!==actor||sessionVersion!==session||!canAccessAcademic()||!current||articleScope(current)!==scope)throw new Error('O acesso ao grupo mudou. Reabra o artigo antes de salvar.');
      return service.saveArticleSection(group.id,key,text,revision);
    }});articleEditors.set(group.id,{editor,scope});
  }
  const editor=articleEditors.get(group.id).editor;
  if(editor.element.parentNode!==$('#group-panel'))$('#group-panel').replaceChildren(editor.element);
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
  const assignment=group.advisorAssignment;
  if(assignment&&(assignment.advisorUid===group.advisorId||assignment.action==='withdraw'&&!group.advisorId)){const assigned=node('section','panel advisor-assignment-card');assigned.setAttribute('aria-label','Registro de orientação');assigned.append(node('span',`badge ${assignment.action==='withdraw'?'warning':'success'}`,assignment.action==='withdraw'?'Grupo sem orientador':'Orientação confirmada'),node('h3','',assignment.action==='withdraw'?'Orientador deixou o grupo':assignment.action==='replace'?'Orientador substituído pela coordenação':'Orientador atribuído pela coordenação'),node('p','advisor-assignment-name',assignment.action==='withdraw'?assignment.previousAdvisorName||'Orientação encerrada':assignment.advisorName||advisorName(group)));if(assignment.action==='replace'&&assignment.previousAdvisorName)assigned.append(node('p','advisor-assignment-audit',`Orientação anterior: ${assignment.previousAdvisorName}`));assigned.append(node('p','advisor-assignment-audit',`${assignment.assignedByName||'Coordenação'} · ${agreementTimestamp(assignment.assignedAt)}`));if(assignment.reason)assigned.append(node('p','orientation-notice-reason',assignment.reason));fragment.append(assigned);}
  const confirmation=groupData.get(group.id)?.advisorConfirmation;
  if(confirmation&&group.advisorId===confirmation.advisorUid){
    const confirmed=node('section','panel advisor-confirmation');confirmed.setAttribute('aria-label','Orientação confirmada');
    confirmed.append(node('span','badge success','Orientação confirmada'),node('h3','',`${confirmation.advisorName||advisorName(group)} aceitou orientar este grupo.`),node('p','',`Aceite registrado em ${agreementTimestamp(confirmation.createdAt)}.`));fragment.append(confirmed);
  }else if(!group.advisorId&&group.advisorRequestPolicy==='first-accept-v1'){
    const pending=pendingAdvisorInvitations(group.id);const waiting=node('section','panel advisor-confirmation is-waiting');
    waiting.append(node('span','badge warning','Escolha de orientação'),node('h3','',pending.length?`${pending.length} convite(s) aguardando resposta`:'Convide um(a) orientador(a)'),node('p','','Envie convites para até 3 orientadores ao mesmo tempo. O primeiro aceite confirma a orientação.'));
    if(canInviteToGroup(group))waiting.append(button('Convidar orientador(a)','button secondary compact',()=>showInviteForm(group.id,'advisor')));fragment.append(waiting);
  }
  const proposalPanel=node('section','panel group-proposal-panel');proposalPanel.append(createProposalView({proposal:group.proposal,onDownload:event=>downloadProposal(group.id,group.proposal,event.currentTarget,'',()=>currentRoute.view==='group'&&currentRoute.groupId===group.id&&currentRoute.tab==='overview')}));if(canManage(group))proposalPanel.append(button(group.proposal?'Atualizar proposta':'Adicionar proposta','button secondary compact',()=>showEditProposal(group)));fragment.append(proposalPanel,inicResultPanel(group),columns);
  const next=tasks.filter(t=>!t.completed).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,3);
  const nextPanel=node('section','panel mt-24');const head=node('div','panel-heading');head.append(node('h3','','Próximos passos'),link('Todas as entregas',routeHref('group',group.id,'tasks')));nextPanel.append(head);
  if(next.length)nextPanel.append(...next.map(t=>taskPreview({...t,groupId:group.id,groupName:group.name})));else nextPanel.append(node('p','empty-small',tasks.length?'Todas as etapas deste grupo foram concluídas.':'O cronograma ainda não tem etapas. Abra “Entregas” para começar.'));
  fragment.append(nextPanel,supportCard());$('#group-panel').replaceChildren(fragment);
}
function renderGroupTasks(group,tasks) {
  const fragment=document.createDocumentFragment();const toolbar=node('div','tasks-toolbar');const pills=node('div','filter-pills task-filters');pills.setAttribute('role','group');pills.setAttribute('aria-label','Filtrar entregas');
  [['all','Todas','list'],['pending','Pendentes','clock'],['late','Em atraso','late'],['done','Concluídas','done']].forEach(([value,label,icon])=>{const b=filterButton(label,icon,value===taskFilter,()=>{taskFilter=value;renderGroupTasks(group,groupData.get(group.id)?.tasks||[]);document.querySelector(`[data-task-filter="${value}"]`)?.focus({preventScroll:true});},'filtered-task-list');b.dataset.taskFilter=value;pills.append(b);});toolbar.append(pills);
  if(canManageTasks(group))toolbar.append(button('Adicionar entrega +','button secondary compact',()=>showTaskForm(group)));
  fragment.append(toolbar);
  const filtered=tasks.filter(t=>taskFilter==='all'||(taskFilter==='pending'?!t.completed:statusOf(t).key===taskFilter)).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
  const list=node('div','task-list');list.id='filtered-task-list';
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
  if(!canChatGroup(group)){$('#group-panel').replaceChildren(emptyState('Chat indisponível','O grupo precisa estar ativo e você deve participar dele.'));return;}
  const actor=state.user?.uid,session=sessionVersion;const sameSession=()=>state.user?.uid===actor&&sessionVersion===session&&!state.archived;
  const panel=node('section','panel message-panel');const head=node('div','message-panel-head');const copy=node('div');copy.append(node('h3','',group.name),node('p','','Conversa do grupo · integrantes, orientador e coordenação'));head.append(copy,node('span','badge','Em tempo real'));panel.append(head);
  const messages=node('div','messages');messages.id='messages-list';messages.setAttribute('role','log');messages.setAttribute('aria-label','Mensagens do grupo');messages.setAttribute('aria-live','polite');messages.setAttribute('aria-relevant','additions');panel.append(messages);
  const form=node('form','message-compose');const label=node('label','field','Sua mensagem');const textarea=node('textarea');textarea.id='message-draft';textarea.name='message';textarea.maxLength=2000;textarea.required=true;textarea.placeholder='Escreva uma pergunta ou compartilhe o próximo passo…';textarea.rows=2;label.append(textarea);const send=node('button','button primary','Enviar');send.type='submit';form.append(label,send);panel.append(form,node('p','compose-footer','Máximo de 2.000 caracteres. Ctrl + Enter também envia. Mensagens ficam visíveis aos integrantes, ao orientador e à coordenação.'));
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!sameSession())return;const text=textarea.value.trim();if(!text)return;
    const ok=await action(send,async()=>{const current=state.groups.find(item=>item.id===group.id);if(!sameSession())return;if(!canChatGroup(current))throw new Error('O chat deste grupo não está disponível para sua conta.');try{await service.sendMessage(group.id,text);}catch(error){if(sameSession())throw error;}});if(ok&&sameSession()){textarea.value='';textarea.focus();}
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

function invitationYear(invite) {
  const group=state.groups.find(item=>item.id===invite.groupId);
  if(group)return {ready:true,year:group.schoolYear||''};
  if(isSchoolYear(invite.schoolYear))return {ready:true,year:invite.schoolYear};
  const stored=invitationSchoolYears.get(invite.groupId);if(stored)return stored;
  if(typeof service.getGroupSchoolYear!=='function')return {ready:true,year:'',error:true};
  const actor=state.user?.uid,session=sessionVersion,entry={ready:false,year:''};
  invitationSchoolYears.set(invite.groupId,entry);
  Promise.resolve().then(()=>service.getGroupSchoolYear(invite.groupId)).then(year=>{
    if(state.user?.uid!==actor||sessionVersion!==session)return;
    invitationSchoolYears.set(invite.groupId,{ready:true,year:isSchoolYear(year)?year:''});
    if(currentRoute.view==='invitations')render();
  }).catch(()=>{
    if(state.user?.uid!==actor||sessionVersion!==session)return;
    invitationSchoolYears.set(invite.groupId,{ready:true,year:'',error:true});
    if(currentRoute.view==='invitations')render();
  });
  return entry;
}
function memberInvitationAvailability(invite) {
  if(invite.type!=='member'||state.role!=='student')return {available:true};
  if(studentGroupId())return {available:false,detail:'Você já aceitou um convite ou criou seu grupo. Cada aluno pode participar de apenas um grupo; este convite não pode ser aceito.'};
  if(!state.peopleReady||state.peopleError)return {available:false,detail:state.peopleError?'Não foi possível consultar sua disponibilidade. Tente novamente em Pessoas.':'Consultando sua participação nos grupos…'};
  if(!isSchoolYear(state.profile?.year))return {available:false,detail:'Informe sua série no cadastro antes de aceitar um convite.'};
  const result=invitationYear(invite);
  if(!result.ready)return {available:false,detail:'Conferindo a série do grupo…'};
  if(result.error)return {available:false,detail:'Não foi possível conferir a série deste grupo. Tente novamente antes de aceitar.',retry:true};
  if(!isSchoolYear(result.year))return {available:false,detail:'A série deste grupo precisa ser confirmada pela coordenação antes de aceitar novos alunos.'};
  if(result.year!==state.profile.year)return {available:false,detail:`Este grupo é do ${result.year}. Você é do ${state.profile.year} e só pode participar de um grupo da sua própria série.`};
  return {available:true};
}
function renderInvitations() {
  const fragment=document.createDocumentFragment();const orientationPanel=orientationNoticesPanel();if(orientationPanel)fragment.append(orientationPanel);fragment.append(heading('Convites',state.role==='advisor'?'Você pode orientar vários grupos. Convide alunos disponíveis e acompanhe as respostas.':'Conecte-se com a comunidade e acompanhe seus convites. Cada aluno participa de um grupo.',[link('Encontrar pessoas','#pessoas','button secondary'),button('Enviar convite +','button primary',()=>showInviteForm())]));
  const filters=node('div','filter-pills invite-tabs');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar convites');[['incoming','Recebidos'],['sent','Enviados'],['history','Histórico']].forEach(([value,label])=>{const b=filterButton(label,value,value===invitationFilter,()=>{invitationFilter=value;render();document.querySelector(`[data-invitation-filter="${value}"]`)?.focus({preventScroll:true});},'invitation-results');b.dataset.invitationFilter=value;filters.append(b);});const results=node('div');results.id='invitation-results';fragment.append(filters,results);
  const invitations=state.invitations.filter(i=>invitationFilter==='incoming'?i.status==='pending'&&isRecipient(i):invitationFilter==='sent'?i.senderId===state.user.uid&&i.status==='pending':i.status!=='pending').sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  if(!invitations.length){results.append(emptyState(invitationFilter==='incoming'?'Nenhum convite aguardando resposta':invitationFilter==='sent'?'Nenhum convite pendente enviado':'O histórico aparece aqui',invitationFilter==='incoming'?'Quando um orientador ou grupo convidar você, o convite aparecerá aqui. Confira se está usando o mesmo e-mail informado.':'Você poderá acompanhar o grupo, o destinatário e a situação de cada convite.'));return fragment;}
  const grid=node('div','invite-grid');
  invitations.forEach(invite=>{
    const name=invite.groupName||groupName(invite.groupId);
    const card=node('article','invitation-card');const border=node('div','invitation-card__border-top');border.setAttribute('aria-hidden','true');
    const avatar=node('div','invitation-card__avatar',initials(name));avatar.setAttribute('aria-hidden','true');
    const recipient=state.people.find(person=>person.id===invite.toUid)?.name||invite.toEmail||state.advisors.find(a=>a.id===invite.toUid)?.name||(invite.toUid===state.user.uid?myName():invite.type==='advisor'?'Professor(a) convidado(a)':'Aluno(a) convidado(a)');
    const date=typeof invite.createdAt==='number'?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(invite.createdAt)):'';
    const status={pending:'Aguardando resposta',accepted:'Aceito',declined:'Recusado',cancelled:'Cancelado'}[invite.status]||invite.status;
    card.append(border,avatar,node('h3','invitation-card__name',name),node('p','invitation-card__role',invite.type==='advisor'?'Convite para orientar o grupo':'Convite para participar do grupo'),node('p','invitation-card__details',`De: ${invite.senderName||'Participante'}\nPara: ${recipient}${date?'\nEnviado em '+date:''}`),node('span','invitation-card__status',status));
    if(invite.status==='pending'&&isRecipient(invite)) {
      if(invite.type==='advisor'&&['advisor','coordinator'].includes(state.role)){const read=button('Ler proposta de TCC','button secondary',()=>showInvitationProposal(invite));read.dataset.invitationProposal=invite.id;card.append(read);}
      const actions=node('div','invitation-card__actions');
      const membership=memberInvitationAvailability(invite);
      const accept=button('Aceitar convite','button primary',event=>{
        const current=state.invitations.find(item=>item.id===invite.id);
        if(!current||current.status!=='pending'||!isRecipient(current)||!canAccessAcademic()){notice('Este convite não está mais disponível. Atualize a lista.','info');return;}
        const availability=memberInvitationAvailability(current);if(!availability.available){notice(availability.detail,'info');return;}
        action(event.currentTarget,()=>service.respondInvitation(invite.id,true),invite.type==='advisor'?'Orientação confirmada. Você pode orientar outros grupos também.':'Convite aceito. Seu grupo está disponível em Meus grupos.',invite.type==='advisor'?'Confirmando orientação…':'Entrando no grupo…');
      });
      const requiresVerification=Boolean(invite.toEmail&&!state.user.emailVerified),requiresApproval=invite.type==='advisor'&&!['advisor','coordinator'].includes(state.role);
      if(requiresVerification||requiresApproval||!membership.available){accept.disabled=true;accept.title=!membership.available?membership.detail:requiresApproval?'Aguarde a aprovação da coordenação para orientar.':'Confirme seu e-mail primeiro';}
      if(!membership.available)card.append(node('p','invitation-card__notice',membership.detail));
      if(membership.retry)card.append(button('Conferir série novamente','text-button',()=>{invitationSchoolYears.delete(invite.groupId);render();}));

      actions.append(accept,button('Recusar','button secondary',()=>confirmAction('Recusar convite?',`O convite para “${invite.groupName||'este grupo'}” será recusado. Um novo convite poderá ser enviado depois.`,async()=>{await service.respondInvitation(invite.id,false);notice('Convite recusado.');},'Recusar convite')));card.append(actions);
      if(requiresVerification)card.append(node('p','invitation-card__notice','Confirme seu e-mail para aceitar. Use “Enviar confirmação” no aviso acima.'));
      if(requiresApproval)card.append(node('p','invitation-card__notice','A coordenação precisa aprovar seu perfil de professor(a) antes do aceite.'));
    } else if(invite.status==='pending'){const target=state.people.find(person=>person.id===invite.toUid),group=state.groups.find(item=>item.id===invite.groupId),schoolYear=group?.schoolYear||invite.schoolYear;card.append(node('p','invitation-card__notice',invite.type==='member'&&target?.groupId?'Este aluno já participa de um grupo e não pode aceitar outro convite.':invite.type==='member'&&target&&isSchoolYear(schoolYear)&&target.year!==schoolYear?'Este aluno é de outra série e não pode aceitar o convite para este grupo.':'Aguardando o aceite do destinatário.'));}
    grid.append(card);
  });results.append(grid);return fragment;
}

function renderCalendar() {
  const fragment=document.createDocumentFragment();
  const events=state.groups.flatMap(group=>(groupData.get(group.id)?.events||[]).map(event=>({...event,groupId:group.id,groupName:group.name})));
  const calendar=createCalendarView({groups:state.groups.filter(group=>group.status!=='deleting'),tasks:allTasks(),events,canManageGroup:group=>canManageTasks(group),onAddEvent:(groupId,date)=>showEventForm(groupId,date),onEditEvent:event=>showEventForm(event.groupId,event.date,event),onTask:showCalendarTask,onNotice:notice,initialDate:new Date(2027,0,1,12),viewState:calendarViewState});
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
function canManagePeople() { return Boolean(state.user&&state.ready&&!state.archived&&state.role==='coordinator'); }
function personArchived(person) { return Boolean(person?.archived); }
function isProtectedPerson(person) { return person?.id===state.user?.uid||person?.role==='coordinator'; }
function currentManagedPerson(uid,{archived=false}={}) {
  if(!canManagePeople())throw new Error('Somente a coordenação pode gerenciar os cadastros.');
  const person=state.users.find(item=>item.id===uid);
  if(!person)throw new Error('Este cadastro não está disponível. Atualize a lista.');
  if(personArchived(person)!==archived)throw new Error('A situação deste cadastro mudou. Confira a lista atual.');
  return person;
}
function showEditUser(person) {
  if(!canManagePeople()||personArchived(person))return;
  const actor=state.user.uid,session=sessionVersion,uid=person.id;
  const student=(person.role||'student')==='student'&&person.requestedRole!=='advisor';
  const name=makeField(student?'Nome completo do aluno':'Nome completo','name',{value:person.name||'',required:true,minLength:2,maxLength:100,autocomplete:'name'});
  const email=makeField('E-mail de acesso','email',{value:person.email||'',help:'O e-mail de acesso permanece o mesmo.'});email.field.readOnly=true;
  const year=makeField('Série escolar','year',{value:person.year||'',options:[{value:'',label:'Não se aplica'},...SCHOOL_YEARS],help:student?'A série de um aluno vinculado a um grupo só pode ser alterada após remover esse vínculo, para evitar grupos com séries diferentes.':''});
  if(person.year&&![...year.field.options].some(option=>option.value===person.year)){const option=node('option','',person.year);option.value=person.year;year.field.append(option);year.field.value=person.year;}
  const role=!isProtectedPerson(person)?makeField('Acesso à plataforma','role',{value:person.role||'student',options:[{value:'student',label:'Estudante'},{value:'advisor',label:'Professor(a) orientador(a)'}]}):null;
  const fields=[name.label,email.label,year.label];if(role)fields.push(role.label);else fields.push(node('p','dialog-note','O acesso desta conta está protegido. Você pode corrigir o nome e a série.'));
  openForm({title:student?'Editar nome e cadastro do aluno':'Editar nome e cadastro',kicker:'COORDENAÇÃO',access:'admin',fields,submit:'Salvar alterações',busy:'Salvando cadastro…',handler:async data=>{
    if(state.user?.uid!==actor||sessionVersion!==session)return;
    const current=currentManagedPerson(uid);
    const payload={name:String(data.get('name')||'').trim(),year:String(data.get('year')||'')};
    if(data.has('role')){
      if(isProtectedPerson(current))throw new Error('O acesso desta conta está protegido. Reabra o cadastro.');
      const nextRole=String(data.get('role'));if(!['student','advisor'].includes(nextRole))throw new Error('Escolha estudante ou professor(a).');payload.role=nextRole;
    }
    if(typeof service.updateUser!=='function')throw new Error('Atualize a página para gerenciar os cadastros.');
    try {await service.updateUser(uid,payload);}catch(error){if(state.user?.uid===actor&&sessionVersion===session&&canManagePeople())throw error;return;}
    if(state.user?.uid!==actor||sessionVersion!==session||!canManagePeople())return;
    notice('Cadastro atualizado.');
  }});
}
function showDeleteUserPermanently(person) {
  if(!canManagePeople()||isProtectedPerson(person))return;
  const actor=state.user.uid,session=sessionVersion,uid=person.id,archived=personArchived(person);
  const unfinished=['archiving','deleting'].includes(person.archive?.status);
  let deletionStarted=false;
  const details=node('div','dialog-details');details.append(node('strong','',person.name||'Pessoa cadastrada'),node('span','',person.email||''));
  const description=node('p','dialog-note','Exclui o cadastro, os documentos pessoais e os vínculos com grupos. O conteúdo compartilhado dos grupos será preservado. Esta ação não pode ser desfeita.');
  const confirmation=makeField('Entendo que este cadastro será excluído definitivamente.','confirmDeleteUser',{type:'checkbox',required:true});confirmation.label.classList.add('admin-confirmation');
  const fields=[details,description];
  if(unfinished)fields.push(node('p','form-note','O acesso já está bloqueado. Confirme para concluir a exclusão que ficou pendente.'));
  fields.push(confirmation.label);
  openForm({title:unfinished?'Concluir exclusão definitiva':'Excluir cadastro definitivamente',kicker:'COORDENAÇÃO',access:'admin',fields,submit:unfinished?'Concluir exclusão':'Excluir definitivamente',danger:true,busy:'Excluindo cadastro e dados pessoais…',handler:async data=>{
    if(state.user?.uid!==actor||sessionVersion!==session)return;
    const pendingRetry=deletionStarted&&['archiving','deleting'].includes(state.users.find(item=>item.id===uid)?.archive?.status);
    const current=currentManagedPerson(uid,{archived:archived||pendingRetry});
    if(isProtectedPerson(current))throw new Error('Não é possível excluir sua própria conta ou uma conta de coordenação.');
    if(!data.has('confirmDeleteUser'))throw new Error('Confirme a exclusão definitiva do cadastro para continuar.');
    if(typeof service.deleteUserPermanently!=='function')throw new Error('Atualize a página para excluir um cadastro definitivamente.');
    deletionStarted=true;
    try {await service.deleteUserPermanently(uid);}catch(error){if(state.user?.uid===actor&&sessionVersion===session&&canManagePeople())throw error;return;}
    if(state.user?.uid!==actor||sessionVersion!==session||!canManagePeople())return;
    notice('Cadastro e dados pessoais excluídos definitivamente. O conteúdo compartilhado dos grupos foi preservado.');
  }});
}
function paintManagedUsers() {
  const list=$('#admin-user-list'),count=$('#admin-user-count'),pagination=$('#admin-user-pagination');if(!list||!canManagePeople())return;
  document.querySelectorAll('[data-user-filter]').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.userFilter===userFilter)));
  pagination.hidden=true;
  list.setAttribute('aria-busy',String(!state.usersReady&&!state.usersError));
  if(state.usersError){
    count.textContent='Indisponível';
    const error=node('div','admin-user-error');error.id='admin-user-error';error.setAttribute('role','alert');
    error.append(node('h4','','Não foi possível carregar os cadastros.'),node('p','','Confira sua conexão e tente novamente.'),button('Tentar novamente','button secondary compact',()=>location.reload()));
    list.replaceChildren(error);return;
  }
  if(!state.usersReady){count.textContent='Carregando…';list.replaceChildren(loadingPanel('Carregando cadastros…'));return;}
  const query=normalize(userSearch).trim();
  const people=state.users.filter(person=>(userFilter==='archived'?personArchived(person):!personArchived(person)&&(userFilter==='all'||(userFilter==='students'?(person.role||'student')==='student'&&person.requestedRole!=='advisor':person.role==='advisor'||(person.role==='coordinator'&&isListedAdvisor(person.id))||(person.role!=='coordinator'&&person.requestedRole==='advisor'))))&&(!query||normalize(`${person.name||''} ${person.email||''} ${person.year||''}`).includes(query))).sort((a,b)=>(a.name||'').localeCompare(b.name||'','pt-BR'));
  count.textContent=`${fmtNumber(people.length)} ${people.length===1?'cadastro':'cadastros'}`;
  const pages=Math.max(1,Math.ceil(people.length/USERS_PER_PAGE));userPage=Math.min(Math.max(1,userPage),pages);
  const start=(userPage-1)*USERS_PER_PAGE,end=Math.min(start+USERS_PER_PAGE,people.length);
  $('#admin-user-range').textContent=people.length?`Mostrando ${fmtNumber(start+1)}–${fmtNumber(end)} de ${fmtNumber(people.length)} ${people.length===1?'cadastro':'cadastros'}`:'';
  $('#admin-user-page').textContent=`Página ${fmtNumber(userPage)} de ${fmtNumber(pages)}`;
  $('#admin-users-prev').disabled=userPage===1;$('#admin-users-next').disabled=userPage===pages;
  pagination.hidden=!people.length;
  list.replaceChildren();
  people.slice(start,end).forEach(person=>{
    const archived=personArchived(person),card=node('article','admin-person-card');card.dataset.userId=person.id;
    const unfinished=['archiving','deleting'].includes(person.archive?.status);
    const copy=node('div','admin-person-copy'),title=node('div','admin-person-heading'),details=node('div','admin-person-details');
    title.append(node('h4','',person.name||'Sem nome'),node('span',`badge ${archived?'warning':''}`,archived?(unfinished?'Exclusão não concluída':'Cadastro bloqueado'):person.role==='coordinator'?(isListedAdvisor(person.id)?'Coordenação e orientação':'Coordenação'):person.role==='advisor'?'Professor(a) orientador(a)':person.requestedRole==='advisor'?'Professor(a) aguardando aprovação':'Estudante'));
    details.append(node('p','',person.email||'Sem e-mail'),node('p','admin-person-year',person.year||'Série não informada'));copy.append(title,details);
    const actions=node('div','admin-person-actions');
    const addAction=(label,kind,handler,className='button secondary compact')=>{const control=button(label,className,handler);control.dataset.userAction=kind;control.dataset.userId=person.id;actions.append(control);};
    if(!archived)addAction('Editar nome e cadastro','edit',()=>showEditUser(person));
    if(!isProtectedPerson(person))addAction(unfinished?'Concluir exclusão':'Excluir definitivamente','delete',()=>showDeleteUserPermanently(person),'text-button destructive-action');
    card.append(copy,actions);list.append(card);
  });
  if(!people.length)list.append(emptyState('Nenhum cadastro neste filtro','Altere o filtro ou a busca para encontrar a pessoa.'));
}
function paintPendingAdvisors() {
  const list=$('#admin-advisor-list'),count=$('#admin-advisor-count');if(!list||!canManagePeople())return;
  list.setAttribute('aria-busy',String(!state.usersReady&&!state.usersError));
  if(state.usersError){count.textContent='—';list.replaceChildren(node('p','empty-small','As solicitações não puderam ser carregadas. Tente novamente na lista de cadastros abaixo.'));return;}
  if(!state.usersReady){count.textContent='…';list.replaceChildren(node('p','empty-small','Carregando solicitações…'));return;}
  const pending=state.users.filter(person=>!personArchived(person)&&person.requestedRole==='advisor'&&person.role!=='advisor'&&person.role!=='coordinator');
  count.textContent=fmtNumber(pending.length);list.replaceChildren();
  pending.forEach(person=>{
    const row=node('div','approval-row'),copy=node('div');copy.append(node('strong','',person.name||'Professor(a)'),node('p','',person.email||''));
    const actor=state.user.uid,session=sessionVersion;
    const approve=button('Aprovar acesso','button primary compact',event=>action(event.currentTarget,async()=>{if(state.user?.uid!==actor||sessionVersion!==session)return;currentManagedPerson(person.id);try {await service.approveAdvisor(person.id);}catch(error){if(state.user?.uid===actor&&sessionVersion===session&&canManagePeople())throw error;return;}if(state.user?.uid===actor&&sessionVersion===session&&canManagePeople())notice('Acesso de orientador liberado.');}));
    row.append(copy,approve);list.append(row);
  });
  if(!pending.length)list.append(node('p','empty-small','Nenhum professor aguardando aprovação.'));
}
function peopleToolIcon(kind) {
  const paths={
    search:'M11 18a7 7 0 1 1 0-14a7 7 0 0 1 0 14Z M16 16l5 5',
    all:'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7Z M2.5 21v-2a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v2 M16 4a3.5 3.5 0 0 1 0 7 M18 14a5 5 0 0 1 3.5 5v2',
    students:'M2 8l10-5 10 5-10 5-10-5Z M6 10v6c4 3 8 3 12 0v-6 M22 8v8',
    advisors:'M3 3h18v12H3V3Z M12 15v6 M8 21l4-4 4 4 M7 7h5 M7 11h10',
    archived:'M6 10h12a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2Z M8 10V7a4 4 0 0 1 8 0v3 M12 14v2',
    list:'M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01',
    incoming:'M4 4h16v16H4V4Z M4 14h5l2 3h2l2-3h5 M12 7v5 M9 10l3 3 3-3',
    sent:'m3 3 19 9-19 9 4-9-4-9Z M7 12h15',
    history:'M3 11a9 9 0 1 1 2.5 7.2 M3 4v7h7 M12 7v5l3 2',
    clock:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2',
    pending:'M6 3h9l4 4v14H6V3Z M14 3v5h5 M9 13h7 M9 17h4',
    done:'M9 12l2 2 4-4 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    late:'M12 3 2 21h20L12 3Z M12 9v5 M12 17h.01',
    returned:'M9 10 4 5l5-4 M4 5h10a6 6 0 0 1 0 12h-3'
  };
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('class','admin-filter-icon filter-icon');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.8');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[kind]||paths.search);icon.append(path);return icon;
}
function renderAdmin() {
  const fragment=document.createDocumentFragment();
  if(!canManagePeople())return fragment;
  const intro=node('section','admin-intro');intro.append(node('h3','','Cadastros e grupos da escola'),node('p','','Corrija os nomes dos alunos, edite cadastros e acompanhe os grupos. A exclusão de cadastros e dados pessoais é definitiva; o conteúdo compartilhado dos grupos é preservado.'),link('Consultar termos e assinaturas','#termo','button secondary compact'),link('Gerenciar todos os grupos','#grupos','button secondary compact'),link('Abrir indicadores INIC','#indicadores','button secondary compact'));fragment.append(intro);
  const panel=node('section','panel');const head=node('div','panel-heading');head.append(node('h3','','Professores aguardando aprovação'),node('span','badge'));head.lastChild.id='admin-advisor-count';panel.append(head);
  const pendingList=node('div');pendingList.id='admin-advisor-list';panel.append(pendingList);fragment.append(panel);
  const usersPanel=node('section','panel mt-24'),usersHead=node('div','panel-heading');usersHead.append(node('h3','','Pessoas cadastradas'),node('span','count-label'));usersHead.lastChild.id='admin-user-count';usersPanel.append(usersHead);
  const tools=node('div','admin-user-tools'),searchField=node('label','admin-user-search');const search=node('input');search.type='search';search.name='userSearch';search.placeholder='Buscar nome, e-mail ou série';search.setAttribute('aria-label','Buscar cadastros');search.value=userSearch;search.addEventListener('input',()=>{userSearch=search.value;userPage=1;paintManagedUsers();});searchField.append(peopleToolIcon('search'),search);tools.append(searchField);
  const filters=node('div','filter-pills admin-user-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar cadastros');[['all','Todos os ativos'],['students','Alunos'],['advisors','Professores'],['archived','Cadastros bloqueados']].forEach(([value,label])=>{const filter=button('','admin-user-filter',()=>{userFilter=value;userPage=1;paintManagedUsers();});filter.dataset.userFilter=value;filter.setAttribute('aria-pressed',String(value===userFilter));filter.setAttribute('aria-controls','admin-user-list');filter.append(peopleToolIcon(value),node('span','',label));filters.append(filter);});tools.append(filters);usersPanel.append(tools);
  const pagination=node('div','admin-user-pagination');pagination.id='admin-user-pagination';pagination.hidden=true;
  const range=node('p','admin-user-range');range.id='admin-user-range';range.setAttribute('role','status');range.setAttribute('aria-live','polite');range.setAttribute('aria-atomic','true');
  const controls=node('nav','admin-page-controls');controls.setAttribute('aria-label','Páginas dos cadastros');
  const previous=button('Anterior','button secondary compact',()=>{if(!canManagePeople()||!state.usersReady||state.usersError||userPage===1)return;userPage--;paintManagedUsers();});previous.id='admin-users-prev';previous.setAttribute('aria-controls','admin-user-list');
  const page=node('span','admin-user-page');page.id='admin-user-page';
  const next=button('Próxima','button secondary compact',()=>{if(!canManagePeople()||!state.usersReady||state.usersError||next.disabled)return;userPage++;paintManagedUsers();});next.id='admin-users-next';next.setAttribute('aria-controls','admin-user-list');
  controls.append(previous,page,next);pagination.append(range,controls);usersPanel.append(pagination);
  const list=node('div','admin-user-list');list.id='admin-user-list';list.setAttribute('aria-label','Cadastros da escola');usersPanel.append(list);fragment.append(usersPanel);queueMicrotask(()=>{paintManagedUsers();paintPendingAdvisors();});return fragment;
}

window.addEventListener('offline',()=>{const banner=$('#connection-banner');banner.textContent='Você está sem conexão. Grupos, convites e mensagens serão atualizados quando a conexão voltar.';banner.hidden=false;});
window.addEventListener('online',()=>{$('#connection-banner').hidden=true;});

readRoute();
try {
  service = await import('./firebase-service.js?v=20261112-13');
  authStatus('Verificando acesso…','',true);
  sessionUnsubscribe = service.onSession(sessionChanged) || (() => {});
} catch(error) {
  authStatus('Não foi possível conectar ao serviço de acesso. Confira a conexão e recarregue esta página.','error');
  const retry=button('Tentar novamente','text-button',()=>location.reload());$('#auth-status').append(document.createTextNode(' '),retry);
}
window.addEventListener('beforeunload',event=>{if([...articleEditors.values()].some(({editor})=>editor.hasUnsaved())){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',event=>{if(!event.persisted){for(const {editor}of articleEditors.values())editor.destroy();articleEditors.clear();revokeProposalUrls();cleanupDialog();destroyIndicators();destroyCommunity();sessionUnsubscribe();appUnsubscribe();agreementsUnsubscribe();for(const unsubscribe of groupListeners.values())unsubscribe();}});
