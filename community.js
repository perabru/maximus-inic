const make=(tag,className='',text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;};
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const initials=name=>String(name||'INIC').trim().split(/\s+/).slice(0,2).map(part=>part.charAt(0).toUpperCase()).join('');
const PAGE_SIZE=12;
const SCHOOL_YEARS=new Set(['1º ano','2º ano','3º ano']);

function icon(kind){
  const shapes={people:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],students:['m3 8 9-5 9 5-9 5-9-5Z','M6 10v6c4 3 8 3 12 0v-6','M21 8v7'],advisors:['M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M15 4h7v11h-4','M18 8h1'],available:['m8 12 3 3 5-6'],search:['m21 21-4.35-4.35'],invite:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M20 8v6','M17 11h6']};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('class','community-icon filter-icon');
  for(const d of shapes[kind]||shapes.people){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}
  if(['people','advisors','invite','search','available'].includes(kind)){const circle=document.createElementNS(svg.namespaceURI,'circle');const [cx,cy,r]=kind==='search'?[10.5,10.5,7.5]:kind==='available'?[12,12,9]:[9,7,4];circle.setAttribute('cx',cx);circle.setAttribute('cy',cy);circle.setAttribute('r',r);svg.append(circle);}
  return svg;
}

export function participantStatus(person={}){
  if((person.role==='advisor'||person.role==='coordinator')&&person.listedAdvisor===true)return {available:true,type:'advisor',label:'Disponível para orientar',detail:'Pode orientar vários grupos.'};
  if(person.role==='advisor')return {available:false,type:'advisor',label:'Aguardando liberação para orientar',detail:'A coordenação precisa liberar este professor na lista de orientadores.'};
  if(person.role==='coordinator')return {available:false,type:null,label:'Coordenação',detail:'Acompanha a comunidade e os grupos.'};
  if(person.requestedRole==='advisor')return {available:false,type:null,label:'Aguardando aprovação',detail:'O perfil de professor está em análise pela coordenação.'};
  if(person.groupId)return {available:false,type:'member',label:'Já participa de um grupo',detail:'Este aluno já aceitou um convite ou criou seu grupo. Cada aluno pode participar de apenas um grupo.'};
  return {available:true,type:'member',label:'Disponível para um grupo',detail:'Pode receber convites para participar de um grupo.'};
}

