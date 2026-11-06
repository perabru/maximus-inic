import assert from 'node:assert/strict';
import {ref,get,update} from 'firebase/database';
import {loadService} from './service-runtime.mjs';

// Actual browser service, synthetic identities, guarded local emulator only.
export async function runProposalRuntimeTests({env,db,ok,no,count}) {
 const root='maximusInic',stamp=Date.now(),ids={coord:'ptxcoord',student:'ptxstudent',teacher:'ptxteacher',other:'ptxother',outsider:'ptxoutsider'};
 const pdf=Buffer.from('%PDF-1.7\nSynthetic private TCC proposal\n%%EOF');
 const inputFile={name:'Proposta TCC.pdf',type:'application/pdf',size:pdf.length,arrayBuffer:async()=>pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength)};
 const text={mode:'text',topics:{problem:'Problema sintético do TCC',objective:'Objetivo do grupo',method:'',expectedResult:''}};
 const changes={};
 for(const uid of Object.values(ids))changes[`users/${uid}`]={name:uid,email:`${uid}@example.com`,requestedRole:[ids.coord,ids.teacher,ids.other].includes(uid)?'advisor':'student',year:'3º ano',createdAt:stamp};
 changes[`roles/${ids.coord}`]='coordinator';
 for(const uid of [ids.teacher,ids.other]){changes[`roles/${uid}`]='advisor';changes[`advisorDirectory/${uid}`]={uid,name:uid};}
 for(const uid of [ids.student,ids.outsider]){
  changes[`agreements/2027/${uid}`]={uid,year:2027,filename:'Termo.pdf',ownerName:uid,size:pdf.length,contentType:'application/pdf',uploadedAt:stamp};
  changes[`agreementFiles/2027/${uid}`]={base64:pdf.toString('base64'),size:pdf.length,contentType:'application/pdf',uploadedAt:stamp};
 }
 await env.withSecurityRulesDisabled(context=>update(ref(context.database(),root),changes));
 const admin=operation=>env.withSecurityRulesDisabled(context=>operation(context.database()));
 const value=async path=>{let result;await admin(async database=>{result=(await get(ref(database,`${root}/${path}`))).val();});return result;};
 const check=(name,condition)=>{assert.ok(condition,name);count(`proposal runtime: ${name}`);};
 const rejects=async(name,operation)=>{let rejected=false;try{await operation();}catch{rejected=true;}check(name,rejected);};
 const student=loadService(db(ids.student),ids.student),teacher=loadService(db(ids.teacher),ids.teacher),other=loadService(db(ids.other),ids.other),outsider=loadService(db(ids.outsider),ids.outsider);
 const textId=await student('createGroup',{name:'PTX proposta por tópicos',topic:'Pesquisa sintética',year:2027,advisorIds:[ids.teacher,ids.other],proposal:text});
 const textGroup=await value(`groups/${textId}`),textInvites=Object.entries(await value('invitations')||{}).filter(([,item])=>item.groupId===textId);
 check('createGroup commits named text proposal schedule and both invitations together',textGroup.proposalRequired===true&&textGroup.proposal.mode==='text'&&textGroup.proposal.topics.problem===text.topics.problem&&textGroup.proposal.updatedByUid===ids.student&&Number.isInteger(textGroup.proposal.updatedAt)&&Object.keys(await value(`tasks/${textId}`)||{}).length===8&&textInvites.length===2&&Object.keys(await value(`advisorRequests/${textId}`)||{}).length===2&&await value(`proposalFiles/${textId}`)===null);
 const candidateProposal=await teacher('getProposal',textId);
 check('pending candidate gets proposal metadata through narrow API',candidateProposal.mode==='text'&&candidateProposal.version===textGroup.proposal.version);
 await rejects('outsider service cannot read proposal metadata',()=>outsider('getProposal',textId));
 const fileId=await student('createGroup',{name:'PTX proposta em arquivo',topic:'Pesquisa sintética',year:2027,advisorIds:[ids.teacher],proposal:{mode:'file'},proposalFile:inputFile});
 let fileGroup=await value(`groups/${fileId}`),storedFile=await value(`proposalFiles/${fileId}`);
 const fileInvites=Object.entries(await value('invitations')||{}).filter(([,item])=>item.groupId===fileId);
 check('createGroup file metadata bytes schedule and candidate commit atomically',fileGroup.proposal.mode==='file'&&fileGroup.proposal.filename==='Proposta TCC.pdf'&&storedFile.base64===pdf.toString('base64')&&storedFile.version===fileGroup.proposal.version&&storedFile.uploadedAt===fileGroup.proposal.updatedAt&&fileInvites.length===1&&Object.keys(await value(`tasks/${fileId}`)||{}).length===8);
 const candidateDownload=await teacher('getProposalFile',fileId);
 check('pending candidate downloads exact private source bytes',candidateDownload.filename==='Proposta TCC.pdf'&&candidateDownload.contentType==='application/pdf'&&Buffer.from(await candidateDownload.blob.arrayBuffer()).equals(pdf));
 const oldVersion=fileGroup.proposal.version;
 await ok('proposal runtime: existing file can be saved without selecting it again',student('saveProposal',fileId,{proposal:{mode:'file'},proposalFile:null,expectedVersion:oldVersion}));
 fileGroup=await value(`groups/${fileId}`);const retained=await value(`proposalFiles/${fileId}`);
 check('file retention issues a new canonical version without changing source bytes',fileGroup.proposal.version!==oldVersion&&fileGroup.proposal.previousVersion===oldVersion&&retained.base64===storedFile.base64&&retained.version===fileGroup.proposal.version&&retained.uploadedAt===fileGroup.proposal.updatedAt);
 await rejects('stale proposal edit cannot replace retained file',()=>student('saveProposal',fileId,{proposal:text,expectedVersion:oldVersion}));
 await ok('proposal runtime: current text edit removes previous file in same write',student('saveProposal',fileId,{proposal:text,expectedVersion:fileGroup.proposal.version}));
 const textReplacement=await value(`groups/${fileId}/proposal`);
 check('file-to-text replacement clears canonical bytes',textReplacement.mode==='text'&&await value(`proposalFiles/${fileId}`)===null);
 await ok('proposal runtime: text proposal may be replaced by a new source file',student('saveProposal',fileId,{proposal:{mode:'file'},proposalFile:inputFile,expectedVersion:textReplacement.version}));
 await ok('proposal runtime: pending professor declines invitation',teacher('respondInvitation',fileInvites[0][0],false));
 await rejects('declined professor loses proposal metadata API access',()=>teacher('getProposal',fileId));
 await rejects('declined professor loses private file API access',()=>teacher('getProposalFile',fileId));
 const acceptedId=await student('createGroup',{name:'PTX orientação com arquivo',topic:'Pesquisa sintética',year:2027,advisorIds:[ids.teacher],proposal:{mode:'file'},proposalFile:inputFile});
 const acceptedInvite=Object.entries(await value('invitations')||{}).find(([,item])=>item.groupId===acceptedId);
 await ok('proposal runtime: candidate accepts proposal-backed group',teacher('respondInvitation',acceptedInvite[0],true));
 const assignedDownload=await teacher('getProposalFile',acceptedId);
 check('assigned professor retains authenticated source download',Buffer.from(await assignedDownload.blob.arrayBuffer()).equals(pdf)&&(await value(`groups/${acceptedId}`)).advisorId===ids.teacher);
 await rejects('foreign professor cannot download assigned proposal',()=>other('getProposalFile',acceptedId));
 let rejectedGroupId='',rejectedInvitationIds=[];
 const rejecting=loadService(db(ids.student),ids.student,{beforeUpdate:async(_,patch)=>{
  const entry=Object.entries(patch).find(([key,item])=>/^groups\/[^/]+$/.test(key)&&item?.name==='PTX atomic reject');
  if(entry){rejectedGroupId=entry[0].slice('groups/'.length);rejectedInvitationIds=Object.keys(patch).filter(key=>/^invitations\/[^/]+$/.test(key)).map(key=>key.slice('invitations/'.length));entry[1].proposal.updatedByUid=ids.teacher;}
 }});
 await rejects('server rejection aborts group file schedule and invitation together',()=>rejecting('createGroup',{name:'PTX atomic reject',topic:'Pesquisa sintética',year:2027,advisorIds:[ids.other],proposal:{mode:'file'},proposalFile:inputFile}));
 check('rejected createGroup leaves no partial proposal or invitation',Boolean(rejectedGroupId)&&await value(`groups/${rejectedGroupId}`)===null&&await value(`proposalFiles/${rejectedGroupId}`)===null&&await value(`tasks/${rejectedGroupId}`)===null&&await value(`userGroups/${ids.student}/${rejectedGroupId}`)===null&&(await Promise.all(rejectedInvitationIds.map(id=>value(`invitations/${id}`)))).every(item=>item===null));
}
