import {readFileSync} from 'node:fs';
import {loadService} from './service-runtime.mjs';
import {runOnboardingContractEventTests} from './onboarding-contracts-events.mjs';
import {runMandatoryTermProposalTests} from './mandatory-term-proposal.test.mjs';
import {runMemberProposalTests} from './member-proposal.test.mjs';
import {runAgreementReviewTests} from './agreement-review.test.mjs';
import {runAgreementSignatureTests} from './agreement-signatures.test.mjs';
import {runUserManagementTests} from './user-management.test.mjs';
import {runOrientationTransitionTests} from './orientation-transitions.test.mjs';
import {runAutomaticOrientationTests} from './automatic-orientation.test.mjs';
import {runInicResultsTests} from './inic-results.test.mjs';
import {runInicResultsRuntimeTests} from './inic-results-runtime.test.mjs';
import {runProposalTests} from './proposal.test.mjs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {ref,set,get,update,query,orderByChild,equalTo,serverTimestamp} from 'firebase/database';
const env=await initializeTestEnvironment({projectId:'demo-maximus-inic',database:{host:'127.0.0.1',port:9000,rules:readFileSync(new URL('../database.rules.json', import.meta.url),'utf8')}});
const stamp=Date.now();
// Third-year fixtures exercise freely selected advisors; first/second-year
// automatic orientation has a dedicated scenario suite.
const person=(name,email)=>({name,email,requestedRole:'student',year:'3º ano',createdAt:stamp});
const group=(id,student,advisor)=>({name:id,topic:'Tema de pesquisa',description:'Descrição',year:2027,advisorId:advisor,members:{[student]:true},memberNames:{[student]:'Estudante'},createdBy:student,createdAt:stamp,status:'active',advisorRequestPolicy:'first-accept-v1'});
const task={title:'Artigo',dueDate:'2027-07-31',completed:false,completedBy:'',weight:1,createdBy:'a1',createdAt:stamp};
const termBytes=Buffer.from('%PDF-test fixture');
const termMeta=uid=>({uid,year:2027,filename:'termo.pdf',ownerName:uid,size:termBytes.length,contentType:'application/pdf',uploadedAt:stamp});
const termFile={base64:termBytes.toString('base64'),size:termBytes.length,contentType:'application/pdf',uploadedAt:stamp};
await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database()),{items:{preserved:'existing'},maximusInic:{agreements:{2027:Object.fromEntries(['s1','s2','s3'].map(uid=>[uid,termMeta(uid)]))},agreementFiles:{2027:Object.fromEntries(['s1','s2','s3'].map(uid=>[uid,termFile]))},roles:{c:'coordinator',a1:'advisor',a2:'advisor',a3:'advisor'},users:{c:person('Coordenação','c@example.com'),s1:person('Aluno 1','s1@example.com'),s2:person('Aluno 2','s2@example.com'),s3:person('Aluno 3','s3@example.com'),a1:person('Orientador 1','a1@example.com'),a2:person('Orientador 2','a2@example.com'),a3:person('Orientador 3','a3@example.com')},advisorDirectory:{a1:{uid:'a1',name:'Orientador 1'},a2:{uid:'a2',name:'Orientador 2'},a3:{uid:'a3',name:'Orientador 3'}},groups:{g1:{...group('Grupo 1','s1','a1'),advisorRequestPolicy:null},g2:{...group('Grupo 2','s2','a2'),advisorRequestPolicy:null}},tasks:{g1:{t1:task}},userGroups:{s1:{g1:true},s2:{g2:true}}}}));
const db=(uid,emailVerified=true)=>env.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:emailVerified}).database();
let passed=0;
const ok=async(name,promise)=>{await assertSucceeds(promise);passed++;console.log('PASS',name);};
const no=async(name,promise)=>{await assertFails(promise);passed++;console.log('PASS',name);};
try{
 await no('anonymous cannot read platform',get(ref(env.unauthenticatedContext().database(),'maximusInic')));
 await ok('existing items permission preserved',get(ref(env.unauthenticatedContext().database(),'items')));
 await no('student cannot read other profile',get(ref(db('s1'),'maximusInic/users/s2')));
 await no('student cannot list all groups',get(ref(db('s1'),'maximusInic/groups')));
 await ok('student reads own group',get(ref(db('s1'),'maximusInic/groups/g1')));
 await no('student cannot read another group',get(ref(db('s1'),'maximusInic/groups/g2')));
 await ok('advisor reads own group',get(ref(db('a1'),'maximusInic/groups/g1')));
 await no('advisor cannot read another group',get(ref(db('a1'),'maximusInic/groups/g2')));
 await ok('advisor indexed query only own groups',get(query(ref(db('a1'),'maximusInic/groups'),orderByChild('advisorId'),equalTo('a1'))));
 await no('advisor cannot query other advisor',get(query(ref(db('a1'),'maximusInic/groups'),orderByChild('advisorId'),equalTo('a2'))));
 await ok('coordinator reads every group',get(ref(db('c'),'maximusInic/groups')));
 await no('student cannot grant coordinator',set(ref(db('s1'),'maximusInic/roles/s1'),'coordinator'));
 await no('student cannot forge approved advisor',set(ref(db('s1'),'maximusInic/advisorDirectory/s1'),{uid:'s1',name:'Fake advisor'}));
 await ok('creator can update own topic',update(ref(db('s1'),'maximusInic/groups/g1'),{topic:'Tema revisado'}));
 await no('student cannot change another group',update(ref(db('s1'),'maximusInic/groups/g2'),{topic:'Tema invadido'}));
 await no('cannot add own uid to arbitrary group',set(ref(db('s3'),'maximusInic/groups/g1/members/s3'),true));
 await no('cannot forge group index',set(ref(db('s3'),'maximusInic/userGroups/s3/g1'),true));
 await no('cannot impersonate message sender',set(ref(db('s1'),'maximusInic/messages/g1/fake'),{text:'Fake',senderId:'a1',senderName:'Fake',createdAt:stamp}));
 await ok('member sends group message',set(ref(db('s1'),'maximusInic/messages/g1/m1'),{text:'Mensagem de teste',senderId:'s1',senderName:'Aluno1',createdAt:stamp}));
 await no('outsider cannot read messages',get(ref(db('s2'),'maximusInic/messages/g1')));
 await no('outsider cannot send messages',set(ref(db('s2'),'maximusInic/messages/g1/m2'),{text:'Invasão',senderId:'s2',senderName:'Aluno2',createdAt:stamp}));
 await ok('student can complete own task',update(ref(db('s1'),'maximusInic/tasks/g1/t1'),{completed:true,completedBy:'s1'}));
 await no('student cannot alter due date',update(ref(db('s1'),'maximusInic/tasks/g1/t1'),{dueDate:'2027-12-31'}));
 await ok('advisor changes deadline of completed task',update(ref(db('a1'),'maximusInic/tasks/g1/t1'),{dueDate:'2027-08-01'}));
 const invitation={groupId:'g1',groupName:'Grupo1',toEmail:'s3@example.com',toUid:'',type:'member',senderId:'c',senderName:'Coordenação',status:'pending',createdAt:serverTimestamp()};
 await ok('coordinator sends invitation',set(ref(db('c'),'maximusInic/invitations/i1'),invitation));
 await no('other recipient cannot admit self',set(ref(db('s2'),'maximusInic/admissions/g1/s2'),'i1'));
 await no('unverified email cannot accept invitation',set(ref(db('s3',false),'maximusInic/admissions/g1/s3'),'i1'));
 await ok('verified recipient creates admission',set(ref(db('s3'),'maximusInic/admissions/g1/s3'),'i1'));
 await no('isolated membership grant cannot leave pending invitation',set(ref(db('s3'),'maximusInic/groups/g1/members/s3'),true));
 await no('cannot consume invite without membership',set(ref(db('s3'),'maximusInic/invitations/i1/status'),'accepted'));
 await ok('atomic member acceptance commits access and consumes invitation',update(ref(db('s3'),'maximusInic'),{'groups/g1/members/s3':true,'groups/g1/memberNames/s3':'Aluno 3','userGroups/s3/g1':true,'invitations/i1/status':'accepted'}));
 await no('accepted invitation cannot be reused',set(ref(db('s3'),'maximusInic/admissions/g1/s3'),'i1'));
 await no('admission cannot target another group',set(ref(db('s3'),'maximusInic/admissions/g2/s3'),'i1'));
 await no('student cannot assign self as advisor',set(ref(db('s1'),'maximusInic/groups/g1/advisorId'),'s1'));
 const advisorInvitation={...invitation,toEmail:'',toUid:'a3',type:'advisor'};
 await no('new unindexed coordinator advisor invite is denied',set(ref(db('c'),'maximusInic/invitations/i2'),advisorInvitation));
 await no('coordination cannot silently clear an advisor without audited transition',set(ref(db('c'),'maximusInic/groups/g1/advisorId'),''));
 await env.withSecurityRulesDisabled(context=>set(ref(context.database(),'maximusInic/groups/g1/advisorId'),''));
 await ok('coordinator invites approved advisor with authoritative slot',update(ref(db('c'),'maximusInic'),{'invitations/i2':advisorInvitation,'advisorRequests/g1/a3':'i2','advisorRequestSlots/g1/0':'a3','groups/g1/advisorRequestVersion':1}));
 await ok('advisor accepts own invitation admission',set(ref(db('a3'),'maximusInic/admissions/g1/a3'),'i2'));
 await no('isolated advisor grant cannot leave pending invitation',set(ref(db('a3'),'maximusInic/groups/g1/advisorId'),'a3'));
 await ok('audited advisor acceptance links and consumes invitation',loadService(db('a3'),'a3')('respondInvitation','i2',true));
 await no('old advisor loses group access',get(ref(db('a1'),'maximusInic/groups/g1')));
 await ok('new advisor reads assigned group',get(ref(db('a3'),'maximusInic/groups/g1')));
 const newGroup={...group('Novo grupo','s1',''),proposalRequired:true};
 await ok('student creates own group',set(ref(db('s1'),'maximusInic/groups/newGroup'),newGroup));
 await ok('student creates default schedule milestone',set(ref(db('s1'),'maximusInic/tasks/newGroup/tema'),{...task,createdBy:'s1'}));
 await no('student cannot create arbitrary milestone',set(ref(db('s1'),'maximusInic/tasks/newGroup/random'),{...task,createdBy:'s1'}));
 await no('group cannot be created with foreign member',set(ref(db('s1'),'maximusInic/groups/badGroup'),{...newGroup,members:{s1:true,s2:true},memberNames:{s1:'Aluno1',s2:'Aluno2'}}));
 await no('nonmember cannot read tasks',get(ref(db('s2'),'maximusInic/tasks/newGroup')));
 await no('unverified cannot query email invitations',get(query(ref(db('s3',false),'maximusInic/invitations'),orderByChild('toEmail'),equalTo('s3@example.com'))));
 await no('unverified cannot read known email invitation',get(ref(db('s3',false),'maximusInic/invitations/i1')));
 await no('fractional group year rejected',update(ref(db('c'),'maximusInic/groups/g1'),{year:2027.5}));
 await no('invalid month rejected',update(ref(db('c'),'maximusInic/tasks/g1/t1'),{dueDate:'2027-19-10'}));
 await no('task creation cannot forge author',set(ref(db('a3'),'maximusInic/tasks/g1/badAuthor'),{...task,createdBy:'s1'}));
 await ok('atomic group plus private index creation',update(ref(db('s3'),'maximusInic'),{'groups/atomicGroup':{...group('Atômico','s3',''),proposalRequired:true},'userGroups/s3/atomicGroup':true}));
 await ok('approved teacher can create group assigned to self',update(ref(db('a3'),'maximusInic'),{'groups/teacherGroup':group('Orientado','a3','a3'),'userGroups/a3/teacherGroup':true}));
 const cancelInvite={...invitation,toEmail:'s2@example.com'};
 await ok('new invitation for cancellation test',set(ref(db('c'),'maximusInic/invitations/i3'),cancelInvite));
 await ok('recipient admission before cancellation',set(ref(db('s2'),'maximusInic/admissions/g1/s2'),'i3'));
 await ok('sender cancels pending invitation',set(ref(db('c'),'maximusInic/invitations/i3/status'),'cancelled'));
 await no('cancelled invitation blocks entire atomic acceptance',update(ref(db('s2'),'maximusInic'),{'groups/g1/members/s2':true,'groups/g1/memberNames/s2':'Aluno 2','userGroups/s2/g1':true,'invitations/i3/status':'accepted'}));
 await no('cancelled recipient still has no group access',get(ref(db('s2'),'maximusInic/groups/g1')));
 await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database(),'maximusInic/groups/formerCreator'),{...group('Ex-criador','s2','a3'),createdBy:'s1'}));
 await no('removed former creator cannot bootstrap reserved task',set(ref(db('s1'),'maximusInic/tasks/formerCreator/artigo'),{...task,createdBy:'s1'}));

 const evaluation=(uid,score=8)=>({score,feedback:'Orientação do projeto',updatedBy:uid,updatedAt:serverTimestamp(),evaluatorName:uid==='c'?'Coordenação':`Orientador ${uid.slice(1)}`});
 await ok('assigned advisor gives group grade zero',set(ref(db('a3'),'maximusInic/evaluations/g1/group'),evaluation('a3',0)));
 if((await get(ref(db('s1'),'maximusInic/evaluations/g1/group/score'))).val()!==0)throw new Error('Grade zero not preserved');
 await ok('assigned advisor gives individual decimal grade',set(ref(db('a3'),'maximusInic/evaluations/g1/members/s1'),evaluation('a3',8.75)));
 await ok('assigned advisor gives second member grade',set(ref(db('a3'),'maximusInic/evaluations/g1/members/s3'),evaluation('a3',9)));
 await ok('student reads own individual grade',get(ref(db('s1'),'maximusInic/evaluations/g1/members/s1')));
 await no('student cannot read peer grade',get(ref(db('s1'),'maximusInic/evaluations/g1/members/s3')));
 await no('student cannot read all individual grades',get(ref(db('s1'),'maximusInic/evaluations/g1/members')));
 await no('student cannot read evaluations ancestor',get(ref(db('s1'),'maximusInic/evaluations/g1')));
 await no('outsider cannot read group grade',get(ref(db('s2'),'maximusInic/evaluations/g1/group')));
 await no('student cannot give group grade',set(ref(db('s1'),'maximusInic/evaluations/g1/group'),evaluation('s1')));
 await no('student cannot change own grade',set(ref(db('s1'),'maximusInic/evaluations/g1/members/s1'),evaluation('s1')));
 await no('other advisor cannot grade foreign group',set(ref(db('a2'),'maximusInic/evaluations/g1/group'),evaluation('a2')));
 await ok('coordinator reads all evaluations of any group',get(ref(db('c'),'maximusInic/evaluations/g1')));
 await no('grade cannot exceed ten',set(ref(db('a3'),'maximusInic/evaluations/g1/group'),evaluation('a3',10.1)));
 await no('grade cannot be negative',set(ref(db('a3'),'maximusInic/evaluations/g1/group'),evaluation('a3',-1)));
 await no('grade cannot be string',set(ref(db('a3'),'maximusInic/evaluations/g1/group'),evaluation('a3','8')));
 await no('grade cannot spoof evaluator uid',set(ref(db('a3'),'maximusInic/evaluations/g1/group'),{...evaluation('a3'),updatedBy:'c'}));
 await no('grade cannot spoof evaluator name',set(ref(db('a3'),'maximusInic/evaluations/g1/group'),{...evaluation('a3'),evaluatorName:'Coordenação'}));
 await no('grade cannot spoof timestamp',set(ref(db('a3'),'maximusInic/evaluations/g1/group'),{...evaluation('a3'),updatedAt:1}));
 await no('grade cannot contain unknown fields',set(ref(db('a3'),'maximusInic/evaluations/g1/group'),{...evaluation('a3'),privateNotes:'forbidden'}));
 await no('grade feedback limit enforced',set(ref(db('a3'),'maximusInic/evaluations/g1/group'),{...evaluation('a3'),feedback:'x'.repeat(3001)}));
 await no('partial grade update cannot omit audit timestamp',set(ref(db('a3'),'maximusInic/evaluations/g1/group/score'),7));
 await no('grade required field cannot be deleted',set(ref(db('a3'),'maximusInic/evaluations/g1/group/score'),null));
 await no('advisor cannot grade nonmember',set(ref(db('a3'),'maximusInic/evaluations/g1/members/s2'),evaluation('a3')));
 await ok('advisor renames only local group member alias',set(ref(db('a3'),'maximusInic/groups/g1/memberNames/s1'),'Nome no grupo'));
 if((await get(ref(db('c'),'maximusInic/users/s1/name'))).val()!=='Aluno 1')throw new Error('Global profile changed');
 await no('other advisor cannot rename foreign member',set(ref(db('a2'),'maximusInic/groups/g1/memberNames/s1'),'Nome externo'));
 await no('creator cannot lock group for deletion',set(ref(db('s1'),'maximusInic/groups/g1/status'),'deleting'));
 await no('student cannot delete own group',set(ref(db('s1'),'maximusInic/groups/g1'),null));
 await no('other advisor cannot delete foreign group',set(ref(db('a2'),'maximusInic/groups/g1'),null));
 await no('advisor cannot bypass deletion cascade lock',set(ref(db('a3'),'maximusInic/groups/g1'),null));
 const staleInvite={...invitation,toEmail:'s1@example.com'};
 await ok('member receives pending invite before removal',set(ref(db('c'),'maximusInic/invitations/staleMember'),staleInvite));
 await ok('member admission can exist before removal',set(ref(db('s1'),'maximusInic/admissions/g1/s1'),'staleMember'));
 await no('raw member removal cannot skip grades indices and revocation',set(ref(db('a3'),'maximusInic/groups/g1/members/s1'),null));
 await no('coordinator cannot bypass member cleanup with parent set',set(ref(db('c'),'maximusInic/groups/g1'),{...group('Forged','s3','a3')}));
 await ok('advisor removes creator with evaluation atomically',update(ref(db('a3'),'maximusInic'),{'groups/g1/members/s1':null,'groups/g1/memberNames/s1':null,'userGroups/s1/g1':null,'evaluations/g1/members/s1':null,'admissions/g1/s1':null,'memberRevocations/g1/s1':serverTimestamp()}));
 await no('removed creator loses group grade access',get(ref(db('s1'),'maximusInic/evaluations/g1/group')));
 await no('removed creator loses own grade access',get(ref(db('s1'),'maximusInic/evaluations/g1/members/s1')));
 await no('old pending email invite cannot recreate admission after removal',set(ref(db('s1'),'maximusInic/admissions/g1/s1'),'staleMember'));
 await no('future invitation timestamp cannot bypass revocation',set(ref(db('c'),'maximusInic/invitations/futureForged'),{...staleInvite,createdAt:Date.now()+60000}));
 await ok('new invitation after removal is allowed',set(ref(db('c'),'maximusInic/invitations/newMember'),staleInvite));
 await ok('new invitation after removal creates fresh admission',set(ref(db('s1'),'maximusInic/admissions/g1/s1'),'newMember'));
 await ok('new invitation after removal allows fresh membership',update(ref(db('s1'),'maximusInic'),{'groups/g1/members/s1':true,'groups/g1/memberNames/s1':'Aluno 1','userGroups/s1/g1':true,'invitations/newMember/status':'accepted'}));
 if((await get(ref(db('s1'),'maximusInic/evaluations/g1/members/s1'))).exists())throw new Error('Removed grade reappeared on reentry');
 await ok('creator can be removed again after fresh admission',update(ref(db('a3'),'maximusInic'),{'groups/g1/members/s1':null,'groups/g1/memberNames/s1':null,'userGroups/s1/g1':null,'evaluations/g1/members/s1':null,'admissions/g1/s1':null,'memberRevocations/g1/s1':serverTimestamp()}));
 await ok('advisor removes last member without deleting group',update(ref(db('a3'),'maximusInic'),{'groups/g1/members/s3':null,'groups/g1/memberNames/s3':null,'userGroups/s3/g1':null,'evaluations/g1/members/s3':null,'admissions/g1/s3':null,'memberRevocations/g1/s3':serverTimestamp()}));
 if((await get(ref(db('a3'),'maximusInic/groups/g1/advisorId'))).val()!=='a3')throw new Error('Advisor link removed with membership');
 await ok('advisor locks group for deletion',set(ref(db('a3'),'maximusInic/groups/g1/status'),'deleting'));
 await no('deletion lock cannot be reverted by advisor',set(ref(db('a3'),'maximusInic/groups/g1/status'),'active'));
 await no('deletion lock cannot be reverted by coordinator',set(ref(db('c'),'maximusInic/groups/g1/status'),'active'));
 await no('metadata frozen during deletion',set(ref(db('a3'),'maximusInic/groups/g1/topic'),'Edited while deleting'));
 await no('group grade frozen during deletion',set(ref(db('a3'),'maximusInic/evaluations/g1/group'),evaluation('a3')));
 await no('task completion frozen during deletion',update(ref(db('a3'),'maximusInic/tasks/g1/t1'),{completed:false,completedBy:''}));
 await no('new task frozen during deletion',set(ref(db('a3'),'maximusInic/tasks/g1/newTask'),{...task,createdBy:'a3'}));
 await no('new message frozen during deletion',set(ref(db('a3'),'maximusInic/messages/g1/newMessage'),{text:'Frozen',senderId:'a3',senderName:'Orientador 3',createdAt:stamp}));
 await no('new invitation frozen during deletion',set(ref(db('a3'),'maximusInic/invitations/frozen'),{...invitation,senderId:'a3'}));
 await no('membership frozen during deletion',set(ref(db('a3'),'maximusInic/groups/g1/members/s1'),true));
 await no('advisor link frozen during deletion',set(ref(db('c'),'maximusInic/groups/g1/advisorId'),'c'));
 await no('cascade resource cannot be deleted alone',set(ref(db('a3'),'maximusInic/messages/g1'),null));
 await ok('advisor queries all group invitations for cleanup',get(query(ref(db('a3'),'maximusInic/invitations'),orderByChild('groupId'),equalTo('g1'))));
 await no('advisor cannot query foreign group invitations',get(query(ref(db('a3'),'maximusInic/invitations'),orderByChild('groupId'),equalTo('g2'))));
 const invitationsToDelete=(await get(query(ref(db('a3'),'maximusInic/invitations'),orderByChild('groupId'),equalTo('g1')))).val()||{};
 const cascade={'groups/g1':null,'tasks/g1':null,'messages/g1':null,'evaluations/g1':null,'admissions/g1':null,'memberRevocations/g1':null,'advisorRequests/g1':null,'advisorRequestSlots/g1':null,'advisorConfirmations/g1':null,'orientationTransitions/g1':null,'userGroups/s1/g1':null,'userGroups/a3/g1':null};
 for(const id of Object.keys(invitationsToDelete))cascade[`invitations/${id}`]=null;
 await ok('advisor atomically deletes locked group and all resources',update(ref(db('a3'),'maximusInic'),cascade));
 await env.withSecurityRulesDisabled(async context=>{for(const resource of ['groups','tasks','messages','events','evaluations','admissions','memberRevocations'])if((await get(ref(context.database(),`maximusInic/${resource}/g1`))).exists())throw new Error(`Cascade left ${resource}`);});
 for(const id of Object.keys(invitationsToDelete))if((await get(ref(db('c'),`maximusInic/invitations/${id}`))).exists())throw new Error('Cascade left invitation');
 await no('coordinator cannot silently overwrite an advisor without audited transition',set(ref(db('c'),'maximusInic/groups/teacherGroup/advisorId'),'a2'));
 await env.withSecurityRulesDisabled(context=>set(ref(context.database(),'maximusInic/groups/teacherGroup/advisorId'),'a2'));
 await no('former advisor creator cannot edit metadata after replacement',set(ref(db('a3'),'maximusInic/groups/teacherGroup/topic'),'Former advisor edit'));
 await no('former advisor cannot read deleted group',get(ref(db('a3'),'maximusInic/groups/g1')));
 await ok('foreign group remains intact after deletion',get(ref(db('a2'),'maximusInic/groups/g2')));
 if((await get(ref(db('c'),'maximusInic/users/s1/name'))).val()!=='Aluno 1')throw new Error('Delete changed global profile');

 await env.withSecurityRulesDisabled(async context=>{
  const root=ref(context.database(),'maximusInic');
  await update(root,{
   'groups/serviceGroup':{...group('Serviço real','s2','a2'),createdBy:'s1',members:{s2:true,s3:true},memberNames:{s2:'Aluno 2',s3:'Aluno 3'}},
   'userGroups/s1/serviceGroup':true,'userGroups/s2/serviceGroup':true,'userGroups/s3/serviceGroup':true,'userGroups/a2/serviceGroup':true,
   'tasks/serviceGroup/t1':{...task,createdBy:'a2'},
   'events/serviceGroup/review':{title:'Reunião de orientação',date:'2027-06-15',description:'Conferir artigo',createdBy:'a2',createdAt:stamp,updatedAt:stamp},
   'messages/serviceGroup/m1':{text:'Conversa do grupo',senderId:'s2',senderName:'Aluno 2',createdAt:stamp},
   'admissions/serviceGroup/s2':'serviceInvite1','admissions/serviceGroup/outside':'serviceInvite2',
   'invitations/serviceInvite1':{...invitation,createdAt:stamp,groupId:'serviceGroup',groupName:'Serviço real',senderId:'s2',toEmail:'s3@example.com'},
   'invitations/serviceInvite2':{...invitation,createdAt:stamp,groupId:'serviceGroup',groupName:'Serviço real',senderId:'c',toEmail:'outside@example.com'}
  });
 });
 let failCascadeOnce=true;
 const staffService=loadService(db('a2'),'a2',{beforeUpdate:(target,changes)=>{if(failCascadeOnce&&changes['groups/serviceGroup']===null){failCascadeOnce=false;throw new Error('simulated connection interruption');}}});
 await ok('actual service edits group metadata as assigned advisor',staffService('updateGroup','serviceGroup',{topic:'Pesquisa revisada pelo professor'}));
 await ok('actual service renames local member alias',staffService('updateMember','serviceGroup','s2',{name:'Nome usado no grupo'}));
 await ok('actual service saves group grade zero with server audit',staffService('saveEvaluation','serviceGroup',{score:0,feedback:'Ponto de partida'}));
 await ok('actual service saves individual decimal grade',staffService('saveMemberEvaluation','serviceGroup','s2',{score:7.25,feedback:'Melhorar referências'}));
 await ok('actual service saves second individual grade',staffService('saveMemberEvaluation','serviceGroup','s3',{score:9.5,feedback:'Boa pesquisa'}));
 for(const score of [-1,11,NaN,Infinity,'7']){let rejected=false;try{await staffService('saveEvaluation','serviceGroup',{score});}catch{rejected=true;}if(!rejected)throw new Error('Service accepted invalid grade');}
 passed++;console.log('PASS actual service rejects invalid nonfinite and out of range grades');
 const watches=[];const studentService=loadService(db('s3'),'s3',{onWatch:path=>watches.push(path)});
 let stopStudent=()=>{};
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{stopStudent();reject(new Error('Student grade subscription timed out'));},5000);
  stopStudent=studentService('subscribeGroup','serviceGroup',state=>{
   if(state.groupEvaluation?.score===0&&state.memberEvaluations.some(e=>e.id==='s3')){
    if(state.memberEvaluations.some(e=>e.id!=='s3')){clearTimeout(timeout);reject(new Error('Peer grade exposed by service'));return;}
    clearTimeout(timeout);resolve();
   }
  });
 });
 stopStudent();
 if(watches.some(path=>/evaluations\/serviceGroup\/members$/.test(path)))throw new Error('Student subscribed to all member grades');
 passed++;console.log('PASS actual student service subscribes only group and own grade');
 await ok('actual service removes member plus grade index admission and revocation atomically',staffService('removeMember','serviceGroup','s2'));
 await env.withSecurityRulesDisabled(async context=>{
  for(const path of ['groups/serviceGroup/members/s2','groups/serviceGroup/memberNames/s2','userGroups/s2/serviceGroup','evaluations/serviceGroup/members/s2','admissions/serviceGroup/s2'])if((await get(ref(context.database(),'maximusInic/'+path))).exists())throw new Error('Member cleanup left '+path);
  if(typeof (await get(ref(context.database(),'maximusInic/memberRevocations/serviceGroup/s2'))).val()!=='number')throw new Error('Revocation missing or not numeric');
 });
 let deletionInterrupted=false;try{await staffService('deleteGroup','serviceGroup');}catch(error){deletionInterrupted=error.message==='simulated connection interruption';}
 if(!deletionInterrupted)throw new Error('Expected simulated deletion interruption');
 if((await get(ref(db('a2'),'maximusInic/groups/serviceGroup/status'))).val()!=='deleting')throw new Error('Deletion lock lost after interruption');
 passed++;console.log('PASS actual service leaves recoverable lock after interrupted deletion');
 await ok('actual service retries and completes full deletion payload',staffService('deleteGroup','serviceGroup'));
 await env.withSecurityRulesDisabled(async context=>{
  for(const resource of ['groups','tasks','messages','events','evaluations','admissions','memberRevocations'])if((await get(ref(context.database(),`maximusInic/${resource}/serviceGroup`))).exists())throw new Error('Service cascade left '+resource);
  for(const uid of ['s1','s2','s3','a2'])if((await get(ref(context.database(),`maximusInic/userGroups/${uid}/serviceGroup`))).exists())throw new Error('Service cascade left index '+uid);
  for(const id of ['serviceInvite1','serviceInvite2'])if((await get(ref(context.database(),`maximusInic/invitations/${id}`))).exists())throw new Error('Service cascade left invitation '+id);
  if((await get(ref(context.database(),'maximusInic/users/s2/name'))).val()!=='Aluno 2')throw new Error('Service changed global profile');
  if((await get(ref(context.database(),'items/preserved'))).val()!=='existing')throw new Error('Legacy items modified');
 });
 passed++;console.log('PASS actual cascade removes resources from other senders and nonmember admissions without touching profiles or legacy data');
 await runOnboardingContractEventTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 await runMandatoryTermProposalTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 await runMemberProposalTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 await runAgreementReviewTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 await runAgreementSignatureTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 await runUserManagementTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 await runOrientationTransitionTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 await runAutomaticOrientationTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 await runInicResultsTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 await runInicResultsRuntimeTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 await runProposalTests({env,db,ok,no,count:name=>{passed++;console.log('PASS',name);}});
 console.log(`SECURITY TESTS PASSED: ${passed}`);
}finally{await env.cleanup();}
