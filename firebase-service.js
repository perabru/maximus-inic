import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, sendPasswordResetEmail, sendEmailVerification, reload, updateProfile, setPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getDatabase, ref, get, set, update, remove, push, onValue, query, orderByChild, equalTo, limitToLast, serverTimestamp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js';

// This public Firebase configuration identifies the project; authorization is
// enforced by database.rules.json, never by an email check in this client.
export const firebaseConfig = Object.freeze({
  apiKey: 'AIzaSyDESrp6AWsqZfU9QJ3f2XdiGtQNRR5LrtE',
  authDomain: 'fir-ionic-a5e90.firebaseapp.com',
  databaseURL: 'https://fir-ionic-a5e90.firebaseio.com',
  projectId: 'fir-ionic-a5e90',
  storageBucket: 'fir-ionic-a5e90.firebasestorage.app',
  messagingSenderId: '784865129310',
  appId: '1:784865129310:web:0a729c1020cf946192d5cf'
});
const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);
const ROOT = 'maximusInic';
const path = (value = '') => ref(db, `${ROOT}${value ? '/' + value : ''}`);
const authReady = setPersistence(auth, browserSessionPersistence);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({prompt: 'select_account'});
let profileCache = null;
let roleCache = 'student';
const profileInitializations = new Map();
const sessionObservers = new Set();
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const collection = (snapshot) => Object.entries(snapshot.val() || {}).map(([id, value]) => ({...value, id}));
const needUser = () => {
  if (!auth.currentUser) throw Object.assign(new Error('Entre na sua conta para continuar.'), {code:'auth/requires-login'});
  return auth.currentUser;
};
async function ensureProfile(user, supplied = {}) {
  const previous = profileInitializations.get(user.uid) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => writeProfile(user,supplied));
  profileInitializations.set(user.uid,operation);
  try {await operation;} finally {if(profileInitializations.get(user.uid) === operation)profileInitializations.delete(user.uid);}
}
async function writeProfile(user, supplied = {}) {
  const record = await get(path(`users/${user.uid}`));
  if (!record.exists()) {
    const name = clean(supplied.name || user.displayName || user.email?.split('@')[0] || 'Participante', 100);
    await set(path(`users/${user.uid}`), {
      name, email: clean(user.email, 254).toLowerCase(),
      requestedRole: supplied.requestedRole === 'advisor' ? 'advisor' : 'student',
      year: clean(supplied.year, 30), createdAt: Date.now()
    });
  } else if (supplied.name) {
    await update(path(`users/${user.uid}`), {
      name: clean(supplied.name,100), requestedRole: supplied.requestedRole === 'advisor' ? 'advisor' : 'student', year: clean(supplied.year,30)
    });
  }
}
export function onSession(callback) {
  sessionObservers.add(callback);
  const stop=onAuthStateChanged(auth, async user => {
    if (user) {
      try {await ensureProfile(user);} catch(error) {console.warn('Perfil: ', error.code || 'indisponível');}
    } else {profileCache = null; roleCache = 'student';}
    callback(user);
  });
  return () => {sessionObservers.delete(callback);stop();};
}
export async function register({name,email,password,requestedRole = 'student',year = ''}) {
  if (!clean(name,100)) throw new Error('Informe seu nome.');
  await authReady;
  const {user} = await createUserWithEmailAndPassword(auth, clean(email,254).toLowerCase(), password);
  await updateProfile(user, {displayName: clean(name,100)});
  await ensureProfile(user, {name,requestedRole,year});
  await sendEmailVerification(user);
  return user;
}
export async function login(email,password) {
  await authReady;
  const {user} = await signInWithEmailAndPassword(auth, clean(email,254).toLowerCase(), password);
  await ensureProfile(user);
  return user;
}
export async function loginGoogle() {
  await authReady;
  try {
    const {user} = await signInWithPopup(auth, provider);
    await ensureProfile(user);
    return user;
  } catch(error) {
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
}
getRedirectResult(auth).then(result => result?.user && ensureProfile(result.user)).catch(error => console.warn('Login Google: ', error.code));
export const logout = () => signOut(auth);
export const resetPassword = email => sendPasswordResetEmail(auth, clean(email,254).toLowerCase());
export const currentUser = () => auth.currentUser;
export const sendVerification = () => sendEmailVerification(needUser());
export async function refreshSession() {
  const user=needUser();
  await reload(user);
  await user.getIdToken(true);
  sessionObservers.forEach(callback=>callback(auth.currentUser));
  return auth.currentUser;
}

export function subscribeApp(user, callback) {
  let stopped = false;
  let scopeStops = [];
  const state = {profile:null,role:'student',users:[],advisors:[],groups:[],invitations:[]};
  const emit = () => {if (!stopped) callback({...state});};
  const report = error => {if (!stopped) callback({...state,error});};
  const watch = (target, fn, into = scopeStops) => {
    const stop = onValue(target, snapshot => {if(!stopped)fn(snapshot);}, report);
    into.push(stop);
    return stop;
  };
  const lifecycleStops = [];
  watch(path(`users/${user.uid}`), snapshot => {state.profile = snapshot.val(); profileCache = state.profile; emit();}, lifecycleStops);
  watch(path('advisorDirectory'), snapshot => {state.advisors = collection(snapshot).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')); emit();}, lifecycleStops);
  watch(path(`roles/${user.uid}`), snapshot => {
    const role = ['coordinator','advisor'].includes(snapshot.val()) ? snapshot.val() : 'student';
    state.role = role;
    roleCache = role;
    scopeStops.forEach(stop => stop());
    scopeStops = [];
    state.groups = [];
    state.users = [];
    state.invitations = [];
    if (role === 'coordinator') {
      watch(path('groups'), snapshot => {state.groups = collection(snapshot).sort((a,b)=>(b.createdAt || 0)-(a.createdAt || 0)); emit();});
      watch(path('users'), snapshot => {state.users = collection(snapshot).map(person => ({...person,role:state.userRoles?.[person.id] || 'student'})); emit();});
      watch(path('invitations'), snapshot => {state.invitations = collection(snapshot).sort((a,b)=>(b.createdAt || 0)-(a.createdAt || 0)); emit();});
      watch(path('roles'), snapshot => {
        const roles = snapshot.val() || {};
        state.users = state.users.map(person => ({...person,role:roles[person.id] || 'student'}));
        state.userRoles = roles;
        emit();
      });
    } else {
      const ownGroups = new Map();
      let advisorGroups = [];
      let groupListeners = new Map();
      const combineGroups = () => {state.groups = [...new Map([...ownGroups.values(),...advisorGroups].map(group=>[group.id,group])).values()].sort((a,b)=>(b.createdAt || 0)-(a.createdAt || 0)); emit();};
      watch(path(`userGroups/${user.uid}`), snapshot => {
        const ids = Object.keys(snapshot.val() || {});
        for(const [id, stop] of groupListeners) if(!ids.includes(id)) {stop(); groupListeners.delete(id); ownGroups.delete(id);}
        for(const id of ids) if(!groupListeners.has(id)) {
          const stop = onValue(path(`groups/${id}`), snap => {
            if(stopped) return;
            if(snap.exists()) ownGroups.set(id,{...snap.val(),id}); else ownGroups.delete(id);
            combineGroups();
          }, error => {ownGroups.delete(id); combineGroups(); if(error.code !== 'PERMISSION_DENIED') report(error);});
          groupListeners.set(id,stop);
        }
        combineGroups();
      });
      scopeStops.push(() => {groupListeners.forEach(stop => stop()); groupListeners.clear();});
      if(role === 'advisor') watch(query(path('groups'),orderByChild('advisorId'),equalTo(user.uid)), snapshot => {advisorGroups=collection(snapshot);combineGroups();});
      const inviteBuckets = new Map();
      const watchInvites = (key,value) => watch(query(path('invitations'),orderByChild(key),equalTo(value)), snapshot => {
        inviteBuckets.set(key,collection(snapshot));
        state.invitations = [...new Map([...inviteBuckets.values()].flat().map(invitation=>[invitation.id,invitation])).values()].sort((a,b)=>(b.createdAt || 0)-(a.createdAt || 0));
        emit();
      });
      watchInvites('senderId',user.uid);
      watchInvites('toUid',user.uid);
      if(user.email && user.emailVerified) watchInvites('toEmail',user.email.toLowerCase());
    }
    emit();
  }, lifecycleStops);
  return () => {stopped=true; lifecycleStops.forEach(stop=>stop()); scopeStops.forEach(stop=>stop());};
}
export function subscribeGroup(groupId, callback) {
  const user=needUser();
  const state = {tasks:[],messages:[],groupEvaluation:null,memberEvaluations:[]};
  let stopped=false;
  let group=null;
  let role='student';
  let evaluationMode='';
  let evaluationVersion=0;
  let evaluationStops=[];
  const emit=()=>{if(!stopped)callback({...state});};
  const report = error => !stopped && callback({...state,error});
  const attachEvaluations=()=>{
    const manager=role==='coordinator'||(role==='advisor'&&group?.advisorId===user.uid);
    const mode=!group||group.status==='deleting'?'none':manager?'manager':group.members?.[user.uid]?'member':'none';
    if(mode===evaluationMode)return;
    evaluationMode=mode;
    const version=++evaluationVersion;
    evaluationStops.forEach(stop=>stop());evaluationStops=[];
    // Discard privileged cached grades before changing to a student scope.
    state.groupEvaluation=null;state.memberEvaluations=[];
    if(mode!=='none') {
      const watchEvaluation=(target,apply)=>evaluationStops.push(onValue(target,snapshot=>{
        if(stopped||version!==evaluationVersion)return;
        apply(snapshot);emit();
      },error=>{if(version===evaluationVersion){state.groupEvaluation=null;state.memberEvaluations=[];report(error);}}));
      watchEvaluation(path(`evaluations/${groupId}/group`),snapshot=>{state.groupEvaluation=snapshot.val();});
      if(mode==='manager')watchEvaluation(path(`evaluations/${groupId}/members`),snapshot=>{state.memberEvaluations=collection(snapshot);});
      else watchEvaluation(path(`evaluations/${groupId}/members/${user.uid}`),snapshot=>{state.memberEvaluations=snapshot.exists()?[{...snapshot.val(),id:user.uid}]:[];});
    }
    emit();
  };
  const stops = [
    onValue(path(`tasks/${groupId}`), snap => {state.tasks=collection(snap).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));if(!stopped)callback({...state});}, report),
    onValue(query(path(`messages/${groupId}`),orderByChild('createdAt'),limitToLast(150)), snap => {state.messages=collection(snap).sort((a,b)=>a.createdAt-b.createdAt);if(!stopped)callback({...state});}, report),
    onValue(path(`groups/${groupId}`),snapshot=>{group=snapshot.val();attachEvaluations();},error=>{group=null;attachEvaluations();report(error);}),
    onValue(path(`roles/${user.uid}`),snapshot=>{role=snapshot.val()||'student';attachEvaluations();},report)
  ];
  return () => {stopped=true;evaluationVersion++;stops.forEach(stop=>stop());evaluationStops.forEach(stop=>stop());};
}
export async function saveProfile(patch) {
  const user=needUser();
  const changes={};
  if(patch.name !== undefined) changes.name=clean(patch.name,100);
  if(patch.year !== undefined) changes.year=clean(patch.year,30);
  if(patch.requestedRole !== undefined) changes.requestedRole=patch.requestedRole === 'advisor' ? 'advisor' : 'student';
  await update(path(`users/${user.uid}`),changes);
  if(changes.name) {
    await updateProfile(user,{displayName:changes.name});
    if(roleCache==='advisor'||roleCache==='coordinator') await set(path(`advisorDirectory/${user.uid}`),{uid:user.uid,name:changes.name});
  }
}
export async function setUserRole(uid,role) {
  needUser();
  if(!['coordinator','advisor','student'].includes(role)) throw new Error('Perfil de acesso inválido.');
  const person=(await get(path(`users/${uid}`))).val();
  if(!person) throw new Error('Usuário não encontrado.');
  const changes = {[`roles/${uid}`]:role,[`advisorDirectory/${uid}`]:role==='advisor'||role==='coordinator'?{uid,name:person.name}:null};
  await update(path(),changes);
}
export async function approveAdvisor(uid) {
  // Coordination and group advising can coexist. Listing a coordinator as an
  // advisor must preserve their access to the whole school.
  const currentRole=(await get(path(`roles/${uid}`))).val();
  return setUserRole(uid,currentRole==='coordinator'?'coordinator':'advisor');
}
export async function createGroup({name,topic,description='',year=2027,advisorId=''}) {
  const user=needUser();
  const edition=Number(year);
  if(!Number.isInteger(edition) || edition<2025 || edition>2100)throw new Error('Informe uma edição válida, por exemplo 2027.');
  const groupRef=push(path('groups'));
  const groupName=clean(name,100);
  const groupTopic=clean(topic,240);
  if(!groupName || !groupTopic)throw new Error('Informe o nome do grupo e o tema da pesquisa.');
  const directAdvisor=(roleCache==='advisor' && (!advisorId || advisorId===user.uid)) || (roleCache==='coordinator' && advisorId===user.uid) ? user.uid : '';
  await update(path(),{[`groups/${groupRef.key}`]:{name:groupName,topic:groupTopic,description:clean(description,3000),year:edition,advisorId:directAdvisor,members:{[user.uid]:true},memberNames:{[user.uid]:profileCache?.name || user.displayName || 'Participante'},createdBy:user.uid,createdAt:Date.now(),status:'active'},[`userGroups/${user.uid}/${groupRef.key}`]:true});
  await createDefaultSchedule(groupRef.key,edition);
  if(advisorId && advisorId!==directAdvisor) await invite({groupId:groupRef.key,toUid:advisorId,type:'advisor'});
  return groupRef.key;
}
export async function updateGroup(groupId,patch) {
  needUser();
  const allowed={};
  for(const [key,value] of Object.entries(patch)) {
    if(['name','topic','description','status'].includes(key))allowed[key]=clean(value,key==='description'?3000:key==='topic'?240:100);
    else if(key==='year') {if(!Number.isInteger(Number(value)))throw new Error('O ano da edição precisa ser inteiro.'); allowed.year=Number(value);}
  }
  await update(path(`groups/${groupId}`),allowed);
}
function checkIdentifier(value) {
  if(typeof value!=='string'||!value||value.length>128||/[.#$\[\]/]/.test(value))throw new Error('Identificação inválida.');
  return value;
}
async function managedGroup(groupId,{allowDeleting=false}={}) {
  const user=needUser();checkIdentifier(groupId);
  const [groupSnapshot,roleSnapshot]=await Promise.all([get(path(`groups/${groupId}`)),get(path(`roles/${user.uid}`))]);
  const group=groupSnapshot.val();
  if(!group)throw new Error('Grupo não encontrado.');
  const role=roleSnapshot.val();
  if(role!=='coordinator'&&!(role==='advisor'&&group.advisorId===user.uid))throw new Error('Somente a coordenação ou o orientador deste grupo pode realizar esta ação.');
  if(group.status==='deleting'&&!allowDeleting)throw new Error('A exclusão deste grupo está em andamento. Conclua a exclusão antes de continuar.');
  return group;
}
export async function updateMember(groupId,uid,{name}) {
  checkIdentifier(uid);
  const group=await managedGroup(groupId);
  if(!group.members?.[uid])throw new Error('Este integrante não pertence ao grupo.');
  const alias=clean(name,100);
  if(!alias)throw new Error('Informe o nome do integrante.');
  await set(path(`groups/${groupId}/memberNames/${uid}`),alias);
}
export async function removeMember(groupId,uid) {
  checkIdentifier(uid);
  const group=await managedGroup(groupId);
  if(!group.members?.[uid])throw new Error('Este integrante não pertence ao grupo.');
  await update(path(),{[`groups/${groupId}/members/${uid}`]:null,[`groups/${groupId}/memberNames/${uid}`]:null,[`userGroups/${uid}/${groupId}`]:null,[`evaluations/${groupId}/members/${uid}`]:null,[`admissions/${groupId}/${uid}`]:null,[`memberRevocations/${groupId}/${uid}`]:serverTimestamp()});
}
export async function deleteGroup(groupId) {
  const group=await managedGroup(groupId,{allowDeleting:true});
  // Lock all new group activity before taking the cleanup snapshot. Retrying a
  // deletion after a lost connection safely resumes the same operation.
  if(group.status!=='deleting')await update(path(`groups/${groupId}`),{status:'deleting'});
  const [lockedGroup,invitationSnapshot]=await Promise.all([
    get(path(`groups/${groupId}`)),
    get(query(path('invitations'),orderByChild('groupId'),equalTo(groupId)))
  ]);
  const frozen=lockedGroup.val();
  if(!frozen)return;
  const changes={};
  for(const resource of ['groups','tasks','messages','evaluations','admissions','memberRevocations'])changes[`${resource}/${groupId}`]=null;
  const relatedUsers=new Set([...Object.keys(frozen.members||{}),frozen.createdBy,frozen.advisorId].filter(Boolean));
  for(const uid of relatedUsers)changes[`userGroups/${uid}/${groupId}`]=null;
  for(const invitation of collection(invitationSnapshot))changes[`invitations/${invitation.id}`]=null;
  await update(path(),changes);
}
async function evaluationRecord({score,feedback=''}) {
  const user=needUser();
  if(typeof score!=='number'||!Number.isFinite(score)||score<0||score>10)throw new Error('Informe uma nota entre 0 e 10.');
  const profile=(await get(path(`users/${user.uid}`))).val();
  return {score,feedback:clean(feedback,3000),updatedBy:user.uid,updatedAt:serverTimestamp(),evaluatorName:clean(profile?.name,100)};
}
export async function saveEvaluation(groupId,evaluation) {
  await managedGroup(groupId);
  await set(path(`evaluations/${groupId}/group`),await evaluationRecord(evaluation));
}
export async function saveMemberEvaluation(groupId,uid,evaluation) {
  checkIdentifier(uid);
  const group=await managedGroup(groupId);
  if(!group.members?.[uid])throw new Error('Este integrante não pertence ao grupo.');
  await set(path(`evaluations/${groupId}/members/${uid}`),await evaluationRecord(evaluation));
}
export async function deleteEvaluation(groupId,uid) {
  await managedGroup(groupId);
  if(uid!==undefined)checkIdentifier(uid);
  await remove(path(`evaluations/${groupId}/${uid===undefined?'group':`members/${uid}`}`));
}
export async function invite({groupId,toEmail='',toUid='',type='member'}) {
  const user=needUser();
  const group=(await get(path(`groups/${groupId}`))).val();
  if(!group)throw new Error('Grupo não encontrado.');
  if(!['member','advisor'].includes(type))throw new Error('Tipo de convite inválido.');
  if(type==='advisor' && !toUid)throw new Error('Selecione um orientador aprovado.');
  if(type==='member' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail))throw new Error('Informe um e-mail válido para o convite.');
  const invitationRef=push(path('invitations'));
  await set(invitationRef,{groupId,groupName:group.name,toEmail:clean(toEmail,254).toLowerCase(),toUid:clean(toUid,128),type,senderId:user.uid,senderName:profileCache?.name || user.displayName || 'Participante',status:'pending',createdAt:serverTimestamp()});
  return invitationRef.key;
}
export async function respondInvitation(invitationId,accept) {
  const user=needUser();
  const invitation=(await get(path(`invitations/${invitationId}`))).val();
  if(!invitation || invitation.status!=='pending')throw new Error('Este convite já foi respondido ou cancelado.');
  if(invitation.toUid!==user.uid && invitation.toEmail!==user.email?.toLowerCase())throw new Error('Este convite pertence a outra conta.');
  if(!accept) {await update(path(`invitations/${invitationId}`),{status:'declined'});return;}
  // Admissions contain only an invitation id. Server rules validate recipient,
  // group, pending state, type and role before any membership can be written.
  await set(path(`admissions/${invitation.groupId}/${user.uid}`),invitationId);
  const changes = {[`invitations/${invitationId}/status`]:'accepted'};
  if(invitation.type==='advisor') {
    changes[`groups/${invitation.groupId}/advisorId`] = user.uid;
  } else {
    changes[`groups/${invitation.groupId}/members/${user.uid}`] = true;
    changes[`groups/${invitation.groupId}/memberNames/${user.uid}`] = profileCache?.name || user.displayName || 'Participante';
    changes[`userGroups/${user.uid}/${invitation.groupId}`] = true;
  }
  // Only the admission is separate; it grants no data access. All effective
  // membership changes and the final invitation status commit atomically.
  await update(path(),changes);
}

export const defaultSchedule = (year=2027) => [
  {id:'tema',title:'Tema e orientador definidos',dueDate:`${year}-03-31`},
  {id:'pesquisa',title:'Pesquisa e referências organizadas',dueDate:`${year}-05-31`},
  {id:'rascunho',title:'Primeira versão do artigo',dueDate:`${year}-06-30`},
  {id:'artigo',title:'Revisão e versão final do artigo',dueDate:`${year}-07-31`},
  {id:'inscricao',title:'Conferir inscrição e boleto (previsão interna)',dueDate:`${year}-08-15`},
  {id:'formatacao',title:'Preparação e revisão do banner',dueDate:`${year}-09-30`},
  {id:'banner',title:'Impressão do banner (previsão interna)',dueDate:`${year}-10-10`},
  {id:'apresentacao',title:'Ensaio e apresentação (data a confirmar)',dueDate:`${year}-10-20`}
];
export async function createDefaultSchedule(groupId,year=2027) {
  const user=needUser();
  if(!Number.isInteger(Number(year)) || Number(year)<2025 || Number(year)>2100)throw new Error('Informe um ano válido para o cronograma.');
  const existing=(await get(path(`tasks/${groupId}`))).val() || {};
  const changes={};
  for(const task of defaultSchedule(year)) if(!existing[task.id]) {
    changes[task.id]={title:task.title,dueDate:task.dueDate,completed:false,weight:1,createdBy:user.uid,createdAt:Date.now(),completedBy:''};
  }
  if(Object.keys(changes).length)await update(path(`tasks/${groupId}`),changes);
}
export async function addTask(groupId,{title,dueDate,weight=1}) {
  const user=needUser();
  checkDate(dueDate);
  const taskRef=push(path(`tasks/${groupId}`));
  await set(taskRef,{title:clean(title,160),dueDate:clean(dueDate,10),completed:false,weight:Math.max(1,Math.min(10,Number(weight)||1)),createdBy:user.uid,createdAt:Date.now(),completedBy:''});
  return taskRef.key;
}
export async function updateTask(groupId,taskId,patch) {
  const user=needUser();
  const changes={};
  if(patch.title!==undefined)changes.title=clean(patch.title,160);
  if(patch.dueDate!==undefined){checkDate(patch.dueDate);changes.dueDate=clean(patch.dueDate,10);}
  if(patch.weight!==undefined)changes.weight=Math.max(1,Math.min(10,Number(patch.weight)||1));
  if(patch.completed!==undefined){changes.completed=Boolean(patch.completed);changes.completedBy=patch.completed?user.uid:'';}
  await update(path(`tasks/${groupId}/${taskId}`),changes);
}
export const deleteTask=(groupId,taskId)=>{needUser();return remove(path(`tasks/${groupId}/${taskId}`));};
export async function sendMessage(groupId,text) {
  const user=needUser();
  const message=clean(text,5000);
  if(!message)throw new Error('Escreva uma mensagem antes de enviar.');
  await set(push(path(`messages/${groupId}`)),{text:message,senderId:user.uid,senderName:profileCache?.name || user.displayName || 'Participante',createdAt:Date.now()});
}
export function getProgress(tasks=[]) {
  const list=Array.isArray(tasks)?tasks:Object.values(tasks);
  const total=list.reduce((sum,task)=>sum+(Number(task.weight)||1),0);
  return total?Math.round(list.reduce((sum,task)=>sum+(task.completed?(Number(task.weight)||1):0),0)/total*100):0;
}
function checkDate(value) {
  const string=String(value || '');
  const date=new Date(`${string}T12:00:00Z`);
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(string) || Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==string)throw new Error('Escolha uma data válida para a entrega.');
}
export function friendlyError(error) {
  const messages={
    'auth/invalid-credential':'E-mail ou senha incorretos.',
    'auth/user-not-found':'E-mail ou senha incorretos.',
    'auth/wrong-password':'E-mail ou senha incorretos.',
    'auth/email-already-in-use':'Este e-mail já tem uma conta. Entre ou redefina a senha.',
    'auth/invalid-email':'Confira o endereço de e-mail.',
    'auth/weak-password':'Use uma senha com pelo menos 6 caracteres.',
    'auth/operation-not-allowed':'Este método de login ainda precisa ser habilitado na configuração do aplicativo.',
    'auth/unauthorized-domain':'Este endereço do site ainda precisa ser autorizado no login do aplicativo.',
    'auth/popup-closed-by-user':'A janela de login foi fechada. Tente novamente.',
    'auth/cancelled-popup-request':'Uma janela de login já está aberta.',
    'auth/network-request-failed':'Sem conexão. Verifique sua internet e tente novamente.',
    'auth/too-many-requests':'Muitas tentativas. Aguarde um pouco e tente novamente.',
    'PERMISSION_DENIED':'Seu perfil ainda não tem permissão para esta ação. Se você é professor, aguarde a liberação da coordenação.',
    'permission_denied':'Seu perfil ainda não tem permissão para esta ação. Verifique a liberação com a coordenação.'
  };
  return messages[error?.code] || error?.message || 'Não foi possível concluir. Tente novamente.';
}
