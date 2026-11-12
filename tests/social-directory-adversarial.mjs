import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {ref,get,set,update} from 'firebase/database';
import {loadService} from './service-runtime.mjs';

// Standalone, local-emulator regression checks for bypasses found during review.
// Never run in parallel with another suite sharing this demo namespace.
const env=await initializeTestEnvironment({projectId:'demo-maximus-inic',database:{host:'127.0.0.1',port:9000,rules:readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')}});
const root='maximusInic',stamp=Date.now();
const db=uid=>env.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:true}).database();
const client=(uid,options={})=>loadService(db(uid),uid,options);
const admin=fn=>env.withSecurityRulesDisabled(context=>fn(context.database()));
const value=async path=>{let result;await admin(async database=>{result=(await get(ref(database,`${root}/${path}`))).val();});return result;};
let passed=0;
const check=(name,condition)=>{assert.ok(condition,name);passed++;console.log('PASS',name);};
const deny=async(name,promise)=>{await assertFails(promise);check(name,true);};
const person=(uid,patch={})=>({name:uid,email:`${uid}@example.com`,requestedRole:'student',year:'2º ano',createdAt:stamp,...patch});
const bytes=Buffer.from('%PDF-1.7\nSynthetic test document\n%%EOF');
const users={coord:person('coord',{requestedRole:'advisor',year:''}),teacher:person('teacher',{requestedRole:'advisor',year:''}),google:person('google',{year:'',onboardingRequired:true}),registered:person('registered'),student:person('student'),peer:person('peer')};
const term=uid=>({uid,year:2027,filename:'term.pdf',ownerName:uid,size:bytes.length,contentType:'application/pdf',uploadedAt:stamp});
const seed={users,roles:{coord:'coordinator',teacher:'advisor'},advisorDirectory:{teacher:{uid:'teacher',name:'teacher'}},agreements:{2027:Object.fromEntries(['registered','student','peer'].map(uid=>[uid,term(uid)]))},agreementFiles:{2027:Object.fromEntries(['registered','student','peer'].map(uid=>[uid,{base64:bytes.toString('base64'),size:bytes.length,contentType:'application/pdf',uploadedAt:stamp}]))}};
const options=name=>({name,topic:'Pesquisa científica'});

try {
  await admin(database=>set(ref(database,root),seed));
  const coord=client('coord'),teacher=client('teacher');
  await coord('syncPeopleDirectory');

  await client('google')('completeGoogleProfile',{name:'Professora Google',requestedRole:'advisor'});
  check('Google onboarding changes profile and community projection atomically',
    (await value('users/google/name'))==='Professora Google'&&
    (await value('peopleDirectory/google/name'))==='Professora Google'&&
    (await value('peopleDirectory/google/requestedRole'))==='advisor'&&
    (await value('users/google/onboardingRequired'))===false);
  check('Google teacher request never grants approved teacher role',(await value('roles/google'))===null);

  // Auth callbacks may have created the default projection before registration
  // supplies the chosen name and school year.
  const registeringUser={uid:'registered',email:'registered@example.com',displayName:'registered',providerData:[]};
  await client('registered')('ensureProfile',registeringUser,{name:'Nome completo registrado',requestedRole:'student',year:'1º ano'});
  check('registration detail completion updates an existing directory projection',
    (await value('users/registered/name'))==='Nome completo registrado'&&
    (await value('peopleDirectory/registered/name'))==='Nome completo registrado'&&
    (await value('peopleDirectory/registered/year'))==='1º ano');
  await deny('raw profile-only rename cannot silently leave a stale directory name',update(ref(db('registered'),`${root}/users/registered`),{name:'Nome sem projeção'}));

  const first=await teacher('createGroup',options('Orientação primeira'));
  const second=await teacher('createGroup',options('Orientação segunda'));
  await deny('null role write cannot turn a teacher with several groups into a student',set(ref(db('coord'),`${root}/roles/teacher`),null));
  await deny('rewriting the public role cannot hide multiple groups during null-role demotion',update(ref(db('coord'),root),{'roles/teacher':null,'peopleDirectory/teacher/role':'student'}));
  check('failed null-role attempts leave teacher and both groups intact',
    (await value('roles/teacher'))==='advisor'&&Object.keys(await value('userGroups/teacher')).length===2);

  const owned=await client('student')('createGroup',options('Grupo do aluno'));
  const incoming=await teacher('invite',{groupId:first,toEmail:'student@example.com',type:'member'});
  await set(ref(db('student'),`${root}/admissions/${first}/student`),incoming);
  await deny('raw legacy email acceptance cannot switch group by hiding the original index',update(ref(db('student'),root),{
    [`userGroups/student/${owned}`]:null,
    [`userGroups/student/${first}`]:true,
    [`groups/${first}/members/student`]:true,
    [`groups/${first}/memberNames/student`]:'student',
    [`invitations/${incoming}/status`]:'accepted',
    'peopleDirectory/student/groupId':first
  }));
  check('failed index-swap leaves original student membership untouched',
    (await value(`groups/${owned}/members/student`))===true&&
    (await value(`groups/${first}/members/student`))===null&&
    (await value('peopleDirectory/student/groupId'))===owned);

  const memberInvite=await teacher('invite',{groupId:second,toUid:'peer',type:'member'});
  let intercepted=false;
  const faultyCleanup=client('coord',{beforeUpdate:(_target,changes)=>{
    if(Object.prototype.hasOwnProperty.call(changes,`groups/${second}`)&&changes[`groups/${second}`]===null){
      delete changes[`memberRequests/${second}`];intercepted=true;
    }
  }});
  await assert.rejects(()=>faultyCleanup('deleteGroup',second));
  check('group deletion refuses a batch that leaves the new member invitation index',intercepted&&
    (await value(`groups/${second}/status`))==='deleting'&&
    (await value(`memberRequests/${second}/peer`))===memberInvite);
  await coord('deleteGroup',second);
  check('retry completes deletion with member invitation index cleanup',
    (await value(`groups/${second}`))===null&&
    (await value(`memberRequests/${second}`))===null&&
    (await value(`invitations/${memberInvite}`))===null);

  await coord('updateUser','teacher',{role:'student'});
  check('supported teacher demotion releases prior orientation before enabling student status',
    (await value('roles/teacher'))==='student'&&
    (await value('peopleDirectory/teacher/role'))==='student'&&
    (await value('peopleDirectory/teacher/groupId'))===''&&
    (await value('userGroups/teacher'))===null&&
    (await value(`groups/${first}/advisorId`))==='');

  console.log(`SOCIAL DIRECTORY ADVERSARIAL CHECKS PASSED: ${passed}`);
} finally {
  await env.cleanup();
}
