'use strict';

import { createCoordinationDashboard } from './coordination-dashboard.js?v=20261105-12';
import { createProposalEditor, createProposalView } from './tcc-proposal.js?v=20261105-12';
import { createCalendarView } from './calendar.js?v=20261105-8';
import { getNotificationState, enableNotifications, disableNotifications } from './notifications.js?v=20261105-8';
import { createArticleEditor } from './article-editor.js?v=20261110-2';

const $ = selector => document.querySelector(selector);
const roleNames = {student:'Estudante',advisor:'Orientador(a)',coordinator:'Coordenação'};
const hashes = {dashboard:'inicio',groups:'grupos',invitations:'convites',calendar:'calendario',agreements:'termo',admin:'coordenacao',indicators:'indicadores'};
const state = {user:null,profile:null,role:'student',users:[],advisors:[],groups:[],invitations:[],orientationNotices:[],ready:false,error:null,archived:false,archive:null};
const groupData = new Map();
const groupListeners = new Map();
const groupAccess = new Map();
const articleEditors = new Map();
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
let dialogVersion = 0;
let dialogAccess = 'academic';
let dialogBusyText = 'Salvando…';
let groupSearch = '';
let groupAdvisorFilter = 'all';
let taskFilter = 'all';
let invitationFilter = 'incoming';
let userSearch = '';
let userFilter = 'all';
let coordinationDashboard = null;
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
function isIndividualWork(group) { return group?.workMode === 'individual'; }
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
function hasAutomaticAdvisor() {return state.role==='student'&&/^[12](?:[º°oaª])?\s*(?:ano|serie|em|ensino medio)\b/.test(normalize(state.profile?.year).trim());}
function requiresAgreement() { return Boolean(state.user && state.profile && state.role === 'student' && !isPendingAdvisor() && state.profile.onboardingRequired !== true); }
function agreementSatisfied() { return agreementsReady && !agreementsError && agreementRequirement.ready === true && agreementRequirement.fulfilled === true; }
function canAccessAcademic() {
  if(state.archived)return false;
  if(!state.user || !state.ready || !state.profile || state.profile.onboardingRequired === true || isPendingAdvisor())return false;
  return state.role === 'advisor' || state.role === 'coordinator' || (requiresAgreement() && agreementSatisfied());
}
function canCreateGroup() { return canAccessAcademic(); }
function canPrepareProposal() { return Boolean(!state.archived && state.user && state.ready && state.profile && state.role === 'student' && state.profile.onboardingRequired !== true && !isPendingAdvisor()); }
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
function cleanupDialog() {const cleanup=dialogCleanup;dialogCleanup=null;cleanup?.();}
function openForm({title,kicker = 'MEU INIC',fields,submit = 'Salvar',danger = false,access = 'academic',busy = 'Salvando…',guard=null,cleanup=null,handler}) {
  if(state.user && access === 'academic' && !canAccessAcademic()){render();return;}
  if(access === 'draft' && !canPrepareProposal()){render();return;}
  if(access === 'admin' && (state.role !== 'coordinator'||state.archived)){render();return;}
  if(state.archived){render();return;}
  if(access === 'review' && state.role !== 'coordinator'){render();return;}
  if(access === 'signature' && !['advisor','coordinator'].includes(state.role)){render();return;}
  if(guard&&!guard()){render();return;}
  cleanupDialog();dialogCleanup=cleanup;
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
  await Promise.all([...articleEditors.values()].map(({editor})=>editor.flush()));
  if([...articleEditors.values()].some(({editor})=>editor.hasUnsaved())&&!window.confirm('Ainda há texto do artigo sem confirmação de salvamento. Sair agora descarta esse texto pendente. Deseja sair mesmo assim?'))return;
  try {await disableNotifications(service,state.user);} catch(error) {console.warn('Avisos:',error.code||'desativação indisponível');}
  await service.logout();
}));
$('#profile-button').addEventListener('click',showProfileForm);

