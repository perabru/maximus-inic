import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as databaseSdk from 'firebase/database';

// Execute the actual browser service against an authenticated emulator client.
// Auth itself is stubbed; every database read/write uses the published rules.
export function loadService(database,uid,{beforeUpdate,onWatch,authUser,authOverrides={}}={}) {
  const emulatorUrl=new URL(databaseSdk.ref(database).toString());
  if(!['127.0.0.1','localhost'].includes(emulatorUrl.hostname)||emulatorUrl.port!=='9000'||database.app.options.projectId!=='demo-maximus-inic'||(emulatorUrl.searchParams.has('ns')&&emulatorUrl.searchParams.get('ns')!=='demo-maximus-inic'))throw new Error('Service tests require only the local demo-maximus-inic emulator; production is forbidden.');
  const user={uid,email:`${uid}@example.com`,displayName:uid,emailVerified:true,providerData:[],...authUser};
  const context={...databaseSdk,console,Blob,btoa,atob,crypto:webcrypto,
    onAuthStateChanged:(_,callback)=>{queueMicrotask(()=>callback(user));return()=>{};},
    signInWithPopup:async()=>({user}),signInWithRedirect:async()=>{},
    updateProfile:async(_,patch)=>Object.assign(user,patch),
    sendEmailVerification:async()=>{},
    initializeApp:()=>({}),getApps:()=>[],getApp:()=>({}),getAuth:()=>({currentUser:user}),
    getDatabase:()=>database,setPersistence:()=>Promise.resolve(),browserSessionPersistence:{},
    GoogleAuthProvider:class {setCustomParameters(){}},getRedirectResult:()=>Promise.resolve(null),
    ...authOverrides,
    update:async(target,changes)=>{if(beforeUpdate)await beforeUpdate(target,changes);return databaseSdk.update(target,changes);},
    onValue:(target,...args)=>{if(onWatch)onWatch(target.toString());return databaseSdk.onValue(target,...args);}
  };
  vm.createContext(context);
  const source=readFileSync(new URL('../firebase-service.js',import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replace(/\bexport (?=(?:const|async function|function)\b)/g,'');
  vm.runInContext(source,context);
  return (name,...args)=>{context.__arguments=args;return vm.runInContext(`${name}(...__arguments)`,context);};
}
