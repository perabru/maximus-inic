(function(){
  'use strict';
  let installPrompt;
  const buttons=()=>document.querySelectorAll('[data-install-app]');
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;buttons().forEach(button=>button.hidden=false);});
  window.addEventListener('appinstalled',()=>{installPrompt=null;buttons().forEach(button=>button.hidden=true);});
  document.addEventListener('DOMContentLoaded',()=>{
    buttons().forEach(button=>{if(installPrompt)button.hidden=false;button.addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;buttons().forEach(b=>b.hidden=true);}else location.href='instalar.html';});});
    if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
  });
})();
