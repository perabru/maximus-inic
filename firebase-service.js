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
async function requireActiveUser(user=needUser()) {
  if((await get(path(`inactiveUsers/${user.uid}`))).val()===true)throw Object.assign(new Error('Este cadastro foi excluído da plataforma. Procure a coordenação se precisar de ajuda.'),{code:'account/archived'});
  return user;
}
async function coordinatorUser() {
  const user=await requireActiveUser();
  if((await get(path(`roles/${user.uid}`))).val()!=='coordinator')throw new Error('Somente a coordenação pode gerenciar os cadastros.');
  return user;
}
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
  const user=await requireActiveUser();
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
  await requireActiveUser(user);
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
  await requireActiveUser();
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
  let stopped=false,sessionEnded=false,activeStops=[],scopeStops=[],archiveStop=()=>{},sessionStop=()=>{},activationVersion=0;
  let archives={},inactive={},archived=false;
  const state={profile:null,role:'student',users:[],usersReady:false,usersError:null,advisors:[],groups:[],invitations:[],orientationNotices:[],orientationNoticesReady:false,orientationNoticesError:null,archived:false,archive:null};
  const decorateUsers=()=>{state.users=(state.rawUsers||[]).map(person=>({...person,role:state.userRoles?.[person.id]||archives[person.id]?.role||'student',archived:inactive[person.id]===true,archive:archives[person.id]||null,archivedAt:archives[person.id]?.archivedAt||null}));};
  const emit=()=>{if(!stopped){const {rawUsers,userRoles,...publicState}=state;callback({...publicState});}};
  const report=error=>{if(!stopped){const {rawUsers,userRoles,...publicState}=state;callback({...publicState,error});}};
  const clearUsers=(error=null)=>{archives={};inactive={};Object.assign(state,{users:[],usersReady:false,usersError:error,rawUsers:[],userRoles:{}});};
  const clearScope=()=>{scopeStops.forEach(stop=>stop());scopeStops=[];state.groups=[];state.invitations=[];clearUsers();};
  const clear=()=>{activeStops.forEach(stop=>stop());activeStops=[];clearScope();Object.assign(state,{profile:null,role:'student',advisors:[],orientationNotices:[],orientationNoticesReady:false,orientationNoticesError:null});};
  const endSession=error=>{
    if(stopped||sessionEnded)return;
    sessionEnded=true;activationVersion++;archiveStop();sessionStop();clear();state.archived=false;state.archive=null;profileCache=null;roleCache='student';report(error);
  };
  const sessionActive=()=>{
    if(stopped||sessionEnded)return false;
    if(auth.currentUser?.uid===user.uid)return true;
    endSession({code:'PERMISSION_DENIED',message:'A sessão foi encerrada.'});return false;
  };
  const watch=(target,fn,into=scopeStops,onError=null)=>{
    let live=true;const raw=onValue(target,snapshot=>{if(live&&sessionActive()&&!archived)fn(snapshot);},error=>{if(live&&sessionActive()&&!archived){live=false;if(onError)onError(error);else report(error);}});
    const stop=()=>{live=false;raw();};into.push(stop);return stop;
  };
  function attach(){
    watch(query(path(`orientationNotices/${user.uid}`),orderByChild('createdAt'),limitToLast(100)),snapshot=>{state.orientationNotices=collection(snapshot).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));state.orientationNoticesReady=true;state.orientationNoticesError=null;emit();},activeStops,error=>{state.orientationNotices=[];state.orientationNoticesReady=false;state.orientationNoticesError=error;emit();});
    watch(path(`users/${user.uid}`),snapshot=>{state.profile=snapshot.val();profileCache=state.profile;emit();},activeStops);
    watch(path('advisorDirectory'),snapshot=>{state.advisors=collection(snapshot).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));emit();},activeStops);
    watch(path(`userArchives/${user.uid}`),snapshot=>{state.archive=snapshot.val();state.invitations=state.invitations.filter(item=>item.senderId===user.uid||item.createdAt>(state.archive?.inviteCutoff||0));emit();},activeStops);
    watch(path(`roles/${user.uid}`),snapshot=>{
      const role=['coordinator','advisor'].includes(snapshot.val())?snapshot.val():'student';state.role=role;roleCache=role;
      clearScope();
      if(role==='coordinator'){
        // Wait for every source used by the people filters. Showing users before
        // roles and archive flags arrive briefly misclassifies blocked accounts.
        const peopleStops=[],peopleReady=new Set();let peopleClosed=false;
        const closePeople=()=>{peopleClosed=true;peopleStops.forEach(stop=>stop());};
        scopeStops.push(closePeople);
        const peopleError=error=>{if(peopleClosed)return;closePeople();clearUsers(error);emit();};
        const watchPeople=(key,apply)=>watch(path(key),snap=>{
          if(peopleClosed)return;
          apply(snap);peopleReady.add(key);state.usersReady=peopleReady.size===4;state.usersError=null;
          if(state.usersReady)decorateUsers();emit();
        },peopleStops,peopleError);
        watch(path('groups'),snap=>{state.groups=collection(snap).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));emit();});
        watchPeople('users',snap=>{state.rawUsers=collection(snap);});
        watch(path('invitations'),snap=>{state.invitations=collection(snap).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));emit();});
        watchPeople('roles',snap=>{state.userRoles=snap.val()||{};});
        watchPeople('inactiveUsers',snap=>{inactive=snap.val()||{};});
        watchPeople('userArchives',snap=>{archives=snap.val()||{};});
      }else{
        const ownGroups=new Map();let advisorGroups=[],groupListeners=new Map();
        const combine=()=>{state.groups=[...new Map([...ownGroups.values(),...advisorGroups].map(group=>[group.id,group])).values()].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));emit();};
        watch(path(`userGroups/${user.uid}`),snap=>{
          const ids=Object.keys(snap.val()||{});
          for(const [id,stop]of groupListeners)if(!ids.includes(id)){stop();groupListeners.delete(id);ownGroups.delete(id);}
          for(const id of ids)if(!groupListeners.has(id)){
            let live=true;const raw=onValue(path(`groups/${id}`),value=>{if(!live||!sessionActive()||archived)return;if(value.exists())ownGroups.set(id,{...value.val(),id});else ownGroups.delete(id);combine();},error=>{if(!live||!sessionActive()||archived)return;ownGroups.delete(id);combine();if(error.code!=='PERMISSION_DENIED')report(error);});
            groupListeners.set(id,()=>{live=false;raw();});
          }combine();
        });scopeStops.push(()=>{groupListeners.forEach(stop=>stop());groupListeners.clear();});
        if(role==='advisor')watch(query(path('groups'),orderByChild('advisorId'),equalTo(user.uid)),snap=>{advisorGroups=collection(snap);combine();});
        const buckets=new Map();const watchInvites=(key,value)=>watch(query(path('invitations'),orderByChild(key),equalTo(value)),snap=>{buckets.set(key,collection(snap));state.invitations=[...new Map([...buckets.values()].flat().map(item=>[item.id,item])).values()].filter(item=>item.senderId===user.uid||item.createdAt>(state.archive?.inviteCutoff||0)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));emit();});
        watchInvites('senderId',user.uid);watchInvites('toUid',user.uid);if(user.email&&user.emailVerified)watchInvites('toEmail',user.email.toLowerCase());
      }emit();
    },activeStops,error=>{clearScope();state.role='student';roleCache='student';report(error);});
  }
  let initialized=false;
  archiveStop=onValue(path(`inactiveUsers/${user.uid}`),snapshot=>{
    if(!sessionActive())return;const next=snapshot.val()===true;
    if(initialized&&next===archived)return;const current=++activationVersion;initialized=true;clear();archived=next;state.archived=next;state.archive=null;
    if(next){profileCache=null;roleCache='student';emit();get(path(`userArchives/${user.uid}`)).then(value=>{if(sessionActive()&&current===activationVersion&&archived){state.archive=value.val();emit();}}).catch(()=>{});}else attach();
  },endSession);
  sessionStop=onAuthStateChanged(auth,active=>{if(active?.uid!==user.uid)endSession({code:'PERMISSION_DENIED',message:'A sessão foi encerrada.'});});
  return()=>{stopped=true;activationVersion++;archiveStop();sessionStop();clear();};
}
export function subscribeGroup(groupId, callback) {
  const user=needUser();
  const state = {tasks:[],messages:[],events:[],groupEvaluation:null,memberEvaluations:[],advisorConfirmation:null,advisorConfirmationReady:false,inicResults:[],inicResultsReady:false,inicResultsError:null};
  let stopped=false,denied=false;
  let group=null;
  let role=null;
  let evaluationMode='';
  let evaluationVersion=0;
  let evaluationStops=[];
  let resultStop=()=>{},resultYear=null,resultVersion=0;
  const attachResults=()=>{const edition=Number(group?.year);const year=group&&!['deleting','archived'].includes(group.status)&&group.archived!==true&&Number.isInteger(edition)&&edition>=2027&&edition<=2100?edition:null;if(year===resultYear)return;resultStop();resultYear=year;const version=++resultVersion;state.inicResults=[];state.inicResultsReady=false;state.inicResultsError=null;if(year)resultStop=subscribeInicResults(groupId,year,result=>{if(stopped||denied||version!==resultVersion)return;state.inicResults=result.results;state.inicResultsReady=result.ready;state.inicResultsError=result.error||null;emit();});};
  const emit=()=>{if(!stopped)callback({...state});};
  const report=error=>{if(stopped||denied)return;if(String(error?.code||'').toUpperCase().includes('PERMISSION_DENIED')){denied=true;resultVersion++;resultStop();evaluationVersion++;evaluationStops.forEach(stop=>stop());evaluationStops=[];Object.assign(state,{tasks:[],messages:[],events:[],groupEvaluation:null,memberEvaluations:[],advisorConfirmation:null,advisorConfirmationReady:false,inicResults:[],inicResultsReady:false});}callback({...state,error});};
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
        if(stopped||denied||version!==evaluationVersion)return;
        apply(snapshot);emit();
      },error=>{if(version===evaluationVersion){state.groupEvaluation=null;state.memberEvaluations=[];report(error);}}));
      watchEvaluation(path(`evaluations/${groupId}/group`),snapshot=>{state.groupEvaluation=snapshot.val();});
      if(mode==='manager')watchEvaluation(path(`evaluations/${groupId}/members`),snapshot=>{state.memberEvaluations=collection(snapshot);});
      else watchEvaluation(path(`evaluations/${groupId}/members/${user.uid}`),snapshot=>{state.memberEvaluations=snapshot.exists()?[{...snapshot.val(),id:user.uid}]:[];});
    }
    emit();
  };
  const stops = [
    onValue(path(`advisorConfirmations/${groupId}`),snap=>{if(stopped||denied)return;state.advisorConfirmation=snap.val();state.advisorConfirmationReady=true;emit();},report),
    onValue(path(`events/${groupId}`),snap=>{if(stopped||denied)return;state.events=collection(snap).sort((a,b)=>a.date.localeCompare(b.date));if(!stopped)callback({...state});},report),
    onValue(path(`tasks/${groupId}`), snap => {if(stopped||denied)return;state.tasks=collection(snap).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));if(!stopped)callback({...state});}, report),
    onValue(query(path(`messages/${groupId}`),orderByChild('createdAt'),limitToLast(150)), snap => {if(stopped||denied)return;state.messages=collection(snap).sort((a,b)=>a.createdAt-b.createdAt);if(!stopped)callback({...state});}, report),
    onValue(path(`groups/${groupId}`),snapshot=>{if(stopped||denied)return;group=snapshot.val();if(!group||(role&&role!=='coordinator'&&!(role==='advisor'&&group.advisorId===user.uid)&&group.members?.[user.uid]!==true)){report({code:'PERMISSION_DENIED',message:'O acesso a este grupo foi encerrado.'});return;}attachResults();attachEvaluations();},error=>{group=null;report(error);}),
    onValue(path(`roles/${user.uid}`),snapshot=>{if(stopped||denied)return;role=snapshot.val()||'student';if(group&&role!=='coordinator'&&!(role==='advisor'&&group.advisorId===user.uid)&&group.members?.[user.uid]!==true){report({code:'PERMISSION_DENIED',message:'O acesso a este grupo foi encerrado.'});return;}attachEvaluations();},report)
  ];
  return () => {stopped=true;resultVersion++;resultStop();evaluationVersion++;stops.forEach(stop=>stop());evaluationStops.forEach(stop=>stop());};
}

