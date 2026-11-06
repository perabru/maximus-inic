import assert from 'node:assert/strict';
import {ref,get,set,update} from 'firebase/database';
import {loadService} from './service-runtime.mjs';

export async function runAutomaticOrientationTests({env,db,ok,no,count}) {
 const root='maximusInic',stamp=Date.now(),bruno='GZv2JuQ7JJg2G4ErhdOEKQOzM3z2';
 const ids={first:'aufirst',second:'ausecond',third:'authird',peer:'aupeer',other:'auother',coord:'aucoord'};
 const pdf=Buffer.from('%PDF-1.7\nAutomatic orientation synthetic term\n%%EOF');
 const years={[ids.first]:'1º ano',[ids.second]:'2º ano',[ids.third]:'3º ano',[ids.peer]:'1º ano'};
 const changes={};
 for(const uid of [...Object.values(ids),bruno])changes[`users/${uid}`]={name:uid===bruno?'Bruno Michel Pera':uid,email:`${uid}@example.com`,requestedRole:[ids.other,ids.coord,bruno].includes(uid)?'advisor':'student',year:years[uid]||'',createdAt:stamp};
 for(const uid of [ids.coord,bruno]){changes[`roles/${uid}`]='coordinator';changes[`advisorDirectory/${uid}`]={uid,name:uid===bruno?'Bruno Michel Pera':uid};}
 changes[`roles/${ids.other}`]='advisor';changes[`advisorDirectory/${ids.other}`]={uid:ids.other,name:ids.other};
 for(const uid of Object.keys(years)){
  changes[`agreements/2027/${uid}`]={uid,year:2027,filename:'termo.pdf',ownerName:uid,size:pdf.length,contentType:'application/pdf',uploadedAt:stamp};
  changes[`agreementFiles/2027/${uid}`]={base64:pdf.toString('base64'),size:pdf.length,contentType:'application/pdf',uploadedAt:stamp};
 }
 await env.withSecurityRulesDisabled(context=>update(ref(context.database(),root),changes));
 const admin=operation=>env.withSecurityRulesDisabled(context=>operation(context.database()));
 const value=async path=>{let result;await admin(async database=>{result=(await get(ref(database,`${root}/${path}`))).val();});return result;};
 const at=(uid,path)=>ref(db(uid),`${root}/${path}`);
 const check=(name,condition)=>{assert.ok(condition,name);count(`automatic orientation: ${name}`);};
 const rejects=async(name,operation)=>{let rejected=false;try{await operation();}catch{rejected=true;}check(name,rejected);};
 const rawGroup=uid=>({name:'Proposta sintética',topic:'Pesquisa escolar',description:'',year:2027,advisorId:'',members:{[uid]:true},memberNames:{[uid]:uid},createdBy:uid,createdAt:stamp,status:'active',advisorRequestPolicy:'first-accept-v1',advisorRequestVersion:0,proposalRequired:true});
 let firstPatch,writes=0;
 const first=loadService(db(ids.first),ids.first,{beforeUpdate:async(_,patch)=>{writes++;firstPatch=structuredClone(patch);}});
 const firstId=await first('createGroup',{name:'TCA primeiro ano',topic:'Pesquisa do primeiro ano',advisorIds:[ids.other],memberEmails:[`${ids.peer}@example.com`]});
 const firstGroup=await value(`groups/${firstId}`),firstInvites=Object.entries(await value('invitations')||{}).filter(([,invite])=>invite.groupId===firstId);
 check('first-year creation commits one atomic proposal with Bruno assigned',writes===1&&firstGroup.advisorId===bruno&&firstGroup.members[ids.first]===true&&(await value(`userGroups/${ids.first}/${firstId}`))===true);
 check('first-year selected advisor is ignored without sending advisor invitations',firstInvites.length===1&&firstInvites[0][1].type==='member'&&(await value(`advisorRequests/${firstId}`))===null&&(await value(`advisorRequestSlots/${firstId}`))===null);
 check('automatic assignment preserves peer invitations and default calendar tasks',firstInvites[0][1].toEmail===`${ids.peer}@example.com`&&Object.keys(await value(`tasks/${firstId}`)).length>0&&Object.keys(firstPatch).some(path=>path.startsWith(`tasks/${firstId}/`)));
 const second=loadService(db(ids.second),ids.second),secondId=await second('createGroup',{name:'TCA segundo ano',topic:'Pesquisa do segundo ano',advisorId:ids.other});
 check('second-year creation also assigns Bruno directly',(await value(`groups/${secondId}/advisorId`))===bruno&&(await value(`advisorRequests/${secondId}`))===null);
 await ok('automatic orientation: Bruno retains coordinator role and advisor directory',get(at(bruno,`groups/${firstId}`)));
 check('automatic groups do not demote Bruno or add him as student member',(await value(`roles/${bruno}`))==='coordinator'&&(await value(`advisorDirectory/${bruno}`))!==null&&(await value(`groups/${firstId}/members/${bruno}`))===null);
 await no('automatic orientation: raw first-year student cannot create unassigned proposal',set(at(ids.first,'groups/au-raw-empty'),rawGroup(ids.first)));
 await no('automatic orientation: raw second-year student cannot select another advisor directly',set(at(ids.second,'groups/au-raw-other'),{...rawGroup(ids.second),advisorId:ids.other}));
 await no('automatic orientation: raw third-year student cannot bypass advisor consent with direct assignment',set(at(ids.third,'groups/au-raw-third'),{...rawGroup(ids.third),advisorId:bruno}));
 await no('automatic orientation: first-year student cannot silently switch its automatic advisor',set(at(ids.first,`groups/${firstId}/advisorId`),ids.other));
 const third=loadService(db(ids.third),ids.third),thirdId=await third('createGroup',{name:'TCC terceiro ano',topic:'Pesquisa do terceiro ano',proposal:{mode:'text',topics:{problem:'Proposta sintética',objective:'',method:'',expectedResult:''}},advisorIds:[ids.other]});
 const thirdInvites=Object.values(await value('invitations')).filter(invite=>invite.groupId===thirdId);
 check('third-year proposal waits for selected advisor consent',(await value(`groups/${thirdId}/advisorId`))===''&&thirdInvites.length===1&&thirdInvites[0].type==='advisor'&&thirdInvites[0].toUid===ids.other);
 await admin(database=>set(ref(database,`${root}/advisorDirectory/${bruno}`),null));
 const beforeMissing=Object.keys(await value('groups')).length;
 await rejects('missing Bruno registration blocks first-year proposal rather than creating orphan',()=>first('createGroup',{name:'Não deve criar',topic:'Sem cadastro de orientação'}));
 check('missing automatic advisor creates no partial group',Object.keys(await value('groups')).length===beforeMissing);
 await admin(database=>update(ref(database,root),{[`advisorDirectory/${bruno}`]:{uid:bruno,name:'Bruno Michel Pera'},[`inactiveUsers/${bruno}`]:true}));
 await rejects('server refuses automatic assignment to an inactive Bruno account',()=>second('createGroup',{name:'Não deve criar inativo',topic:'Cadastro inativo'}));
 check('inactive automatic advisor creates no partial schedule or proposal',Object.keys(await value('groups')).length===beforeMissing);
 await admin(database=>set(ref(database,`${root}/inactiveUsers/${bruno}`),null));
}
