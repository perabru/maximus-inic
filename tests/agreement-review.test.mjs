import assert from 'node:assert/strict';
import {ref,get,set,update,onValue,serverTimestamp} from 'firebase/database';
import {loadService} from './service-runtime.mjs';

// Authenticated demo emulator only: no production documents, reviews or users.
export async function runAgreementReviewTests({env,db,ok,no,count}) {
 const root='maximusInic',year=2027,stamp=Date.now();
 const ids={student:'reviewstudent',other:'reviewother',teacher:'reviewteacher',pending:'reviewpending',coordinator:'reviewcoord',worker:'reviewworker',legacy:'reviewlegacy',missing:'reviewmissing',race:'reviewrace',concurrent:'reviewconcurrent',coordinator2:'reviewcoordtwo',orphan:'revieworphan',mismatch:'reviewmismatch'};
 const pdf=Buffer.from('%PDF-1.7\nSynthetic review fixture\n%%EOF');
 const file=(label='Termo.pdf')=>({name:label,type:'application/pdf',size:pdf.length,arrayBuffer:async()=>pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength)});
 const person=uid=>({name:uid,email:`${uid}@example.com`,requestedRole:'student',year:'3º ano',createdAt:stamp});
 const changes={};
 for(const uid of Object.values(ids))changes[`users/${uid}`]=person(uid);
 changes[`roles/${ids.coordinator}`]='coordinator';changes[`roles/${ids.coordinator2}`]='coordinator';changes[`roles/${ids.teacher}`]='advisor';
 changes[`advisorDirectory/${ids.coordinator}`]={uid:ids.coordinator,name:ids.coordinator};
 changes[`users/${ids.pending}`].requestedRole='advisor';changes[`notificationWorkers/${ids.worker}`]=true;
 changes[`groups/reviewowned`]={name:'Grupo de revisão',topic:'Tema de pesquisa',description:'',year,advisorId:ids.teacher,members:{[ids.student]:true},memberNames:{[ids.student]:ids.student},createdBy:ids.student,createdAt:stamp,status:'active'};
 changes[`userGroups/${ids.student}/reviewowned`]=true;
 const legacyMeta={uid:ids.legacy,year,filename:'Legado.pdf',ownerName:ids.legacy,size:pdf.length,contentType:'application/pdf',uploadedAt:stamp-1000};
 changes[`agreements/${year}/${ids.legacy}`]=legacyMeta;
 changes[`agreementFiles/${year}/${ids.legacy}`]={base64:pdf.toString('base64'),size:pdf.length,contentType:'application/pdf',uploadedAt:stamp-1000};
 for(const uid of [ids.orphan,ids.mismatch])changes[`agreements/${year}/${uid}`]={...legacyMeta,uid,ownerName:uid};
 changes[`agreementFiles/${year}/${ids.mismatch}`]={base64:pdf.toString('base64'),size:pdf.length,contentType:'application/pdf',uploadedAt:stamp-2000};
 await env.withSecurityRulesDisabled(context=>update(ref(context.database(),root),changes));
 const admin=async operation=>env.withSecurityRulesDisabled(async context=>operation(context.database()));
 const value=async path=>{let result;await admin(async database=>{result=(await get(ref(database,`${root}/${path}`))).val();});return result;};
 const check=(name,condition)=>{assert.ok(condition,name);count(`agreement review: ${name}`);};
 const rejects=async(name,operation)=>{let rejected=false;try{await operation();}catch{rejected=true;}check(name,rejected);};
 const meta=uid=>value(`agreements/${year}/${uid}`);
 const reviewPath=uid=>`agreementReviews/${year}/${uid}`;
 const revisions=new Map();const revisionKey=metadata=>`${metadata.uid}/${metadata.uploadVersion||''}/${metadata.uploadedAt}`;
 const request=(metadata,status='approved',reason='')=>({year,status,reason,expectedUploadVersion:metadata.uploadVersion||'',expectedUploadedAt:metadata.uploadedAt,expectedReviewedAt:revisions.get(revisionKey(metadata))||0});
 const record=(metadata,status='approved',reason='')=>({status,reason,reviewerUid:ids.coordinator,reviewerName:ids.coordinator,reviewedAt:serverTimestamp(),uploadVersion:metadata.uploadVersion||'',uploadedAt:metadata.uploadedAt,previousReviewedAt:revisions.get(revisionKey(metadata))||0});
 const waitState=(service,predicate)=>new Promise((resolve,reject)=>{
  let stop=()=>{},finished=false;
  const timer=setTimeout(()=>{stop();reject(new Error('Agreement review subscription timed out'));},7000);
  stop=service('subscribeAgreements',year,state=>{if(finished)return;if(state.error){finished=true;clearTimeout(timer);stop();reject(state.error);return;}if(predicate(state)){finished=true;clearTimeout(timer);stop();resolve(state);}});
 });
 const student=loadService(db(ids.student),ids.student),coordinator=loadService(db(ids.coordinator),ids.coordinator);
 await ok('agreement review: student uploads a versioned PDF',student('uploadAgreement',file(),{year}));
 let first=await meta(ids.student);
 const firstBytes=await value(`agreementFiles/${year}/${ids.student}`);
 check('new upload has a nonempty version paired in metadata and file',typeof first.uploadVersion==='string'&&first.uploadVersion.length>0&&firstBytes.uploadVersion===first.uploadVersion);
 const pending=await waitState(student,state=>state.reviewReady===true&&state.agreements.some(item=>item.id===ids.student));
 const pendingRecord=pending.agreements.find(item=>item.id===ids.student);
 check('uploaded but unreviewed term is pending with a ready review baseline',pendingRecord.review===null&&pending.requirement.fulfilled===true);
 await ok('agreement review: coordinator confirms the exact uploaded term',coordinator('reviewAgreement',ids.student,request(first)));
 const approved=await value(reviewPath(ids.student));revisions.set(revisionKey(first),approved.reviewedAt);
 check('approval stores coordinator identity exact upload version and server audit',approved.status==='approved'&&approved.reason===''&&approved.reviewerUid===ids.coordinator&&approved.reviewerName===ids.coordinator&&approved.uploadVersion===first.uploadVersion&&approved.uploadedAt===first.uploadedAt&&typeof approved.reviewedAt==='number'&&approved.reviewedAt>=stamp);
 const approvedState=await waitState(student,state=>state.reviewReady===true&&state.agreements.some(item=>item.id===ids.student&&item.review?.status==='approved'));
 check('student receives approved review on its own live metadata record',approvedState.agreements.find(item=>item.id===ids.student).review.reviewerName===ids.coordinator);
 await ok('agreement review: coordination lists review metadata',get(ref(db(ids.coordinator),`${root}/agreementReviews/${year}`)));
 await ok('agreement review: listed coordinator still reads every group',get(ref(db(ids.coordinator),`${root}/groups`)));
 check('coordinator listed as advisor preserves coordination role',(await value(`roles/${ids.coordinator}`))==='coordinator'&&(await value(`advisorDirectory/${ids.coordinator}`)).uid===ids.coordinator);
 await ok('agreement review: owner reads own approval',get(ref(db(ids.student),`${root}/${reviewPath(ids.student)}`)));
 for(const [name,database,path] of [
  ['another student cannot read a review',db(ids.other),reviewPath(ids.student)],
  ['assigned teacher cannot read student review',db(ids.teacher),reviewPath(ids.student)],
  ['pending teacher cannot read student review',db(ids.pending),reviewPath(ids.student)],
  ['notification worker cannot read review',db(ids.worker),reviewPath(ids.student)],
  ['student cannot list reviews for all classmates',db(ids.student),`agreementReviews/${year}`],
  ['anonymous cannot read signed-term review',env.unauthenticatedContext().database(),reviewPath(ids.student)]
 ])await no(`agreement review: ${name}`,get(ref(database,`${root}/${path}`)));
 for(const [name,uid] of [['student',ids.student],['other student',ids.other],['assigned teacher',ids.teacher],['pending teacher',ids.pending],['worker',ids.worker]]){
  await no(`agreement review: ${name} cannot write an approval`,set(ref(db(uid),`${root}/${reviewPath(ids.student)}`),record(first)));
 }
 await no('agreement review: student cannot remove coordinator decision directly',set(ref(db(ids.student),`${root}/${reviewPath(ids.student)}`),null));
 await no('agreement review: student cannot alter only return explanation',set(ref(db(ids.student),`${root}/${reviewPath(ids.student)}/reason`),'Tudo certo'));
 await rejects('service denies professor reviewing a student',()=>loadService(db(ids.teacher),ids.teacher)('reviewAgreement',ids.student,request(first)));
 await rejects('service denies pending teacher reviewing a student',()=>loadService(db(ids.pending),ids.pending)('reviewAgreement',ids.student,request(first)));
 await rejects('service denies student self approval',()=>student('reviewAgreement',ids.student,request(first)));
 await rejects('return requires a meaningful nonempty explanation',()=>coordinator('reviewAgreement',ids.student,request(first,'returned','  ')));
 await rejects('return explanation cannot exceed two thousand characters',()=>coordinator('reviewAgreement',ids.student,request(first,'returned','x'.repeat(2001))));
 await rejects('unknown review status cannot be saved',()=>coordinator('reviewAgreement',ids.student,request(first,'pending','')));
 await rejects('unsupported edition cannot be reviewed',()=>coordinator('reviewAgreement',ids.student,{...request(first),year:2026}));
 await no('agreement review: server rejects missing return explanation',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.student)}`),record(first,'returned','')));
 for(const [label,reason] of [['spaces','   '],['tabs and newlines','\t \n'],['control whitespace','\r\n\t']])await no(`agreement review: server rejects return reason containing only ${label}`,set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.student)}`),record(first,'returned',reason)));
 await no('agreement review: server rejects oversized return explanation',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.student)}`),record(first,'returned','x'.repeat(2001))));
 await no('agreement review: server rejects spoofed reviewer UID',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.student)}`),{...record(first),reviewerUid:ids.teacher}));
 await no('agreement review: server rejects spoofed reviewer display name',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.student)}`),{...record(first),reviewerName:'Outra pessoa'}));
 await no('agreement review: server rejects unknown review fields',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.student)}`),{...record(first),publicUrl:'https://example.com/document'}));
 await no('agreement review: server rejects missing review audit timestamp',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.student)}`),{...record(first),reviewedAt:null}));
 await no('agreement review: server rejects approval for missing signed term',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.missing)}`),record({...first,uid:ids.missing})));
 await rejects('service refuses review when no signed term was uploaded',()=>coordinator('reviewAgreement',ids.missing,request(first)));
 for(const uid of [ids.orphan,ids.mismatch]){
  const broken=await meta(uid);
  await no(`agreement review: server rejects approval of incomplete file pair ${uid}`,set(ref(db(ids.coordinator),`${root}/${reviewPath(uid)}`),record(broken)));
  await rejects(`service rejects approval of incomplete file pair ${uid}`,()=>coordinator('reviewAgreement',uid,request(broken)));
 }
 await ok('agreement review: coordinator returns file with exact pending correction',coordinator('reviewAgreement',ids.student,request(first,'returned','Falta assinatura.\nEnvie novamente.')));
 const returned=await waitState(student,state=>state.reviewReady===true&&state.agreements.some(item=>item.id===ids.student&&item.review?.status==='returned'));
 revisions.set(revisionKey(first),returned.agreements[0].review.reviewedAt);
 check('student receives literal correction reason and original upload identity',returned.agreements[0].review.reason==='Falta assinatura.\nEnvie novamente.'&&returned.agreements[0].review.uploadedAt===first.uploadedAt);
 check('review decision does not add an unrequested academic approval gate',returned.requirement.fulfilled===true);
 await ok('agreement review: returned student may continue existing academic work',student('createGroup',{name:'Continuidade após devolução',topic:'Pesquisa de TCC'}));
 await ok('agreement review: corrected reupload succeeds after return',student('uploadAgreement',file('Corrigido.pdf'),{year}));
 const second=await meta(ids.student);
 check('resubmission gets a fresh upload version and timestamp',second.uploadVersion!==first.uploadVersion&&second.uploadedAt>first.uploadedAt);
 check('resubmission retains earlier return only as version-bound audit',(await value(reviewPath(ids.student))).uploadVersion===first.uploadVersion&&(await value(reviewPath(ids.student))).status==='returned');
 const resubmitted=await waitState(student,state=>state.reviewReady===true&&state.agreements.some(item=>item.uploadVersion===second.uploadVersion));
 check('student sees pending after corrected submission instead of stale return',resubmitted.agreements[0].review===null);
 await rejects('service rejects a coordinator form bound to old upload version',()=>coordinator('reviewAgreement',ids.student,request(first)));
 await no('agreement review: raw stale approval cannot target replacement file',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.student)}`),record(first)));
 await no('agreement review: current timestamp cannot rescue stale upload version',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.student)}`),record({...second,uploadVersion:first.uploadVersion})));
 await no('agreement review: current version cannot rescue stale upload timestamp',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.student)}`),record({...second,uploadedAt:first.uploadedAt})));
 await ok('agreement review: coordinator confirms corrected current upload',coordinator('reviewAgreement',ids.student,request(second)));
 await ok('agreement review: another upload invalidates an earlier approval',student('uploadAgreement',file('Mais recente.pdf'),{year}));
 const third=await meta(ids.student);
 const thirdState=await waitState(student,state=>state.reviewReady===true&&state.agreements.some(item=>item.uploadVersion===third.uploadVersion));
 check('newer upload cannot display previous approval even when PDF bytes are identical',third.uploadVersion!==second.uploadVersion&&thirdState.agreements[0].review===null&&(await value(reviewPath(ids.student))).uploadVersion===second.uploadVersion);
 await no('agreement review: reused upload version cannot preserve approval identity',update(ref(db(ids.student),root),{
  [`agreements/${year}/${ids.student}`]:{...third,filename:'Reuso.pdf',uploadedAt:serverTimestamp()},
  [`agreementFiles/${year}/${ids.student}`]:{...await value(`agreementFiles/${year}/${ids.student}`),uploadedAt:serverTimestamp()}
 }));
 await no('agreement review: metadata upload version cannot change alone',set(ref(db(ids.student),`${root}/agreements/${year}/${ids.student}/uploadVersion`),'different-version'));
 await no('agreement review: file upload version cannot change alone',set(ref(db(ids.student),`${root}/agreementFiles/${year}/${ids.student}/uploadVersion`),'different-version'));

 const legacy=loadService(db(ids.legacy),ids.legacy);
 const legacyState=await waitState(legacy,state=>state.reviewReady===true&&state.agreements.some(item=>item.id===ids.legacy));
 check('existing legacy file without upload token remains available and pending',legacyState.agreements[0].review===null&&legacyState.requirement.fulfilled===true&&!legacyState.agreements[0].uploadVersion);
 await ok('agreement review: coordinator can approve legacy upload by original timestamp',coordinator('reviewAgreement',ids.legacy,request(legacyMeta)));
 check('legacy approval is bound to empty legacy version and existing timestamp',(await value(reviewPath(ids.legacy))).uploadVersion===''&&(await value(reviewPath(ids.legacy))).uploadedAt===legacyMeta.uploadedAt);
 await ok('agreement review: legacy student can replace reviewed file with versioned upload',legacy('uploadAgreement',file('Legado corrigido.pdf'),{year}));
 const upgradedLegacy=await waitState(legacy,state=>state.reviewReady===true&&state.agreements.some(item=>typeof item.uploadVersion==='string'));
 check('upgrading legacy upload invalidates its previous review and creates unique token',upgradedLegacy.agreements[0].review===null&&typeof(await meta(ids.legacy)).uploadVersion==='string'&&(await value(reviewPath(ids.legacy))).uploadVersion==='');
 await no('agreement review: stale legacy approval cannot apply to versioned replacement',set(ref(db(ids.coordinator),`${root}/${reviewPath(ids.legacy)}`),record(legacyMeta)));

 const race=loadService(db(ids.race),ids.race);
 await ok('agreement review: race fixture uploads initial file',race('uploadAgreement',file('Antes.pdf'),{year}));
 const raceOld=await meta(ids.race);
 let reached,release;const atWrite=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const delayedCoordinator=loadService(db(ids.coordinator),ids.coordinator,{beforeUpdate:async(_target,patch)=>{if(Object.keys(patch).some(key=>key===reviewPath(ids.race))){reached();await gate;}}});
 const delayedDecision=delayedCoordinator('reviewAgreement',ids.race,request(raceOld)).then(()=>({ok:true}),error=>({ok:false,error}));
 await Promise.race([atWrite,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Review write barrier timed out')),7000);timer.unref();})]);
 await ok('agreement review: student replaces file while coordinator decision is in flight',race('uploadAgreement',file('Depois.pdf'),{year}));
 release();const raced=await delayedDecision;
 check('server rejects stale decision that passed preflight before a concurrent reupload',raced.ok===false&&(await value(reviewPath(ids.race)))===null);
 await rejects('old UI cannot review race replacement with expired expected identity',()=>coordinator('reviewAgreement',ids.race,request(raceOld)));

 const concurrentStudent=loadService(db(ids.concurrent),ids.concurrent);
 await ok('agreement review: concurrent fixture uploads a versioned term',concurrentStudent('uploadAgreement',file('Concorrente.pdf'),{year}));
 const concurrentMeta=await meta(ids.concurrent);let reachedBoth,releaseBoth,reachedCount=0;
 const bothAtWrite=new Promise(resolve=>{reachedBoth=resolve;}),bothGate=new Promise(resolve=>{releaseBoth=resolve;});
 const coordinatorClient=uid=>loadService(db(uid),uid,{beforeUpdate:async(_target,patch)=>{if(Object.keys(patch).includes(reviewPath(ids.concurrent))){if(++reachedCount===2)reachedBoth();await bothGate;}}});
 const one=coordinatorClient(ids.coordinator)('reviewAgreement',ids.concurrent,request(concurrentMeta)).then(()=>true,()=>false);
 const two=coordinatorClient(ids.coordinator2)('reviewAgreement',ids.concurrent,request(concurrentMeta,'returned','Corrigir a assinatura indicada.')).then(()=>true,()=>false);
 await Promise.race([bothAtWrite,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Concurrent review barriers timed out')),7000);timer.unref();})]);releaseBoth();const outcomes=await Promise.all([one,two]);
 const winner=await value(reviewPath(ids.concurrent));
 check('two coordinators reviewing the same prior revision cannot silently overwrite each other',outcomes.filter(Boolean).length===1&&winner.previousReviewedAt===0&&[ids.coordinator,ids.coordinator2].includes(winner.reviewerUid));
 await rejects('a stale coordinator form cannot overwrite the winning decision',()=>coordinator('reviewAgreement',ids.concurrent,request(concurrentMeta)));
 revisions.set(revisionKey(concurrentMeta),winner.reviewedAt);
 await ok('agreement review: refreshed coordinator may explicitly change current decision',coordinator('reviewAgreement',ids.concurrent,request(concurrentMeta,'returned','Envie todas as páginas assinadas.')));
 const changed=await value(reviewPath(ids.concurrent));
 check('changed decision records the predecessor revision and a newer server audit timestamp',changed.previousReviewedAt===winner.reviewedAt&&changed.reviewedAt>winner.reviewedAt&&changed.status==='returned');

 // An old retained decision injected by a privileged migration must not appear
 // as current approval for a different file version.
 await admin(database=>set(ref(database,`${root}/${reviewPath(ids.student)}`),{...approved,reviewedAt:Date.now()}));
 const stale=await waitState(student,state=>state.reviewReady===true&&state.agreements.some(item=>item.uploadVersion===third.uploadVersion));
 check('subscription ignores stale privileged review record for a different file version',stale.agreements[0].review===null);
 const coordinatorState=await waitState(coordinator,state=>state.reviewReady===true&&state.agreements.some(item=>item.id===ids.student));
 check('coordination also sees only effective review for the currently uploaded file',coordinatorState.agreements.find(item=>item.id===ids.student).review===null);
 await no('agreement review: role-request field cannot grant review permissions',set(ref(db(ids.pending),`${root}/${reviewPath(ids.student)}`),record(third)));
 await no('agreement review: worker cannot grant itself reviewer coordinator role',set(ref(db(ids.worker),`${root}/roles/${ids.worker}`),'coordinator'));
}