const articleSectionKeys=['title','authors','abstract','keywords','introduction','methodology','results','discussion','conclusion','references'];
export function subscribeArticle(groupId,callback) {
  checkIdentifier(groupId);const user=needUser();
  let stopped=false,denied=false,articleStop=()=>{},attached=false;
  let group=null,role=null,inactive=false,groupReady=false,roleReady=false,inactiveReady=false;
  const stops=[];let sections={},ready=false,connected=false;
  const emit=()=>{if(!stopped&&!denied)callback({sections,ready,connected});};
  const report=error=>{
    if(stopped||denied)return;
    const revoked=String(error?.code||'').toUpperCase().includes('PERMISSION_DENIED');
    if(revoked){denied=true;articleStop();stops.forEach(stop=>stop());sections={};ready=false;}
    callback({sections,ready:false,connected,error,revoked});
  };
  const scope=()=>{
    if(stopped||denied||!groupReady||!roleReady||!inactiveReady)return;
    const allowed=!inactive&&group&&!['deleting','archived'].includes(group.status)&&group.archived!==true&&(role==='coordinator'||role==='advisor'&&group.advisorId===user.uid||role==='student'&&group.members?.[user.uid]===true);
    if(!allowed){report({code:'PERMISSION_DENIED',message:'Seu acesso ao artigo deste grupo foi encerrado.'});return;}
    if(!attached){attached=true;articleStop=onValue(path(`articles/${groupId}`),snapshot=>{if(stopped||denied)return;sections=snapshot.val()||{};ready=true;emit();},report);}
  };
  stops.push(onValue(path(`groups/${groupId}`),snapshot=>{group=snapshot.val();groupReady=true;scope();},report));
  stops.push(onValue(path(`roles/${user.uid}`),snapshot=>{role=snapshot.val()||'student';roleReady=true;scope();},report));
  stops.push(onValue(path(`inactiveUsers/${user.uid}`),snapshot=>{inactive=snapshot.val()===true;inactiveReady=true;scope();},report));
  stops.push(onValue(ref(db,'.info/connected'),snapshot=>{connected=snapshot.val()===true;emit();},report));
  stops.push(onAuthStateChanged(auth,active=>{if(active?.uid!==user.uid)report({code:'PERMISSION_DENIED',message:'A sessão foi encerrada.'});}));
  return ()=>{stopped=true;sections={};articleStop();stops.forEach(stop=>stop());};
}
export async function saveArticleSection(groupId,section,text,expectedRevision) {
  const actor=needUser();checkIdentifier(groupId);
  if(!articleSectionKeys.includes(section))throw new Error('Escolha uma seção válida do artigo.');
  const max={title:300,authors:2000,keywords:500}[section]||30000;
  if(typeof text!=='string'||text.length>max)throw new Error(`Use até ${max.toLocaleString('pt-BR')} caracteres nesta seção.`);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('Reabra a seção antes de salvar.');
  await requireAcademicAccess();
  const [groupSnapshot,roleSnapshot,profileSnapshot]=await Promise.all([get(path(`groups/${groupId}`)),get(path(`roles/${actor.uid}`)),get(path(`users/${actor.uid}`))]);
  const group=groupSnapshot.val(),role=roleSnapshot.val()||'student';
  if(!group||['deleting','archived'].includes(group.status)||group.archived===true||!(role==='coordinator'||role==='advisor'&&group.advisorId===actor.uid||role==='student'&&group.members?.[actor.uid]===true))throw new Error('Você não tem acesso para escrever neste artigo.');
  if(auth.currentUser?.uid!==actor.uid)throw new Error('A sessão mudou. Entre novamente para salvar.');
  const target=path(`articles/${groupId}/${section}`);
  const record={text,revision:expectedRevision+1,updatedBy:actor.uid,authorName:clean(profileSnapshot.val()?.name||actor.displayName||'Integrante',100),updatedAt:serverTimestamp()};
  try {await set(target,record);}
  catch(error) {
    // Rules compare revisions on the server, so two clients cannot overwrite a
    // section using the same baseline. Independent sections remain independent.
    if(String(error?.code||'').toUpperCase().includes('PERMISSION_DENIED')){
      let remote;try{remote=(await get(target)).val();}catch{throw error;}
      if((remote?.revision||0)!==expectedRevision)throw Object.assign(new Error('Outra pessoa alterou esta seção. Compare os textos antes de salvar.'),{code:'article/conflict',remote});
    }
    throw error;
  }
  return (await get(target)).val();
}
export async function saveProfile(patch) {
  await requireActiveUser();
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
function pendingForUser(invitation,uid,email){return invitation.status==='pending'&&(invitation.senderId===uid||invitation.toUid===uid);}
function releaseAdvisorChanges(group,uid,changes){
  changes[`groups/${group.id}/advisorId`]='';changes[`groups/${group.id}/advisorAssignment`]=null;changes[`groups/${group.id}/orientationRevision`]=(group.orientationRevision||0)+1;
  changes[`groups/${group.id}/advisorRequestVersion`]=(group.advisorRequestVersion||0)+1;
  for(const resource of ['advisorConfirmations','advisorRequests','advisorRequestSlots'])changes[`${resource}/${group.id}`]=null;
  changes[`groups/${group.id}/members/${uid}`]=null;changes[`groups/${group.id}/memberNames/${uid}`]=null;if(!Object.prototype.hasOwnProperty.call(changes,`userGroups/${uid}`))changes[`userGroups/${uid}/${group.id}`]=null;changes[`evaluations/${group.id}/members/${uid}`]=null;changes[`inicResults/${group.year}/${group.id}/${uid}`]=null;
  changes[`admissions/${group.id}/${uid}`]=null;
  changes[`memberRevocations/${group.id}/${uid}`]=serverTimestamp();
}
export async function updateUser(uid,{name,year,role}={}) {
  const actor=await coordinatorUser();checkIdentifier(uid);
  const [personSnapshot,roleSnapshot,inactiveSnapshot,groupsSnapshot,invitationsSnapshot]=await Promise.all([get(path(`users/${uid}`)),get(path(`roles/${uid}`)),get(path(`inactiveUsers/${uid}`)),get(path('groups')),get(path('invitations'))]);
  const person=personSnapshot.val(),previousRole=roleSnapshot.val()||'student';
  if(!person)throw new Error('Cadastro não encontrado.');
  if(inactiveSnapshot.val()===true)throw new Error('Restaure este cadastro antes de editar.');
  const nextRole=role===undefined?previousRole:role;
  if(!['student','advisor','coordinator'].includes(nextRole)||nextRole==='coordinator'&&previousRole!=='coordinator')throw new Error('Escolha estudante ou professor para este cadastro.');
  if((uid===actor.uid||previousRole==='coordinator')&&nextRole!==previousRole)throw new Error('O acesso da coordenação está protegido.');
  const nextName=name===undefined?person.name:clean(name,100),nextYear=year===undefined?person.year:clean(year,30);
  if(!nextName)throw new Error('Informe o nome do cadastro.');
  const changes={[`users/${uid}/name`]:nextName,[`users/${uid}/year`]:nextYear,[`roles/${uid}`]:nextRole,[`advisorDirectory/${uid}`]:['advisor','coordinator'].includes(nextRole)?{uid,name:nextName}:null};
  if(nextRole!==previousRole){changes[`users/${uid}/requestedRole`]=nextRole==='student'?'student':'advisor';changes[`users/${uid}/onboardingRequired`]=false;}
  for(const group of collection(groupsSnapshot)){
    if(group.status==='deleting'){if(previousRole==='advisor'&&nextRole==='student'&&group.advisorId===uid)throw new Error('Conclua a exclusão do grupo '+group.name+' antes de alterar este acesso.');continue;}
    if(nextName!==person.name&&group.members?.[uid])changes[`groups/${group.id}/memberNames/${uid}`]=nextName;
    if(previousRole==='advisor'&&nextRole==='student'&&group.advisorId===uid){releaseAdvisorChanges(group,uid,changes);for(const invitation of collection(invitationsSnapshot))if(invitation.groupId===group.id&&invitation.type==='advisor'&&invitation.status==='pending')changes[`invitations/${invitation.id}/status`]='cancelled';}
  }
  if(previousRole==='advisor'&&nextRole==='student')for(const invitation of collection(invitationsSnapshot))if(invitation.type==='advisor'&&invitation.toUid===uid&&invitation.status==='pending')changes[`invitations/${invitation.id}/status`]='cancelled';
  if(auth.currentUser?.uid!==actor.uid)throw new Error('Sua conta mudou. Entre novamente.');
  await update(path(),changes);
}
export async function setUserRole(uid,role) {return updateUser(uid,{role});}
async function changeOrientation(groupId,newAdvisorUid,{action,reason='',expectedAdvisorUid,expectedRevision,invitationId=''}={}) {
  const actor=await requireActiveUser();checkIdentifier(groupId);if(newAdvisorUid)checkIdentifier(newAdvisorUid);
  const [groupSnapshot,roleSnapshot,profileSnapshot,requestsSnapshot]=await Promise.all([get(path(`groups/${groupId}`)),get(path(`roles/${actor.uid}`)),get(path(`users/${actor.uid}`)),get(path(`advisorRequests/${groupId}`))]);
  const group=groupSnapshot.val(),role=roleSnapshot.val(),profile=profileSnapshot.val();
  if(!group||group.status==='deleting'||group.status==='archived'||group.archived===true)throw new Error('Este grupo não está disponível para alterar a orientação.');
  const oldUid=group.advisorId||'',revision=group.orientationRevision||0;
  if(action==='assign'&&(role!=='coordinator'||oldUid))throw new Error(oldUid?'Este grupo já tem um orientador.':'Somente a coordenação pode atribuir orientadores.');
  if(action==='replace'&&role!=='coordinator')throw new Error('Somente a coordenação pode substituir o orientador.');
  if(action==='withdraw'&&(!oldUid||oldUid!==actor.uid||!['advisor','coordinator'].includes(role)))throw new Error('Somente o orientador atual pode sair desta orientação.');
  if(action==='accept'&&(oldUid||newAdvisorUid!==actor.uid||!['advisor','coordinator'].includes(role)||!invitationId))throw new Error('Outro orientador já confirmou este grupo.');
  if(['replace','withdraw'].includes(action)&&(!Number.isInteger(expectedRevision)||expectedRevision!==revision||expectedAdvisorUid!==oldUid||!oldUid))throw new Error('A orientação mudou. Atualize o grupo antes de continuar.');
  const note=clean(reason,2000);
  if(action==='replace'&&(note.length<3||note.length>2000))throw new Error('Informe o motivo da substituição, com 3 a 2000 caracteres.');
  if(action==='replace'&&newAdvisorUid===oldUid)throw new Error('Escolha outro orientador.');
  if(!profile?.name)throw new Error('Conclua seu perfil antes de alterar a orientação.');
  let newName='';
  if(newAdvisorUid){const [directory,targetRole,inactive]=await Promise.all([get(path(`advisorDirectory/${newAdvisorUid}`)),get(path(`roles/${newAdvisorUid}`)),get(path(`inactiveUsers/${newAdvisorUid}`))]);if(!directory.exists()||!['advisor','coordinator'].includes(targetRole.val())||inactive.val()===true)throw new Error('Escolha um orientador aprovado e ativo.');newName=directory.val().name;}
  const previousName=oldUid?(await get(path(`users/${oldUid}`))).val()?.name||group.advisorAssignment?.advisorName||'Orientador anterior':'';
  const transitionId=push(path(`orientationTransitions/${groupId}`)).key;
  const nextRevision=revision+1,requestVersion=group.advisorRequestVersion||0,stamp=serverTimestamp();
  const transition={action,groupName:group.name,oldAdvisorUid:oldUid,oldAdvisorName:clean(previousName,100),newAdvisorUid:newAdvisorUid||'',newAdvisorName:clean(newName,100),actorUid:actor.uid,actorName:clean(profile.name,100),reason:note,createdAt:stamp,revision:nextRevision,requestVersion,invitationId:action==='accept'?invitationId:''};
  const assignment={advisorUid:newAdvisorUid||'',advisorName:transition.newAdvisorName,assignedBy:actor.uid,assignedByName:transition.actorName,assignedAt:stamp,requestVersion,revision:nextRevision,transitionId,action,reason:note,previousAdvisorUid:oldUid,previousAdvisorName:transition.oldAdvisorName};
  const changes={[`groups/${groupId}/advisorId`]:newAdvisorUid||'',[`groups/${groupId}/advisorAssignment`]:assignment,[`groups/${groupId}/orientationRevision`]:nextRevision,[`groups/${groupId}/advisorRequestVersion`]:requestVersion+1,[`orientationTransitions/${groupId}/${transitionId}`]:transition,[`advisorRequests/${groupId}`]:null,[`advisorRequestSlots/${groupId}`]:null,[`advisorConfirmations/${groupId}`]:null};
  if(action==='accept')changes[`advisorConfirmations/${groupId}`]={studentUid:group.createdBy,advisorUid:actor.uid,advisorName:transition.newAdvisorName,invitationId,createdAt:stamp,requestVersion};
  const recipients=new Map();
  if(newAdvisorUid&&newAdvisorUid!==actor.uid)recipients.set(newAdvisorUid,'assigned');
  if(oldUid)recipients.set(oldUid,action==='withdraw'?'withdrawn':'replaced');
  for(const [candidate,id] of Object.entries(requestsSnapshot.val()||{})){
    const status=(await get(path(`invitations/${id}/status`))).val();
    if(status==='pending'){changes[`invitations/${id}/status`]=action==='accept'&&id===invitationId?'accepted':'cancelled';if(candidate!==newAdvisorUid&&!recipients.has(candidate))recipients.set(candidate,'unavailable');}
  }
  if(action==='accept')changes[`invitations/${invitationId}/status`]='accepted';
  if(oldUid&&oldUid!==newAdvisorUid){
    changes[`groups/${groupId}/members/${oldUid}`]=null;changes[`groups/${groupId}/memberNames/${oldUid}`]=null;changes[`userGroups/${oldUid}/${groupId}`]=null;changes[`admissions/${groupId}/${oldUid}`]=null;changes[`evaluations/${groupId}/members/${oldUid}`]=null;changes[`inicResults/${group.year}/${groupId}/${oldUid}`]=null;changes[`memberRevocations/${groupId}/${oldUid}`]=stamp;
  }
  for(const [recipient,type] of recipients){
    if(!(await get(path(`advisorDirectory/${recipient}`))).exists())continue;
    changes[`orientationNotices/${recipient}/${transitionId}`]={type,groupId,groupName:group.name,oldAdvisorName:transition.oldAdvisorName,newAdvisorName:transition.newAdvisorName,reason:note,createdAt:stamp,transitionId,read:false};
  }
  if(auth.currentUser?.uid!==actor.uid)throw new Error('Sua conta mudou. Entre novamente.');
  try{await update(path(),changes);}catch(error){if(String(error?.code||'').toUpperCase().includes('PERMISSION_DENIED'))throw new Error('A orientação ou os convites mudaram. Atualize o grupo antes de continuar.');throw error;}
}
export async function assignAdvisor(groupId,advisorUid){return changeOrientation(groupId,advisorUid,{action:'assign'});}
export async function replaceAdvisor(groupId,advisorUid,options={}){return changeOrientation(groupId,advisorUid,{...options,action:'replace'});}
export async function withdrawAdvisor(groupId,options={}){return changeOrientation(groupId,'',{...options,action:'withdraw'});}
export async function markOrientationNoticeRead(id){const user=await requireActiveUser();checkIdentifier(id);await update(path(`orientationNotices/${user.uid}/${id}`),{read:true});}
export async function archiveUser(uid) {
  const actor=await coordinatorUser();checkIdentifier(uid);
  const [personSnapshot,roleSnapshot,archiveSnapshot,actorSnapshot]=await Promise.all([get(path(`users/${uid}`)),get(path(`roles/${uid}`)),get(path(`userArchives/${uid}`)),get(path(`users/${actor.uid}`))]);
  const person=personSnapshot.val(),role=roleSnapshot.val()||archiveSnapshot.val()?.role||'student',previous=archiveSnapshot.val();
  if(!person)throw new Error('Cadastro não encontrado.');
  if(uid===actor.uid||role==='coordinator')throw new Error('O cadastro da coordenação está protegido.');
  if(previous?.status==='archived')return;
  if(previous?.status!=='archiving'){
    const audit={uid,role,status:'archiving',archivedAt:serverTimestamp(),archivedBy:actor.uid,archivedByName:clean(actorSnapshot.val()?.name||'Coordenação',100),inviteCutoff:serverTimestamp()};
    await update(path(),{[`inactiveUsers/${uid}`]:true,[`userArchives/${uid}`]:audit,[`pushSubscriptions/${uid}`]:null,[`advisorDirectory/${uid}`]:null});
  }
  const [groupsSnapshot,invitationsSnapshot]=await Promise.all([get(path('groups')),get(path('invitations'))]);
  const changes={[`roles/${uid}`]:null,[`advisorDirectory/${uid}`]:null,[`userGroups/${uid}`]:null,[`userArchives/${uid}/status`]:'archived'};
  for(const group of collection(groupsSnapshot)){
    if(group.status==='deleting'){if(group.members?.[uid]||group.advisorId===uid)throw new Error('Conclua a exclusão do grupo '+group.name+' e depois conclua a exclusão deste cadastro.');continue;}
    if(group.members?.[uid]){
      changes[`groups/${group.id}/members/${uid}`]=null;changes[`groups/${group.id}/memberNames/${uid}`]=null;changes[`evaluations/${group.id}/members/${uid}`]=null;changes[`inicResults/${group.year}/${group.id}/${uid}`]=null;changes[`admissions/${group.id}/${uid}`]=null;changes[`memberRevocations/${group.id}/${uid}`]=serverTimestamp();
    }
    if(group.advisorId===uid)releaseAdvisorChanges(group,uid,changes);
  }
  for(const invitation of collection(invitationsSnapshot))if(pendingForUser(invitation,uid,person.email)||Object.keys(changes).includes(`advisorRequests/${invitation.groupId}`)&&invitation.type==='advisor'&&invitation.status==='pending')changes[`invitations/${invitation.id}/status`]='cancelled';
  if(auth.currentUser?.uid!==actor.uid)throw new Error('Sua conta mudou. Entre novamente.');
  await update(path(),changes);
}
export async function deleteUserPermanently(uid) {
  const actor=await coordinatorUser();checkIdentifier(uid);
  const [personSnapshot,roleSnapshot,archiveSnapshot,inactiveSnapshot,actorSnapshot]=await Promise.all([
    get(path(`users/${uid}`)),get(path(`roles/${uid}`)),get(path(`userArchives/${uid}`)),
    get(path(`inactiveUsers/${uid}`)),get(path(`users/${actor.uid}`))
  ]);
  const person=personSnapshot.val(),previous=archiveSnapshot.val(),role=roleSnapshot.val()||previous?.role||'student';
  if(uid===actor.uid||role==='coordinator')throw new Error('O cadastro da coordenação está protegido.');
  // A completed deletion has no retained profile or archive. The UID-only
  // blocking flag must remain: Firebase Authentication is a separate service,
  // and an existing Auth session must never recreate this profile on login.
  if(!person){if(inactiveSnapshot.val()===true&&!previous)return;throw new Error('Cadastro não encontrado.');}
  if(!['student','advisor'].includes(role))throw new Error('Este cadastro não pode ser excluído por esta operação.');
  if(previous?.status!=='deleting'){
    const audit={uid,role,status:'deleting',archivedAt:serverTimestamp(),archivedBy:actor.uid,archivedByName:clean(actorSnapshot.val()?.name||'Coordenação',100),inviteCutoff:serverTimestamp()};
    if(auth.currentUser?.uid!==actor.uid)throw new Error('Sua conta mudou. Entre novamente.');
    // The new status is deliberately rejected by older database rules. An old
    // deployment cannot partially archive someone and then fail the hard delete.
    try{await update(path(),{[`inactiveUsers/${uid}`]:true,[`userArchives/${uid}`]:audit,[`pushSubscriptions/${uid}`]:null,[`advisorDirectory/${uid}`]:null});}
    catch(error){
      if(String(error?.code||'').toUpperCase().includes('PERMISSION_DENIED'))throw Object.assign(new Error('A exclusão definitiva ainda não está disponível. Solicite a atualização do aplicativo à administração. O cadastro não foi alterado.'),{code:'account/deletion-unavailable',cause:error});
      throw error;
    }
  }else if(inactiveSnapshot.val()!==true)throw new Error('Não foi possível confirmar o bloqueio deste cadastro. Atualize a página antes de tentar novamente.');
  try{
    // Only metadata and indexes are loaded. Personal document bytes are removed
    // by their known paths, without downloading every student's signed files.
    const resources=['groups','invitations','admissions','memberRevocations','evaluations','inicResults','advisorRequests','advisorRequestSlots','advisorConfirmations','agreementAdvisorAccess'];
    const snapshots=await Promise.all(resources.map(resource=>get(path(resource))));
    const records=Object.fromEntries(resources.map((resource,index)=>[resource,snapshots[index].val()||{}]));
    const changes={};
    for(const resource of ['users','roles','advisorDirectory','userGroups','userArchives','pushSubscriptions','orientationNotices'])changes[`${resource}/${uid}`]=null;
    // Every year accepted by agreementYear is covered, including a file or
    // signature left without its metadata after a prior interrupted operation.
    for(let year=2027;year<=2100;year++)for(const resource of ['agreements','agreementFiles','agreementReviews','agreementSignatures','agreementAdvisorAccess'])changes[`${resource}/${year}/${uid}`]=null;
    const email=clean(person.email,254).toLowerCase(),removedInvitations=new Set(),releasedGroups=new Set();
    for(const [id,invitation]of Object.entries(records.invitations)){
      if(invitation.senderId===uid||invitation.toUid===uid||email&&clean(invitation.toEmail,254).toLowerCase()===email){
        removedInvitations.add(id);changes[`invitations/${id}`]=null;changes[`invitationIssuedAt/${id}`]=null;
      }
    }
    for(const [id,group]of Object.entries(records.groups)){
      if(group.status==='deleting'&&(group.members?.[uid]||group.memberNames?.[uid]||group.advisorId===uid))throw new Error('Conclua a exclusão do grupo '+group.name+' e tente excluir este cadastro novamente.');
      if(group.members?.[uid]||group.memberNames?.[uid]){
        changes[`groups/${id}/members/${uid}`]=null;changes[`groups/${id}/memberNames/${uid}`]=null;
        // Include empty individual paths too: a staff update racing the cleanup
        // snapshot must not leave a grade, result or admission behind.
        changes[`evaluations/${id}/members/${uid}`]=null;changes[`inicResults/${group.year}/${id}/${uid}`]=null;
        changes[`admissions/${id}/${uid}`]=null;changes[`memberRevocations/${id}/${uid}`]=null;
      }
      if(group.advisorId===uid){releaseAdvisorChanges({...group,id},uid,changes);releasedGroups.add(id);}
    }
    for(const [id,invitation]of Object.entries(records.invitations))if(!removedInvitations.has(id)&&releasedGroups.has(invitation.groupId)&&invitation.type==='advisor'&&invitation.status==='pending')changes[`invitations/${id}/status`]='cancelled';
    for(const [groupId,admissions]of Object.entries(records.admissions))for(const [memberUid,invitationId]of Object.entries(admissions||{}))if(memberUid===uid||removedInvitations.has(invitationId))changes[`admissions/${groupId}/${memberUid}`]=null;
    for(const [groupId,revocations]of Object.entries(records.memberRevocations))if(Object.prototype.hasOwnProperty.call(revocations||{},uid))changes[`memberRevocations/${groupId}/${uid}`]=null;
    for(const groupId of releasedGroups)changes[`memberRevocations/${groupId}/${uid}`]=null;
    for(const [groupId,evaluations]of Object.entries(records.evaluations))if(Object.prototype.hasOwnProperty.call(evaluations.members||{},uid))changes[`evaluations/${groupId}/members/${uid}`]=null;
    for(const [year,groups]of Object.entries(records.inicResults))for(const [groupId,results]of Object.entries(groups||{}))if(Object.prototype.hasOwnProperty.call(results||{},uid))changes[`inicResults/${year}/${groupId}/${uid}`]=null;
    for(const [groupId,requests]of Object.entries(records.advisorRequests)){
      if(releasedGroups.has(groupId))continue;
      for(const [advisorUid,invitationId]of Object.entries(requests||{}))if(advisorUid===uid||removedInvitations.has(invitationId))changes[`advisorRequests/${groupId}/${advisorUid}`]=null;
    }
    for(const [groupId,slots]of Object.entries(records.advisorRequestSlots)){
      if(releasedGroups.has(groupId))continue;
      for(const [slot,advisorUid]of Object.entries(slots||{}))if(advisorUid===uid||removedInvitations.has(records.advisorRequests[groupId]?.[advisorUid]))changes[`advisorRequestSlots/${groupId}/${slot}`]=null;
    }
    for(const [groupId,confirmation]of Object.entries(records.advisorConfirmations))if(!releasedGroups.has(groupId)&&(confirmation.studentUid===uid||confirmation.advisorUid===uid||removedInvitations.has(confirmation.invitationId)))changes[`advisorConfirmations/${groupId}`]=null;
    for(const [year,owners]of Object.entries(records.agreementAdvisorAccess))for(const [ownerUid,advisors]of Object.entries(owners||{}))if(ownerUid!==uid&&Object.prototype.hasOwnProperty.call(advisors||{},uid))changes[`agreementAdvisorAccess/${year}/${ownerUid}/${uid}`]=null;
    if(auth.currentUser?.uid!==actor.uid)throw new Error('Sua conta mudou. Entre novamente.');
    // Shared articles, proposals, messages, schedules and historical authorship
    // are deliberately preserved; this operation removes individual records.
    await update(path(),changes);
  }catch(error){throw Object.assign(new Error(`${error?.message||'Não foi possível concluir a exclusão.'} O acesso permanece bloqueado. Tente excluir o cadastro novamente para concluir.`),{code:'account/deletion-incomplete',cause:error});}
}
export async function restoreUser(uid) {
  const actor=await coordinatorUser();checkIdentifier(uid);
  const [personSnapshot,archiveSnapshot,inactiveSnapshot,invitationsSnapshot]=await Promise.all([get(path(`users/${uid}`)),get(path(`userArchives/${uid}`)),get(path(`inactiveUsers/${uid}`)),get(path('invitations'))]);
  const person=personSnapshot.val(),archive=archiveSnapshot.val();
  if(!person||!archive||inactiveSnapshot.val()!==true)throw new Error('Este cadastro não está excluído.');
  if(archive.status!=='archived')throw new Error('Conclua a exclusão antes de restaurar o cadastro.');
  if(uid===actor.uid||!['student','advisor'].includes(archive.role))throw new Error('O cadastro da coordenação está protegido.');
  const changes={[`inactiveUsers/${uid}`]:null,[`roles/${uid}`]:archive.role,[`advisorDirectory/${uid}`]:archive.role==='advisor'?{uid,name:person.name}:null,[`userArchives/${uid}/status`]:'restored',[`userArchives/${uid}/restoredAt`]:serverTimestamp(),[`userArchives/${uid}/restoredBy`]:actor.uid,[`userArchives/${uid}/inviteCutoff`]:serverTimestamp()};
  for(const invitation of collection(invitationsSnapshot))if(pendingForUser(invitation,uid,person.email))changes[`invitations/${invitation.id}/status`]='cancelled';
  if(auth.currentUser?.uid!==actor.uid)throw new Error('Sua conta mudou. Entre novamente.');
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
export async function createGroup({name,topic,description='',year=2027,advisorId='',advisorIds=[],memberEmails=[],proposal=null,proposalFile=null}) {
  const user=needUser(),role=await requireAcademicAccess();
  const edition=Number(year);
  if(!Number.isInteger(edition)||edition<2025||edition>2100)throw new Error('Informe uma edição válida, por exemplo 2027.');
  const groupName=clean(name,100),groupTopic=clean(topic,240);
  if(!groupName||!groupTopic)throw new Error('Informe o nome do grupo e o tema da pesquisa.');
  const colleagues=proposalMemberEmails(memberEmails,user.email);
  const schoolYear=role==='student'?String((await get(path(`users/${user.uid}/year`))).val()||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim():'';
  const automaticBruno=role==='student'&&/^[12](?:[º°oaª])?\s*(?:ano|serie|em|ensino medio)\b/.test(schoolYear);
  const brunoUid='GZv2JuQ7JJg2G4ErhdOEKQOzM3z2';
  if(automaticBruno){const directory=await get(path(`advisorDirectory/${brunoUid}`));if(!directory.exists())throw new Error('O cadastro do professor Bruno Michel Pera precisa estar ativo e aprovado. Avise a coordenação para liberar a criação do grupo.');}
  const candidates=automaticBruno?[]:await approvedAdvisorIds(role==='student'?(advisorIds.length?advisorIds:advisorId?[advisorId]:[]):advisorId&&advisorId!==user.uid?[advisorId]:[]);
  const directAdvisor=automaticBruno?brunoUid:(role==='advisor'&&(!advisorId||advisorId===user.uid))||(role==='coordinator'&&advisorId===user.uid)?user.uid:'';
  const groupId=push(path('groups')).key;
  const preparedProposal=proposal?await prepareProposal(groupId,{proposal,proposalFile,user}):null;
  if(role==='student'&&candidates.length&&!preparedProposal)throw new Error('Preencha ou envie a proposta antes de convidar os orientadores.');
  const group={name:groupName,topic:groupTopic,description:clean(description,3000),year:edition,advisorId:directAdvisor,members:{[user.uid]:true},memberNames:{[user.uid]:profileCache?.name||user.displayName||'Participante'},createdBy:user.uid,createdAt:Date.now(),status:'active',advisorRequestVersion:candidates.length?1:0};
  if(role==='student'){group.advisorRequestPolicy='first-accept-v1';group.proposalRequired=true;}
  if(preparedProposal)group.proposal=preparedProposal.metadata;
  const changes={[`groups/${groupId}`]:group,[`userGroups/${user.uid}/${groupId}`]:true};
  if(preparedProposal?.payload)changes[`proposalFiles/${groupId}`]=preparedProposal.payload;
  for(const task of defaultSchedule(edition))changes[`tasks/${groupId}/${task.id}`]={title:task.title,dueDate:task.dueDate,completed:false,weight:1,createdBy:user.uid,createdAt:Date.now(),completedBy:''};
  for(const [slot,uid] of candidates.entries()){const id=push(path('invitations')).key;changes[`invitations/${id}`]=invitationRecord(user,groupId,groupName,uid);changes[`invitationIssuedAt/${id}`]=serverTimestamp();changes[`advisorRequests/${groupId}/${uid}`]=id;changes[`advisorRequestSlots/${groupId}/${slot}`]=uid;}
  for(const email of colleagues){const id=push(path('invitations')).key;changes[`invitations/${id}`]=invitationRecord(user,groupId,groupName,'',email,'member');changes[`invitationIssuedAt/${id}`]=serverTimestamp();}
  // Proposal, first schedule and all selected invitations either all commit or
  // all fail. Retrying a failed form cannot leave a second partial proposal.
  if(auth.currentUser?.uid!==user.uid)throw new Error('Sua conta mudou. Entre novamente.');
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
  await update(path(),{[`groups/${groupId}/members/${uid}`]:null,[`groups/${groupId}/memberNames/${uid}`]:null,[`userGroups/${uid}/${groupId}`]:null,[`evaluations/${groupId}/members/${uid}`]:null,[`inicResults/${group.year}/${groupId}/${uid}`]:null,[`admissions/${groupId}/${uid}`]:null,[`memberRevocations/${groupId}/${uid}`]:serverTimestamp()});
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
  for(const resource of ['groups','tasks','messages','events','evaluations','admissions','memberRevocations','advisorRequests','advisorRequestSlots','advisorConfirmations','orientationTransitions','articles'])changes[`${resource}/${groupId}`]=null;
  changes[`proposalFiles/${groupId}`]=null;
  changes[`inicResults/${frozen.year}/${groupId}`]=null;changes[`inicBoards/${frozen.year}/${groupId}`]=null;
  const relatedUsers=new Set([...Object.keys(frozen.members||{}),frozen.createdBy,frozen.advisorId].filter(Boolean));
  for(const uid of relatedUsers)changes[`userGroups/${uid}/${groupId}`]=null;
  for(const invitation of collection(invitationSnapshot)){changes[`invitations/${invitation.id}`]=null;changes[`invitationIssuedAt/${invitation.id}`]=null;}
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
  if(type==='advisor'&&role==='student'){
    const payload=group.proposal?.mode==='file'?(await get(path(`proposalFiles/${groupId}`))).val():null;
    if(!proposalMetadataValid(group.proposal,payload))throw new Error('Preencha ou envie a proposta antes de convidar os orientadores.');
  }
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
  changes[`invitations/${id}`]=invitationRecord(user,groupId,group.name,toUid,toEmail,type);changes[`invitationIssuedAt/${id}`]=serverTimestamp();
  await update(path(),changes);return id;
}
export async function respondInvitation(invitationId,accept) {
  await requireActiveUser();
  const user=needUser();checkIdentifier(invitationId);
  const invitation=(await get(path(`invitations/${invitationId}`))).val();
  if(!invitation||invitation.status!=='pending')throw new Error('Este convite já foi respondido ou cancelado.');
  const archiveState=await get(path(`userArchives/${user.uid}`));
  const cutoff=archiveState.val()?.inviteCutoff||0,issuedAt=cutoff?(await get(path(`invitationIssuedAt/${invitationId}`))).val():invitation.createdAt;
  if(cutoff&&(!Number.isInteger(issuedAt)||issuedAt<=cutoff))throw new Error('Este convite não está mais disponível. Solicite um novo convite.');
  if(invitation.toUid!==user.uid&&invitation.toEmail!==user.email?.toLowerCase())throw new Error('Este convite pertence a outra conta.');
  if(!accept){await update(path(`invitations/${invitationId}`),{status:'declined'});return;}
  await requireAcademicAccess();
  await set(path(`admissions/${invitation.groupId}/${user.uid}`),invitationId);
  const changes={[`invitations/${invitationId}/status`]:'accepted'};
  if(invitation.type==='advisor') {
    await changeOrientation(invitation.groupId,user.uid,{action:'accept',invitationId});return;
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
  await requireActiveUser();
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
  await requireActiveUser();
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
  await requireActiveUser();
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
  await requireActiveUser();
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
  await requireActiveUser();
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

// INIC declarations and coordination-entered boards are separate from grades.
const inicResultStatuses=Object.freeze(['pending','approved','rejected','correction']);
function inicEdition(year=2027){return agreementYear(year);}
function inicStatus(value,correction=''){
  if(!inicResultStatuses.includes(value))throw new Error('Escolha a situação do INIC.');
  const note=clean(correction,2000);
  if(value==='correction'&&note.replace(/\s/g,'').length<3)throw new Error('Descreva a correção pendente em pelo menos 3 caracteres.');
  return {status:value,correction:note};
}
function inicExpectedStamp(value,current){
  const stamp=current?.updatedAt||0;
  if(value!==undefined&&(!Number.isInteger(value)||value<0||value!==stamp))throw new Error('O registro foi atualizado. Confira a situação atual antes de salvar.');
  return stamp;
}
async function inicActor(user){
  const [profileSnapshot,roleSnapshot]=await Promise.all([get(path(`users/${user.uid}`)),get(path(`roles/${user.uid}`))]);
  const profile=profileSnapshot.val(),storedRole=roleSnapshot.val();
  if(!profile?.name)throw new Error('Conclua seu perfil antes de registrar esta informação.');
  return {updatedByUid:user.uid,updatedByName:clean(profile.name,100),updatedByRole:['advisor','coordinator'].includes(storedRole)?storedRole:'student'};
}
export async function saveInicResult(groupId,studentUid,{year=2027,status,correction='',expectedUpdatedAt}={}){
  const user=await requireActiveUser(),role=await requireAcademicAccess(),edition=inicEdition(year);checkIdentifier(groupId);checkIdentifier(studentUid);
  const [groupSnapshot,resultSnapshot]=await Promise.all([get(path(`groups/${groupId}`)),get(path(`inicResults/${edition}/${groupId}/${studentUid}`))]);
  const group=groupSnapshot.val();
  if(!group||group.status==='deleting'||group.status==='archived'||group.archived===true||Number(group.year)!==edition)throw new Error('O grupo não está disponível nesta edição do INIC.');
  const manager=role==='coordinator'||role==='advisor'&&group.advisorId===user.uid;
  if(!group.members?.[studentUid]||!manager&&(studentUid!==user.uid||!group.members?.[user.uid]))throw new Error('Você só pode registrar a situação dos estudantes vinculados ao seu grupo.');
  const previousUpdatedAt=inicExpectedStamp(expectedUpdatedAt,resultSnapshot.val()),actor=await inicActor(user);
  if(auth.currentUser?.uid!==user.uid)throw new Error('Sua conta mudou. Entre novamente.');
  const record={year:edition,groupId,studentUid,...inicStatus(status,correction),...actor,updatedAt:serverTimestamp(),previousUpdatedAt};
  await set(path(`inicResults/${edition}/${groupId}/${studentUid}`),record);
  return record;
}
export async function saveInicBoard(groupId,{year=2027,id,title,date,time='',evaluatorsText='',status='pending',correction='',expectedUpdatedAt}={}){
  const user=await coordinatorUser(),edition=inicEdition(year);checkIdentifier(groupId);if(id!==undefined)checkIdentifier(id);
  const boardId=id||push(path(`inicBoards/${edition}/${groupId}`)).key;
  const [groupSnapshot,boardSnapshot]=await Promise.all([get(path(`groups/${groupId}`)),get(path(`inicBoards/${edition}/${groupId}/${boardId}`))]);
  const group=groupSnapshot.val(),current=boardSnapshot.val();
  if(!group||group.status==='deleting'||group.status==='archived'||group.archived===true||Number(group.year)!==edition)throw new Error('Escolha um grupo ativo desta edição.');
  if(id&&!current)throw new Error('Esta banca não está mais disponível.');
  if(current?.deleted===true)throw new Error('Esta banca foi excluída. Crie um novo registro se necessário.');
  const name=clean(title,160),civil=String(date||''),clock=String(time||'');
  if(name.length<2)throw new Error('Informe o título da banca.');
  checkDate(civil);if(!civil.startsWith(`${edition}-`))throw new Error('A data da banca deve pertencer à edição escolhida.');
  if(clock!==''&&!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(clock))throw new Error('Escolha um horário válido.');
  const previousUpdatedAt=inicExpectedStamp(expectedUpdatedAt,current),actor=await inicActor(user);
  if(auth.currentUser?.uid!==user.uid)throw new Error('Sua conta mudou. Entre novamente.');
  const record={year:edition,groupId,title:name,date:civil,time:clock,evaluatorsText:clean(evaluatorsText,2000),...inicStatus(status,correction),...actor,updatedAt:serverTimestamp(),previousUpdatedAt,createdAt:current?.createdAt||serverTimestamp(),createdByUid:current?.createdByUid||user.uid};
  await set(path(`inicBoards/${edition}/${groupId}/${boardId}`),record);
  return boardId;
}
export async function deleteInicBoard(groupId,id,{year=2027,expectedUpdatedAt}={}){
  const user=await coordinatorUser(),edition=inicEdition(year);checkIdentifier(groupId);checkIdentifier(id);
  const [groupSnapshot,boardSnapshot]=await Promise.all([get(path(`groups/${groupId}`)),get(path(`inicBoards/${edition}/${groupId}/${id}`))]);
  const group=groupSnapshot.val(),current=boardSnapshot.val();
  if(!group||group.status==='deleting'||group.status==='archived'||group.archived===true||Number(group.year)!==edition)throw new Error('Escolha um grupo ativo desta edição.');
  if(!current||current.deleted===true)throw new Error('Esta banca já foi excluída.');
  const previousUpdatedAt=inicExpectedStamp(expectedUpdatedAt,current),actor=await inicActor(user);
  if(auth.currentUser?.uid!==user.uid)throw new Error('Sua conta mudou. Entre novamente.');
  await set(path(`inicBoards/${edition}/${groupId}/${id}`),{...current,...actor,previousUpdatedAt,updatedAt:serverTimestamp(),deleted:true,deletedAt:serverTimestamp(),deletedByUid:user.uid});
}
export function subscribeCoordinationMetrics(year=2027,callback){
  const user=needUser(),edition=inicEdition(year);let stopped=false,activeVersion=0,roleStop=()=>{},privateStops=[];
  const state={ready:false,boards:[],results:[],tasks:[]};
  function detach(){activeVersion++;privateStops.forEach(stop=>stop());privateStops=[];state.ready=false;state.boards=[];state.results=[];state.tasks=[];}
  const emit=error=>{if(!stopped)callback({...state,...(error?{error}:{} )});};
  const inactiveStop=onValue(path(`inactiveUsers/${user.uid}`),flag=>{
    if(stopped)return;roleStop();roleStop=()=>{};detach();
    if(flag.val()===true){emit(new Error('Este cadastro está excluído da plataforma.'));return;}
    let roleLive=true;const rawRoleStop=onValue(path(`roles/${user.uid}`),roleSnapshot=>{
      if(stopped||!roleLive)return;detach();
      if(roleSnapshot.val()!=='coordinator'){emit(new Error('Os indicadores são exclusivos da coordenação.'));return;}
      const version=activeVersion,loaded=new Set(),raw={groups:{},boards:{},results:{},tasks:{},inactive:{}};
      const paint=()=>{
        if(stopped||version!==activeVersion)return;
        const groups=Object.fromEntries(Object.entries(raw.groups||{}).filter(([,group])=>group&&group.status!=='deleting'&&Number(group.year)===edition));
        state.boards=Object.entries(raw.boards||{}).flatMap(([groupId,records])=>groups[groupId]?Object.entries(records||{}).filter(([,item])=>item&&item.deleted!==true).map(([id,item])=>({...item,id,groupId})):[]);
        state.results=Object.entries(raw.results||{}).flatMap(([groupId,records])=>groups[groupId]?Object.entries(records||{}).filter(([studentUid,item])=>item&&groups[groupId].members?.[studentUid]===true&&raw.inactive?.[studentUid]!==true).map(([studentUid,item])=>({...item,groupId,studentUid})):[]);
        state.tasks=Object.entries(raw.tasks||{}).flatMap(([groupId,records])=>groups[groupId]?Object.entries(records||{}).map(([id,item])=>({...item,id,groupId})):[]);
        state.ready=loaded.size===5;emit();
      };
      for(const [key,target]of Object.entries({groups:path('groups'),boards:path(`inicBoards/${edition}`),results:path(`inicResults/${edition}`),tasks:path('tasks'),inactive:path('inactiveUsers')})){
        let live=true;const rawStop=onValue(target,snapshot=>{if(stopped||!live||version!==activeVersion)return;raw[key]=snapshot.val()||{};loaded.add(key);paint();},error=>{if(stopped||!live||version!==activeVersion)return;roleStop();roleStop=()=>{};detach();emit(error);});
        privateStops.push(()=>{live=false;rawStop();});
      }
      emit();
    },error=>{if(!stopped&&roleLive){roleLive=false;rawRoleStop();detach();emit(error);}});
    roleStop=()=>{roleLive=false;rawRoleStop();};
  },error=>{if(!stopped){roleStop();roleStop=()=>{};detach();emit(error);}});
  return()=>{stopped=true;inactiveStop();roleStop();detach();};
}
// Optional adapter used by subscribeGroup. A professor reads participant rows
// individually, so an archived student is excluded by the row's server rule.
export function subscribeInicResults(groupId,year=2027,callback){
  const user=needUser(),edition=inicEdition(year);checkIdentifier(groupId);
  let stopped=false,version=0,scopeVersion=0,scopeStops=[],dataStops=[],group=null,role=null;
  const state={results:[],ready:false};
  const emit=error=>{if(!stopped)callback({...state,...(error?{error}:{})});};
  const clearData=()=>{version++;dataStops.forEach(stop=>stop());dataStops=[];state.results=[];state.ready=false;};
  const clearScope=()=>{scopeVersion++;scopeStops.forEach(stop=>stop());scopeStops=[];clearData();group=null;role=null;};
  const attach=()=>{
    if(stopped)return;clearData();const current=version;
    const manager=role==='coordinator'||role==='advisor'&&group?.advisorId===user.uid;
    if(!group||!role||group.status==='deleting'||Number(group.year)!==edition||!manager&&!group.members?.[user.uid]){emit();return;}
    if(role==='coordinator'){
      let live=true;const rawStop=onValue(path(`inicResults/${edition}/${groupId}`),snapshot=>{if(stopped||!live||current!==version)return;state.results=collection(snapshot).filter(item=>group.members?.[item.studentUid||item.id]===true).map(item=>({...item,studentUid:item.studentUid||item.id,groupId}));state.ready=true;emit();},error=>{if(stopped||!live||current!==version)return;state.results=[];state.ready=false;emit(error);});
      dataStops.push(()=>{live=false;rawStop();});emit();return;
    }
    const ids=manager?Object.keys(group.members||{}).filter(uid=>group.members[uid]===true):[user.uid];
    const rows=new Map(),loaded=new Set();
    const paint=()=>{if(stopped||current!==version)return;state.results=[...rows.values()];state.ready=loaded.size===ids.length;emit();};
    for(const studentUid of ids){
      let live=true;const rawStop=onValue(path(`inicResults/${edition}/${groupId}/${studentUid}`),snapshot=>{if(stopped||!live||current!==version)return;loaded.add(studentUid);if(snapshot.exists())rows.set(studentUid,{...snapshot.val(),id:studentUid,studentUid,groupId});else rows.delete(studentUid);paint();},error=>{if(stopped||!live||current!==version)return;live=false;rawStop();loaded.add(studentUid);rows.delete(studentUid);paint();if(!String(error?.code||'').toLowerCase().includes('permission'))emit(error);});
      dataStops.push(()=>{live=false;rawStop();});
    }
    paint();
  };
  const inactiveStop=onValue(path(`inactiveUsers/${user.uid}`),snapshot=>{
    if(stopped)return;clearScope();const scope=scopeVersion;
    if(snapshot.val()===true){emit(new Error('Este cadastro está excluído da plataforma.'));return;}
    let groupLive=true;const rawGroupStop=onValue(path(`groups/${groupId}`),snap=>{if(stopped||!groupLive||scope!==scopeVersion)return;group=snap.val();attach();},error=>{if(stopped||!groupLive||scope!==scopeVersion)return;clearScope();emit(error);});
    scopeStops.push(()=>{groupLive=false;rawGroupStop();});
    let roleLive=true;const rawRoleStop=onValue(path(`roles/${user.uid}`),snap=>{if(stopped||!roleLive||scope!==scopeVersion)return;role=snap.val()||'student';attach();},error=>{if(stopped||!roleLive||scope!==scopeVersion)return;clearScope();emit(error);});
    scopeStops.push(()=>{roleLive=false;rawRoleStop();});emit();
  },error=>{if(stopped)return;clearScope();emit(error);});
  return()=>{stopped=true;inactiveStop();clearScope();};
}

// A proposal is text in up to four named fields, or one private source file.
const proposalTopicKeys=Object.freeze(['problem','objective','method','expectedResult']);
function proposalMetadataValid(proposal,payload){
  if(!proposal||typeof proposal.version!=='string'||!proposal.version)return false;
  if(proposal.mode==='text')return proposalTopicKeys.every(key=>typeof proposal.topics?.[key]==='string'&&proposal.topics[key].length<=2000)&&proposalTopicKeys.some(key=>proposal.topics[key].trim());
  return Boolean(proposal.mode==='file'&&payload&&proposal.filename&&Number.isInteger(proposal.size)&&proposal.size>0&&proposal.size<=agreementLimits.maxBytes&&agreementLimits.contentTypes.includes(proposal.contentType)&&payload.size===proposal.size&&payload.contentType===proposal.contentType&&payload.version===proposal.version&&payload.uploadedAt===proposal.updatedAt&&typeof payload.base64==='string'&&payload.base64.length>0);
}
async function prepareProposal(groupId,{proposal,proposalFile=null,current=null,currentFile=null,user=needUser()}={}){
  if(!proposal||!['text','file'].includes(proposal.mode))throw new Error('Preencha a proposta por tópicos ou envie o arquivo da proposta.');
  const profile=(await get(path(`users/${user.uid}`))).val();
  if(!profile?.name)throw new Error('Conclua seu perfil antes de enviar a proposta.');
  const version=push(path('proposalFiles')).key,updatedAt=serverTimestamp();
  const metadata={mode:proposal.mode,version,previousVersion:current?.version||'',updatedAt,updatedByUid:user.uid,updatedByName:clean(profile.name,100)};
  if(proposal.mode==='text'){
    const topics={};
    for(const key of proposalTopicKeys){const value=proposal.topics?.[key]??'';if(typeof value!=='string'||value.trim().length>2000)throw new Error('Cada tópico da proposta deve ter até 2.000 caracteres.');topics[key]=value.trim();}
    if(!Object.values(topics).some(value=>value.length))throw new Error('Preencha pelo menos um tópico da proposta.');
    return {metadata:{...metadata,topics},payload:null};
  }
  let payload;
  if(proposalFile){
    if(typeof proposalFile.arrayBuffer!=='function'||!Number.isInteger(proposalFile.size)||proposalFile.size<=0||proposalFile.size>agreementLimits.maxBytes)throw new Error('Envie a proposta em PDF, JPG ou PNG de até 3 MB.');
    const bytes=new Uint8Array(await proposalFile.arrayBuffer());
    if(bytes.length!==proposalFile.size)throw new Error('Não foi possível ler o arquivo completo da proposta.');
    const contentType=detectAgreementType(bytes);
    if(!contentType||proposalFile.type&&proposalFile.type!==contentType)throw new Error('Formato inválido. Envie a proposta em PDF, JPG ou PNG.');
    Object.assign(metadata,{filename:agreementFilename(proposalFile.name||'proposta',contentType,2027),size:bytes.length,contentType});
    payload={base64:bytesToBase64(bytes),size:bytes.length,contentType,version,uploadedAt:updatedAt};
  }else{
    if(!proposalMetadataValid(current,currentFile)||current.mode!=='file')throw new Error('Selecione o arquivo da proposta.');
    Object.assign(metadata,{filename:current.filename,size:current.size,contentType:current.contentType});
    payload={...currentFile,version,uploadedAt:updatedAt};
  }
  return {metadata,payload};
}
export async function saveProposal(groupId,{proposal,proposalFile=null,expectedVersion}={}){
  const user=await requireActiveUser(),role=await requireAcademicAccess();checkIdentifier(groupId);
  const group=(await get(path(`groups/${groupId}`))).val();
  if(!group||['deleting','archived'].includes(group.status)||group.archived===true)throw new Error('O grupo não está disponível para alterar a proposta.');
  if(!(role==='coordinator'||role==='advisor'&&group.advisorId===user.uid||group.members?.[user.uid]===true))throw new Error('Somente os integrantes e o orientador atual podem editar a proposta.');
  const current=group.proposal||null;
  if(expectedVersion!==undefined&&(expectedVersion??'')!==(current?.version||''))throw new Error('A proposta foi atualizada. Confira a versão atual antes de salvar.');
  const currentFile=proposal?.mode==='file'&&!proposalFile&&current?.mode==='file'?(await get(path(`proposalFiles/${groupId}`))).val():null;
  const prepared=await prepareProposal(groupId,{proposal,proposalFile,current,currentFile,user});
  if(auth.currentUser?.uid!==user.uid)throw new Error('Sua conta mudou. Entre novamente.');
  await update(path(),{[`groups/${groupId}/proposal`]:prepared.metadata,[`proposalFiles/${groupId}`]:prepared.payload});
  return prepared.metadata;
}
export async function getProposal(groupId){
  const user=await requireActiveUser();checkIdentifier(groupId);
  const proposal=(await get(path(`groups/${groupId}/proposal`))).val();
  if(auth.currentUser?.uid!==user.uid)throw new Error('Sua conta mudou. Entre novamente.');
  return proposal;
}
export async function getProposalFile(groupId){
  const user=await requireActiveUser();checkIdentifier(groupId);
  const [metadataSnapshot,fileSnapshot]=await Promise.all([get(path(`groups/${groupId}/proposal`)),get(path(`proposalFiles/${groupId}`))]);
  const metadata=metadataSnapshot.val(),payload=fileSnapshot.val();
  if(!metadata||metadata.mode!=='file'||!proposalMetadataValid(metadata,payload))throw new Error('O arquivo da proposta não está disponível nesta versão.');
  const bytes=Uint8Array.from(atob(payload.base64),value=>value.charCodeAt(0));
  if(bytes.length!==metadata.size||detectAgreementType(bytes)!==metadata.contentType)throw new Error('O arquivo da proposta está incompleto ou possui formato inválido.');
  const latest=(await get(path(`groups/${groupId}/proposal/version`))).val();
  await requireActiveUser(user);
  if(latest!==metadata.version)throw new Error('A proposta mudou durante o download. Tente novamente.');
  if(auth.currentUser?.uid!==user.uid)throw new Error('Sua conta mudou. Entre novamente.');
  return {blob:new Blob([bytes],{type:metadata.contentType}),filename:agreementFilename(metadata.filename,metadata.contentType,2027),contentType:metadata.contentType};
}
export function subscribeProposal(groupId,callback){
  const user=needUser();checkIdentifier(groupId);let stopped=false,version=0,proposalStop=()=>{};
  const emit=(proposal,ready,error)=>{if(!stopped)callback({proposal,ready,...(error?{error}:{})});};
  const detach=()=>{version++;proposalStop();proposalStop=()=>{};};
  const flagStop=onValue(path(`inactiveUsers/${user.uid}`),snapshot=>{
    if(stopped)return;detach();const current=version;
    if(snapshot.val()===true){emit(null,false,new Error('Este cadastro está excluído da plataforma.'));return;}
    let live=true;const rawStop=onValue(path(`groups/${groupId}/proposal`),snap=>{if(stopped||!live||current!==version)return;emit(snap.val(),true);},error=>{if(stopped||!live||current!==version)return;live=false;detach();emit(null,false,error);});
    proposalStop=()=>{live=false;rawStop();};
  },error=>{if(stopped)return;detach();emit(null,false,error);});
  return()=>{stopped=true;flagStop();detach();};
}
