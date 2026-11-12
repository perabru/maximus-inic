import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {ref,get,set,update,serverTimestamp} from 'firebase/database';
import {loadService} from './service-runtime.mjs';

// Independent boundary tests: every client is synthetic and local. Run this
// suite sequentially with the other tests sharing the demo namespace.
const env=await initializeTestEnvironment({projectId:'demo-maximus-inic',database:{host:'127.0.0.1',port:9000,rules:readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')}});
const root='maximusInic',stamp=Date.now();
const db=uid=>env.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:true}).database();
const at=(uid,path='')=>ref(db(uid),`${root}${path?'/'+path:''}`);
const client=(uid,options={})=>loadService(db(uid),uid,options);
const admin=operation=>env.withSecurityRulesDisabled(context=>operation(context.database()));
const value=async path=>{let result;await admin(async database=>{result=(await get(ref(database,`${root}/${path}`))).val();});return result;};
let passed=0;
const check=(name,condition)=>{assert.ok(condition,name);passed++;console.log('PASS',name);};
const deny=async(name,promise)=>{await assertFails(promise);check(name,true);};
const rejects=async(name,operation)=>{await assert.rejects(operation);check(name,true);};
const person=(uid,year='2º ano',requestedRole='student')=>({name:uid,email:`${uid}@example.com`,requestedRole,year,createdAt:stamp});
const bytes=Buffer.from('%PDF-1.7\nSynthetic same-year agreement\n%%EOF');
const students=['owner','peer','first','third','raw','pending','createRace','inviteRace','acceptRace','profileRace','archivePeer','legacyFirst','legacySecond','legacyPeer','missingYear','requestedTeacher'];
const users=Object.fromEntries(students.map(uid=>[uid,person(uid)]));
users.first.year='1º ano';users.third.year='3º ano';users.legacyFirst.year='1º ano';users.missingYear.year='';users.requestedTeacher.requestedRole='advisor';
users.coord=person('coord','','advisor');users.teacher=person('teacher','','advisor');users.soloTeacher=person('soloTeacher','1º ano','advisor');
const term=uid=>({uid,year:2027,filename:'term.pdf',ownerName:uid,size:bytes.length,contentType:'application/pdf',uploadedAt:stamp});
const seed={users,roles:{coord:'coordinator',teacher:'advisor',soloTeacher:'advisor'},advisorDirectory:{teacher:{uid:'teacher',name:'teacher'},soloTeacher:{uid:'soloTeacher',name:'soloTeacher'}},agreements:{2027:Object.fromEntries(students.map(uid=>[uid,term(uid)]))},agreementFiles:{2027:Object.fromEntries(students.map(uid=>[uid,{base64:bytes.toString('base64'),size:bytes.length,contentType:'application/pdf',uploadedAt:stamp}]))}};
const options=(name,schoolYear='2º ano',patch={})=>({name,topic:'Pesquisa científica',schoolYear,...patch});
const invite=(groupId,uid,{email=false}={})=>({groupId,groupName:'Grupo sintético',toEmail:email?`${uid}@example.com`:'',toUid:email?'':uid,type:'member',senderId:'teacher',senderName:'teacher',status:'pending',createdAt:stamp});
const acceptance=(groupId,uid,id)=>({
  [`groups/${groupId}/members/${uid}`]:true,
  [`groups/${groupId}/memberNames/${uid}`]:uid,
  [`userGroups/${uid}/${groupId}`]:true,
  [`peopleDirectory/${uid}/groupId`]:groupId,
  [`invitations/${id}/status`]:'accepted'
});

try {
  await admin(database=>set(ref(database,root),seed));
  const coord=client('coord'),teacher=client('teacher');
  await coord('syncPeopleDirectory');

  const visible=(await get(at('owner','peopleDirectory'))).val();
  check('a student can discover registered students in every school year',
    visible.first?.year==='1º ano'&&visible.peer?.year==='2º ano'&&visible.third?.year==='3º ano');
  await deny('community visibility does not expose private student profiles',get(at('owner','users/first')));

  const owned=await client('owner')('createGroup',options('Grupo do segundo ano','1º ano',{year:2028}));
  check('student creation derives grade from profile and keeps INIC edition separate',
    (await value(`groups/${owned}/schoolYear`))==='2º ano'&&(await value(`groups/${owned}/year`))===2028);
  const groups={};
  for(const year of ['1º ano','2º ano','3º ano'])groups[year]=await teacher('createGroup',options(`Orientação ${year}`,year));
  const firstGroup=groups['1º ano'],secondGroup=groups['2º ano'];
  check('one professor can orient groups from all three years',
    Object.keys(await value('userGroups/teacher')).length===3&&
    (await Promise.all(Object.values(groups).map(gid=>value(`groups/${gid}/advisorId`)))).every(uid=>uid==='teacher'));
  await rejects('staff must explicitly choose a school year',()=>teacher('createGroup',{name:'Série ausente',topic:'Pesquisa científica'}));
  await rejects('missing student grade cannot be replaced by an INIC edition or payload grade',()=>client('missingYear')('createGroup',options('Série incompleta')));

  // Intercept the actual service batch to model a client that bypasses all UI
  // validation while preserving every unrelated creation field.
  for(const [label,mutate] of [
    ['different school year',group=>{group.schoolYear='1º ano';}],
    ['missing school year',group=>{delete group.schoolYear;}],
    ['numeric INIC edition as school year',group=>{group.schoolYear=2027;}]
  ]) {
    let gid;
    const forged=client('raw',{beforeUpdate:(_target,changes)=>{
      const entry=Object.entries(changes).find(([path])=>/^groups\/[^/]+$/.test(path));
      if(entry){gid=entry[0].split('/')[1];mutate(entry[1]);}
    }});
    await rejects(`raw creation rejects ${label}`,()=>forged('createGroup',options('Criação adulterada')));
    check(`rejected ${label} leaves no group, tasks or membership claim`,Boolean(gid)&&
      (await value(`groups/${gid}`))===null&&(await value(`tasks/${gid}`))===null&&
      (await value(`userGroups/raw/${gid}`))===null&&(await value('peopleDirectory/raw/groupId'))==='');
  }

  await rejects('student cannot send a member invitation to another school year',()=>client('owner')('invite',{groupId:owned,toUid:'first',type:'member'}));
  await rejects('professor cannot send a mismatching student invitation',()=>teacher('invite',{groupId:secondGroup,toUid:'first',type:'member'}));
  await rejects('coordination cannot send a mismatching student invitation',()=>coord('invite',{groupId:secondGroup,toUid:'third',type:'member'}));
  await deny('direct indexed invitation cannot bypass the grade restriction',update(at('teacher'),{
    'invitations/raw-other-year':{...invite(secondGroup,'first'),schoolYear:'2º ano',createdAt:serverTimestamp()},
    'invitationIssuedAt/raw-other-year':serverTimestamp(),
    [`memberRequests/${secondGroup}/first`]:'raw-other-year'
  }));
  check('rejected direct invitation leaves its index empty',(await value(`memberRequests/${secondGroup}/first`))===null);

  const validInvite=await teacher('invite',{groupId:secondGroup,toUid:'peer',type:'member'});
  await client('peer')('respondInvitation',validInvite,true);
  check('matching student joins the group through its normal invitation',
    (await value(`groups/${secondGroup}/members/peer`))===true&&(await value('peopleDirectory/peer/groupId'))===secondGroup);
  await rejects('bound student cannot switch year through the profile editor',()=>client('peer')('saveProfile',{year:'1º ano'}));
  await rejects('coordination cannot mix a group by changing a bound student year',()=>coord('updateUser','peer',{year:'1º ano'}));
  await deny('raw profile and directory rewrite cannot change a bound student year',update(at('peer'),{'users/peer/year':'1º ano','peopleDirectory/peer/year':'1º ano'}));
  await deny('forging only a public directory year is rejected',set(at('peer','peopleDirectory/peer/year'),'1º ano'));
  await deny('self-requested professor status cannot evade student year constraints',update(at('peer'),{
    'users/peer/requestedRole':'advisor','users/peer/year':'1º ano',
    'peopleDirectory/peer/requestedRole':'advisor','peopleDirectory/peer/year':'1º ano'
  }));
  await deny('student cannot grant an approved staff role',set(at('peer','roles/peer'),'advisor'));
  await deny('deleting the public claim cannot detach an existing membership',set(at('peer','peopleDirectory/peer'),null));
  await deny('deleting both profile and public school years cannot evade validation',update(at('peer'),{'users/peer/year':null,'peopleDirectory/peer/year':null}));
  const incompleteProfile={...await value('users/peer')};delete incompleteProfile.year;
  await deny('replacing the profile without a year cannot erase the grade boundary',set(at('peer','users/peer'),incompleteProfile));
  await deny('onboarding cannot be reopened to remove a bound directory entry',update(at('peer'),{'users/peer/onboardingRequired':true,'peopleDirectory/peer':null}));
  await rejects('registration completion cannot change an enrolled student year',()=>client('peer')('ensureProfile',{
    uid:'peer',email:'peer@example.com',displayName:'peer',providerData:[]
  },{name:'peer',year:'1º ano',requestedRole:'student'}));
  await client('peer')('completeGoogleProfile',{name:'Alteração indevida',requestedRole:'student',year:'1º ano'});
  check('completed Google onboarding cannot be replayed to change a bound grade',(await value('users/peer/year'))==='2º ano');
  await deny('changing every known student profile does not make group school year mutable',update(at('coord'),{
    [`groups/${secondGroup}/schoolYear`]:'1º ano',
    'users/peer/year':'1º ano','peopleDirectory/peer/year':'1º ano'
  }));
  await deny('professor cannot delete a group school year',set(at('teacher',`groups/${secondGroup}/schoolYear`),null));
  await deny('coordination cannot overwrite school year alone',set(at('coord',`groups/${secondGroup}/schoolYear`),'1º ano'));
  await client('peer')('saveProfile',{name:'Nome corrigido',year:'2º ano'});
  check('same-year profile correction preserves membership and directory consistency',
    (await value('users/peer/name'))==='Nome corrigido'&&(await value('peopleDirectory/peer/year'))==='2º ano'&&
    (await value(`groups/${secondGroup}/members/peer`))===true);

  const pending=await teacher('invite',{groupId:secondGroup,toUid:'pending',type:'member'});
  await coord('updateUser','pending',{year:'1º ano'});
  await rejects('a pending invitation is revalidated after a free student changes year',()=>client('pending')('respondInvitation',pending,true));
  await deny('direct admission rejects an invitation whose recipient changed year',set(at('pending',`admissions/${secondGroup}/pending`),pending));
  // An admission could predate the grade rule. Membership must independently
  // validate the current profile, even when that old proof already exists.
  await admin(database=>set(ref(database,`${root}/admissions/${secondGroup}/pending`),pending));
  await deny('an old admission does not let another-year student join directly',update(at('pending'),acceptance(secondGroup,'pending',pending)));
  check('rejected stale invitation changes no membership or consumed status',
    (await value(`groups/${secondGroup}/members/pending`))===null&&
    (await value('peopleDirectory/pending/groupId'))===''&&(await value(`invitations/${pending}/status`))==='pending');

  await admin(database=>update(ref(database,root),{
    'invitations/legacy-email':invite(secondGroup,'first',{email:true}),
    [`admissions/${secondGroup}/first`]:'legacy-email'
  }));
  await rejects('legacy email invitation cannot admit a student from another year',()=>client('first')('respondInvitation','legacy-email',true));
  await deny('legacy email proof cannot bypass raw membership validation',update(at('first'),acceptance(secondGroup,'first','legacy-email')));
  await deny('coordination cannot use its write privileges to add a mismatching student',update(at('coord'),acceptance(secondGroup,'first','legacy-email')));
  await deny('rejected other-year student still cannot read private group content',get(at('first',`groups/${secondGroup}`)));
  await client('first')('respondInvitation','legacy-email',false);
  check('ineligible legacy invitation can still be declined',(await value('invitations/legacy-email/status'))==='declined');
  await admin(database=>update(ref(database,root),{
    [`groups/${secondGroup}/members/first`]:false,
    'invitations/legacy-false-member':invite(secondGroup,'first'),
    [`admissions/${secondGroup}/first`]:'legacy-false-member'
  }));
  await deny('a malformed historical false flag is not an existing student member',update(at('first'),acceptance(secondGroup,'first','legacy-false-member')));
  check('rejected false-to-true membership leaves the other-year student free',
    (await value(`groups/${secondGroup}/members/first`))===false&&(await value('peopleDirectory/first/groupId'))==='');

  // Partial archival must not hide the authoritative membership index. Doing
  // so would allow restoration with an empty claim followed by a year change
  // while the original group still contains the student.
  const archiveInvite=await teacher('invite',{groupId:secondGroup,toUid:'archivePeer',type:'member'});
  await client('archivePeer')('respondInvitation',archiveInvite,true);
  let archiveIntercepted=false;
  const partialArchive=client('coord',{beforeUpdate:(_target,changes)=>{
    if(changes['userArchives/archivePeer/status']==='archived'){
      archiveIntercepted=true;
      for(const path of Object.keys(changes))if(![
        'roles/archivePeer','advisorDirectory/archivePeer','userGroups/archivePeer','userArchives/archivePeer/status'
      ].includes(path)&&!path.startsWith('userGroups/archivePeer/'))delete changes[path];
    }
  }});
  await rejects('archival cannot erase indexes while retaining actual membership',()=>partialArchive('archiveUser','archivePeer'));
  check('failed partial archive retains membership index behind its resumable lock',archiveIntercepted&&
    (await value(`groups/${secondGroup}/members/archivePeer`))===true&&
    (await value(`userGroups/archivePeer/${secondGroup}`))===true&&
    (await value('userArchives/archivePeer/status'))==='archiving');
  await coord('archiveUser','archivePeer');
  await coord('restoreUser','archivePeer');
  await client('archivePeer')('saveProfile',{year:'1º ano'});
  check('completed archival allows a new year only after removing old participation',
    (await value(`groups/${secondGroup}/members/archivePeer`))===null&&
    (await value('users/archivePeer/year'))==='1º ano'&&(await value('peopleDirectory/archivePeer/groupId'))==='');

  // Historical groups can contain incomplete or mixed data. Preserve them,
  // but never guess their grade or allow new admissions under a false label.
  const legacy={name:'Grupo anterior',topic:'Pesquisa preservada',description:'',year:2027,advisorId:'teacher',members:{legacyFirst:true,legacySecond:true},memberNames:{legacyFirst:'legacyFirst',legacySecond:'legacySecond'},createdBy:'legacyFirst',createdAt:stamp,status:'active'};
  await admin(database=>update(ref(database,root),{
    'groups/legacy':legacy,'userGroups/legacyFirst/legacy':true,'userGroups/legacySecond/legacy':true,
    'peopleDirectory/legacyFirst/groupId':'legacy','peopleDirectory/legacySecond/groupId':'legacy',
    'invitations/legacy-unclassified':invite('legacy','legacyPeer'),
    'admissions/legacy/legacyPeer':'legacy-unclassified'
  }));
  await coord('syncPeopleDirectory');
  check('directory synchronization does not silently remove historical mixed members',
    (await value('groups/legacy/members/legacyFirst'))===true&&(await value('groups/legacy/members/legacySecond'))===true&&
    (await value('peopleDirectory/legacyFirst/groupId'))==='legacy'&&(await value('peopleDirectory/legacySecond/groupId'))==='legacy');
  await deny('coordination cannot label a nonempty legacy group without validated migration',set(at('coord','groups/legacy/schoolYear'),'2º ano'));
  await deny('student cannot initialize legacy school year from their own profile',set(at('legacyFirst','groups/legacy/schoolYear'),'1º ano'));
  await rejects('legacy group refuses new member invitations until classified',()=>teacher('invite',{groupId:'legacy',toUid:'legacyPeer',type:'member'}));
  await rejects('legacy pending invitation is blocked while group grade is unknown',()=>client('legacyPeer')('respondInvitation','legacy-unclassified',true));
  await deny('direct legacy admission cannot exploit a preexisting proof',update(at('legacyPeer'),acceptance('legacy','legacyPeer','legacy-unclassified')));
  await client('legacyFirst')('updateGroup','legacy',{topic:'Pesquisa revisada'});
  await client('legacySecond')('saveProfile',{name:'Nome legado corrigido',year:'2º ano'});
  check('legacy group still supports normal editing without dropping its members',
    (await value('groups/legacy/topic'))==='Pesquisa revisada'&&Object.keys(await value('groups/legacy/members')).length===2&&
    (await value('peopleDirectory/legacySecond/name'))==='Nome legado corrigido');

  // Deterministic races: mutate the authoritative profile after the service
  // checks it but before its atomic write reaches the emulator.
  let createRaceId;
  const creating=client('createRace',{beforeUpdate:async(_target,changes)=>{
    const entry=Object.entries(changes).find(([path])=>/^groups\/[^/]+$/.test(path));
    if(entry){createRaceId=entry[0].split('/')[1];await coord('updateUser','createRace',{year:'1º ano'});}
  }});
  await rejects('profile change between create checks and commit invalidates group creation',()=>creating('createGroup',options('Criação concorrente')));
  check('failed creation race leaves no partial group or claim',Boolean(createRaceId)&&
    (await value(`groups/${createRaceId}`))===null&&(await value('peopleDirectory/createRace/groupId'))==='');

  let inviteRaceId;
  const inviting=client('teacher',{beforeUpdate:async(_target,changes)=>{
    const entry=Object.entries(changes).find(([path,item])=>/^invitations\/[^/]+$/.test(path)&&item.type==='member');
    if(entry){inviteRaceId=entry[0].split('/')[1];await coord('updateUser','inviteRace',{year:'1º ano'});}
  }});
  await rejects('profile change after invitation checks invalidates the invitation batch',()=>inviting('invite',{groupId:secondGroup,toUid:'inviteRace',type:'member'}));
  check('failed invitation race leaves no request or invitation residue',Boolean(inviteRaceId)&&
    (await value(`invitations/${inviteRaceId}`))===null&&(await value(`memberRequests/${secondGroup}/inviteRace`))===null);

  const acceptRaceInvite=await teacher('invite',{groupId:secondGroup,toUid:'acceptRace',type:'member'});
  const accepting=client('acceptRace',{beforeUpdate:async(_target,changes)=>{
    if(changes[`groups/${secondGroup}/members/acceptRace`])await coord('updateUser','acceptRace',{year:'1º ano'});
  }});
  await rejects('profile change after admission but before commit rejects acceptance',()=>accepting('respondInvitation',acceptRaceInvite,true));
  check('failed acceptance race keeps student free and invitation pending',
    (await value(`groups/${secondGroup}/members/acceptRace`))===null&&(await value('peopleDirectory/acceptRace/groupId'))===''&&
    (await value(`invitations/${acceptRaceInvite}/status`))==='pending');

  const profileRaceInvite=await teacher('invite',{groupId:secondGroup,toUid:'profileRace',type:'member'});
  let acceptedDuringEdit=false;
  const editing=client('profileRace',{beforeUpdate:async(_target,changes)=>{
    if(changes['users/profileRace/year']){await client('profileRace')('respondInvitation',profileRaceInvite,true);acceptedDuringEdit=true;}
  }});
  await rejects('an acceptance occurring during a profile edit prevents stale grade change',()=>editing('saveProfile',{year:'1º ano'}));
  check('winning membership retains its original year after the edit race',acceptedDuringEdit&&
    (await value('users/profileRace/year'))==='2º ano'&&(await value(`groups/${secondGroup}/members/profileRace`))===true);

  await deny('raw staff demotion cannot leave student memberships in different years',update(at('coord'),{
    'roles/teacher':'student','users/teacher/requestedRole':'student','users/teacher/year':'1º ano',
    'advisorDirectory/teacher':null,
    'peopleDirectory/teacher':{uid:'teacher',name:'teacher',year:'1º ano',role:'student',requestedRole:'student',listedAdvisor:false,groupId:firstGroup}
  }));
  check('rejected demotion preserves professor role and multiple orientations',
    (await value('roles/teacher'))==='advisor'&&Object.keys(await value('userGroups/teacher')).length===3);

  // A role-only write does not re-run sibling membership validation. The role
  // boundary must therefore require cleanup even for a single group.
  const soloGroup=await client('soloTeacher')('createGroup',options('Orientação única','2º ano'));
  const soloPublic=await value('peopleDirectory/soloTeacher');
  for(const [label,extra] of [
    ['explicit student role',{'roles/soloTeacher':'student'}],
    ['deleting the staff role',{'roles/soloTeacher':null}],
    ['changing profile grade at demotion',{'roles/soloTeacher':'student','users/soloTeacher/year':'2º ano'}]
  ]) {
    const year=extra['users/soloTeacher/year']||'1º ano';
    await deny(`single-group demotion cannot retain membership by ${label}`,update(at('coord'),{
      ...extra,'advisorDirectory/soloTeacher':null,
      'peopleDirectory/soloTeacher':{...soloPublic,role:'student',year,listedAdvisor:false,groupId:soloGroup}
    }));
  }
  await deny('demotion cannot hide the private index while leaving real membership',update(at('coord'),{
    'roles/soloTeacher':'student','advisorDirectory/soloTeacher':null,'userGroups/soloTeacher':null,
    'peopleDirectory/soloTeacher':{...soloPublic,role:'student',listedAdvisor:false,groupId:''}
  }));
  await coord('updateUser','soloTeacher',{role:'student',year:'1º ano'});
  check('supported demotion releases group and orientation before student access',
    (await value('roles/soloTeacher'))==='student'&&(await value('users/soloTeacher/year'))==='1º ano'&&
    (await value('userGroups/soloTeacher'))===null&&(await value(`groups/${soloGroup}/members/soloTeacher`))===null&&
    (await value(`groups/${soloGroup}/advisorId`))===''&&(await value('peopleDirectory/soloTeacher/groupId'))==='');

  console.log(`SAME-YEAR ADVERSARIAL CHECKS PASSED: ${passed}`);
} finally {
  await env.cleanup();
}
