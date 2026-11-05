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
const controls = ['#search', '#year', '#advisor', '#school'];
function displayTitle(title) {
  let value = title.toLocaleLowerCase('pt-BR').replace(/\.$/, '');
  value = value.charAt(0).toLocaleUpperCase('pt-BR') + value.slice(1);
  const words = {'ia':'IA','vants':'VANTs','esp-32':'ESP-32','wroom':'WROOM','dopplertrack':'DopplerTrack','biotable':'BioTable','honeybee':'HoneyBee','coca-cola':'Coca-Cola','doppler':'Doppler'};
  return value.replace(/escola máximu[’']s/gi, 'Escola Máximu’s').replace(/\b(ia|vants|esp-32|wroom|dopplertrack|biotable|honeybee|coca-cola|doppler)\b/gi, (word) => words[word.toLowerCase()]);
}
function getMatches(paper) {
  if (paper.matchedPeople) return paper.matchedPeople;
  const names = normalize([...(paper.authors || []), ...(paper.supervisors || paper.advisors || [])].join(' '));
  return ['Bruno', 'Taynara'].filter(name => names.includes(name.toLowerCase()));
}
function makeCard(paper) {
  const card = el('article', 'article-card');
  const meta = el('div', 'article-meta');
  meta.append(el('span', 'year-badge', paper.year), el('span', `school-badge${paper.isMaximus ? ' maximus' : ''}`, paper.isMaximus ? 'Escola Máximu’s' : 'Colégios Univap'));
  card.append(meta, el('p', 'topic', paper.topic), el('h3', '', displayTitle(paper.title)), el('p', 'description', paper.description));
  if (paper.award) card.append(el('p', 'award', typeof paper.award === 'string' ? paper.award : '2º lugar · Área Técnico · INIC 2025'));
  const acknowledgement = paper.relationship === 'acknowledgement' || paper.relationship === 'reference';
  if (acknowledgement) card.append(el('p', 'award', paper.relationship === 'reference' ? 'Nome citado nas referências' : 'Nome citado nos agradecimentos'));
  const advisors = el('p', 'advisors');
  advisors.append(el('strong', '', 'Orientação: '), document.createTextNode((paper.supervisors || paper.advisors || []).join(' · ') || 'Consulte o artigo'));
  card.append(advisors);
  const details = el('details');
  details.append(el('summary', '', 'Autores e informações'));
  const authorLine = el('p');
  authorLine.append(el('strong', '', 'Autores no PDF: '), document.createTextNode((paper.authors || []).join(', ')));
  details.append(authorLine);
  const institution = el('p');
  institution.append(el('strong', '', 'Instituição: '), document.createTextNode(paper.institution));
  details.append(institution);
  if (paper.note) details.append(el('p', 'article-note', paper.note));
  if (paper.indexTitle && paper.title !== paper.indexTitle) details.append(el('p', '', `Título no índice: ${paper.indexTitle}`));
  const source = el('a', 'text-link', 'Conferir no índice oficial →');
  source.href = paper.source;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  details.append(source);
  card.append(details);
  const link = el('a', 'read-link');
  link.href = paper.pdfUrl || paper.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `Ler artigo em PDF: ${displayTitle(paper.title)} (abre em nova aba)`);
  link.append(document.createTextNode('Ler artigo · PDF'), el('span', '', '→'));
  link.lastChild.setAttribute('aria-hidden', 'true');
  card.append(link);
  return card;
}
function applyFilters(resetLimit = true) {
  if (resetLimit) visibleLimit = 6;
  const query = normalize($('#search').value).trim();
  const year = $('#year').value;
  const advisor = $('#advisor').value;
  const school = $('#school').value;
  const filtered = papers.filter(p => (year === 'all' || p.year === Number(year)) && (advisor === 'all' || getMatches(p).includes(advisor)) && (school === 'all' || p.isMaximus === (school === 'maximus')) && (!query || query.split(/\s+/).every(word => normalize([p.title,p.description,p.students,(p.authors || []).join(' '),(p.supervisors || []).join(' '),p.topic,p.institution,p.note].join(' ')).includes(word))));
  $('#articles').replaceChildren(...filtered.slice(0, visibleLimit).map(makeCard));
  const shown = Math.min(visibleLimit, filtered.length);
  $('#results-count').textContent = filtered.length ? `${shown} de ${filtered.length} ${filtered.length === 1 ? 'artigo encontrado' : 'artigos encontrados'}` : year === '2026' ? 'Anais de 2026 ainda não localizados' : 'Nenhum artigo encontrado';
  $('#empty').hidden = filtered.length > 0;
  $('#empty-title').textContent = year === '2026' ? 'Aguardando os anais de 2026' : 'Nenhum artigo com esses filtros';
  $('#empty-text').textContent = year === '2026' ? 'Os PDFs desta edição ainda não foram localizados no portal oficial. Enquanto isso, conheça as pesquisas de 2025 e as fotos das apresentações.' : 'Tente outro tema, nome de estudante ou limpe os filtros para explorar a biblioteca.';
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
fetch('articles.json').then(r => {if (!r.ok) throw new Error('Catalogue'); return r.json();}).then(data => {
  papers = [...data.articles].sort((a,b) => Number(b.isMaximus) - Number(a.isMaximus) || a.title.localeCompare(b.title,'pt-BR'));
  $('#total-count').textContent = papers.length;
  applyFilters();
}).catch(() => {
  $('#results-count').textContent = 'Não foi possível carregar a biblioteca. Recarregue a página ou consulte o índice oficial abaixo.';
});

let photos = [];
let current = 0;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let playing = !reducedMotion.matches;
let galleryInView = false;
let interacting = false;
let focused = false;
let lastChange = Date.now();
function paintPlay() {
  $('#play').textContent = playing ? 'Ⅱ' : '▶';
  $('#play').setAttribute('aria-label', playing ? 'Pausar troca automática de fotos' : 'Iniciar troca automática de fotos');
  $('#play').setAttribute('aria-pressed', String(playing));
}
function showPhoto(index, automatic = false) {
  if (!photos.length) return;
  current = (index + photos.length) % photos.length;
  const photo = photos[current];
  const image = $('#gallery-image');
  image.src = photo.src;
  image.alt = photo.alt;
  image.width = photo.width;
  image.height = photo.height;
  $('#gallery-caption').textContent = photo.caption;
  $('#gallery-detail').textContent = photo.detail;
  $('#photo-counter').setAttribute('aria-live', automatic ? 'off' : 'polite');
  $('#photo-counter').textContent = `${String(current + 1).padStart(2, '0')} / ${photos.length}`;
  document.querySelectorAll('#thumbnails button').forEach((button, index) => button.setAttribute('aria-current', String(index === current)));
  lastChange = Date.now();
  if ($('#lightbox').open) updateLightbox();
}
function updateLightbox() {
  $('#lightbox-image').src = photos[current].src;
  $('#lightbox-image').alt = photos[current].alt;
  $('#lightbox-caption').textContent = photos[current].caption;
  $('#lightbox-counter').textContent = `${current + 1} / ${photos.length}`;
}
$('#previous').addEventListener('click', () => showPhoto(current - 1));
$('#next').addEventListener('click', () => showPhoto(current + 1));
$('#play').addEventListener('click', () => { playing = !playing; lastChange = Date.now(); paintPlay(); });
$('.gallery').addEventListener('mouseenter', () => interacting = true);
$('.gallery').addEventListener('mouseleave', () => { interacting = false; lastChange = Date.now(); });
$('.gallery').addEventListener('focusin', () => focused = true);
$('.gallery').addEventListener('focusout', e => { focused = $('.gallery').contains(e.relatedTarget); lastChange = Date.now(); });
$('.gallery').addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); showPhoto(current + (e.key === 'ArrowRight' ? 1 : -1)); }
});
let touchStart = null;
$('.gallery-stage').addEventListener('touchstart', e => { touchStart = {x:e.changedTouches[0].clientX,y:e.changedTouches[0].clientY}; }, {passive:true});
$('.gallery-stage').addEventListener('touchend', e => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) showPhoto(current + (dx < 0 ? 1 : -1));
  touchStart = null;
}, {passive:true});
new IntersectionObserver(entries => {galleryInView = entries[0].isIntersecting; lastChange = Date.now();}, {threshold:.25}).observe($('.gallery'));
setInterval(() => {if (playing && galleryInView && !interacting && !focused && !document.hidden && !$('#lightbox').open && Date.now() - lastChange > 6500) showPhoto(current + 1, true);}, 1000);
reducedMotion.addEventListener('change', e => {if(e.matches){playing = false; paintPlay();}});
paintPlay();
fetch('photos.json').then(r => {if(!r.ok) throw new Error('Photos'); return r.json();}).then(data => {
  photos = data;
  $('#thumbnails').replaceChildren(...photos.map((photo,index) => {
    const button = el('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Ver foto ${index + 1}: ${photo.caption}`);
    const image = el('img');
    image.src = photo.thumb;
    image.alt = '';
    image.width = 75;
    image.height = 56;
    image.loading = 'lazy';
    button.append(image);
    button.addEventListener('click', () => showPhoto(index));
    return button;
  }));
  showPhoto(0);
}).catch(() => {$('#gallery-detail').textContent = 'Recarregue a página para abrir todas as fotos.'; playing = false; paintPlay();});
$('#expand-photo').addEventListener('click', () => {if(photos.length) {updateLightbox(); $('#lightbox').showModal(); document.body.style.overflow = 'hidden';}});
$('#close-lightbox').addEventListener('click', () => $('#lightbox').close());
$('#lightbox').addEventListener('close', () => { document.body.style.overflow = ''; lastChange = Date.now(); });
$('#lightbox').addEventListener('click', e => {if (e.target === $('#lightbox')) { const r = $('#lightbox').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('#lightbox').close(); }});
$('#lightbox-prev').addEventListener('click', () => showPhoto(current - 1));
$('#lightbox-next').addEventListener('click', () => showPhoto(current + 1));
$('#lightbox').addEventListener('keydown', e => {if(e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); showPhoto(current + (e.key === 'ArrowRight' ? 1 : -1)); }});

$('#share').addEventListener('click', async () => {
  const url = new URL('./', location.href).href;
  try {
    if (navigator.share) {await navigator.share({title:'Máximu’s no INIC',text:'Conheça as pesquisas e os momentos dos nossos estudantes no INIC.',url}); $('#share-status').textContent = 'Página compartilhada.';}
    else if (navigator.clipboard?.writeText) {await navigator.clipboard.writeText(url); $('#share-status').textContent = 'Link copiado! Envie para a família.';}
    else $('#share-status').textContent = `Copie o endereço: ${url}`;
  } catch(error) {if(error.name !== 'AbortError') $('#share-status').textContent = `Copie o endereço: ${url}`;}
});
