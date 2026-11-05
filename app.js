'use strict';

const $ = (selector) => document.querySelector(selector);
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// All visible metadata comes from the verified, versioned local catalogue.
let papers = [];
let visibleLimit = 6;
let searchStatus = {};
const controls = ['#search', '#year', '#advisor', '#school'];
function displayTitle(title) {
  let value = title.toLocaleLowerCase('pt-BR').replace(/\.$/, '');
  value = value.charAt(0).toLocaleUpperCase('pt-BR') + value.slice(1);
  const words = {'ia':'IA','vants':'VANTs','esp-32':'ESP-32','wroom':'WROOM','dopplertrack':'DopplerTrack','biotable':'BioTable','honeybee':'HoneyBee','coca-cola':'Coca-Cola','doppler':'Doppler'};
  return value.replace(/escola máximu[’']s/gi, 'Escola Máximu’s').replace(/\b(ia|vants|esp-32|wroom|dopplertrack|biotable|honeybee|coca-cola|doppler)\b/gi, (word) => words[word.toLowerCase()]);
}
const searchedPeople = ['Bruno','Taynara','Viviane','Yan','Adely','Mariana Carmona','Stephanie','Silvana Goes','Jhonneyvarl','Angelo'];
function getMatches(paper) {
  if (paper.matchedPeople) return paper.matchedPeople;
  const names = normalize([...(paper.authors || []), ...(paper.supervisors || paper.advisors || [])].join(' '));
  return searchedPeople.filter(name => names.includes(normalize(name)));
}
function schoolLabel(paper) {
  if(paper.isMaximus) return 'Máximu’s';
  if(/univap/i.test(paper.institution)) return /col[eé]gio/i.test(paper.institution) ? 'Colégios Univap' : 'Univap';
  if(/esp[ií]rito santo|UFES/i.test(paper.institution)) return 'UFES';
  return paper.school || paper.institution;
}
function matchedNames(paper) {
  if(paper.matchedFullNames?.length) return paper.matchedFullNames.join(' · ');
  const people=[...(paper.authors||[]),...(paper.supervisors||paper.advisors||[])];
  return [...new Set(people.filter(person=>getMatches(paper).some(term=>normalize(person).includes(normalize(term)))))].join(' · ');
}
function makeCard(paper) {
  const card=el('article','research-card');
  card.setAttribute('aria-label',displayTitle(paper.title));
  const content=el('div','research-card__content');
  const back=el('div','research-card__back');
  const cover=el('div','research-card__back-content');
  const badge=el('span','research-card__badge'+(paper.isMaximus?' school-maximus':''),`${paper.year} · ${schoolLabel(paper)}`);
  cover.append(badge,el('h3','',displayTitle(paper.title)));
  if(paper.award)cover.append(el('p','research-card__footer',typeof paper.award==='string'?paper.award:'2º lugar · Técnico · 2025'));
  cover.append(el('p','research-card__authors',matchedNames(paper)));
  if(paper.relationship==='acknowledgement')cover.append(el('p','research-card__footer','Menção nos agradecimentos'));
  back.append(cover);
  const front=el('div','research-card__front');front.setAttribute('aria-hidden','true');
  const graphic=el('div','research-card__image');graphic.setAttribute('aria-hidden','true');
  ['',' research-card__orb--right',' research-card__orb--bottom'].forEach(variant=>graphic.append(el('div','research-card__orb'+variant)));
  const frontContent=el('div','research-card__front-content');
  frontContent.append(el('span','research-card__badge',paper.topic));
  const details=el('div','research-card__description');details.id=`article-details-${paper.id}`;
  details.append(el('h3','','Autores e orientação'));
  const authors=el('p');authors.append(el('strong','','Autores: '),document.createTextNode((paper.authors||[]).join(', ')));details.append(authors);
  const advisors=el('p');advisors.append(el('strong','','Orientação: '),document.createTextNode((paper.supervisors||paper.advisors||[]).join(' · ')||'Consulte o artigo'));details.append(advisors);
  details.append(el('p','',paper.institution),el('p','',paper.description));
  if(paper.note)details.append(el('p','article-note',paper.note));
  const source=el('a','','Ver registro nos anais →');source.href=paper.source;source.target='_blank';source.rel='noopener noreferrer';source.tabIndex=-1;details.append(source);
  frontContent.append(details);front.append(graphic,frontContent);content.append(back,front);
  const flip=el('button','research-card__flip','Autores');flip.type='button';flip.setAttribute('aria-controls',details.id);flip.setAttribute('aria-expanded','false');
  let pinned=false,hovered=false,suppressHover=false;
  const update=()=>{const expanded=pinned||(hovered&&!suppressHover)||front.contains(document.activeElement);card.classList.toggle('is-closed',suppressHover);card.classList.toggle('is-flipped',expanded);flip.setAttribute('aria-expanded',String(expanded));flip.textContent=pinned?'Fechar':'Autores';back.setAttribute('aria-hidden',String(expanded));front.setAttribute('aria-hidden',String(!expanded));source.tabIndex=expanded?0:-1;};
  flip.addEventListener('click',()=>{pinned=!pinned;suppressHover=!pinned;update();});
  card.addEventListener('mouseenter',()=>{suppressHover=false;hovered=matchMedia('(hover:hover)').matches;update();});
  card.addEventListener('mouseleave',()=>{hovered=false;suppressHover=false;update();});
  front.addEventListener('focusin',update);front.addEventListener('focusout',()=>queueMicrotask(update));
  const link=el('a','research-card__open');link.href=paper.pdfUrl||paper.url;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',`Ler artigo em PDF: ${displayTitle(paper.title)} (abre em nova aba)`);
  const arrow=el('span','','→');arrow.setAttribute('aria-hidden','true');link.append(document.createTextNode('Ler artigo · PDF'),arrow);
  card.append(content,flip,link);
  return card;
}
function applyFilters(resetLimit = true) {
  if (resetLimit) visibleLimit = 6;
  const query = normalize($('#search').value).trim();
  const year = $('#year').value;
  const advisor = $('#advisor').value;
  const school = $('#school').value;
  const filtered = papers.filter(p => (year === 'all' || p.year === Number(year)) && (advisor === 'all' || getMatches(p).includes(advisor)) && (school === 'all' || p.isMaximus === (school === 'maximus')) && (!query || query.split(/\s+/).every(word => normalize([p.title,p.description,p.students,(p.authors || []).join(' '),(p.supervisors || []).join(' '),p.topic,p.institution,p.note,(p.matchedPeople||[]).join(' '),(p.matchedFullNames||[]).join(' '),JSON.stringify(p.nameMatches||{})].join(' ')).includes(word))));
  $('#articles').replaceChildren(...filtered.slice(0, visibleLimit).map(makeCard));
  const shown = Math.min(visibleLimit, filtered.length);
  $('#results-count').textContent = filtered.length ? `${shown} de ${filtered.length} ${filtered.length === 1 ? 'artigo encontrado' : 'artigos encontrados'}` : year === '2026' ? 'Anais de 2026 ainda não localizados' : 'Nenhum artigo encontrado';
  $('#empty').hidden = filtered.length > 0;
  const missingName = year !== '2024' && ['Mariana Carmona','Silvana Goes'].includes(advisor);
  $('#empty-title').textContent = year === '2026' ? 'Anais de 2026 pendentes' : missingName ? `${advisor}: nenhum artigo localizado em 2025` : 'Nenhum artigo com esses filtros';
  $('#empty-text').textContent = missingName ? 'O nome não foi localizado nos PDFs de 2025. Há um pôster fotografado de 2026; o artigo completo ainda não foi localizado nos anais dessa edição.' : year === '2026' ? 'Os anais desta edição ainda não foram localizados no portal oficial.' : 'Altere o nome, o tema ou a instituição.';
  const evidence=$('#photo-evidence');if(evidence)evidence.hidden=filtered.length>0||!missingName;
  $('#load-more').hidden = shown >= filtered.length;
  const remaining = filtered.length - shown;
  $('#load-more').firstChild.textContent = `Mostrar mais ${Math.min(6, remaining)} artigos `;
}
function resetFilters() {
  $('#search').value = '';
  ['#year','#advisor','#school'].forEach(selector => $(selector).value = 'all');
  applyFilters();
}
$('#filters').addEventListener('submit', e => e.preventDefault());
controls.forEach(selector => $(selector).addEventListener(selector === '#search' ? 'input' : 'change', () => applyFilters()));
$('#clear-filters').addEventListener('click', resetFilters);
$('#empty-reset').addEventListener('click', () => {resetFilters(); $('#search').focus({preventScroll:true});});
$('#load-more').addEventListener('click', () => {
  const oldCount = $('#articles').children.length;
  visibleLimit += 6;
  applyFilters(false);
  const next = $('#articles').children[oldCount];
  if (next) { next.tabIndex = -1; next.focus({preventScroll:true}); }
});
fetch('articles.json?v=20261105-3').then(r => {if (!r.ok) throw new Error('Catalogue'); return r.json();}).then(data => {
  searchStatus = data.nameSearchStatus || {};
  papers = [...data.articles].sort((a,b) => Number(b.isMaximus) - Number(a.isMaximus) || a.title.localeCompare(b.title,'pt-BR'));
  $('#total-count').textContent = papers.length;
  const quickCount=$('#quick-article-count');if(quickCount)quickCount.textContent=`${papers.length} artigos`;
  applyFilters();
}).catch(() => {
  $('#results-count').textContent = 'Não foi possível carregar os artigos. Recarregue a página ou abra os anais oficiais abaixo.';
}).finally(()=>{const loading=$('#article-loading');if(loading)loading.hidden=true;$('#articles').setAttribute('aria-busy','false');});

let photos = [];
let current = 0;
let orbitAngle = 0;
let orbitTarget = null;
let orbitLastFrame = performance.now();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const gallery = $('.gallery');
const orbitStage = $('#photo-orbit');
const orbitInner = $('#photo-orbit-inner');
let playing = !reducedMotion.matches;
let galleryInView = false;
let hovered = false;
let focused = false;
let explicitPlay = false;
let lastChange = Date.now();
let lastGesture = 0;
let drag = null;
const wrapPhoto = index => ((index % photos.length) + photos.length) % photos.length;
const photoStep = () => 360 / photos.length;
function paintPlay() {
  $('#play').hidden=reducedMotion.matches;
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
  icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','15');icon.setAttribute('height','15');icon.setAttribute('aria-hidden','true');
  const shape=document.createElementNS(icon.namespaceURI,'path');shape.setAttribute('fill','currentColor');
  shape.setAttribute('d',playing?'M5 4h5v16H5zM14 4h5v16h-5z':'M7 3l14 9-14 9z');icon.append(shape);$('#play').replaceChildren(icon);
  $('#play').setAttribute('aria-label',playing?'Pausar animação das fotos':'Reproduzir animação das fotos');
  $('#play').setAttribute('aria-pressed',String(playing));
  orbitStage.classList.toggle('is-paused',!playing);
}
function paintRotation() {orbitInner.style.setProperty('--rotation',`${orbitAngle.toFixed(4)}deg`);}
function keepThumbnailVisible(automatic) {
  const strip=$('#thumbnails'),item=strip.children[current];
  if(!item)return;
  const bounds=strip.getBoundingClientRect(),photoBounds=item.getBoundingClientRect();
  if(photoBounds.left<bounds.left||photoBounds.right>bounds.right){
    strip.scrollTo({left:strip.scrollLeft+photoBounds.left-bounds.left-(strip.clientWidth-item.clientWidth)/2,behavior:automatic||reducedMotion.matches?'instant':'smooth'});
  }
}
function showPhoto(index,automatic=false) {
  if(!photos.length)return;
  current=wrapPhoto(index);
  const photo=photos[current];
  $('#gallery-caption').textContent=photo.caption;
  $('#gallery-detail').textContent=photo.detail;
  $('#photo-counter').setAttribute('aria-live',automatic?'off':'polite');
  $('#photo-counter').textContent=`${String(current+1).padStart(2,'0')} / ${photos.length}`;
  document.querySelectorAll('#thumbnails button').forEach((button,index)=>button.setAttribute('aria-current',String(index===current)));
  document.querySelectorAll('.photo-orbit__card').forEach((button,index)=>{
    button.classList.toggle('is-selected',index===current);button.setAttribute('aria-current',String(index===current));button.tabIndex=reducedMotion.matches||index===current?0:-1;
  });
  keepThumbnailVisible(automatic);
  if(!automatic){
    const angle=-current*photoStep();
    orbitTarget=angle+Math.round((orbitAngle-angle)/360)*360;
    lastChange=Date.now();
    if(reducedMotion.matches){
      orbitAngle=orbitTarget;orbitTarget=null;paintRotation();
      const item=orbitInner.children[current];
      if(item){const bounds=orbitInner.getBoundingClientRect(),photoBounds=item.getBoundingClientRect();orbitInner.scrollTo({left:orbitInner.scrollLeft+photoBounds.left-bounds.left-(orbitInner.clientWidth-item.clientWidth)/2,behavior:'instant'});}
    }
  }
  if($('#lightbox').open)updateLightbox();
}
function updateLightbox() {
  const image=$('#lightbox-image'),photo=photos[current];
  image.src=photo.src;image.alt=photo.alt;image.width=photo.width;image.height=photo.height;
  $('#lightbox-caption').textContent=photo.caption;
  $('#lightbox-counter').textContent=`${current+1} / ${photos.length}`;
}
$('#play').addEventListener('click',()=>{
  playing=!playing;explicitPlay=playing;lastChange=0;paintPlay();
});
orbitStage.addEventListener('mouseenter',()=>{hovered=true;explicitPlay=false;});
orbitStage.addEventListener('mouseleave',()=>{hovered=false;lastChange=Date.now();});
gallery.addEventListener('focusin',event=>{focused=true;if(event.target!==$('#play'))explicitPlay=false;});
gallery.addEventListener('focusout',event=>{focused=gallery.contains(event.relatedTarget);if(!focused)lastChange=Date.now();});
gallery.addEventListener('keydown',event=>{
  if(!photos.length)return;
  let index;
  if(event.key==='ArrowLeft')index=current-1;
  else if(event.key==='ArrowRight')index=current+1;
  else if(event.key==='Home')index=0;
  else if(event.key==='End')index=photos.length-1;
  else return;
  event.preventDefault();explicitPlay=false;showPhoto(index);
  if(event.target.closest('.photo-orbit__card'))orbitInner.children[current]?.focus({preventScroll:true});
});
// Pointer gestures work with mouse, pen and touch; vertical page scrolling stays native.
orbitStage.addEventListener('pointerdown',event=>{
  if(event.button!==0||!event.isPrimary||reducedMotion.matches||!photos.length)return;
  drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,startAngle:orbitAngle,lastX:event.clientX,lastTime:performance.now(),velocity:0,horizontal:false};
  orbitTarget=null;explicitPlay=false;
});
orbitStage.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
  if(!drag.horizontal){
    if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){drag=null;return;}
    if(Math.abs(dx)<9||Math.abs(dx)<Math.abs(dy)*1.2)return;
    drag.horizontal=true;orbitStage.classList.add('is-dragging');orbitStage.setPointerCapture(event.pointerId);
  }
  if(event.cancelable)event.preventDefault();
  const now=performance.now(),dt=Math.max(8,now-drag.lastTime);
  drag.velocity=.65*drag.velocity+.35*(event.clientX-drag.lastX)/dt;
  drag.lastX=event.clientX;drag.lastTime=now;
  const sensitivity=photoStep()/(orbitStage.clientWidth<600?145:245);
  orbitAngle=drag.startAngle+dx*sensitivity;paintRotation();
  const nearest=wrapPhoto(Math.round(-orbitAngle/photoStep()));if(nearest!==current)showPhoto(nearest,true);
});
function finishDrag(event,cancelled=false) {
  if(!drag||event.pointerId!==drag.id)return;
  const ended=drag;drag=null;orbitStage.classList.remove('is-dragging');
  if(orbitStage.hasPointerCapture(event.pointerId))orbitStage.releasePointerCapture(event.pointerId);
  if(!ended.horizontal){lastChange=Date.now();return;}
  lastGesture=Date.now();
  const sensitivity=photoStep()/(orbitStage.clientWidth<600?145:245);
  const velocity=performance.now()-ended.lastTime<100?ended.velocity:0;
  const drift=cancelled?0:Math.max(-photoStep()*.8,Math.min(photoStep()*.8,velocity*150*sensitivity));
  showPhoto(Math.round(-(orbitAngle+drift)/photoStep()));
  if(document.activeElement?.closest('.photo-orbit__card'))orbitInner.children[current]?.focus({preventScroll:true});
}
orbitStage.addEventListener('pointerup',event=>finishDrag(event));
orbitStage.addEventListener('pointercancel',event=>finishDrag(event,true));
orbitStage.addEventListener('lostpointercapture',event=>finishDrag(event,true));
new IntersectionObserver(entries=>{galleryInView=entries[0].isIntersecting;lastChange=Date.now();},{threshold:.15}).observe(orbitStage);
function animateOrbit(time) {
  const elapsed=Math.min(.05,Math.max(0,(time-orbitLastFrame)/1000));orbitLastFrame=time;
  let changed=false;
  if(!drag&&orbitTarget!==null&&!reducedMotion.matches){
    const distance=orbitTarget-orbitAngle;
    orbitAngle+=distance*(1-Math.exp(-10*elapsed));
    if(Math.abs(distance)<.015){orbitAngle=orbitTarget;orbitTarget=null;}
    changed=true;
  }else if(photos.length&&playing&&!reducedMotion.matches&&galleryInView&&!document.hidden&&!$('#lightbox').open&&!drag&&(explicitPlay||(!hovered&&!focused))&&Date.now()-lastChange>1200){
    orbitAngle-=elapsed*4;changed=true;
    const nearest=wrapPhoto(Math.round(-orbitAngle/photoStep()));if(nearest!==current)showPhoto(nearest,true);
  }
  if(changed)paintRotation();
  requestAnimationFrame(animateOrbit);
}
requestAnimationFrame(animateOrbit);
reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches){playing=false;explicitPlay=false;paintPlay();}if(photos.length)showPhoto(current);});
paintPlay();
fetch('photos.json?v=20261105-4').then(response=>{if(!response.ok)throw new Error('Photos');return response.json();}).then(data=>{
  photos=data;orbitInner.style.setProperty('--quantity',String(photos.length));
  orbitInner.replaceChildren(...photos.map((photo,index)=>{
    const button=el('button','photo-orbit__card');button.type='button';
    button.style.setProperty('--index',String(index));button.style.setProperty('--photo-ratio',String(photo.width/photo.height));
    button.setAttribute('aria-label',`Ampliar foto ${index+1}: ${photo.caption}`);
    const image=el('img','photo-orbit__image');image.src=photo.src;image.alt=photo.alt;image.width=photo.width;image.height=photo.height;
    image.style.objectPosition=photo.focalPoint||'50% 50%';image.decoding='async';image.loading=index<3||index>=photos.length-3?'eager':'lazy';image.fetchPriority=index===0?'high':'low';image.draggable=false;
    button.append(image);
    button.addEventListener('focus',()=>{if(index!==current&&!drag&&button.matches(':focus-visible'))showPhoto(index);});
    button.addEventListener('click',()=>{if(Date.now()-lastGesture<500)return;showPhoto(index);openLightbox();});
    return button;
  }));
  $('#thumbnails').replaceChildren(...photos.map((photo,index)=>{
    const button=el('button');button.type='button';button.setAttribute('aria-label',`Ver foto ${index+1}: ${photo.caption}`);
    const image=el('img');image.src=photo.thumb;image.alt='';image.width=75;image.height=56;image.loading='lazy';image.decoding='async';image.draggable=false;
    button.append(image);button.addEventListener('click',()=>{explicitPlay=false;showPhoto(index);});return button;
  }));
  showPhoto(0);
}).catch(()=>{$('#gallery-detail').textContent='Recarregue a página para abrir todas as fotos.';playing=false;paintPlay();});
function openLightbox() {
  if(!photos.length)return;
  updateLightbox();$('#lightbox').showModal();document.body.style.overflow='hidden';
}
$('#expand-photo').addEventListener('click',openLightbox);
$('#close-lightbox').addEventListener('click',()=>$('#lightbox').close());
$('#lightbox').addEventListener('close',()=>{document.body.style.overflow='';lastChange=Date.now();});
$('#lightbox').addEventListener('click',event=>{
  if(event.target===$('#lightbox')){const bounds=$('#lightbox').getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)$('#lightbox').close();}
});
$('#lightbox').addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();showPhoto(current+(event.key==='ArrowRight'?1:-1));}});
let lightboxDrag=null;
$('#lightbox-image').draggable=false;
$('#lightbox-image').addEventListener('pointerdown',event=>{if(event.button===0&&event.isPrimary)lightboxDrag={id:event.pointerId,x:event.clientX,y:event.clientY};});
$('#lightbox-image').addEventListener('pointerup',event=>{
  if(!lightboxDrag||lightboxDrag.id!==event.pointerId)return;
  const dx=event.clientX-lightboxDrag.x,dy=event.clientY-lightboxDrag.y;lightboxDrag=null;
  if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.3)showPhoto(current+(dx<0?1:-1));
});
$('#lightbox-image').addEventListener('pointercancel',()=>lightboxDrag=null);

$('#share').addEventListener('click', async () => {
  const url = new URL('./', location.href).href;
  try {
    if (navigator.share) {await navigator.share({title:'Máximu’s no INIC',text:'Conheça as pesquisas e os momentos dos nossos estudantes no INIC.',url}); $('#share-status').textContent = 'Página compartilhada.';}
    else if (navigator.clipboard?.writeText) {await navigator.clipboard.writeText(url); $('#share-status').textContent = 'Link copiado! Envie para a família.';}
    else $('#share-status').textContent = `Copie o endereço: ${url}`;
  } catch(error) {if(error.name !== 'AbortError') $('#share-status').textContent = `Copie o endereço: ${url}`;}
});