function showProfileForm() {
  if(state.archived){render();return;}
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
  for(const {editor}of articleEditors.values())editor.destroy();articleEditors.clear();
  destroyIndicators();revokeProposalUrls();orientationNoticeBaselineReady=false;seenOrientationNotices.clear();
  const sessionId=++sessionVersion;seenAdvisorConfirmations.clear();seenAgreementReviews.clear();agreementReviewsReady=false;agreementReviewError=null;agreementReviewBaselineReady=false;agreementSignaturesReady=false;agreementSignatureError=null;advisorAgreementGroupId='';groupAdvisorFilter='all';userSearch='';userFilter='all';
  proposalDraft=null;
  cleanupDialog();$('#dialog-fields').replaceChildren();
  dialogVersion++;dialogHandler=null;dialogGuard=null;$('#form-dialog').close();
  appUnsubscribe();
  appUnsubscribe = () => {};
  agreementsUnsubscribe();agreementsUnsubscribe = () => {};agreementScope='';agreementSubscription++;
  agreements=[];agreementsReady=false;agreementsError=null;agreementRequirement={ready:false,fulfilled:false};agreementUploadBusy=false;agreementSearch='';agreementFilter='all';
  for (const unsubscribe of groupListeners.values()) unsubscribe();
  groupListeners.clear();groupAccess.clear();groupData.clear();
  Object.assign(state,{user,profile:null,role:'student',users:[],advisors:[],groups:[],invitations:[],orientationNotices:[],ready:false,error:null,archived:false,archive:null});
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
    state.archived = data.archived === true;
    state.archive = data.archive || null;
    state.profile = data.profile || null;
    state.role = data.role || 'student';
    state.users = data.users || [];
    state.advisors = data.advisors || [];
    state.groups = data.groups || [];
    state.invitations = data.invitations || [];
    state.orientationNotices = data.orientationNotices || [];
    state.error = data.error || null;
    state.ready = true;
    if(state.archived){
      state.profile=null;state.users=[];state.advisors=[];state.groups=[];state.invitations=[];state.orientationNotices=[];proposalDraft=null;
      cleanupDialog();revokeProposalUrls();$('#dialog-fields').replaceChildren();
      dialogVersion++;dialogHandler=null;$('#form-dialog').close();$('#app-notice').hidden=true;$('#verification-notice')?.remove();
    }
    if(coordinationDashboard&&(state.role!=='coordinator'||!canAccessAcademic())){destroyIndicators();$('#view-content').replaceChildren(loadingPanel('Atualizando acesso…'));}
    else coordinationDashboard?.updateState(state);
    if(data.orientationNoticesError)orientationNoticeBaselineReady=false;
    else if(!state.archived&&data.orientationNoticesReady===true){const fresh=[];state.orientationNotices.forEach(item=>{const key=`${item.id}/${item.createdAt}`;if(!seenOrientationNotices.has(key)){seenOrientationNotices.add(key);if(!item.read)fresh.push(item);}});if(orientationNoticeBaselineReady&&fresh.length){const newest=fresh.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];notice(orientationNoticeCopy(newest),'info',true,{title:'Aviso de orientação',href:'#convites',label:'Ver aviso'});}orientationNoticeBaselineReady=true;}
    if(dialogGuard&&!dialogGuard()&&$('#form-dialog').open){dialogVersion++;dialogHandler=null;dialogGuard=null;$('#form-dialog').close();}
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
  const titles = {dashboard:'Visão geral',groups:state.role==='coordinator'?'Todos os grupos':'Meus grupos',invitations:'Convites',calendar:'Calendário',agreements:state.role==='coordinator'?'Termos e assinaturas':state.role==='advisor'?'Termos para assinar':'Meu termo',admin:'Coordenação',indicators:'Indicadores INIC',group:'Meu grupo'};
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
    const permitted=!state.archived&&(a.dataset.route==='agreements'?canUseAgreements()&&state.profile?.onboardingRequired!==true:['admin','indicators'].includes(a.dataset.route)?state.role==='coordinator':academic);
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
  if(state.archived){renderAccountArchived();return;}
  if (['admin','indicators'].includes(currentRoute.view) && state.role !== 'coordinator' && state.ready) {navigate('dashboard');return;}
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
  if (currentRoute.view === 'indicators') {renderIndicators();return;}
  renderedKey = currentRoute.view;
  const views = {dashboard:renderDashboard,groups:renderGroups,invitations:renderInvitations,calendar:renderCalendar,admin:renderAdmin};
  $('#view-content').replaceChildren((views[currentRoute.view] || renderDashboard)());
}
function renderAccountArchived() {
  updateShell();
  $('#view-title').textContent='Cadastro excluído';$('#view-kicker').textContent='ACESSO À PLATAFORMA';
  $('#pending-advisor-note').hidden=true;
  const panel=node('section','panel account-archived');
  panel.append(node('span','badge warning','Acesso bloqueado'),node('h2','','Este cadastro foi excluído.'),node('p','','Procure a coordenação para conferir a situação ou solicitar a restauração do acesso.'),button('Sair da conta','button primary',()=>$('#logout').click()));
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
  const label=node('label','field','Arquivo assinado');const input=node('input');input.type='file';input.name='agreement';input.required=true;input.accept='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';label.append(input,node('small','','PDF, JPG ou PNG · até 3 MB. Reúna todas as páginas em um arquivo.'));
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
  const copy=node('div','proposal-callout-copy');copy.append(node('span','term-step','SEU INIC'),node('h3','','Faça seu INIC individualmente ou em grupo.'),node('p','','Escolha a modalidade, apresente sua proposta e conte com o acompanhamento do orientador.'));
  const actions=node('div','proposal-callout-actions');const control=button('Criar meu INIC','button orange',()=>canCreateGroup()?showCreateGroup():showProposalDraft());control.id='proposal-callout-button';
  const status=node('p','proposal-callout-status');status.id='proposal-callout-status';actions.append(control,status);panel.append(copy,actions);return panel;
}
function paintProposalCallout() {
  const control=$('#proposal-callout-button'),status=$('#proposal-callout-status');if(!control||!status)return;
  const draft=proposalDraft?.uid===state.user?.uid;
  const automatic=hasAutomaticAdvisor(),individual=draft&&proposalDraft?.workMode==='individual';const copy=$('#proposal-callout .proposal-callout-copy');if(copy){copy.querySelector('h3').textContent='Faça seu INIC individualmente ou em grupo.';copy.querySelector('p').textContent=automatic?'Nas duas modalidades, estudantes do 1º e 2º ano recebem Bruno Michel Pera como orientador automaticamente.':'Escolha a modalidade e até 3 orientadores para convidar. Em grupo, você também pode convidar os colegas.';}
  control.textContent=canCreateGroup()?(draft?(individual?'Enviar proposta individual':'Enviar proposta e convites'):'Criar meu INIC'):(draft?'Revisar meu INIC':'Criar meu INIC');
  status.textContent=canCreateGroup()?(draft?'Rascunho pronto. Revise e confirme o envio.':'Opcional · você também pode entrar por convite.'):(draft?'Rascunho salvo nesta sessão. Envie o termo para concluir.':'Você pode preparar agora. Envie o termo antes de concluir.');
}
function renderAgreements() {
  const key=`agreements/${state.user.uid}/${state.role}/${state.role==='advisor'?advisorAgreementGroupId:''}`;
  if(renderedKey!==key){
    renderedKey=key;
    const fragment=document.createDocumentFragment();
    if(state.role==='coordinator')fragment.append(heading('Termos de aceite · 2027','Acompanhe os arquivos recebidos e as pendências.',[link('Visualizar o termo','conformidade.html','button secondary')]));
    if(state.role==='student'){
      const grid=node('div','term-action-grid');
      const download=node('section','term-download');download.append(node('span','term-step','01 · DOCUMENTO'),node('h2','','Termo de aceite · 2027'),node('p','','Baixe, imprima e recolha as assinaturas.'));
      const pdf=link('Baixar termo em PDF','documentos/Termo_Compromisso_INIC_2027_Maximus.pdf','button term-download-button');pdf.download='Termo_Compromisso_INIC_2027_Maximus.pdf';
      download.append(pdf,link('Visualizar e imprimir','conformidade.html','term-preview-link'));
      const gate=node('p','agreement-gate agreement-gate--compact');gate.id='agreement-gate';gate.append(node('span','badge warning','Envio obrigatório'),document.createTextNode(' Envie o termo assinado para liberar sua participação.'));download.append(gate);
      grid.append(download,buildAgreementUpload());fragment.append(grid);
      const reviewSlot=node('div','agreement-review-slot');reviewSlot.id='agreement-review-slot';fragment.append(reviewSlot,proposalCallout());
    }else if(state.role==='advisor'){
      fragment.append(heading('Termos para assinar','Documentos conferidos dos estudantes dos seus grupos.'));
      const groups=state.groups.filter(group=>group.status!=='deleting'&&group.advisorId===state.user.uid);
      if(groups.length){const selector=makeField('Grupo orientado','advisorAgreementGroup',{value:advisorAgreementGroupId,options:groups.map(group=>({value:group.id,label:group.name}))});selector.field.addEventListener('change',()=>{advisorAgreementGroupId=selector.field.value;agreementScope='';syncAgreementSubscription();renderedKey='';render();});fragment.append(selector.label);}
    }else{
      const summary=node('div','agreement-summary');summary.id='agreement-summary';summary.setAttribute('aria-live','polite');fragment.append(summary);
      const search=node('input');search.type='search';search.className='agreement-search';search.placeholder='Buscar estudante, e-mail ou arquivo';search.setAttribute('aria-label','Buscar contratos assinados');search.value=agreementSearch;search.addEventListener('input',()=>{agreementSearch=search.value;paintAgreements();});
      const filters=node('div','filter-pills agreement-filters');filters.setAttribute('aria-label','Filtrar termos');
      [['all','Todos'],['pending','Sem envio'],['awaiting','Aguardando conferência'],['approved','Conferidos'],['returned','Devolvidos'],['received','Todos os enviados']].forEach(([value,label])=>{const filter=button(label,'',()=>{agreementFilter=value;paintAgreements();});filter.dataset.agreementFilter=value;filters.append(filter);});fragment.append(search,filters);
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
  const card=node('article','group-card');const top=node('div','card-top');top.append(node('span','badge',`INIC ${group.year || 2027}`),node('span','count-label',isIndividualWork(group)?'Autoria individual':`${Object.values(group.members || {}).filter(Boolean).length} integrante(s)`));
  if(isIndividualWork(group)){card.dataset.workMode='individual';top.append(node('span','badge work-mode-badge','Individual'));}
  card.append(top,node('h3','',group.name),node('p','group-topic',group.topic || 'Tema em definição'),node('p','advisor-line',`Orientação: ${advisorName(group)}`));
  if(group.status==='deleting')card.append(node('p','deletion-warning','Exclusão em andamento'));
  else if(groupData.has(group.id))card.append(progressBlock(tasks));else card.append(node('p','loading-task','Carregando entregas…'));
  const footer=node('div','card-footer');footer.append(node('span','',tasks.length ? `${tasks.filter(t=>t.completed).length} de ${tasks.length} etapas` : 'Organize as próximas etapas'),link(isIndividualWork(group)?'Abrir trabalho':'Abrir grupo',routeHref('group',group.id)));card.append(footer);
  const actions=node('div','group-card-actions');
  if(canAssignGroupAdvisor(group)){const assign=button('Atribuir orientador','button primary compact',()=>showAssignAdvisor(group));assign.dataset.groupAssign=group.id;actions.append(assign);}
  if(canChatGroup(group))actions.append(link(isIndividualWork(group)?'Abrir conversa do trabalho':'Abrir chat do grupo',routeHref('group',group.id,'messages'),'button secondary compact'));
  if(group.status==='deleting'&&isGroupManager(group))actions.append(button('Concluir exclusão','button danger-button compact',()=>showDeleteGroup(group)));
  else if(group.status!=='archived'&&group.archived!==true){
    if(isGroupManager(group))actions.append(button(isIndividualWork(group)?'Editar trabalho':'Editar grupo','text-button',()=>showEditGroup(group)),button(isIndividualWork(group)?'Excluir trabalho':'Excluir grupo','text-button destructive-action',()=>showDeleteGroup(group)));
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
  const card=node('div','support-card');const copy=node('div');copy.append(node('h3','','Compromisso com a pesquisa, combinado em família.'),node('p','','Leia o termo, preencha os dados e leve a versão impressa à coordenação para as assinaturas. Valores e datas do evento em 2027 ainda serão confirmados.'));card.append(copy,link('Acessar o termo','conformidade.html','button secondary'));return card;
}
function renderDashboard() {
  const fragment=document.createDocumentFragment();
  const welcome=node('section','welcome');const copy=node('div');copy.append(node('p','eyebrow','O PRÓXIMO PASSO DA SUA PESQUISA'),node('h2','',`Olá, ${myName().split(' ')[0]}. Vamos construir conhecimento?`),node('p','',state.role==='coordinator'?'Acompanhe grupos, orientadores e entregas em um só lugar.':'Seu trabalho, seu orientador e as próximas entregas estão aqui. Comece por um pequeno passo.'));welcome.append(copy);
  if(canCreateGroup())welcome.append(button(state.role==='student'?'Criar meu INIC':'Criar um grupo','button orange',showCreateGroup));else welcome.append(link('Conhecer as pesquisas','index.html#artigos','button orange'));
  fragment.append(welcome);
  const reviewCard=studentAgreementReviewCard();if(reviewCard)fragment.append(reviewCard);
  const tasks=allTasks();const complete=tasks.filter(t=>t.completed).length;const late=tasks.filter(t=>statusOf(t).key==='late').length;
  const stats=node('div','stats-grid');
  [[state.role==='coordinator'?'Pesquisas da escola':'Meus trabalhos',state.groups.length,'Cada pesquisa tem seu espaço'],['Etapas concluídas',`${complete}/${tasks.length}`,'Atualizadas pelo grupo'],['Entregas em atraso',late,'Prazos do planejamento interno'],['Convites recebidos',pendingInvitations().length,'Aguardando sua resposta']].forEach(([label,value,detail])=>{const stat=node('div','stat');stat.append(node('span','',label),node('strong','',value),node('p','',detail));stats.append(stat);});
  fragment.append(stats);
  const columns=node('div','two-columns');const nextPanel=node('section','panel');const nextHead=node('div','panel-heading');nextHead.append(node('h3','','Próximas entregas'),link('Ver calendário','#calendario'));nextPanel.append(nextHead);
  const next=tasks.filter(t=>!t.completed).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,4);
  nextPanel.append(...(next.length?next.map(taskPreview):[node('p','empty-small','Nenhuma entrega pendente. Crie um grupo ou organize as etapas da sua pesquisa.')]));
  const invitePanel=node('section','panel');const inviteHead=node('div','panel-heading');inviteHead.append(node('h3','','Seu próximo encontro'),link('Ver convites','#convites'));invitePanel.append(inviteHead);
  const incoming=pendingInvitations().slice(0,3);
  if(incoming.length)incoming.forEach(invite=>{const row=node('div','mini-invite');row.append(node('h4','',invite.groupName||groupName(invite.groupId)),node('p','',`${invite.senderName||'Um participante'} convidou você como ${invite.type==='advisor'?'orientador(a)':'integrante'}.`),link('Responder convite','#convites'));invitePanel.append(row);});
  else invitePanel.append(node('p','empty-small','Você está em dia com os convites. Quando alguém convidar você para um grupo, o convite aparecerá aqui.'));
  columns.append(nextPanel,invitePanel);fragment.append(columns);
  const groupsHead=heading(state.role==='coordinator'?'Pesquisas da escola':'Seus trabalhos','Abra sua pesquisa individual ou em grupo para acompanhar as entregas.',[link('Ver todos','#grupos','text-button')]);groupsHead.classList.add('mt-24');fragment.append(groupsHead);
  if(state.groups.length){const grid=node('div','group-grid');grid.append(...state.groups.slice(0,3).map(groupCard));fragment.append(grid);}else fragment.append(emptyState('Sua pesquisa começa por aqui','Comece seu INIC individualmente ou em grupo e conte com um orientador. Se já recebeu um convite, abra a área de convites.',[...(canCreateGroup()?[button(state.role==='student'?'Criar meu INIC':'Criar grupo','button primary',showCreateGroup)]:[]),link('Ver convites','#convites','button secondary')]));
  fragment.append(supportCard());return fragment;
}
function renderGroups() {
  const fragment=document.createDocumentFragment();
  fragment.append(heading(state.role==='coordinator'?'Todas as pesquisas':'Seus trabalhos do INIC',state.role==='coordinator'?'Acompanhe os trabalhos individuais e em grupo da escola.':'Escreva individualmente ou em grupo, com orientação e etapas organizadas.',canCreateGroup()?[button(state.role==='student'?'Novo trabalho +':'Novo grupo +','button primary',showCreateGroup)]:[]));
  const filters=node('div','search-filter');const search=node('input');search.type='search';search.placeholder='Buscar grupo, tema ou integrante';search.setAttribute('aria-label','Buscar grupos');search.value=groupSearch;
  search.addEventListener('input',event=>{groupSearch=event.target.value;paintFilteredGroups();});filters.append(search);
  if(state.role==='coordinator'){
    const select=node('select');select.setAttribute('aria-label','Filtrar por orientador');[{value:'all',label:'Todos os orientadores'},{value:'mine',label:'Grupos que eu oriento'},{value:'none',label:'Sem orientador'},...state.advisors.map(a=>({value:a.id,label:advisorLabel(a)}))].forEach(a=>{const o=node('option','',a.label);o.value=a.value;select.append(o);});select.value=groupAdvisorFilter;select.addEventListener('change',event=>{groupAdvisorFilter=event.target.value;paintFilteredGroups();});filters.append(select);
  }
  fragment.append(filters,node('div','group-grid'));fragment.lastChild.id='filtered-groups';
  const count=node('p','count-label');count.id='groups-count';count.style.marginTop='16px';fragment.append(count);
  queueMicrotask(paintFilteredGroups);return fragment;
}
function paintFilteredGroups() {
  const area=$('#filtered-groups');if(!area)return;
  const query=normalize(groupSearch).trim();
  const filtered=state.groups.filter(g=>(!query||normalize([g.name,g.topic,g.description,...Object.values(g.memberNames||{})].join(' ')).includes(query))&&(state.role!=='coordinator'||groupAdvisorFilter==='all'||(groupAdvisorFilter==='mine'?g.advisorId===state.user?.uid:groupAdvisorFilter==='none'?!g.advisorId:g.advisorId===groupAdvisorFilter)));
  area.className=filtered.length?'group-grid':'';
  area.replaceChildren(...(filtered.length?filtered.map(groupCard):[emptyState(state.groups.length?'Nenhum trabalho com esses filtros':'Você ainda não tem um trabalho',state.groups.length?'Tente outro tema ou nome.':'Crie seu INIC individualmente, monte um grupo ou aceite um convite.',canCreateGroup()?[button(state.role==='student'?'Criar meu INIC':'Criar grupo','button primary',showCreateGroup)]:[])]));
  $('#groups-count').textContent=`${filtered.length} ${filtered.length===1?'grupo encontrado':'grupos encontrados'}`;
}

function buildAdvisorPicker(initialIds = []) {
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
    if(initialIds.includes(person.id)&&selected.size<3){selected.add(person.id);input.checked=true;}
    const avatar=node('span','avatar',initials(person.name));avatar.setAttribute('aria-hidden','true');
    const copy=node('span','advisor-choice-copy');copy.append(node('strong','',advisorLabel(person)),node('small','','Orientador(a) aprovado(a)'));
    input.addEventListener('change',()=>{if(input.checked&&selected.size>=3){input.checked=false;count.textContent='Selecione no máximo 3 orientadores.';return;}if(input.checked)selected.add(person.id);else selected.delete(person.id);paint();});
    controls.push({input,label});label.append(input,avatar,copy);list.append(label);
  });
  const empty=node('p','empty-small',advisors.length?'Nenhum orientador com esse nome.':'A coordenação ainda não liberou orientadores para convite.');empty.hidden=Boolean(advisors.length);
  search.addEventListener('input',()=>{const query=normalize(search.value).trim();let visible=0;controls.forEach(({label})=>{label.hidden=Boolean(query&&!label.dataset.search.includes(query));if(!label.hidden)visible++;});empty.hidden=visible>0;});
  field.append(search,count,list,empty,node('p','advisor-picker-help','Você também pode escolher depois, em Convites.'));
  paint();
  return {field,selectedIds:()=>[...selected]};
}
function showCreateGroup() {
  if(!canCreateGroup()){render();return;}
  openProposalForm(false);
}
function showProposalDraft() {
  if(!canPrepareProposal()){render();return;}
  if(canCreateGroup()){showCreateGroup();return;}
  openProposalForm(true);
}
function proposalMemberEmails(value) {
  const own=String(state.user?.email||'').toLowerCase();
  const emails=[...new Set(String(value||'').split(/[\s,;]+/).map(email=>email.trim().toLowerCase()).filter(email=>email&&email!==own))];
  if(emails.some(email=>email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw new Error('Confira os e-mails dos colegas antes de continuar.');
  if(emails.length>20)throw new Error('Convide no máximo 20 colegas por proposta.');
  return emails;
}
function openProposalForm(draftOnly) {
  const uid=state.user?.uid,session=sessionVersion;
  const student=state.role==='student',automatic=hasAutomaticAdvisor();const saved=student&&proposalDraft?.uid===uid?proposalDraft:{};
  const modePicker=student?node('fieldset','proposal-mode-picker'):null,modeControls=[];
  if(modePicker){
    modePicker.append(node('legend','','Como você quer fazer o INIC?'));
    const choices=node('div','proposal-mode-options');
    for(const [value,title,description]of [['individual','Individual','Uma pesquisa sua, com acompanhamento do orientador.'],['group','Em grupo','Construa a pesquisa com colegas e o orientador.']]){
      const label=node('label','proposal-mode-option'),input=node('input');input.type='radio';input.name='workMode';input.value=value;input.required=true;input.checked=value===(saved.workMode==='individual'?'individual':'group');
      const copy=node('span','proposal-mode-copy');copy.append(node('strong','',title),node('small','',description));label.append(input,copy);choices.append(label);modeControls.push({input,label});
      input.addEventListener('change',()=>{if(input.checked){for(const other of modeControls)if(other.input!==input)other.input.checked=false;}paintWorkMode();});
    }
    modePicker.append(choices);
  }
  const name=makeField('Nome do grupo','name',{value:saved.name||'',required:true,minLength:2,maxLength:100,placeholder:'Ex.: Equipe EcoPlant'});
  const topic=makeField(student?'Tema da proposta':'Tema da pesquisa','topic',{value:saved.topic||'',required:true,minLength:3,maxLength:240,placeholder:'O que vocês querem investigar?'});
  const description=makeField('Descrição da proposta','description',{type:'textarea',value:saved.description||'',maxLength:3000,placeholder:'Problema, objetivo e ideia inicial da pesquisa.'});
  const year=makeField('Edição do INIC','year',{type:'number',value:saved.year||2027,required:true,min:2027,max:2100});
  const proposalEditor=student?createProposalEditor({value:saved.proposal||null,proposalFile:saved.proposalFile||null}):null;
  const picker=student&&!automatic?buildAdvisorPicker(saved.advisorIds||[]):null;
  const automaticCard=automatic?node('section','automatic-advisor-card'):null;if(automaticCard){automaticCard.dataset.automaticAdvisor='true';automaticCard.append(node('span','badge success','Orientação automática'),node('strong','','Orientador: Bruno Michel Pera'),node('p','','Atribuição automática para estudantes do 1º e 2º ano. Você pode convidar os colegas para compor o grupo.'));}
  const memberEmails=student?makeField('E-mails dos colegas para convidar (opcional)','memberEmails',{type:'textarea',value:(saved.memberEmails||[]).join('\n'),maxLength:6000,placeholder:'colega1@gmail.com\ncolega2@gmail.com',help:'Separe por vírgulas ou linhas. Cada colega recebe o convite no aplicativo ao entrar com esse e-mail.'}):null;
  if(memberEmails)memberEmails.field.rows=3;
  const advisor=student?null:makeField('Orientador(a) desejado(a)','advisorId',{options:[{value:'',label:state.role==='advisor'?'Eu serei o(a) orientador(a)':'Escolher depois'},...state.advisors.map(a=>({value:a.id,label:advisorLabel(a)}))],help:state.role==='coordinator'&&isListedAdvisor()?'Escolha seu nome para orientar este novo grupo. Outros orientadores receberão um convite e precisam aceitar.':'O orientador receberá um convite e será vinculado após aceitar.'});
  const modeNote=node('p','dialog-note');
  const fields=[...(modePicker?[modePicker]:[]),name.label,topic.label,description.label,year.label,...(proposalEditor?[proposalEditor.element]:[]),...(memberEmails?[memberEmails.label]:[]),automaticCard||picker?.field||advisor.label,modeNote];
  function paintWorkMode(){
    const individual=student&&modeControls.some(({input})=>input.value==='individual'&&input.checked);
    for(const {input,label}of modeControls)label.classList.toggle('is-selected',input.checked);
    if(memberEmails){memberEmails.label.hidden=individual;memberEmails.field.disabled=individual;}
    name.label.firstChild.textContent=individual?'Nome do trabalho':'Nome do grupo';name.field.placeholder=individual?'Ex.: EcoPlant — minha pesquisa':'Ex.: Equipe EcoPlant';
    topic.field.placeholder=individual?'O que você quer investigar?':'O que vocês querem investigar?';
    if(automaticCard)automaticCard.querySelector('p').textContent=individual?'Bruno Michel Pera acompanhará seu trabalho individual, como nos demais trabalhos do 1º e 2º ano.':'Atribuição automática para estudantes do 1º e 2º ano. Você pode convidar os colegas para compor o grupo.';
    modeNote.textContent=individual?(draftOnly?'Seu rascunho individual fica nesta sessão. Envie o termo assinado para criar o trabalho.':automatic?'Seu trabalho individual terá Bruno Michel Pera como orientador e um cronograma inicial.':'Seu trabalho individual terá um cronograma e os convites para os orientadores selecionados. Você também pode escolher a orientação depois.'):(draftOnly?'Rascunho nesta sessão. Envie o termo assinado antes de criar o grupo e enviar os convites.':automatic?'Ao confirmar, o grupo recebe Bruno Michel Pera como orientador, um cronograma inicial e os convites para os colegas informados.':student?'Ao confirmar, o grupo, o cronograma e todos os convites são criados juntos.':'O grupo recebe um cronograma inicial editável.');
    $('#dialog-heading').textContent=individual?(draftOnly?'Preparar meu INIC individual':'Meu INIC individual'):(draftOnly?'Preparar meu grupo':student?'Nova proposta de TCC':'Novo grupo');
    const submit=$('#dialog-submit');if(!submit.hasAttribute('aria-busy'))submit.textContent=draftOnly?'Salvar rascunho':individual?'Criar meu INIC individual':student?'Enviar proposta e convites':'Criar grupo';
    dialogBusyText=draftOnly?'Salvando rascunho…':individual?'Criando seu INIC individual…':student?'Criando proposta e enviando convites…':'Criando grupo…';
  }
  openForm({title:draftOnly?'Preparar meu grupo':student?'Nova proposta de TCC':'Novo grupo',kicker:draftOnly?'RASCUNHO · INIC 2027':'INIC 2027',access:draftOnly?'draft':'academic',fields,cleanup:()=>proposalEditor?.destroy(),submit:draftOnly?'Salvar rascunho':student?'Enviar proposta e convites':'Criar grupo',busy:draftOnly?'Salvando rascunho…':student?'Criando proposta e enviando convites…':'Criando grupo…',handler:async data=>{
    if(state.user?.uid!==uid||sessionVersion!==session)return;
    if(student&&(state.role!=='student'||hasAutomaticAdvisor()!==automatic))throw new Error('Sua série ou seu perfil mudou. Abra a proposta novamente para conferir a orientação.');
    if(draftOnly&&!canPrepareProposal())throw new Error('Seu perfil mudou. Confira seu cadastro antes de continuar.');
    if(!draftOnly&&!canCreateGroup())throw new Error('Envie o termo assinado e aguarde a confirmação antes de enviar a proposta.');
    const advisorIds=picker?.selectedIds()||[];
    if(advisorIds.length>3)throw new Error('Selecione no máximo 3 orientadores.');
    if(student&&advisorIds.some(id=>!state.advisors.some(person=>person.id===id)))throw new Error('A lista de orientadores mudou. Revise os nomes antes de enviar.');
    const workMode=student?String(data.get('workMode')||'group'):'group';
    if(!['individual','group'].includes(workMode))throw new Error('Escolha a modalidade individual ou em grupo.');
    const emails=student&&workMode!=='individual'?proposalMemberEmails(data.get('memberEmails')):[];
    const payload={name:String(data.get('name')).trim(),topic:String(data.get('topic')).trim(),description:String(data.get('description')).trim(),year:Number(data.get('year')),workMode,...(student?{advisorIds,memberEmails:emails,...proposalEditor.read()}:{advisorId:String(data.get('advisorId')||'')})};
    if(student)proposalDraft={uid,...payload};
    if(draftOnly){paintProposalCallout();notice('Rascunho preparado. Envie o termo assinado para concluir a proposta.');return;}
    const id=await service.createGroup(payload);
    if(state.user?.uid!==uid||sessionVersion!==session)return;
    proposalDraft=null;
    const count=emails.length+advisorIds.length;
    notice(workMode==='individual'?(automatic?'Seu INIC individual foi criado com Bruno Michel Pera como orientador.':advisorIds.length?`Seu INIC individual foi criado. ${advisorIds.length} convite(s) enviado(s) para orientação.`:'Seu INIC individual foi criado. Você pode escolher o orientador na área do trabalho.'):automatic?`Proposta criada com Bruno Michel Pera como orientador.${emails.length?` ${emails.length} convite(s) enviado(s) aos colegas.`:''}`:student?(count?`Proposta criada. ${count} convite(s) enviado(s) para os colegas e orientadores selecionados.`:'Proposta criada. Você pode enviar convites na área do grupo.'):'Grupo criado. Convide os integrantes e organize as entregas.');navigate('group',typeof id==='string'?id:id.id);
  }});paintWorkMode();
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
  const fields=[makeField(isIndividualWork(group)?'Nome do trabalho':'Nome do grupo','name',{value:group.name,required:true,minLength:2,maxLength:100}).label,makeField('Tema da pesquisa','topic',{value:group.topic,required:true,minLength:3,maxLength:240}).label,makeField('Descrição','description',{value:group.description||'',type:'textarea',maxLength:3000}).label,makeField('Edição do INIC','year',{type:'number',value:group.year||2027,min:2027,max:2100,required:true}).label];
  openForm({title:isIndividualWork(group)?'Editar trabalho':'Editar grupo',fields,guard:()=>{const current=state.groups.find(item=>item.id===group.id);return Boolean(current&&canEditGroup(current));},handler:async data=>{
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
function showInviteForm(initialGroupId = '', initialType = 'member') {
  const actor=state.user?.uid,session=sessionVersion;
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
  const proposalSlot=node('div','invite-proposal-slot');let proposalEditor=null,proposalEditorGroup='';
  advisor.field.setAttribute('aria-describedby',guidance.id);
  function toggle(){
    const current=state.groups.find(item=>item.id===group.field.value),individual=isIndividualWork(current);
    const memberOption=[...type.field.options].find(option=>option.value==='member');if(memberOption){memberOption.disabled=individual;memberOption.hidden=individual;}
    if(individual)type.field.value='advisor';type.label.hidden=individual;
    group.label.firstChild.textContent=individual?'Trabalho':'Grupo';$('#dialog-heading').textContent=individual?'Convidar orientador':'Convidar para o grupo';
    const isAdvisor=type.field.value==='advisor';const pending=pendingAdvisorInvitations(group.field.value);
    const blocked=isAdvisor&&(Boolean(current?.advisorId)||pending.length>=3);
    advisor.label.hidden=!isAdvisor;advisor.field.disabled=blocked;advisor.field.required=isAdvisor&&!blocked;email.label.hidden=isAdvisor;email.field.required=!isAdvisor;email.field.disabled=isAdvisor;guidance.hidden=!isAdvisor;
    guidance.textContent=current?.advisorId?'Este grupo já tem orientador(a). Novos convites de orientação não estão disponíveis.':pending.length>=3?'Há 3 convites de orientação aguardando resposta. Aguarde uma resposta antes de enviar outro convite.':`Envie convites para até 3 orientadores ao mesmo tempo. O primeiro aceite confirma a orientação. ${pending.length} de 3 convites pendentes.`;
    const needsProposal=isAdvisor&&!blocked&&!current?.proposal;
    proposalSlot.hidden=!needsProposal;
    if(needsProposal&&proposalEditorGroup!==current?.id){proposalEditor?.destroy();proposalEditor=createProposalEditor({});proposalEditorGroup=current?.id||'';proposalSlot.replaceChildren(proposalEditor.element);}
    [...advisor.field.options].forEach(option=>{option.disabled=Boolean(option.value&&pending.some(invite=>invite.toUid===option.value));});
    if(advisor.field.selectedOptions?.[0]?.disabled)advisor.field.value='';
    const submit=$('#dialog-submit');if(submit&&!submit.hasAttribute('aria-busy'))submit.disabled=blocked;
  }
  type.field.addEventListener('change',toggle);group.field.addEventListener('change',toggle);
  const sameSession=()=>state.user?.uid===actor&&sessionVersion===session&&canAccessAcademic();
  openForm({title:'Convidar para o grupo',fields:[group.label,type.label,advisor.label,email.label,guidance,proposalSlot,node('p','dialog-note','O destinatário precisa aceitar o convite para entrar no grupo.')],submit:'Enviar convite',busy:'Enviando convite…',guard:()=>sameSession()&&state.groups.some(canManage),cleanup:()=>proposalEditor?.destroy(),handler:async data=>{
    if(!sameSession())return;
    const groupId=String(data.get('groupId'));const inviteType=String(data.get('type'));const current=state.groups.find(item=>item.id===groupId);
    if(!current||!canManage(current))throw new Error('Você não pode enviar convites para este grupo.');
    if(isIndividualWork(current)&&inviteType!=='advisor')throw new Error('No INIC individual, os convites são somente para orientação.');
    const toUid=String(data.get('toUid')||'');
    if(inviteType==='advisor'){
      if(current.advisorId)throw new Error('Este grupo já tem orientador(a). Novos convites de orientação não estão disponíveis.');
      const pending=pendingAdvisorInvitations(groupId);
      if(pending.length>=3)throw new Error('Este grupo já tem 3 convites de orientação aguardando resposta.');
      if(pending.some(invite=>invite.toUid===toUid))throw new Error('Este orientador já tem um convite pendente para o grupo.');
      if(!toUid||!state.advisors.some(person=>person.id===toUid))throw new Error('Selecione um orientador aprovado pela coordenação.');
      if(!current.proposal){
        if(proposalEditorGroup!==groupId||!proposalEditor)throw new Error('Inclua uma proposta de TCC antes de convidar o orientador.');
        if(typeof service.saveProposal!=='function')throw new Error('Atualize a página para incluir a proposta.');
        try{await service.saveProposal(groupId,{...proposalEditor.read(),expectedVersion:null});}catch(error){if(sameSession())throw error;return;}
        if(!sameSession())return;
        const latest=state.groups.find(item=>item.id===groupId);if(!latest||!canManage(latest)||latest.advisorId)throw new Error('O acesso ou a orientação deste grupo mudou. Confira a situação antes de convidar.');
        const refreshed=pendingAdvisorInvitations(groupId);if(refreshed.length>=3||refreshed.some(invite=>invite.toUid===toUid))throw new Error('Os convites deste grupo mudaram. Confira os destinatários pendentes.');
      }
    }
    try{await service.invite({groupId,type:inviteType,...(inviteType==='advisor'?{toUid}:{toEmail:String(data.get('toEmail')||'').trim()})});}catch(error){if(sameSession())throw error;return;}if(sameSession())notice('Convite enviado. Acompanhe os convites pendentes na aba Enviados.');
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
    const tabs=node('nav','group-tabs');tabs.setAttribute('aria-label',isIndividualWork(group)?'Áreas do trabalho':'Áreas do grupo');[['overview','Resumo'],['tasks','Entregas'],['article','Artigo INIC'],['messages',isIndividualWork(group)?'Conversa do trabalho':'Chat do grupo'],['evaluations','Avaliações']].forEach(([tab,label])=>{const a=link(label,routeHref('group',group.id,tab));if(tab===currentRoute.tab)a.setAttribute('aria-current','page');tabs.append(a);});fragment.append(tabs);
    const content=node('div');content.id='group-panel';fragment.append(content);$('#view-content').replaceChildren(fragment);renderedKey=key;
    if(currentRoute.tab==='messages')buildMessagesView(group);
  }
  const copy=$('#group-heading-copy');copy.querySelector('.badge').textContent=`INIC ${group.year||2027}`;copy.querySelector('h2').textContent=group.name;copy.querySelector('p').textContent=group.topic||'Tema em definição';
  if(isIndividualWork(group)&&!copy.querySelector('.work-mode-badge'))copy.insertBefore(node('span','badge work-mode-badge','Individual'),copy.querySelector('h2'));
  $('#group-meta').replaceChildren(node('span','',`Orientação: ${advisorName(group)}`),node('span','',isIndividualWork(group)?'Autoria individual':`${Object.values(group.members||{}).filter(Boolean).length} integrante(s)`));
  const actions=$('#group-header-actions');actions.replaceChildren();
  if(canAssignGroupAdvisor(group)){const assign=button('Atribuir orientador','button primary compact',()=>showAssignAdvisor(group));assign.dataset.groupAssign=group.id;actions.append(assign);}
  if(canReplaceGroupAdvisor(group))actions.append(button('Substituir orientador','button secondary compact',()=>showReplaceAdvisor(group)));
  if(canWithdrawGroupAdvisor(group))actions.append(button('Sair da orientação','text-button destructive-action',()=>showWithdrawAdvisor(group)));
  if(canEditGroup(group))actions.append(button(isIndividualWork(group)?'Editar trabalho':'Editar grupo','button secondary compact',()=>showEditGroup(group)));
  if(canManage(group)&&(!isIndividualWork(group)||!group.advisorId))actions.append(button(isIndividualWork(group)?'Convidar orientador':'Convidar +','button primary compact',()=>showInviteForm(group.id,isIndividualWork(group)?'advisor':'member')));
  if(isGroupManager(group))actions.append(button(isIndividualWork(group)?'Excluir trabalho':'Excluir grupo','text-button destructive-action',()=>showDeleteGroup(group)));
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
    const requireArticleAccess=()=>{
      const current=state.groups.find(item=>item.id===group.id);
      if(state.user?.uid!==actor||sessionVersion!==session||!canAccessAcademic()||!current||articleScope(current)!==scope)throw new Error('O acesso ao grupo mudou. Reabra o artigo antes de salvar.');
    };
    const editor=createArticleEditor({group,user:{uid:actor,role:state.role},subscribe:callback=>service.subscribeArticle(group.id,callback),onSave:(key,text,revision)=>{
      requireArticleAccess();
      return service.saveArticleSection(group.id,key,text,revision);
    },onComplete:(key,revision)=>{
      requireArticleAccess();
      if(typeof service.completeArticleSection!=='function')throw new Error('Atualize a página para concluir as etapas e receber os troféus.');
      return service.completeArticleSection(group.id,key,revision);
    }});articleEditors.set(group.id,{editor,scope});
  }
  const editor=articleEditors.get(group.id).editor;
  if(editor.element.parentNode!==$('#group-panel'))$('#group-panel').replaceChildren(editor.element);
}
function renderGroupOverview(group,tasks) {
  const columns=node('div','two-columns');const about=node('section','panel');const top=node('div','panel-heading');top.append(node('h3','','Sobre a pesquisa'));about.append(top,node('p','group-description',group.description||(isIndividualWork(group)?'Registre aqui sua ideia, o problema e o caminho da sua pesquisa.':'Registre aqui a ideia, o problema e o caminho que o grupo quer investigar.')));
  const facts=node('div','group-facts');[['Tema',group.topic||'Em definição'],['Orientação',advisorName(group)],['Edição',String(group.year||2027)]].forEach(([label,value])=>{const line=node('div');line.append(node('span','',`${label}: `),node('strong','',value));facts.append(line);});about.append(facts);
  const team=node('section','panel');const teamHeading=node('div','panel-heading');teamHeading.append(node('h3','',isIndividualWork(group)?'Estudante e orientação':'Pessoas do grupo'));team.append(teamHeading);
  if(group.advisorId){const row=node('div','team-member');row.append(node('span','avatar',initials(advisorName(group))));const info=node('div','member-info');info.append(node('strong','',advisorName(group)),node('p','','Orientador(a)'));row.append(info);team.append(row);}
  Object.entries(group.members||{}).filter(([,member])=>member).forEach(([uid])=>{
    const name=memberName(group,uid);const row=node('div','team-member');row.append(node('span','avatar',initials(name)));const info=node('div','member-info');info.append(node('strong','',name),node('p','',isIndividualWork(group)?'Autor(a) do trabalho':uid===group.createdBy?'Criou o grupo':'Integrante'));row.append(info);
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
    if(canManage(group))waiting.append(button('Convidar orientador(a)','button secondary compact',()=>showInviteForm(group.id,'advisor')));fragment.append(waiting);
  }
  const proposalPanel=node('section','panel group-proposal-panel');proposalPanel.append(createProposalView({proposal:group.proposal,onDownload:event=>downloadProposal(group.id,group.proposal,event.currentTarget,'',()=>currentRoute.view==='group'&&currentRoute.groupId===group.id&&currentRoute.tab==='overview')}));if(canManage(group))proposalPanel.append(button(group.proposal?'Atualizar proposta':'Adicionar proposta','button secondary compact',()=>showEditProposal(group)));fragment.append(proposalPanel,inicResultPanel(group),columns);
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
  if(!canChatGroup(group)){$('#group-panel').replaceChildren(emptyState('Chat indisponível','O grupo precisa estar ativo e você deve participar dele.'));return;}
  const actor=state.user?.uid,session=sessionVersion;const sameSession=()=>state.user?.uid===actor&&sessionVersion===session&&!state.archived;
  const panel=node('section','panel message-panel');const head=node('div','message-panel-head');const copy=node('div');copy.append(node('h3','',group.name),node('p','',isIndividualWork(group)?'Conversa do trabalho · estudante, orientador e coordenação':'Conversa do grupo · integrantes, orientador e coordenação'));head.append(copy,node('span','badge','Em tempo real'));panel.append(head);
  const messages=node('div','messages');messages.id='messages-list';messages.setAttribute('role','log');messages.setAttribute('aria-label',isIndividualWork(group)?'Mensagens do trabalho':'Mensagens do grupo');messages.setAttribute('aria-live','polite');messages.setAttribute('aria-relevant','additions');panel.append(messages);
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

function renderInvitations() {
  const fragment=document.createDocumentFragment();const orientationPanel=orientationNoticesPanel();if(orientationPanel)fragment.append(orientationPanel);fragment.append(heading('Convites',state.role==='advisor'?'Envie convites aos estudantes e responda aos convites para orientar grupos.':'Convide pessoas para seu grupo e responda aos convites recebidos.',[button('Enviar convite +','button primary',()=>showInviteForm())]));
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
      if(invite.type==='advisor'&&['advisor','coordinator'].includes(state.role)){const read=button('Ler proposta de TCC','button secondary',()=>showInvitationProposal(invite));read.dataset.invitationProposal=invite.id;card.append(read);}
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
  const name=makeField('Nome completo','name',{value:person.name||'',required:true,minLength:2,maxLength:100});
  const email=makeField('E-mail de acesso','email',{value:person.email||'',help:'O e-mail de acesso permanece o mesmo.'});email.field.readOnly=true;
  const year=makeField('Série escolar','year',{value:person.year||'',options:[{value:'',label:'Não se aplica'},'1º ano','2º ano','3º ano']});
  if(person.year&&![...year.field.options].some(option=>option.value===person.year)){const option=node('option','',person.year);option.value=person.year;year.field.append(option);year.field.value=person.year;}
  const role=!isProtectedPerson(person)?makeField('Acesso à plataforma','role',{value:person.role||'student',options:[{value:'student',label:'Estudante'},{value:'advisor',label:'Professor(a) orientador(a)'}]}):null;
  const fields=[name.label,email.label,year.label];if(role)fields.push(role.label);else fields.push(node('p','dialog-note','O acesso desta conta está protegido. Você pode corrigir o nome e a série.'));
  openForm({title:'Editar cadastro',kicker:'COORDENAÇÃO',access:'admin',fields,submit:'Salvar cadastro',busy:'Salvando cadastro…',handler:async data=>{
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
function showArchiveUser(person) {
  if(!canManagePeople()||personArchived(person)||isProtectedPerson(person))return;
  const actor=state.user.uid,session=sessionVersion,uid=person.id;
  const details=node('div','dialog-details');details.append(node('strong','',person.name||'Pessoa cadastrada'),node('span','',person.email||''));
  const description=node('p','dialog-note','O cadastro será removido da lista de ativos e perderá o acesso à plataforma. Os vínculos com grupos e as notas individuais serão removidos; grupos orientados ficarão sem orientador. Termos, assinaturas e histórico serão preservados para a coordenação.');
  const confirmation=makeField('Confirmar exclusão deste cadastro','confirmArchive',{type:'checkbox',required:true});confirmation.label.classList.add('admin-confirmation');
  openForm({title:'Excluir cadastro',kicker:'COORDENAÇÃO',access:'admin',fields:[details,description,node('p','dialog-note','A coordenação poderá restaurar o cadastro, mas os vínculos antigos com grupos não serão refeitos.'),confirmation.label],submit:'Excluir cadastro',danger:true,busy:'Excluindo cadastro…',handler:async data=>{
    if(state.user?.uid!==actor||sessionVersion!==session)return;
    const current=currentManagedPerson(uid);
    if(isProtectedPerson(current))throw new Error('Não é possível excluir sua própria conta ou uma conta de coordenação.');
    if(!data.has('confirmArchive'))throw new Error('Confirme a exclusão do cadastro para continuar.');
    if(typeof service.archiveUser!=='function')throw new Error('Atualize a página para excluir um cadastro.');
    try {await service.archiveUser(uid);}catch(error){if(state.user?.uid===actor&&sessionVersion===session&&canManagePeople())throw error;return;}
    if(state.user?.uid!==actor||sessionVersion!==session||!canManagePeople())return;
    notice('Cadastro excluído. O acesso foi bloqueado; a coordenação pode restaurá-lo.');
  }});
}
function showRestoreUser(person) {
  if(!canManagePeople()||!personArchived(person)||person.archive?.status==='archiving')return;
  const actor=state.user.uid,session=sessionVersion,uid=person.id;
  const copy=node('p','dialog-note',`Restaurar o acesso de “${person.name||person.email||'esta pessoa'}”? O cadastro volta à lista de ativos. Para participar de grupos, a pessoa precisará de novos convites.`);
  openForm({title:'Restaurar cadastro',kicker:'COORDENAÇÃO',access:'admin',fields:[copy],submit:'Restaurar acesso',busy:'Restaurando cadastro…',handler:async()=>{
    if(state.user?.uid!==actor||sessionVersion!==session)return;
    const current=currentManagedPerson(uid,{archived:true});
    if(current.archive?.status==='archiving')throw new Error('Conclua a exclusão antes de restaurar o cadastro.');
    if(typeof service.restoreUser!=='function')throw new Error('Atualize a página para restaurar um cadastro.');
    try {await service.restoreUser(uid);}catch(error){if(state.user?.uid===actor&&sessionVersion===session&&canManagePeople())throw error;return;}
    if(state.user?.uid!==actor||sessionVersion!==session||!canManagePeople())return;
    notice('Cadastro restaurado. Os grupos precisam de novos convites.');
  }});
}
function showResumeArchiveUser(person) {
  if(!canManagePeople()||!personArchived(person)||person.archive?.status!=='archiving'||isProtectedPerson(person))return;
  const actor=state.user.uid,session=sessionVersion,uid=person.id;
  openForm({title:'Concluir exclusão do cadastro',kicker:'COORDENAÇÃO',access:'admin',fields:[node('p','dialog-note',`O acesso de “${person.name||person.email||'esta pessoa'}” já está bloqueado. Confirme para concluir a remoção dos vínculos pendentes.`)],submit:'Concluir exclusão',danger:true,busy:'Concluindo exclusão…',handler:async()=>{
    if(state.user?.uid!==actor||sessionVersion!==session)return;
    const current=currentManagedPerson(uid,{archived:true});if(isProtectedPerson(current))throw new Error('Este cadastro está protegido.');
    if(typeof service.archiveUser!=='function')throw new Error('Atualize a página para concluir a exclusão.');
    try {await service.archiveUser(uid);}catch(error){if(state.user?.uid===actor&&sessionVersion===session&&canManagePeople())throw error;return;}
    if(state.user?.uid!==actor||sessionVersion!==session||!canManagePeople())return;
    notice('Exclusão do cadastro concluída.');
  }});
}
function paintManagedUsers() {
  const list=$('#admin-user-list'),count=$('#admin-user-count');if(!list||!canManagePeople())return;
  const query=normalize(userSearch).trim();
  const people=state.users.filter(person=>(userFilter==='archived'?personArchived(person):!personArchived(person)&&(userFilter==='all'||(userFilter==='students'?(person.role||'student')==='student'&&person.requestedRole!=='advisor':person.role==='advisor'||(person.role!=='coordinator'&&person.requestedRole==='advisor'))))&&(!query||normalize(`${person.name||''} ${person.email||''} ${person.year||''}`).includes(query))).sort((a,b)=>(a.name||'').localeCompare(b.name||'','pt-BR'));
  if(count)count.textContent=`${people.length} cadastro(s)`;
  document.querySelectorAll('[data-user-filter]').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.userFilter===userFilter)));
  list.replaceChildren();
  people.forEach(person=>{
    const archived=personArchived(person),card=node('article','admin-person-card');card.dataset.userId=person.id;
    const copy=node('div','admin-person-copy');copy.append(node('span',`badge ${archived?'warning':''}`,archived?(person.archive?.status==='archiving'?'Exclusão em andamento':'Cadastro excluído'):person.role==='coordinator'?(isListedAdvisor(person.id)?'Coordenação e orientação':'Coordenação'):person.role==='advisor'?'Professor(a) orientador(a)':person.requestedRole==='advisor'?'Professor(a) aguardando aprovação':'Estudante'),node('h4','',person.name||'Sem nome'),node('p','',person.email||'Sem e-mail'),node('p','admin-person-year',person.year||'Série não informada'));
    const actions=node('div','admin-person-actions');
    const addAction=(label,kind,handler,className='button secondary compact')=>{const control=button(label,className,handler);control.dataset.userAction=kind;control.dataset.userId=person.id;actions.append(control);};
    if(archived){if(!isProtectedPerson(person))addAction(person.archive?.status==='archiving'?'Concluir exclusão':'Restaurar cadastro',person.archive?.status==='archiving'?'resume':'restore',()=>person.archive?.status==='archiving'?showResumeArchiveUser(person):showRestoreUser(person));}
    else {addAction('Editar cadastro','edit',()=>showEditUser(person));if(!isProtectedPerson(person))addAction('Excluir cadastro','archive',()=>showArchiveUser(person),'text-button destructive-action');}
    card.append(copy,actions);list.append(card);
  });
  if(!people.length)list.append(emptyState('Nenhum cadastro neste filtro','Altere o filtro ou a busca para encontrar a pessoa.'));
}
function renderAdmin() {
  const fragment=document.createDocumentFragment();
  if(!canManagePeople())return fragment;
  const intro=node('section','admin-intro');intro.append(node('h3','','Cadastros e grupos da escola'),node('p','','Edite cadastros de alunos e professores, gerencie acessos e acompanhe os grupos. Excluir um cadastro bloqueia o acesso; restaurar não refaz os vínculos antigos.'),link('Consultar termos e assinaturas','#termo','button secondary compact'),link('Gerenciar todos os grupos','#grupos','button secondary compact'),link('Abrir indicadores INIC','#indicadores','button secondary compact'));fragment.append(intro);
  const pending=state.users.filter(person=>!personArchived(person)&&person.requestedRole==='advisor'&&person.role!=='advisor'&&person.role!=='coordinator');
  const panel=node('section','panel');const head=node('div','panel-heading');head.append(node('h3','','Professores aguardando aprovação'),node('span','badge',pending.length));panel.append(head);
  pending.forEach(person=>{
    const row=node('div','approval-row'),copy=node('div');copy.append(node('strong','',person.name||'Professor(a)'),node('p','',person.email||''));
    const actor=state.user.uid,session=sessionVersion;
    const approve=button('Aprovar acesso','button primary compact',event=>action(event.currentTarget,async()=>{if(state.user?.uid!==actor||sessionVersion!==session)return;currentManagedPerson(person.id);try {await service.approveAdvisor(person.id);}catch(error){if(state.user?.uid===actor&&sessionVersion===session&&canManagePeople())throw error;return;}if(state.user?.uid===actor&&sessionVersion===session&&canManagePeople())notice('Acesso de orientador liberado.');}));
    row.append(copy,approve);panel.append(row);
  });
  if(!pending.length)panel.append(node('p','empty-small','Nenhum professor aguardando aprovação.'));fragment.append(panel);
  const usersPanel=node('section','panel mt-24'),usersHead=node('div','panel-heading');usersHead.append(node('h3','','Pessoas cadastradas'),node('span','count-label'));usersHead.lastChild.id='admin-user-count';usersPanel.append(usersHead);
  const tools=node('div','admin-user-tools');const search=node('input');search.type='search';search.name='userSearch';search.placeholder='Buscar nome, e-mail ou série';search.setAttribute('aria-label','Buscar cadastros');search.value=userSearch;search.addEventListener('input',()=>{userSearch=search.value;paintManagedUsers();});tools.append(search);
  const filters=node('div','filter-pills admin-user-filters');filters.setAttribute('aria-label','Filtrar cadastros');[['all','Todos os ativos'],['students','Alunos'],['advisors','Professores'],['archived','Excluídos']].forEach(([value,label])=>{const filter=button(label,'',()=>{userFilter=value;paintManagedUsers();});filter.dataset.userFilter=value;filters.append(filter);});tools.append(filters);usersPanel.append(tools);
  const list=node('div','admin-user-list');list.id='admin-user-list';list.setAttribute('aria-label','Cadastros da escola');usersPanel.append(list);fragment.append(usersPanel);queueMicrotask(paintManagedUsers);return fragment;
}

window.addEventListener('offline',()=>{const banner=$('#connection-banner');banner.textContent='Você está sem conexão. Grupos, convites e mensagens serão atualizados quando a conexão voltar.';banner.hidden=false;});
window.addEventListener('online',()=>{$('#connection-banner').hidden=true;});

readRoute();
try {
  service = await import('./firebase-service.js?v=20261110-2');
  authStatus('Verificando acesso…','',true);
  sessionUnsubscribe = service.onSession(sessionChanged) || (() => {});
} catch(error) {
  authStatus('Não foi possível conectar ao serviço de acesso. Confira a conexão e recarregue esta página.','error');
  const retry=button('Tentar novamente','text-button',()=>location.reload());$('#auth-status').append(document.createTextNode(' '),retry);
}
window.addEventListener('beforeunload',event=>{if([...articleEditors.values()].some(({editor})=>editor.hasUnsaved())){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',event=>{if(!event.persisted){for(const {editor}of articleEditors.values())editor.destroy();articleEditors.clear();revokeProposalUrls();cleanupDialog();destroyIndicators();sessionUnsubscribe();appUnsubscribe();agreementsUnsubscribe();for(const unsubscribe of groupListeners.values())unsubscribe();}});
