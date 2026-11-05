(function(){
  'use strict';
  function loader(){
    const element=document.createElement('div');
    element.className='book-loader';
    element.setAttribute('aria-hidden','true');
    for(let i=0;i<9;i++){const box=document.createElement('div');box.className='book-loader__box';element.append(box);}
    return element;
  }
  window.MaximusUI=Object.freeze({loader});
  function upgradeButtons(root=document){
    const candidates=[];
    if(root instanceof Element&&root.matches('.button,.uiverse-button,.primary,.secondary'))candidates.push(root);
    root.querySelectorAll?.('button.button,a.button,button.primary,a.primary,button.secondary,a.secondary,.uiverse-button').forEach(button=>candidates.push(button));
    for(const button of candidates){
      if(!button.matches('button,a')||button.hasAttribute('data-theme-toggle')||button.closest('.theme-switch')||button.querySelector(':scope > .uiverse-button__blobs'))continue;
      button.classList.add('uiverse-button');
      const blobs=document.createElement('span');blobs.className='uiverse-button__blobs';blobs.setAttribute('aria-hidden','true');
      for(let i=0;i<3;i++)blobs.append(document.createElement('span'));
      button.append(blobs);
    }
  }
  function installFilter(){
    if(document.getElementById('maximus-goo'))return;
    const ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg');svg.classList.add('ui-filter');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
    const defs=document.createElementNS(ns,'defs'),filter=document.createElementNS(ns,'filter');filter.id='maximus-goo';
    const blur=document.createElementNS(ns,'feGaussianBlur');blur.setAttribute('in','SourceGraphic');blur.setAttribute('stdDeviation','10');blur.setAttribute('result','blur');
    const matrix=document.createElementNS(ns,'feColorMatrix');matrix.setAttribute('in','blur');matrix.setAttribute('mode','matrix');matrix.setAttribute('values','1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7');matrix.setAttribute('result','goo');
    const blend=document.createElementNS(ns,'feBlend');blend.setAttribute('in','SourceGraphic');blend.setAttribute('in2','goo');
    filter.append(blur,matrix,blend);defs.append(filter);svg.append(defs);document.body.append(svg);
  }
  function showSplash(){
    try{if(sessionStorage.getItem('maximus-opening-v2'))return;sessionStorage.setItem('maximus-opening-v2','1');}catch{}
    const splash=document.createElement('div');splash.className='app-splash';splash.setAttribute('role','dialog');splash.setAttribute('aria-modal','true');splash.setAttribute('aria-label','Abrindo Máximu’s INIC');
    const brand=document.createElement('div');brand.className='splash-brand';
    const image=document.createElement('img');image.src='assets/maximus-banner.png';image.alt='Escola Máximu’s';image.width=1600;image.height=400;brand.append(image);
    const title=document.createElement('p');title.textContent='INIC';title.className='splash-title';
    const skip=document.createElement('button');skip.type='button';skip.className='splash-skip';skip.textContent='Pular abertura';
    splash.append(brand,title,loader(),skip);const previousFocus=document.activeElement;const behind=[...document.body.children].map(element=>({element,inert:element.inert}));behind.forEach(({element})=>element.inert=true);document.body.append(splash);skip.focus({preventScroll:true});
    const started=performance.now();let dismissed=false;
    const dismiss=()=>{if(dismissed)return;dismissed=true;behind.forEach(({element,inert})=>element.inert=inert);if(splash.contains(document.activeElement)){if(previousFocus instanceof HTMLElement)previousFocus.focus({preventScroll:true});else skip.blur();}splash.classList.add('is-leaving');setTimeout(()=>splash.remove(),180);document.removeEventListener('keydown',escape);};
    const escape=event=>{if(event.key==='Escape')dismiss();};
    document.addEventListener('keydown',escape);skip.addEventListener('click',dismiss);
    const minimum=matchMedia('(prefers-reduced-motion: reduce)').matches?100:650;
    Promise.race([image.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,1200))]).then(()=>setTimeout(dismiss,Math.max(0,minimum-(performance.now()-started))));
    setTimeout(dismiss,1800);
  }
  function start(){
    installFilter();upgradeButtons();showSplash();
    new MutationObserver(records=>{
      for(const record of records){
        if(record.type==='childList'){
          if(record.target instanceof Element&&record.target.matches('button.uiverse-button,a.uiverse-button'))upgradeButtons(record.target);
          record.addedNodes.forEach(node=>{if(node instanceof Element&&!node.closest('.uiverse-button__blobs'))upgradeButtons(node);});
        }
      }
    }).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
