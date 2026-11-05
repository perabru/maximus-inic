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
export const mandatoryAgreementYear = 2027;
const agreementUploads = new Map();
const agreementObservers = new Set();
const notifyAgreementObservers = () => agreementObservers.forEach(emit=>emit());
function completeAgreement(metadata,file,uid,year=mandatoryAgreementYear) {
  return Boolean(metadata&&file&&metadata.uid===uid&&metadata.year===year&&
    typeof metadata.filename==='string'&&metadata.filename.length>0&&typeof metadata.ownerName==='string'&&metadata.ownerName.length>0&&
    Number.isInteger(metadata.size)&&metadata.size>0&&metadata.size<=3*1024*1024&&
    ['application/pdf','image/jpeg','image/png'].includes(metadata.contentType)&&
    typeof metadata.uploadedAt==='number'&&metadata.uploadedAt>0&&
    file.size===metadata.size&&file.contentType===metadata.contentType&&file.uploadedAt===metadata.uploadedAt);
}
async function requireAcademicAccess() {
  const user=needUser();
  const role=(await get(path(`roles/${user.uid}`))).val();
  if(role==='advisor'||role==='coordinator')return role;
  if(agreementUploads.has(user.uid))throw Object.assign(new Error('Aguarde a confirmação do envio do termo.'),{code:'agreement/pending'});
  const profile=(await get(path(`users/${user.uid}`))).val();
  if(!profile||profile.onboardingRequired===true)throw new Error('Conclua seu cadastro antes de continuar.');
  if(profile.requestedRole==='advisor')throw new Error('Aguarde a aprovação da coordenação para atuar como professor(a).');
  const base=`${mandatoryAgreementYear}/${user.uid}`;
  // Read only the small file descriptors; the signed document is never loaded
  // just to check access. Database rules verify the complete stored file pair.
  const [metadata,size,contentType,uploadedAt]=await Promise.all([
    get(path(`agreements/${base}`)),get(path(`agreementFiles/${base}/size`)),
    get(path(`agreementFiles/${base}/contentType`)),get(path(`agreementFiles/${base}/uploadedAt`))
  ]);
  if(!completeAgreement(metadata.val(),{size:size.val(),contentType:contentType.val(),uploadedAt:uploadedAt.val()},user.uid))
    throw Object.assign(new Error('Envie o termo assinado de 2027 em “Meu termo” para continuar.'),{code:'agreement/required'});
  return 'student';
}
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
      year: clean(supplied.year, 30), createdAt: Date.now(),
      onboardingRequired: !supplied.name && user.providerData?.some(item=>item.providerId==='google.com') === true
    });
  } else if (supplied.name) {
    await update(path(`users/${user.uid}`), {
      name: clean(supplied.name,100), requestedRole: supplied.requestedRole === 'advisor' ? 'advisor' : 'student', year: clean(supplied.year,30), onboardingRequired:false
    });
  }
}
export function onSession(callback) {
  sessionObservers.add(callback);let active=true,version=0;
  const stop=onAuthStateChanged(auth, async user => {
    const current=++version;
    if (user) {
      try {await ensureProfile(user);} catch(error) {console.warn('Perfil: ', error.code || 'indisponível');}
    } else {profileCache = null; roleCache = 'student';}
    if(active&&current===version&&(auth.currentUser?.uid||null)===(user?.uid||null))callback(user);
  });
  return () => {active=false;version++;sessionObservers.delete(callback);stop();};
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
// A Google account is authenticated first. Its role request is chosen once in
// the application, so popup, redirect and auth observer ordering cannot silently
// assign a new teacher the student profile. Requested roles never grant access.
export async function completeGoogleProfile({requestedRole,year='',name=''}={}) {
  const user=needUser();
  if(!['student','advisor'].includes(requestedRole))throw new Error('Escolha se você é estudante ou professor(a).');
  const snapshot=await get(path(`users/${user.uid}`));
  const profile=snapshot.val();
  if(!profile)throw new Error('Seu perfil ainda está carregando. Tente novamente.');
  if(profile.onboardingRequired!==true)return profile;
  const fullName=clean(name||profile.name||user.displayName,100);
  if(fullName.length<2)throw new Error('Informe seu nome completo.');
  const schoolYear=requestedRole==='student'?clean(year,30):'';
  if(requestedRole==='student'&&!['1º ano','2º ano','3º ano'].includes(schoolYear))throw new Error('Escolha sua série escolar.');
  const changes={name:fullName,requestedRole,year:schoolYear,onboardingRequired:false};
  await update(path(`users/${user.uid}`),changes);
  await updateProfile(user,{displayName:fullName});
  profileCache={...profile,...changes};
  return profileCache;
}
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
  const state = {tasks:[],messages:[],events:[],groupEvaluation:null,memberEvaluations:[],advisorConfirmation:null,advisorConfirmationReady:false};
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
    onValue(path(`advisorConfirmations/${groupId}`),snap=>{state.advisorConfirmation=snap.val();state.advisorConfirmationReady=true;emit();},report),
    onValue(path(`events/${groupId}`),snap=>{state.events=collection(snap).sort((a,b)=>a.date.localeCompare(b.date));if(!stopped)callback({...state});},report),
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
async function approvedAdvisorIds(ids) {
  if(!Array.isArray(ids)||ids.length>3)throw new Error('Escolha até 3 orientadores.');
  const unique=[...new Set(ids.map(checkIdentifier))];
  if(unique.length!==ids.length)throw new Error('Escolha orientadores diferentes.');
  for(const uid of unique)if(!(await get(path(`advisorDirectory/${uid}`))).exists())throw new Error('Selecione apenas orientadores aprovados pela coordenação.');
  return unique;
}
function invitationRecord(user,groupId,groupName,toUid='',toEmail='',type='advisor') {
  return {groupId,groupName,toEmail:clean(toEmail,254).toLowerCase(),toUid,type,senderId:user.uid,senderName:profileCache?.name||user.displayName||'Participante',status:'pending',createdAt:serverTimestamp()};
}
function proposalMemberEmails(emails,selfEmail) {
  if(!Array.isArray(emails))throw new Error('Informe os e-mails dos colegas em uma lista.');
  const unique=new Set(),own=String(selfEmail||'').trim().toLowerCase();
  for(const value of emails){
    if(typeof value!=='string')throw new Error('Informe um e-mail válido para cada colega.');
    const email=value.trim().toLowerCase();
    if(email.length>254||!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email))throw new Error('Confira os e-mails dos colegas antes de enviar os convites.');
    if(email!==own)unique.add(email);
    if(unique.size>20)throw new Error('Convide até 20 colegas ao criar o grupo.');
  }
  return [...unique];
}
export async function createGroup({name,topic,description='',year=2027,advisorId='',advisorIds=[],memberEmails=[]}) {
  const user=needUser(),role=await requireAcademicAccess();
  const edition=Number(year);
  if(!Number.isInteger(edition)||edition<2025||edition>2100)throw new Error('Informe uma edição válida, por exemplo 2027.');
  const groupName=clean(name,100),groupTopic=clean(topic,240);
  if(!groupName||!groupTopic)throw new Error('Informe o nome do grupo e o tema da pesquisa.');
  const colleagues=proposalMemberEmails(memberEmails,user.email);
  const candidates=await approvedAdvisorIds(role==='student'?(advisorIds.length?advisorIds:advisorId?[advisorId]:[]):advisorId&&advisorId!==user.uid?[advisorId]:[]);
  const directAdvisor=(role==='advisor'&&(!advisorId||advisorId===user.uid))||(role==='coordinator'&&advisorId===user.uid)?user.uid:'';
  const groupId=push(path('groups')).key;
  const group={name:groupName,topic:groupTopic,description:clean(description,3000),year:edition,advisorId:directAdvisor,members:{[user.uid]:true},memberNames:{[user.uid]:profileCache?.name||user.displayName||'Participante'},createdBy:user.uid,createdAt:Date.now(),status:'active',advisorRequestVersion:candidates.length?1:0};
  if(role==='student')group.advisorRequestPolicy='first-accept-v1';
  const changes={[`groups/${groupId}`]:group,[`userGroups/${user.uid}/${groupId}`]:true};
  for(const task of defaultSchedule(edition))changes[`tasks/${groupId}/${task.id}`]={title:task.title,dueDate:task.dueDate,completed:false,weight:1,createdBy:user.uid,createdAt:Date.now(),completedBy:''};
  for(const [slot,uid] of candidates.entries()){const id=push(path('invitations')).key;changes[`invitations/${id}`]=invitationRecord(user,groupId,groupName,uid);changes[`advisorRequests/${groupId}/${uid}`]=id;changes[`advisorRequestSlots/${groupId}/${slot}`]=uid;}
  for(const email of colleagues){const id=push(path('invitations')).key;changes[`invitations/${id}`]=invitationRecord(user,groupId,groupName,'',email,'member');}
  // Proposal, first schedule and all selected invitations either all commit or
  // all fail. Retrying a failed form cannot leave a second partial proposal.
  await update(path(),changes);
  return groupId;
}
export async function updateGroup(groupId,patch) {
  needUser();
  await requireAcademicAccess();
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
  for(const resource of ['groups','tasks','messages','events','evaluations','admissions','memberRevocations','advisorRequests','advisorRequestSlots','advisorConfirmations'])changes[`${resource}/${groupId}`]=null;
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
  const user=needUser(),role=await requireAcademicAccess();checkIdentifier(groupId);
  const group=(await get(path(`groups/${groupId}`))).val();
  if(!group)throw new Error('Grupo não encontrado.');
  if(group.status==='deleting')throw new Error('A exclusão deste grupo está em andamento.');
  if(!(role==='coordinator'||(role==='advisor'&&group.advisorId===user.uid)||(role!=='advisor'&&group.members?.[user.uid])))throw new Error('Você não pode enviar convites para este grupo.');
  if(!['member','advisor'].includes(type))throw new Error('Tipo de convite inválido.');
  if(type==='member'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail))throw new Error('Informe um e-mail válido para o convite.');
  const id=push(path('invitations')).key,changes={};
  if(type==='advisor') {
    await approvedAdvisorIds([toUid]);
    const slots=(await get(path(`advisorRequests/${groupId}`))).val()||{};
    const positions=(await get(path(`advisorRequestSlots/${groupId}`))).val()||{};
    if(group.advisorId)throw new Error('Este grupo já tem um orientador confirmado.');
    const active=[];
    for(const [uid,previous] of Object.entries(slots)){
      const status=(await get(path(`invitations/${previous}/status`))).val();
      if(status==='pending')active.push(uid);else if(status==='declined'||status==='cancelled'){changes[`advisorRequests/${groupId}/${uid}`]=null;for(const [position,owner] of Object.entries(positions))if(owner===uid){changes[`advisorRequestSlots/${groupId}/${position}`]=null;delete positions[position];}}
    }
    if(active.includes(toUid))throw new Error('Já existe um convite pendente para este orientador.');
    if(active.length>=3)throw new Error('O grupo já tem 3 convites pendentes. Aguarde uma resposta.');
    const position=['0','1','2'].find(key=>!positions[key]);
    if(position===undefined)throw new Error('O grupo já tem 3 convites pendentes.');
    changes[`advisorRequests/${groupId}/${toUid}`]=id;
    changes[`advisorRequestSlots/${groupId}/${position}`]=toUid;
    changes[`groups/${groupId}/advisorRequestVersion`]=(group.advisorRequestVersion||0)+1;
  }
  changes[`invitations/${id}`]=invitationRecord(user,groupId,group.name,toUid,toEmail,type);
  await update(path(),changes);return id;
}
export async function respondInvitation(invitationId,accept) {
  const user=needUser();checkIdentifier(invitationId);
  const invitation=(await get(path(`invitations/${invitationId}`))).val();
  if(!invitation||invitation.status!=='pending')throw new Error('Este convite já foi respondido ou cancelado.');
  if(invitation.toUid!==user.uid&&invitation.toEmail!==user.email?.toLowerCase())throw new Error('Este convite pertence a outra conta.');
  if(!accept){await update(path(`invitations/${invitationId}`),{status:'declined'});return;}
  await requireAcademicAccess();
  await set(path(`admissions/${invitation.groupId}/${user.uid}`),invitationId);
  const changes={[`invitations/${invitationId}/status`]:'accepted'};
  if(invitation.type==='advisor') {
    const group=(await get(path(`groups/${invitation.groupId}`))).val();
    if(!group||group.status==='deleting')throw new Error('Este grupo não está disponível.');
    const slots=(await get(path(`advisorRequests/${invitation.groupId}`))).val()||{};
    if(group.advisorId)throw new Error('Outro orientador já confirmou este grupo.');
    const profile=(await get(path(`users/${user.uid}`))).val();
    changes[`groups/${invitation.groupId}/advisorId`]=user.uid;
    changes[`advisorConfirmations/${invitation.groupId}`]={studentUid:group.createdBy,advisorUid:user.uid,advisorName:clean(profile?.name||user.displayName||'Orientador',100),invitationId,createdAt:serverTimestamp(),requestVersion:group.advisorRequestVersion||0};
    for(const previous of Object.values(slots))if(previous!==invitationId&&(await get(path(`invitations/${previous}/status`))).val()==='pending')changes[`invitations/${previous}/status`]='cancelled';
  } else {
    changes[`groups/${invitation.groupId}/members/${user.uid}`]=true;
    changes[`groups/${invitation.groupId}/memberNames/${user.uid}`]=profileCache?.name||user.displayName||'Participante';
    changes[`userGroups/${user.uid}/${invitation.groupId}`]=true;
  }
  // A validated pending advisor admission allows inspection of this proposal.
  // Membership, acceptance and the durable confirmation still commit together.
  await update(path(),changes);
}