export function createCommunityView(options={}){
  let state={people:[],ready:false,error:null,currentUid:'',currentRole:'',currentYear:'',...options},filter='all',page=1,disposed=false;
  const element=make('section','community');element.setAttribute('aria-label','Comunidade INIC');
  const intro=make('div','community-intro'),copy=make('div','community-intro-copy');
  copy.append(make('p','eyebrow','CONEXÕES QUE VIRAM PESQUISA'),make('h2','','Nossa comunidade'),make('p','','Encontre colegas e professores, forme sua equipe e acompanhe os convites.'));
  const note=make('div','community-rule');note.append(icon('people'),make('p','','Um grupo por aluno, com colegas da mesma série. Vários grupos por professor.'));intro.append(copy,note);
  const stats=make('div','community-stats');stats.setAttribute('aria-label','Participantes cadastrados');
  const statsValues={},statsLabels={};
  for(const [key,label]of [['students','Alunos'],['advisors','Professores'],['available','Alunos disponíveis']]){const card=make('div','community-stat'),value=make('strong','','—'),caption=make('span','',label);statsValues[key]=value;statsLabels[key]=caption;card.append(icon(key),value,caption);stats.append(card);}
  const toolbar=make('div','community-toolbar');
  const search=make('input');search.type='search';search.id='community-search';search.placeholder='Buscar pelo nome ou pela série';search.setAttribute('aria-label','Buscar pessoas pelo nome ou série');search.setAttribute('aria-controls','community-results');search.autocomplete='off';
  const searchField=make('label','filter-search community-search');searchField.append(icon('search'),search);
  const filters=make('div','filter-pills community-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar pessoas');
  for(const [key,label,kind]of [['all','Todos','people'],['students','Alunos','students'],['advisors','Professores','advisors'],['available','Disponíveis','available']]){const control=make('button','filter-choice');control.type='button';control.dataset.peopleFilter=key;control.setAttribute('aria-controls','community-results');control.append(icon(kind),make('span','filter-label',label));control.addEventListener('click',()=>{if(disposed)return;filter=key;page=1;paint();});filters.append(control);}
  toolbar.append(searchField,filters);
  const count=make('p','community-count');count.id='community-count';count.setAttribute('role','status');count.setAttribute('aria-live','polite');count.setAttribute('aria-atomic','true');
  const results=make('div','community-grid');results.id='community-results';results.setAttribute('aria-describedby','community-count');results.tabIndex=-1;
  const pagination=make('nav','community-pagination');pagination.setAttribute('aria-label','Páginas de pessoas');
  const previous=make('button','button secondary','Anterior'),next=make('button','button secondary','Próxima'),pageLabel=make('span');previous.type=next.type='button';previous.dataset.peoplePage='previous';next.dataset.peoplePage='next';pagination.append(previous,pageLabel,next);
  function turnPage(delta){if(disposed)return;page+=delta;paint();results.focus({preventScroll:true});results.scrollIntoView?.({block:'start',behavior:'auto'});}
  previous.addEventListener('click',()=>turnPage(-1));next.addEventListener('click',()=>turnPage(1));search.addEventListener('input',()=>{if(disposed)return;page=1;paint();});
  element.append(intro,stats,toolbar,count,results,pagination);
  function empty(title,description){const box=make('div','community-empty');box.append(icon('people'),make('h3','',title),make('p','',description));return box;}
  function invitationContext(person){
    const status=participantStatus(person),self=(person.id||person.uid)===state.currentUid;
    const action=typeof state.invitationState==='function'?state.invitationState(person)||{}:{};
    let restriction=null;
    if(state.currentRole==='student'&&status.type==='member'&&!self){
      if(!SCHOOL_YEARS.has(state.currentYear))restriction={label:'Série não informada',detail:'Informe sua série no perfil para convidar colegas. Os grupos devem reunir alunos da mesma série.'};
      else if(!SCHOOL_YEARS.has(person.year))restriction={label:'Série não informada',detail:'Este aluno precisa informar a série no perfil para receber convites de colegas da mesma série.'};
      else if(person.year!==state.currentYear)restriction={label:'Outra série',detail:`Você está no ${state.currentYear}. Convites entre alunos são permitidos apenas para colegas da mesma série.`};
    }
    return {status,self,action,restriction,available:!self&&status.available&&!restriction&&action.disabled!==true};
  }
  function paint(){
    if(disposed)return;
    const focusUid=results.contains(document.activeElement)?document.activeElement?.dataset.personInvite:null;
    filters.querySelectorAll('button').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.peopleFilter===filter)));
    statsLabels.available.textContent=state.currentRole==='student'?'Alunos disponíveis da sua série':'Alunos disponíveis';
    results.replaceChildren();results.setAttribute('aria-busy',String(!state.ready&&!state.error));pagination.hidden=true;
    if(state.error){Object.values(statsValues).forEach(value=>value.textContent='—');count.textContent='Não foi possível carregar as pessoas.';const box=empty('Vamos tentar novamente?','Confira sua conexão para consultar a comunidade e a disponibilidade dos convites.');if(typeof state.onRetry==='function'){const retry=make('button','button secondary','Tentar novamente');retry.type='button';retry.addEventListener('click',()=>{if(!disposed)state.onRetry();});box.append(retry);}results.append(box);return;}
    if(!state.ready){Object.values(statsValues).forEach(value=>value.textContent='—');count.textContent='Carregando pessoas e disponibilidade…';const loading=make('div','community-loading');loading.setAttribute('aria-hidden','true');for(let i=0;i<3;i++){const card=make('div','community-skeleton');card.append(make('span','community-skeleton-avatar'),make('span','community-skeleton-name'),make('span','community-skeleton-line'),make('span','community-skeleton-button'));loading.append(card);}results.append(loading);return;}
    const people=[...new Map((state.people||[]).filter(person=>person&&(person.id||person.uid)).map(person=>[person.id||person.uid,{...person,id:person.id||person.uid}])).values()];
    const contexts=new Map(people.map(person=>[person.id,invitationContext(person)]));
    const statusFor=person=>contexts.get(person.id).status,availableFor=person=>contexts.get(person.id).available;
    const isProfessor=person=>statusFor(person).type==='advisor'||person.role==='student'&&person.requestedRole==='advisor';
    statsValues.students.textContent=people.filter(person=>statusFor(person).type==='member').length;
    statsValues.advisors.textContent=people.filter(isProfessor).length;
    statsValues.available.textContent=people.filter(person=>statusFor(person).type==='member'&&availableFor(person)).length;
    const query=normalize(search.value),filtered=people.filter(person=>{const status=statusFor(person);return (filter==='all'||filter==='students'&&status.type==='member'||filter==='advisors'&&isProfessor(person)||filter==='available'&&availableFor(person))&&(!query||normalize(`${person.name} ${person.year||''}`).includes(query));}).sort((a,b)=>Number(availableFor(b))-Number(availableFor(a))||String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
    const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));page=Math.max(1,Math.min(page,pages));const start=(page-1)*PAGE_SIZE;
    count.textContent=filtered.length?`${start+1}–${Math.min(start+PAGE_SIZE,filtered.length)} de ${filtered.length} pessoa${filtered.length===1?'':'s'}${filter!=='all'||query?' neste filtro':''}`:people.length?'Nenhuma pessoa neste filtro.':'A comunidade está começando.';
    if(!filtered.length){results.append(empty(people.length?'Nenhuma pessoa encontrada':'Os participantes aparecerão aqui',people.length?'Tente outro nome, série ou filtro.':'Os perfis são exibidos após o cadastro no Meu INIC.'));return;}
    for(const person of filtered.slice(start,start+PAGE_SIZE)){
      const {status,self,action,restriction,available:canInvite}=contexts.get(person.id);
      const card=make('article',`community-person community-person--${status.type==='advisor'?'advisor':'student'}`);card.dataset.personId=person.id;
      const cover=make('div','community-person-cover');cover.setAttribute('aria-hidden','true');cover.append(icon(status.type==='advisor'?'advisors':'students'));
      const avatar=make('div','community-avatar',initials(person.name));avatar.setAttribute('aria-hidden','true');
      const profile=make('div','community-person-copy'),role=status.type==='advisor'?'Professor(a)':person.role==='coordinator'?'Coordenação':person.requestedRole==='advisor'?'Professor(a)':'Aluno(a)';
      const tags=make('div','community-person-tags');tags.append(make('span','community-role',role));if(self)tags.append(make('span','community-self','Você'));if(status.type==='member'&&person.year)tags.append(make('span','community-year',person.year));
      profile.append(tags,make('h3','',person.name||'Participante'));
      const availability=make('p',`community-availability ${status.available&&!restriction?'is-available':'is-unavailable'}${restriction?.label==='Outra série'?' is-other-year':''}`);availability.append(make('span','community-status-dot'),make('span','',restriction?.label||status.label));
      const detail=make('p','community-person-detail',restriction?`${restriction.detail}${status.available?'':` ${status.detail}`}`:status.available&&action.detail?action.detail:status.detail);
      const invite=make('button',`button ${canInvite?'primary':'secondary'} community-invite`);invite.type='button';invite.dataset.personInvite=person.id;
      invite.disabled=!canInvite||typeof state.onInvite!=='function';
      invite.append(icon('invite'),make('span','',self?'Seu perfil':restriction?.label||(!status.available?(status.type==='member'?'Já está em um grupo':status.label):action.label||(status.type==='advisor'?'Convidar para orientar':'Convidar para meu grupo'))));
      invite.addEventListener('click',()=>{if(disposed||invite.disabled||!state.ready||state.error||typeof state.onInvite!=='function')return;const current=(state.people||[]).find(item=>(item.id||item.uid)===person.id);if(current&&invitationContext(current).available)state.onInvite(current);});
      card.append(cover,avatar,profile,availability,detail,invite);results.append(card);
    }
    previous.disabled=page===1;next.disabled=page===pages;pageLabel.textContent=`Página ${page} de ${pages}`;pagination.hidden=pages<=1;
    if(focusUid){const control=[...results.querySelectorAll('[data-person-invite]')].find(item=>item.dataset.personInvite===focusUid);(control&&!control.disabled?control:results).focus({preventScroll:true});}
  }
  paint();
  return {element,update(next={}){if(disposed)return;state={...state,...next};paint();},destroy(){disposed=true;state={people:[]};element.replaceChildren();}};
}
