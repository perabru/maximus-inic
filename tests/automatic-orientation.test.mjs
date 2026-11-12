import assert from 'node:assert/strict';
import {ref,get,set,update} from 'firebase/database';
import {loadService} from './service-runtime.mjs';

// Kept at the original suite path so the main security runner exercises the
// replacement of the former automatic first/second-year assignment policy.
export async function runAdvisorChoiceTests({env,db,ok,no,count}) {
 const root='maximusInic',stamp=Date.now(),bruno='GZv2JuQ7JJg2G4ErhdOEKQOzM3z2';
 const ids={first:'aufirst',second:'ausecond',third:'authird',peer:'aupeer',other:'auother',another:'auanother',fourth:'aufourth',coord:'aucoord',unapproved:'auunapproved',missing:'aumissing'};
 const pdf=Buffer.from('%PDF-1.7\nAdvisor choice synthetic term\n%%EOF');
 const years={[ids.first]:'1º ano',[ids.second]:'2º ano',[ids.third]:'3º ano',[ids.peer]:'1º ano',[ids.missing]:'2º ano'};
 const staff=[ids.other,ids.another,ids.fourth,ids.coord,bruno],changes={};
 for(const uid of [...Object.values(ids),bruno])changes[`users/${uid}`]={name:uid===bruno?'Bruno Michel Pera':uid,email:`${uid}@example.com`,requestedRole:[...staff,ids.unapproved].includes(uid)?'advisor':'student',year:years[uid]||'',createdAt:stamp};
 for(const uid of staff){changes[`roles/${uid}`]=[ids.coord,bruno].includes(uid)?'coordinator':'advisor';if(uid!==ids.coord)changes[`advisorDirectory/${uid}`]={uid,name:uid===bruno?'Bruno Michel Pera':uid};}
 for(const uid of Object.keys(years).filter(uid=>uid!==ids.missing)){
  changes[`agreements/2027/${uid}`]={uid,year:2027,filename:'termo.pdf',ownerName:uid,size:pdf.length,contentType:'application/pdf',uploadedAt:stamp};
  changes[`agreementFiles/2027/${uid}`]={base64:pdf.toString('base64'),size:pdf.length,contentType:'application/pdf',uploadedAt:stamp};
 }
 const rawGroup=uid=>({name:'Proposta sintética',topic:'Pesquisa escolar',description:'',year:2027,advisorId:'',members:{[uid]:true},memberNames:{[uid]:uid},createdBy:uid,createdAt:stamp,status:'active',advisorRequestPolicy:'first-accept-v1',advisorRequestVersion:0,proposalRequired:true});
 const legacy={...rawGroup(ids.first),advisorId:bruno};changes['groups/au-legacy-bruno']=legacy;changes[`userGroups/${ids.first}/au-legacy-bruno`]=true;
 await env.withSecurityRulesDisabled(context=>update(ref(context.database(),root),changes));
 const admin=operation=>env.withSecurityRulesDisabled(context=>operation(context.database()));
 const value=async path=>{let result;await admin(async database=>{result=(await get(ref(database,`${root}/${path}`))).val();});return result;};
 const at=(uid,path)=>ref(db(uid),`${root}/${path}`);
 const check=(name,condition)=>{assert.ok(condition,name);count(`advisor choice: ${name}`);};
 const rejects=async(name,operation,pattern)=>{await assert.rejects(operation,pattern);count(`advisor choice: ${name}`);};
 const proposal={mode:'text',topics:{problem:'Proposta sintética',objective:'Objetivo de teste',method:'Método de teste',expectedResult:'Resultado esperado'}};
 const candidates=[ids.other,bruno,ids.another],created=[];
 const options=(uid,patch={})=>({name:`TCC ${years[uid]||uid}`,topic:'Escolha livre de orientador',proposal,advisorIds:candidates,...patch});
 for(const uid of [ids.first,ids.second,ids.third]){
  const writes=[],client=loadService(db(uid),uid,{beforeUpdate:async(_,patch)=>writes.push(structuredClone(patch))});
  const gid=await client('createGroup',options(uid,{memberEmails:[`${ids.peer}@example.com`]}));created.push({uid,gid,client});
  const group=await value(`groups/${gid}`),invitations=Object.entries(await value('invitations')||{}).filter(([,invite])=>invite.groupId===gid),advisorInvites=invitations.filter(([,invite])=>invite.type==='advisor'),requests=await value(`advisorRequests/${gid}`),slots=await value(`advisorRequestSlots/${gid}`);
  check(`${years[uid]} creates atomically with three selected candidates and no assigned advisor`,writes.length===1&&group.advisorId===''&&group.members[uid]===true&&group.advisorRequestPolicy==='first-accept-v1'&&group.proposalRequired===true&&group.proposal.mode==='text'&&group.advisorRequestVersion===1&&(await value(`userGroups/${uid}/${gid}`))===true&&advisorInvites.length===3);
  check(`${years[uid]} indexes the exact chosen candidates and preserves colleague invitations`,advisorInvites.every(([id,invite])=>candidates.includes(invite.toUid)&&requests[invite.toUid]===id&&invite.status==='pending')&&Object.values(slots).length===3&&candidates.every(candidate=>Object.values(slots).includes(candidate))&&invitations.some(([,invite])=>invite.type==='member'&&invite.toEmail===`${ids.peer}@example.com`)&&Object.keys(await value(`tasks/${gid}`)).length>0);
  await no(`advisor choice: ${years[uid]} cannot assign a candidate before acceptance`,set(at(uid,`groups/${gid}/advisorId`),ids.other));
  const selected=advisorInvites.find(([,invite])=>invite.toUid===ids.other);
  await ok(`advisor choice: ${years[uid]} selected teacher accepts through normal audited flow`,loadService(db(ids.other),ids.other)('respondInvitation',selected[0],true));
  const resolved=await value(`groups/${gid}`),resolvedInvites=Object.values(await value('invitations')).filter(invite=>invite.groupId===gid&&invite.type==='advisor');
  check(`${years[uid]} keeps one advisor and cancels competing requests`,resolved.advisorId===ids.other&&resolved.advisorAssignment?.action==='accept'&&resolvedInvites.filter(invite=>invite.status==='accepted').length===1&&resolvedInvites.filter(invite=>invite.status==='cancelled').length===2&&(await value(`advisorRequests/${gid}`))===null&&(await value(`advisorRequestSlots/${gid}`))===null);
  await no(`advisor choice: ${years[uid]} cannot replace the accepted advisor silently`,set(at(uid,`groups/${gid}/advisorId`),bruno));
  await no(`advisor choice: ${years[uid]} cannot use a legacy client to assign Bruno directly`,set(at(uid,`groups/au-raw-bruno-${uid}`),{...rawGroup(uid),advisorId:bruno}));
  await no(`advisor choice: ${years[uid]} cannot assign another teacher directly at creation`,set(at(uid,`groups/au-raw-other-${uid}`),{...rawGroup(uid),advisorId:ids.other}));
  const before=Object.keys(await value('groups')).length;
  await rejects(`${years[uid]} requires a proposal before sending advisor invitations`,()=>client('createGroup',options(uid,{proposal:null})),/proposta/);
  await rejects(`${years[uid]} rejects more than three candidates`,()=>client('createGroup',options(uid,{advisorIds:[...candidates,ids.fourth]})),/até 3/);
  await rejects(`${years[uid]} rejects unapproved candidates`,()=>client('createGroup',options(uid,{advisorIds:[ids.unapproved]})),/aprovados/);
  check(`${years[uid]} rejected proposals leave no partial group`,Object.keys(await value('groups')).length===before);
 }
 const first=created[0].client,second=created[1].client;
 assert.deepEqual(await value('groups/au-legacy-bruno'),legacy);count('advisor choice: new proposals do not change previous automatic assignments');
 await ok('advisor choice: an existing Bruno group remains editable without clearing its advisor',first('updateGroup','au-legacy-bruno',{topic:'Tema atualizado'}));
 check('editing a previous group preserves its advisor and Bruno dual role',(await value('groups/au-legacy-bruno/advisorId'))===bruno&&(await value(`roles/${bruno}`))==='coordinator'&&(await value(`advisorDirectory/${bruno}`))!==null);
 await no('advisor choice: student cannot silently change the advisor of a legacy group',set(at(ids.first,'groups/au-legacy-bruno/advisorId'),ids.another));
 await admin(database=>set(ref(database,`${root}/advisorDirectory/${bruno}`),null));
 const noBruno=await first('createGroup',options(ids.first,{advisorIds:[],proposal:null}));
 check('first-year group can be created before choosing candidates while Bruno is not listed',(await value(`groups/${noBruno}/advisorId`))===''&&(await value(`advisorRequests/${noBruno}`))===null);
 await admin(database=>update(ref(database,root),{[`advisorDirectory/${bruno}`]:{uid:bruno,name:'Bruno Michel Pera'},[`inactiveUsers/${bruno}`]:true}));
 const inactiveBruno=await second('createGroup',options(ids.second,{advisorIds:[ids.another]}));
 check('second-year choice of another teacher is independent of an inactive Bruno account',(await value(`groups/${inactiveBruno}/advisorId`))===''&&Object.keys(await value(`advisorRequests/${inactiveBruno}`)).join()===ids.another);
 const beforeInactive=Object.keys(await value('groups')).length;
 await rejects('inactive candidates still cannot receive a new proposal',()=>second('createGroup',options(ids.second,{advisorIds:[bruno]})),/permission_denied/i);
 check('invalid inactive candidate leaves no partial group',Object.keys(await value('groups')).length===beforeInactive);
 await admin(database=>set(ref(database,`${root}/inactiveUsers/${bruno}`),null));
 await rejects('all-year advisor choice still requires the mandatory term',()=>loadService(db(ids.missing),ids.missing)('createGroup',options(ids.missing)),/termo/);
 const coord=loadService(db(ids.coord),ids.coord);
 await ok('advisor choice: renaming a coordinator without advising does not add them to the directory',coord('updateUser',ids.coord,{name:'Coordenação escolar'}));
 check('coordination-only role remains unlisted after managed rename',(await value(`advisorDirectory/${ids.coord}`))===null&&(await value(`roles/${ids.coord}`))==='coordinator');
 await ok('advisor choice: self profile rename also preserves coordination-only role',coord('saveProfile',{name:'Coordenação escolar atualizada'}));
 check('self profile edit leaves coordination-only directory absent',(await value(`advisorDirectory/${ids.coord}`))===null);
 await ok('advisor choice: an explicit coordinator approval can still enable advising',coord('approveAdvisor',ids.coord));
 check('explicit approval keeps both coordinator and advisor directory entry',(await value(`roles/${ids.coord}`))==='coordinator'&&(await value(`advisorDirectory/${ids.coord}/name`))==='Coordenação escolar atualizada');
}
