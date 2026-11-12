import {pathToFileURL} from 'node:url';

const YEARS=new Set(['1º ano','2º ano','3º ano']);
const staff=role=>role==='advisor'||role==='coordinator';

// Pure planning step: never edits the snapshot and never returns personal data.
// Only groups whose complete student membership is provably homogeneous and
// indexed can be classified. Ambiguous historical records stay untouched.
export function planSchoolYearMigration(snapshot={}){
  const {groups={},users={},roles={},userGroups={},peopleDirectory={}}=snapshot||{};
  const actual=new Map();
  for(const [gid,group] of Object.entries(groups))for(const [uid,member] of Object.entries(group?.members||{}))if(member===true){
    if(!actual.has(uid))actual.set(uid,[]);
    actual.get(uid).push(gid);
  }
  const assignments=[],skipped=[];let alreadyClassified=0;
  for(const [groupId,group] of Object.entries(groups)){
    let reason='';const years=new Set();
    const members=Object.entries(group?.members||{});
    if(!group||typeof group!=='object'||Array.isArray(group))reason='invalid-group';
    else if(group.status==='deleting')reason='group-deleting';
    else if(!members.length)reason='no-students';
    for(const [uid,present] of reason?[]:members){
      if(present!==true){reason='invalid-membership';break;}
      if(!users[uid]){reason='missing-profile';break;}
      // The index prevents a later role/year change from evading the new rules.
      if(userGroups[uid]?.[groupId]!==true){reason='missing-membership-index';break;}
      if(staff(roles[uid]))continue;
      const year=users[uid].year;
      if(!YEARS.has(year)){reason='invalid-student-year';break;}
      const indexed=Object.entries(userGroups[uid]||{}).filter(([,value])=>value===true).map(([gid])=>gid);
      if(actual.get(uid)?.length!==1||indexed.length!==1||indexed[0]!==groupId){reason='student-multiple-groups';break;}
      if(peopleDirectory[uid]?.groupId!==groupId||peopleDirectory[uid]?.year!==year||peopleDirectory[uid]?.role!=='student'){
        reason='directory-needs-reconciliation';break;
      }
      years.add(year);
    }
    if(!reason&&!years.size)reason='no-students';
    if(!reason&&years.size!==1)reason='mixed-school-years';
    if(!reason&&Object.hasOwn(group,'schoolYear')){
      if(YEARS.has(group.schoolYear)&&group.schoolYear===[...years][0])alreadyClassified++;
      else reason='existing-school-year-conflict';
      if(!reason)continue;
    }
    if(reason)skipped.push({groupId,reason});
    else assignments.push({groupId,schoolYear:[...years][0]});
  }
  return {assignments,skipped,alreadyClassified};
}

export function applySchoolYearPlan(snapshot,plan){
  if(!snapshot||!plan.assignments.length)return snapshot;
  const groups={...snapshot.groups};
  for(const {groupId,schoolYear} of plan.assignments)groups[groupId]={...groups[groupId],schoolYear};
  return {...snapshot,groups};
}

export async function migrateSchoolYears(rootRef,{apply=false}={}){
  if(!apply){
    const keys=['groups','users','roles','userGroups','peopleDirectory'];
    const values=await Promise.all(keys.map(key=>rootRef.child(key).once('value')));
    const plan=planSchoolYearMigration(Object.fromEntries(keys.map((key,index)=>[key,values[index].val()||{}])));
    return {mode:'dry-run',committed:false,...plan};
  }
  // Prime the local cache before the transaction. The transaction is placed at
  // the common ancestor so any concurrent membership, role or year change
  // forces a fresh plan from the current server snapshot. No other field is
  // changed, and no complete snapshot or private document is written to logs.
  await rootRef.once('value');
  let plan={assignments:[],skipped:[],alreadyClassified:0};
  const result=await rootRef.transaction(current=>{
    plan=planSchoolYearMigration(current);
    if(!current||!plan.assignments.length)return;
    return applySchoolYearPlan(current,plan);
  },undefined,false);
  return {mode:'apply',committed:result.committed,...plan};
}

function parseArgs(args){
  const options={apply:false};
  for(let index=0;index<args.length;index++){
    const name=args[index];
    if(name==='--apply')options.apply=true;
    else if(name==='--project'||name==='--database-url'){
      const value=args[++index];
      if(!value||value.startsWith('--'))throw new Error(`Informe o valor de ${name}.`);
      options[name==='--project'?'projectId':'databaseURL']=value;
    }else throw new Error(`Opção desconhecida: ${name}`);
  }
  if(!options.projectId||!options.databaseURL)throw new Error('Uso: node migrate.mjs --project PROJETO --database-url URL [--apply]');
  const url=new URL(options.databaseURL);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(/\.firebaseio\.com$|\.firebasedatabase\.app$/).test(url.hostname))throw new Error('Informe apenas a URL HTTPS raiz do Realtime Database.');
  if(!url.hostname.startsWith(options.projectId+'.')&&!url.hostname.startsWith(options.projectId+'-default-rtdb.'))throw new Error('O projeto e o endereço do banco precisam corresponder.');
  if(process.env.FIREBASE_DATABASE_EMULATOR_HOST&&(!['127.0.0.1:9000','localhost:9000'].includes(process.env.FIREBASE_DATABASE_EMULATOR_HOST)||options.projectId!=='demo-maximus-inic'))throw new Error('Emulador permitido apenas em localhost:9000 no projeto demo-maximus-inic.');
  return options;
}

async function main(){
  const options=parseArgs(process.argv.slice(2));
  const [{initializeApp,applicationDefault,deleteApp},{getDatabase}]=await Promise.all([import('firebase-admin/app'),import('firebase-admin/database')]);
  const app=initializeApp({projectId:options.projectId,databaseURL:options.databaseURL,credential:applicationDefault()});
  try{
    const report=await migrateSchoolYears(getDatabase(app).ref('maximusInic'),{apply:options.apply});
    console.log(JSON.stringify({projectId:options.projectId,...report},null,2));
    if(!options.apply)console.log('Simulação concluída. Nenhum registro foi alterado. Use --apply para executar o mesmo planejamento novamente sobre os dados atuais.');
  }finally{await deleteApp(app);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
  // SDK errors may contain payloads; expose only a stable error code.
  console.error(error?.code?`Migração não concluída (${error.code}).`:String(error?.message||'Migração não concluída.'));
  process.exitCode=1;
});
