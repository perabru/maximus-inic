import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {ref,get,set,update} from 'firebase/database';
import {loadService} from './service-runtime.mjs';

const env=await initializeTestEnvironment({projectId:'demo-maximus-inic',database:{host:'127.0.0.1',port:9000,rules:readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')}});
const root='maximusInic',stamp=Date.now();
const db=uid=>env.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:true}).database();
const client=uid=>loadService(db(uid),uid),admin=fn=>env.withSecurityRulesDisabled(c=>fn(c.database()));
let passed=0;
const check=(name,value=true)=>{assert.ok(value,name);passed++;console.log('PASS',name);};
const value=async p=>{let result;await admin(async d=>{result=(await get(ref(d,`${root}/${p}`))).val();});return result;};
const deny=async(name,work)=>{await assertFails(work);check(name);};
const reject=async(name,work,code)=>{await assert.rejects(work,error=>error.code===code);check(name);};
const options=(name,patch={})=>({name,topic:'Pesquisa escolar',...patch});
const term=Buffer.from('%PDF-1.7\nSynthetic signed term\n%%EOF');
const seed={users:{},roles:{teacher:'advisor',coord:'coordinator'},advisorDirectory:{teacher:{uid:'teacher',name:'Professor'}},agreements:{2027:{}},agreementFiles:{2027:{}},notificationWorkers:{worker:true}};
for(const [uid,year] of Object.entries({first:'1º ano',second:'2º ano',third:'3º ano',firstPeer:'1º ano',firstOther:'1º ano',secondPeer:'2º ano',secondOther:'2º ano',thirdPeer:'3º ano',thirdOther:'3º ano',oldEmail:'2º ano',noYear:'',teacher:'',coord:''})){
  seed.users[uid]={name:uid,email:`${uid}@example.com`,requestedRole:['teacher','coord'].includes(uid)?'advisor':'student',year,createdAt:stamp};
  if(!['teacher','coord'].includes(uid)){
    seed.agreements[2027][uid]={uid,year:2027,filename:'termo.pdf',ownerName:uid,size:term.length,contentType:'application/pdf',uploadedAt:stamp};
    seed.agreementFiles[2027][uid]={base64:term.toString('base64'),size:term.length,contentType:'application/pdf',uploadedAt:stamp};
  }
}
try{
  await admin(d=>set(ref(d,root),seed));
  await client('coord')('syncPeopleDirectory');
  check('student sees classmates and students of every other year',Object.keys((await get(ref(db('first'),`${root}/peopleDirectory`))).val()).length===Object.keys(seed.users).length);
  const groups={};
  for(const [uid,year] of [['first','1º ano'],['second','2º ano'],['third','3º ano']]){
    groups[uid]=await client(uid)('createGroup',options(`Grupo ${year}`,{schoolYear:year==='1º ano'?'3º ano':'1º ano'}));
    check(`${year} creator uses saved profile year, not submitted year`,(await value(`groups/${groups[uid]}/schoolYear`))===year);
    check(`${year} retains the independent event edition`,(await value(`groups/${groups[uid]}/year`))===2027);
  }
  await reject('student without canonical grade cannot create group',()=>client('noYear')('createGroup',options('Sem série')),'group/school-year-required');
  await reject('professor explicitly chooses the group grade',()=>client('teacher')('createGroup',options('Série ausente')),'group/school-year-required');
  const teacherFirst=await client('teacher')('createGroup',options('Orientação primeiro',{schoolYear:'1º ano'}));
  const teacherThird=await client('teacher')('createGroup',options('Orientação terceiro',{schoolYear:'3º ano'}));
  check('professor can orient several school years simultaneously',(await value(`groups/${teacherFirst}/advisorId`))==='teacher'&&(await value(`groups/${teacherThird}/advisorId`))==='teacher'&&Object.keys(await value('userGroups/teacher')).length===2);
  const same=await client('first')('invite',{groupId:groups.first,toUid:'firstPeer',type:'member'});
  check('new member invitation carries the canonical group grade',(await value(`invitations/${same}/schoolYear`))==='1º ano');
  check('recipient can read grade without access to private group',await client('firstPeer')('getGroupSchoolYear',groups.first)==='1º ano');
  await deny('pending student cannot inspect the rest of a group',get(ref(db('firstPeer'),`${root}/groups/${groups.first}`)));
  await client('firstPeer')('respondInvitation',same,true);
  check('same-year acceptance saves membership and claim atomically',(await value(`groups/${groups.first}/members/firstPeer`))===true&&(await value('peopleDirectory/firstPeer/groupId'))===groups.first);
  await reject('student cannot invite another year',()=>client('first')('invite',{groupId:groups.first,toUid:'secondPeer',type:'member'}),'group/school-year-mismatch');
  await reject('professor cannot invite another year into a group',()=>client('teacher')('invite',{groupId:teacherThird,toUid:'firstOther',type:'member'}),'group/school-year-mismatch');
  await reject('coordination cannot mix years at creation',()=>client('coord')('createGroup',options('Mistura',{schoolYear:'2º ano',memberUids:['firstOther']})),'group/school-year-mismatch');
  check('failed creation leaves no group behind',!Object.values(await value('groups')).some(group=>group.name==='Mistura'));
  await reject('bound student cannot change their year',()=>client('firstPeer')('saveProfile',{year:'3º ano'}),'profile/school-year-in-use');
  await reject('coordination cannot change a bound student year',()=>client('coord')('updateUser','firstPeer',{year:'2º ano'}),'profile/school-year-in-use');
  await client('coord')('updateUser','firstPeer',{name:'Nome corrigido'});
  check('coordination can still correct a bound student name',(await value('users/firstPeer/name'))==='Nome corrigido');
  await client('secondPeer')('saveProfile',{year:'3º ano'});
  check('unbound student can correct their year',(await value('peopleDirectory/secondPeer/year'))==='3º ano');
  await reject('email API cannot expose private registrations to students',()=>client('first')('invite',{groupId:groups.first,toEmail:'firstOther@example.com',type:'member'}),'group/member-registration-required');
  const emailResolved=await client('coord')('invite',{groupId:groups.second,toEmail:'oldEmail@example.com',type:'member'});
  check('authorized coordinator email lookup becomes a UID invitation',(await value(`invitations/${emailResolved}/toUid`))==='oldEmail'&&(await value(`invitations/${emailResolved}/toEmail`))==='');
  await client('oldEmail')('respondInvitation',emailResolved,true);
  check('resolved legacy API invitation keeps the same-year constraint',(await value(`groups/${groups.second}/members/oldEmail`))===true);
  const legacy={groupId:groups.second,groupName:'Grupo segundo',toUid:'',toEmail:'secondother@example.com',type:'member',senderId:'coord',senderName:'Coordenação',status:'pending',createdAt:stamp};
  await admin(d=>set(ref(d,`${root}/invitations/legacy-email`),legacy));
  await client('secondOther')('respondInvitation','legacy-email',true);
  check('preexisting email invitation still works for the same school year',(await value(`groups/${groups.second}/members/secondOther`))===true);
  await admin(d=>set(ref(d,`${root}/invitations/legacy-wrong-year`),{...legacy,toEmail:'thirdother@example.com'}));
  await reject('old email invitation cannot admit a different year',()=>client('thirdOther')('respondInvitation','legacy-wrong-year',true),'group/school-year-mismatch');
  check('failed old invitation produces no admission or membership',(await value(`admissions/${groups.second}/thirdOther`))===null&&(await value(`groups/${groups.second}/members/thirdOther`))===null&&(await value('invitations/legacy-wrong-year/status'))==='pending');
  const legacyGroup={...(await value(`groups/${groups.second}`)),members:{teacher:true},memberNames:{teacher:'Professor'},createdBy:'teacher',advisorId:'teacher'};
  delete legacyGroup.schoolYear;
  await admin(d=>update(ref(d,root),{'groups/legacy-unclassified':legacyGroup,'userGroups/teacher/legacy-unclassified':true}));
  check('unclassified old group returns an empty school year',await client('firstOther')('getGroupSchoolYear','legacy-unclassified')==='');
  await reject('old unclassified group fails closed before sending',()=>client('teacher')('invite',{groupId:'legacy-unclassified',toUid:'thirdOther',type:'member'}),'group/school-year-unclassified');
  check('old members and history remain untouched',(await value('groups/legacy-unclassified/members/teacher'))===true);
  await deny('anonymous cannot inspect grade metadata',get(ref(env.unauthenticatedContext().database(),`${root}/groups/${groups.first}/schoolYear`)));
  // Notification workers already read groups for the existing scheduled alerts.
  // The new grade label must not grant them access to the people directory.
  await deny('grade metadata does not expose the student directory to the notification worker',get(ref(db('worker'),`${root}/peopleDirectory`)));
  console.log(`SAME YEAR SERVICE SECURITY TESTS PASSED: ${passed}`);
}finally{await env.cleanup();}
