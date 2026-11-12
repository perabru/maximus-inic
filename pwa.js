(function(){
  'use strict';

  const DISMISSED_KEY='INIC_INSTALL_DISMISSED_AT';
  const SNOOZE_MS=7*24*60*60*1000;
  const ua=navigator.userAgent||'';
  const ios=/iPhone|iPad|iPod/i.test(ua)||(/Mac/i.test(navigator.platform||'')&&navigator.maxTouchPoints>1);
  const mobile=ios||navigator.userAgentData?.mobile===true||/Android|IEMobile|Opera Mini/i.test(ua);
  const inApp=/FBAN|FBAV|Instagram|MicroMessenger|\bLine\//i.test(ua);
  const secure=location.protocol==='https:';
  const modes=['standalone','minimal-ui','fullscreen'].map(mode=>window.matchMedia?.(`(display-mode: ${mode})`)).filter(Boolean);
  const boundButtons=new WeakSet();
  let nativePrompt=null,ready=false,busy=false,installed=false,memoryDismissedAt=0,ui=null;

  function isInstalled(){return installed||navigator.standalone===true||modes.some(mode=>mode.matches);}
  function readDismissal(){
    try{const value=Number(window.localStorage.getItem(DISMISSED_KEY));return Number.isFinite(value)&&value>0?Math.max(value,memoryDismissedAt):memoryDismissedAt;}
    catch{return memoryDismissedAt;}
  }
  function snoozed(){const elapsed=Date.now()-readDismissal();return elapsed>=0&&elapsed<SNOOZE_MS;}
  function rememberDismissal(){memoryDismissedAt=Date.now();try{window.localStorage.setItem(DISMISSED_KEY,String(memoryDismissedAt));}catch{/* Dismissal still applies to this page when storage is unavailable. */}}
  function element(tag,className='',text){const item=document.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=text;return item;}
  function control(text,className,id,action){const item=element('button',className,text);item.type='button';item.id=id;item.addEventListener('click',action);return item;}
  function hideOffer(){if(ui)ui.offer.hidden=true;}
  function dismiss(){if(busy)return;rememberDismissal();hideOffer();}

  function buildOffer(){
    if(ui)return ui;
    const offer=element('section','pwa-install-offer');offer.id='pwa-install-offer';offer.hidden=true;offer.setAttribute('aria-labelledby','pwa-install-title');offer.setAttribute('aria-describedby','pwa-install-description');
    const card=element('div','pwa-install-card'),header=element('header','pwa-install-header'),copy=element('div','pwa-install-copy');
    const icon=element('img','pwa-install-icon');icon.src='assets/icons/icon-192.png';icon.width=56;icon.height=56;icon.alt='';
    const title=element('h2','','Seu INIC na Tela de Início');title.id='pwa-install-title';
    const description=element('p','','Instale para abrir seus grupos, mensagens e entregas direto pelo ícone do aplicativo.');description.id='pwa-install-description';
    copy.append(element('p','pwa-install-kicker','MÁXIMU’S · INIC'),title,description);
    const close=control('×','pwa-install-close','pwa-install-close',dismiss);close.setAttribute('aria-label','Fechar convite de instalação');
    header.append(icon,copy,close);
    const actions=element('div','pwa-install-actions');
    const primary=control('Instalar aplicativo','pwa-install-primary','pwa-install-primary',requestInstall);
    primary.setAttribute('aria-controls','pwa-install-help');primary.setAttribute('aria-expanded','false');
    const later=control('Agora não','pwa-install-later','pwa-install-later',dismiss);actions.append(primary,later);
    const help=element('div','pwa-install-help');help.id='pwa-install-help';help.hidden=true;
    const status=element('p','pwa-install-status');status.id='pwa-install-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
    card.append(header,actions,help,status);offer.append(card);document.body.append(offer);
    ui={offer,primary,later,close,help,status};
    offer.addEventListener('keydown',event=>{if(event.key==='Escape'&&!busy){event.preventDefault();dismiss();}});
    return ui;
  }
  function updateControls(){
    const unavailable=isInstalled();
    document.querySelectorAll('[data-install-app]').forEach(button=>{
      button.hidden=unavailable;button.disabled=busy;
      if(!boundButtons.has(button)){boundButtons.add(button);button.addEventListener('click',requestInstall);}
    });
    if(!ui)return;
    ui.primary.disabled=busy;ui.later.disabled=busy;ui.close.disabled=busy;
    ui.primary.textContent=busy?'Abrindo instalação…':nativePrompt?'Instalar aplicativo':ios?'Adicionar à Tela de Início':'Ver como instalar';
    ui.primary.setAttribute('aria-expanded',String(!ui.help.hidden));
    if(unavailable)hideOffer();
  }
  function showOffer(manual=false){
    if(!ready||!secure||isInstalled()||(!manual&&(!mobile||snoozed())))return false;
    const current=buildOffer();current.offer.hidden=false;updateControls();return true;
  }
  function showHelp(){
    if(!showOffer(true))return;
    const steps=element('ol','pwa-install-steps');
    const instructions=ios?[
      inApp?'Abra este site no Safari usando a opção de abrir no navegador. No Safari, toque em Compartilhar; se necessário, abra o menu Mais primeiro.':'Toque em Compartilhar no navegador. Se necessário, abra o menu Mais primeiro.',
      'Escolha “Adicionar à Tela de Início”.',
      'Se aparecer “Abrir como App”, deixe essa opção ativada e toque em “Adicionar”.'
    ]:mobile?[
      inApp?'Abra este site no Chrome pelo menu do aplicativo. No Chrome, abra o menu do navegador (⋮).':'Abra o menu do navegador (⋮).',
      'Escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.',
      'Confirme em “Instalar” ou “Adicionar”. Depois, abra o ícone Máximu’s INIC.'
    ]:[
      'No Chrome ou Edge, procure o ícone de instalação na barra de endereço ou no menu do navegador.',
      'Escolha instalar este site como aplicativo e confirme.'
    ];
    instructions.forEach(text=>steps.append(element('li','',text)));
    const more=element('a','pwa-install-help-link','Ver o guia de instalação');more.href='instalar.html';
    ui.help.replaceChildren(element('h3','',ios?'No iPhone ou iPad':'Instalar pelo navegador'),steps);
    if(ios&&!inApp)ui.help.append(element('p','','Se a opção não aparecer, abra este mesmo site no Safari.'));
    else if(mobile&&!ios)ui.help.append(element('p','','Se a opção não aparecer, abra este site no Chrome atualizado. O navegador decide quando a instalação está disponível.'));
    ui.help.append(more);ui.help.hidden=false;ui.primary.setAttribute('aria-expanded','true');
    ui.status.textContent='Siga as etapas acima para adicionar o aplicativo.';
  }
  async function requestInstall(){
    if(busy||isInstalled())return;
    if(!showOffer(true))return;
    if(!nativePrompt){showHelp();return;}
    // The browser permits one prompt per event, directly from this user gesture.
    const event=nativePrompt;nativePrompt=null;busy=true;ui.status.textContent='Confirme a instalação na janela do navegador.';updateControls();
    try{
      const promptResult=await event.prompt();
      const choice=event.userChoice?await event.userChoice:promptResult;
      if(choice?.outcome==='accepted'){
        installed=true;rememberDismissal();hideOffer();
      }else if(choice?.outcome==='dismissed'){
        rememberDismissal();hideOffer();
      }else if(!isInstalled()){
        showHelp();ui.status.textContent='Se a instalação não abriu, use as opções do navegador acima.';
      }
    }catch{
      if(!isInstalled()){showHelp();ui.status.textContent='Não foi possível abrir a instalação automática. Você pode usar as etapas acima.';}
    }finally{busy=false;updateControls();}
  }
  function reflectInstalled(){
    if(!isInstalled())return;
    installed=true;nativePrompt=null;rememberDismissal();hideOffer();updateControls();
  }
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    if(isInstalled())return;
    nativePrompt=event;
    if(ready){updateControls();showOffer();}
  });
  window.addEventListener('appinstalled',()=>{installed=true;reflectInstalled();});
  modes.forEach(mode=>{if(mode.addEventListener)mode.addEventListener('change',reflectInstalled);else mode.addListener?.(reflectInstalled);});
  window.addEventListener('storage',event=>{if(event.key===DISMISSED_KEY&&snoozed())hideOffer();});
  window.addEventListener('pageshow',()=>{if(ready){if(isInstalled())reflectInstalled();else{updateControls();if(snoozed())hideOffer();}}});
  function start(){
    if(ready)return;ready=true;updateControls();showOffer();
    if('serviceWorker' in navigator&&secure){try{const registration=navigator.serviceWorker.register('./sw.js',{scope:'./'});registration?.catch?.(()=>{});}catch{/* Help remains usable if registration is unavailable. */}}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
