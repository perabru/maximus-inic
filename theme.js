(function(){
  'use strict';
  const preference=window.matchMedia('(prefers-color-scheme: dark)');
  let saved;
  try{saved=localStorage.getItem('maximus-theme');}catch{}
  function apply(theme){
    document.documentElement.dataset.theme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#191a32':'#3d4094');
    document.querySelectorAll('[data-theme-toggle]').forEach(button=>{if(button.classList.contains('icon-button')){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',theme==='dark'?'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0':'M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z');svg.append(path);button.replaceChildren(svg);}else button.textContent=theme==='dark'?'Modo claro':'Modo noturno';button.setAttribute('aria-label',theme==='dark'?'Ativar modo claro':'Ativar modo noturno');button.setAttribute('aria-pressed',String(theme==='dark'));});
  }
  apply(saved|| (preference.matches?'dark':'light'));
  document.addEventListener('DOMContentLoaded',()=>{apply(document.documentElement.dataset.theme);document.querySelectorAll('[data-theme-toggle]').forEach(button=>button.addEventListener('click',()=>{saved=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('maximus-theme',saved);}catch{}apply(saved);}));});
  preference.addEventListener('change',e=>{if(!saved)apply(e.matches?'dark':'light');});
})();