export async function addEvent({groupId,title,date,description=''}={}) {
  const user=needUser();await managedGroup(groupId);
  checkDate(date);
  const eventTitle=clean(title,160);if(!eventTitle)throw new Error('Informe o título do evento.');
  const event=push(path(`events/${groupId}`));
  await set(event,{title:eventTitle,date,description:clean(description,3000),createdBy:user.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  return event.key;
}
export async function updateEvent(groupId,eventId,patch={}) {
  await managedGroup(groupId);checkIdentifier(eventId);
  if(!(await get(path(`events/${groupId}/${eventId}`))).exists())throw new Error('Evento não encontrado.');
  const changes={updatedAt:serverTimestamp()};
  if(patch.title!==undefined){changes.title=clean(patch.title,160);if(!changes.title)throw new Error('Informe o título do evento.');}
  if(patch.date!==undefined){checkDate(patch.date);changes.date=patch.date;}
  if(patch.description!==undefined)changes.description=clean(patch.description,3000);
  await update(path(`events/${groupId}/${eventId}`),changes);
}
export async function deleteEvent(groupId,eventId) {
  await managedGroup(groupId);checkIdentifier(eventId);
  await remove(path(`events/${groupId}/${eventId}`));
}

export const agreementLimits=Object.freeze({maxBytes:3*1024*1024,contentTypes:['application/pdf','image/jpeg','image/png']});
function agreementYear(year=2027) {
  const value=Number(year);if(!Number.isInteger(value)||value<2027||value>2100)throw new Error('Escolha uma edição válida para o termo.');return value;
}
function effectiveAgreementReview(metadata,review) {
  if(!metadata||!review||!['approved','returned'].includes(review.status)||review.uploadedAt!==metadata.uploadedAt||review.uploadVersion!==(metadata.uploadVersion||''))return null;
  return review;
}
export function subscribeAgreements(year=2027,callback) {
  const user=needUser(),edition=agreementYear(year);let stopped=false,dataStops=[];let generation=0,currentEmit=()=>{};
  const pendingEmit=()=>currentEmit();agreementObservers.add(pendingEmit);
  const roleStop=onValue(path(`roles/${user.uid}`),snapshot=>{
    const current=++generation;dataStops.forEach(stop=>stop());dataStops=[];
    if(!stopped)callback({agreements:[],reviewReady:false,requirement:{ready:false,fulfilled:false}});
    const coordinator=snapshot.val()==='coordinator';
    const staff=coordinator||snapshot.val()==='advisor';
    const target=coordinator?path(`agreements/${edition}`):path(`agreements/${edition}/${user.uid}`);
    const reviewTarget=coordinator?path(`agreementReviews/${edition}`):path(`agreementReviews/${edition}/${user.uid}`);
    let metadataLoaded=false,metadata=null,list=[],descriptor={},scopeError=null,reviewsLoaded=false,reviews=null,reviewError=null,signaturesLoaded=false,signatureData=null,signatureError=null;const descriptorLoaded=new Set();
    const emit=()=>{
      if(stopped||current!==generation)return;
      if(scopeError){callback({agreements:[],reviewReady:false,requirement:{ready:false,fulfilled:false},error:scopeError});return;}
      const pending=!staff&&agreementUploads.has(user.uid);
      const ready=!pending&&metadataLoaded&&(staff||descriptorLoaded.size===3);
      const reviewReady=ready&&reviewsLoaded&&!reviewError;
      const signatureReady=reviewReady&&signaturesLoaded&&!signatureError;
      const records=list.map(record=>{const review=reviewReady?effectiveAgreementReview(record,coordinator?reviews?.[record.uid||record.id]:reviews):null;return {...record,review,signatures:signatureReady?effectiveAgreementSignatures(record,review,coordinator?signatureData?.[record.uid||record.id]:signatureData):[]};});
      callback({agreements:records,reviewReady,reviewError,signatureReady,signatureError,requirement:{ready,fulfilled:ready&&(staff||completeAgreement(metadata,descriptor,user.uid,edition))}});
    };
    currentEmit=emit;
    const fail=error=>{if(!stopped&&current===generation){scopeError=error;emit();}};
    dataStops.push(onValue(target,snap=>{
      if(stopped||current!==generation)return;
      metadataLoaded=true;metadata=snap.val();list=(coordinator?collection(snap):snap.exists()?[{...snap.val(),id:user.uid}]:[]).sort((a,b)=>(b.uploadedAt||0)-(a.uploadedAt||0));emit();
    },fail));
    dataStops.push(onValue(reviewTarget,snap=>{
      if(stopped||current!==generation)return;reviews=snap.val();reviewsLoaded=true;reviewError=null;emit();
    },error=>{if(!stopped&&current===generation){reviews=null;reviewsLoaded=false;reviewError=error;emit();}}));
    dataStops.push(onValue(coordinator?path(`agreementSignatures/${edition}`):path(`agreementSignatures/${edition}/${user.uid}`),snap=>{if(stopped||current!==generation)return;signatureData=snap.val();signaturesLoaded=true;signatureError=null;emit();},error=>{if(!stopped&&current===generation){signatureData=null;signaturesLoaded=false;signatureError=error;emit();}}));
    if(!staff)for(const field of ['size','contentType','uploadedAt'])dataStops.push(onValue(path(`agreementFiles/${edition}/${user.uid}/${field}`),snap=>{
      if(stopped||current!==generation)return;descriptor[field]=snap.val();descriptorLoaded.add(field);emit();
    },fail));
  },error=>{if(!stopped){generation++;dataStops.forEach(stop=>stop());dataStops=[];currentEmit=()=>{};callback({agreements:[],reviewReady:false,requirement:{ready:false,fulfilled:false},error});}});
  return()=>{stopped=true;generation++;agreementObservers.delete(pendingEmit);roleStop();dataStops.forEach(stop=>stop());};
}
export async function reviewAgreement(uid,{year=2027,status,reason='',expectedUploadVersion='',expectedUploadedAt,expectedReviewedAt=0}={}) {
  const user=needUser(),edition=agreementYear(year);checkIdentifier(uid);
  if(!['approved','returned'].includes(status))throw new Error('Escolha confirmar o recebimento ou devolver com uma pendência.');
  const note=status==='returned'?String(reason||'').trim():'';
  if(status==='returned'&&(note.length<3||note.length>2000))throw new Error('Descreva a pendência em 3 a 2000 caracteres.');
  if(typeof expectedUploadVersion!=='string'||!Number.isInteger(expectedUploadedAt)||expectedUploadedAt<=0||!Number.isInteger(expectedReviewedAt)||expectedReviewedAt<0)throw new Error('Reabra o termo enviado antes de conferir.');
  const role=(await get(path(`roles/${user.uid}`))).val();
  if(role!=='coordinator')throw new Error('Somente a coordenação pode conferir os termos.');
  const [metadataSnapshot,reviewSnapshot,profileSnapshot,sizeSnapshot,typeSnapshot,stampSnapshot,versionSnapshot]=await Promise.all([get(path(`agreements/${edition}/${uid}`)),get(path(`agreementReviews/${edition}/${uid}`)),get(path(`users/${user.uid}`)),get(path(`agreementFiles/${edition}/${uid}/size`)),get(path(`agreementFiles/${edition}/${uid}/contentType`)),get(path(`agreementFiles/${edition}/${uid}/uploadedAt`)),get(path(`agreementFiles/${edition}/${uid}/uploadVersion`))]);
  const metadata=metadataSnapshot.val(),profile=profileSnapshot.val(),previous=effectiveAgreementReview(metadata,reviewSnapshot.val());
  if(!metadata)throw new Error('O aluno ainda não enviou o termo.');
  if(!completeAgreement(metadata,{size:sizeSnapshot.val(),contentType:typeSnapshot.val(),uploadedAt:stampSnapshot.val()},uid,edition)||(metadata.uploadVersion||'')!==(versionSnapshot.val()||''))throw new Error('O arquivo enviado está incompleto. Solicite um novo envio antes de conferir.');
  if(metadata.uploadedAt!==expectedUploadedAt||(metadata.uploadVersion||'')!==expectedUploadVersion)throw new Error('O termo foi atualizado. Reabra o arquivo mais recente antes de conferir.');
  if((previous?.reviewedAt||0)!==expectedReviewedAt)throw new Error('A conferência mudou. Atualize a página e revise a situação atual.');
  if(!profile?.name)throw new Error('Conclua o perfil da coordenação antes de conferir o termo.');
  if(auth.currentUser?.uid!==user.uid)throw new Error('Sua conta mudou. Entre novamente antes de conferir.');
  const record={status,reason:note,reviewerUid:user.uid,reviewerName:clean(profile.name,100),reviewedAt:serverTimestamp(),uploadVersion:expectedUploadVersion,uploadedAt:expectedUploadedAt,previousReviewedAt:expectedReviewedAt};
  await update(path(),{[`agreementReviews/${edition}/${uid}`]:record});
  return record;
}
const signatureRoles=['advisor','coordinator'];
function effectiveAgreementSignatures(metadata,review,stored) {
  if(!metadata||review?.status!=='approved')return [];
  return Object.values(stored||{}).flatMap(role=>Object.values(role||{})).filter(item=>item&&signatureRoles.includes(item.role)&&item.consent===true&&item.uploadVersion===(metadata.uploadVersion||'')&&item.uploadedAt===metadata.uploadedAt&&item.reviewedAt===review.reviewedAt&&(!metadata.documentSha256||item.documentSha256===metadata.documentSha256));
}
async function documentChecksum(bytes) {
  if(!globalThis.crypto?.subtle)throw new Error('Este navegador não permite conferir a integridade do documento. Atualize o aplicativo.');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function advisorDocumentAccess(uid,year,groupId) {
  const user=needUser();checkIdentifier(uid);checkIdentifier(groupId);
  const [roleSnapshot,groupSnapshot]=await Promise.all([get(path(`roles/${user.uid}`)),get(path(`groups/${groupId}`))]);
  const role=roleSnapshot.val(),group=groupSnapshot.val();
  if(!['advisor','coordinator'].includes(role)||!group||group.status!=='active'||group.advisorId!==user.uid||group.members?.[uid]!==true)throw new Error('Somente o orientador atual do grupo pode acessar este termo aprovado.');
  if(auth.currentUser?.uid!==user.uid)throw new Error('Sua conta mudou. Entre novamente antes de continuar.');
  await set(path(`agreementAdvisorAccess/${year}/${uid}/${user.uid}`),groupId);
  return group;
}
export async function downloadSigningAgreement(uid,{year=2027,role,groupId=''}={}) {
  const user=needUser(),edition=agreementYear(year);checkIdentifier(uid);
  const actorRole=(await get(path(`roles/${user.uid}`))).val()||'student';
  if(role==='advisor'||actorRole==='advisor')await advisorDocumentAccess(uid,edition,groupId);
  else if(actorRole!=='coordinator'&&user.uid!==uid)throw new Error('Você não tem acesso ao termo deste estudante.');
  const [metaSnapshot,reviewSnapshot,signatureSnapshot]=await Promise.all([get(path(`agreements/${edition}/${uid}`)),get(path(`agreementReviews/${edition}/${uid}`)),get(path(`agreementSignatures/${edition}/${uid}`))]);
  const metadata=metaSnapshot.val(),review=effectiveAgreementReview(metadata,reviewSnapshot.val());
  if(review?.status!=='approved')throw new Error('Aguarde a coordenação confirmar este termo antes de assinar.');
  const original=await downloadAgreement(uid,edition);
  if(original.metadata.uploadedAt!==metadata.uploadedAt||(original.metadata.uploadVersion||'')!==(metadata.uploadVersion||''))throw new Error('O termo foi atualizado durante a leitura. Reabra o documento atual.');
  const documentSha256=await documentChecksum(new Uint8Array(await original.blob.arrayBuffer()));
  if(metadata.documentSha256&&metadata.documentSha256!==documentSha256)throw new Error('A integridade do documento mudou. Solicite um novo envio.');
  const [currentMetadataSnapshot,currentReviewSnapshot,currentSignatureSnapshot]=await Promise.all([get(path(`agreements/${edition}/${uid}`)),get(path(`agreementReviews/${edition}/${uid}`)),get(path(`agreementSignatures/${edition}/${uid}`))]);
  const currentMetadata=currentMetadataSnapshot.val(),currentReview=effectiveAgreementReview(currentMetadata,currentReviewSnapshot.val());
  if(!currentMetadata||currentMetadata.uploadedAt!==metadata.uploadedAt||(currentMetadata.uploadVersion||'')!==(metadata.uploadVersion||'')||currentReview?.status!=='approved'||currentReview.reviewedAt!==review.reviewedAt)throw new Error('O documento ou a aprovação mudou durante a leitura. Reabra a versão atual.');
  return {...original,metadata:currentMetadata,review:currentReview,signatures:effectiveAgreementSignatures(currentMetadata,currentReview,currentSignatureSnapshot.val()).filter(item=>item.documentSha256===documentSha256),documentSha256};
}
export async function signAgreement(uid,{year=2027,role,groupId='',consent=false,signatureImage='',signaturePng=signatureImage,expectedUploadVersion='',expectedUploadedAt,expectedReviewedAt}={}) {
  const user=needUser(),edition=agreementYear(year);checkIdentifier(uid);
  if(!signatureRoles.includes(role)||consent!==true)throw new Error('Leia o documento e confirme expressamente a assinatura com sua conta.');
  if(typeof signaturePng!=='string'||signaturePng.length>180000||signaturePng!==''&&!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(signaturePng))throw new Error('A imagem da assinatura deve ser PNG e ter até130KB.');
  if(signaturePng){const image=Uint8Array.from(atob(signaturePng.split(',')[1]),character=>character.charCodeAt(0));if(image.length<24||![137,80,78,71,13,10,26,10].every((byte,index)=>image[index]===byte))throw new Error('A assinatura desenhada precisa ser uma imagem PNG válida.');}
  const actorRole=(await get(path(`roles/${user.uid}`))).val();
  if(role==='coordinator'&&actorRole!=='coordinator')throw new Error('Somente a coordenação pode assinar neste campo.');
  if(role==='advisor')await advisorDocumentAccess(uid,edition,groupId);
  const data=await downloadSigningAgreement(uid,{year:edition,role,groupId});
  if(data.metadata.uploadedAt!==expectedUploadedAt||(data.metadata.uploadVersion||'')!==expectedUploadVersion||data.review.reviewedAt!==expectedReviewedAt)throw new Error('O documento ou sua aprovação mudou. Reabra a versão atual antes de assinar.');
  if(data.signatures.some(item=>item.role===role&&item.signerUid===user.uid))throw new Error('Sua assinatura já está registrada nesta versão aprovada.');
  const profile=(await get(path(`users/${user.uid}`))).val();
  if(!profile?.name||auth.currentUser?.uid!==user.uid)throw new Error('Confira sua conta antes de assinar.');
  const record={role,signerUid:user.uid,signerName:clean(profile.name,100),signedAt:serverTimestamp(),uploadVersion:expectedUploadVersion,uploadedAt:expectedUploadedAt,reviewedAt:expectedReviewedAt,documentSha256:data.documentSha256,signaturePng,consent:true,groupId:role==='advisor'?groupId:''};
  await update(path(),{[`agreementSignatures/${edition}/${uid}/${role}/${user.uid}`]:record});
  return record;
}
export function subscribeAdvisorAgreements(groupId,year=2027,callback) {
  const user=needUser(),edition=agreementYear(year);checkIdentifier(groupId);
  let stopped=false,generation=0,memberStops=[],rows=new Map(),pendingMembers=new Set(),groupLoaded=false;
  const emit=(error=null)=>{const ready=groupLoaded&&pendingMembers.size===0&&!error;if(!stopped)callback({agreements:[...rows.values()].sort((a,b)=>(a.ownerName||'').localeCompare(b.ownerName||'','pt-BR')),reviewReady:ready,signatureReady:ready,requirement:{ready,fulfilled:ready},error});};
  const groupStop=onValue(path(`groups/${groupId}`),snapshot=>{
    const current=++generation;memberStops.forEach(stop=>stop());memberStops=[];rows=new Map();groupLoaded=false;
    const group=snapshot.val();
    if(!group||group.status!=='active'||group.advisorId!==user.uid){emit(new Error('Você não orienta este grupo.'));return;}
    groupLoaded=true;pendingMembers=new Set(Object.keys(group.members||{}));emit();
    for(const uid of Object.keys(group.members||{})){
      let dataStops=[],documentEpoch=0,statusLoaded=false,revisionLoaded=false,observedStatus=null,observedRevision=0;
      const valid=()=>!stopped&&current===generation;
      const fail=()=>{if(valid()){documentEpoch++;dataStops.forEach(stop=>stop());dataStops=[];pendingMembers.delete(uid);rows.delete(uid);emit();}};
      const refresh=()=>{
        if(!valid()||!statusLoaded||!revisionLoaded)return;
        const epoch=++documentEpoch;dataStops.forEach(stop=>stop());dataStops=[];rows.delete(uid);
        if(observedStatus!=='approved'){pendingMembers.delete(uid);emit();return;}
        pendingMembers.add(uid);emit();
        let metadata=null,review=null,signatures=null,metadataReady=false,reviewReady=false,signatureReady=false;
        const currentDocument=()=>valid()&&epoch===documentEpoch;
        const paint=()=>{if(!currentDocument())return;const effective=effectiveAgreementReview(metadata,review);if(metadataReady&&reviewReady&&signatureReady){pendingMembers.delete(uid);}if(metadataReady&&reviewReady&&signatureReady&&effective?.status==='approved'&&effective.reviewedAt===observedRevision)rows.set(uid,{...metadata,id:uid,review:effective,signatures:effectiveAgreementSignatures(metadata,effective,signatures)});else rows.delete(uid);emit();};
        const unavailable=()=>{if(currentDocument())fail();};
        dataStops.push(onValue(path(`agreements/${edition}/${uid}`),snap=>{if(!currentDocument())return;metadata=snap.val();metadataReady=true;paint();},unavailable));
        dataStops.push(onValue(path(`agreementReviews/${edition}/${uid}`),snap=>{if(!currentDocument())return;review=snap.val();reviewReady=true;paint();},unavailable));
        dataStops.push(onValue(path(`agreementSignatures/${edition}/${uid}`),snap=>{if(!currentDocument())return;signatures=snap.val();signatureReady=true;paint();},unavailable));
      };
      memberStops.push(()=>{documentEpoch++;dataStops.forEach(stop=>stop());});
      advisorDocumentAccess(uid,edition,groupId).then(()=>{
        if(!valid())return;
        memberStops.push(onValue(path(`agreementReviews/${edition}/${uid}/status`),snap=>{if(!valid())return;observedStatus=snap.val();statusLoaded=true;refresh();},fail));
        memberStops.push(onValue(path(`agreementReviews/${edition}/${uid}/reviewedAt`),snap=>{if(!valid())return;observedRevision=snap.val()||0;revisionLoaded=true;refresh();},fail));
      }).catch(fail);
    }
  },error=>{generation++;memberStops.forEach(stop=>stop());memberStops=[];rows.clear();groupLoaded=false;emit(error);});
  return()=>{stopped=true;generation++;groupStop();memberStops.forEach(stop=>stop());};
}

function bytesToBase64(bytes) {
  let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(binary);
}
function detectAgreementType(bytes) {
  if(bytes.length>=5&&String.fromCharCode(...bytes.subarray(0,5))==='%PDF-')return 'application/pdf';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((byte,i)=>bytes[i]===byte))return 'image/png';
  return '';
}
function agreementFilename(name,contentType,year) {
  const extension={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'}[contentType];
  const safe=clean(name||`termo-${year}`,180).replace(/[\\/\u0000-\u001f\u007f<>:\"|?*]/g,'_').replace(/^\.+/,'').replace(/\.[^.]*$/,'');
  return `${safe.slice(0,170)||`termo-${year}`}.${extension}`;
}
export async function uploadAgreement(file,{year=2027}={}) {
  const user=needUser(),edition=agreementYear(year);
  if(!file||typeof file.arrayBuffer!=='function'||!Number.isInteger(file.size)||file.size<=0||file.size>agreementLimits.maxBytes)throw new Error('Escolha um PDF ou uma imagem JPG/PNG de até 3 MB.');
  const [profileSnapshot,roleSnapshot]=await Promise.all([get(path(`users/${user.uid}`)),get(path(`roles/${user.uid}`))]);
  const profile=profileSnapshot.val(),role=roleSnapshot.val()||'student';
  if(!profile||profile.requestedRole!=='student'||role!=='student'||profile.onboardingRequired===true)throw new Error('O envio do termo está disponível para estudantes com cadastro concluído.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes.length!==file.size)throw new Error('Não foi possível ler o arquivo completo. Selecione-o novamente.');
  const contentType=detectAgreementType(bytes);
  if(!contentType||file.type&&file.type!==contentType)throw new Error('Formato inválido. Envie um PDF, JPG ou PNG.');
  const filename=agreementFilename(file.name,contentType,edition);
  const uploadedAt=serverTimestamp(),uploadVersion=push(path(`agreements/${edition}`)).key,documentSha256=await documentChecksum(bytes);
  const metadata={uid:user.uid,year:edition,filename,size:bytes.length,contentType,ownerName:clean(profile.name,100),uploadedAt,uploadVersion,documentSha256};
  const payload={base64:bytesToBase64(bytes),size:bytes.length,contentType,uploadedAt,uploadVersion,documentSha256};
  // Only metadata is listed. File bytes are fetched individually with Auth and
  // never exposed through a persistent download token or public URL.
  if(agreementUploads.has(user.uid))throw new Error('O envio anterior ainda está em andamento.');
  agreementUploads.set(user.uid,true);notifyAgreementObservers();
  try {
    await update(path(),{[`agreements/${edition}/${user.uid}`]:metadata,[`agreementFiles/${edition}/${user.uid}`]:payload});
  } finally {
    // Local optimistic snapshots cannot unlock the portal before the write is
    // acknowledged (or rolled back) by Firebase. Server rules are authoritative.
    agreementUploads.delete(user.uid);notifyAgreementObservers();
  }
  return metadata;
}
export async function downloadAgreement(uid,year=2027) {
  needUser();checkIdentifier(uid);const edition=agreementYear(year);
  const [metadataSnapshot,fileSnapshot]=await Promise.all([get(path(`agreements/${edition}/${uid}`)),get(path(`agreementFiles/${edition}/${uid}`))]);
  const metadata=metadataSnapshot.val(),file=fileSnapshot.val();
  if(!metadata||!file)throw new Error('O termo ainda não foi enviado.');
  if(file.uploadedAt!==metadata.uploadedAt||file.size!==metadata.size||file.contentType!==metadata.contentType||(file.uploadVersion||'')!==(metadata.uploadVersion||''))throw new Error('O termo foi atualizado. Tente baixar novamente.');
  const binary=atob(file.base64),bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
  if(bytes.length!==metadata.size||detectAgreementType(bytes)!==metadata.contentType)throw new Error('O arquivo não pôde ser validado. Envie uma nova cópia.');
  return {blob:new Blob([bytes],{type:metadata.contentType}),filename:agreementFilename(metadata.filename,metadata.contentType,edition),contentType:metadata.contentType,metadata};
}

function pushDevice(value) {
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('Identificação do dispositivo inválida.');return value;
}
export async function savePushSubscription(subscriptionJSON,deviceId) {
  const user=needUser();pushDevice(deviceId);
  const endpoint=subscriptionJSON?.endpoint,keys=subscriptionJSON?.keys;
  if(typeof endpoint!=='string'||endpoint.length>2048||!/^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)\/[^\s]+$/.test(endpoint))throw new Error('Serviço de notificações não reconhecido.');
  if(typeof keys?.p256dh!=='string'||!/^[A-Za-z0-9_-]{87}=?$/.test(keys.p256dh)||typeof keys?.auth!=='string'||!/^[A-Za-z0-9_-]{22}(==)?$/.test(keys.auth))throw new Error('As chaves de notificação deste dispositivo são inválidas.');
  await set(path(`pushSubscriptions/${user.uid}/${deviceId}`),{endpoint,keys:{p256dh:keys.p256dh,auth:keys.auth},updatedAt:serverTimestamp()});
}
export async function removePushSubscription(deviceId) {
  const user=needUser();pushDevice(deviceId);
  await remove(path(`pushSubscriptions/${user.uid}/${deviceId}`));
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
  await requireAcademicAccess();
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
  await requireAcademicAccess();
  checkDate(dueDate);
  const taskRef=push(path(`tasks/${groupId}`));
  await set(taskRef,{title:clean(title,160),dueDate:clean(dueDate,10),completed:false,weight:Math.max(1,Math.min(10,Number(weight)||1)),createdBy:user.uid,createdAt:Date.now(),completedBy:''});
  return taskRef.key;
}
export async function updateTask(groupId,taskId,patch) {
  const user=needUser();
  await requireAcademicAccess();
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
  await requireAcademicAccess();
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
