import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as databaseSdk from 'firebase/database';

// Execute the actual browser service against an authenticated emulator client.
// Auth itself is stubbed; every database read/write uses the published rules.
export function loadService(database,uid,{beforeUpdate,onWatch}={}) {
  const user={uid,email:`${uid}@example.com`,displayName:uid};
  const context={...databaseSdk,console,
    initializeApp:()=>({}),getApps:()=>[],getApp:()=>({}),getAuth:()=>({currentUser:user}),
    getDatabase:()=>database,setPersistence:()=>Promise.resolve(),browserSessionPersistence:{},
    GoogleAuthProvider:class {setCustomParameters(){}},getRedirectResult:()=>Promise.resolve(null),
    update:async(target,changes)=>{if(beforeUpdate)await beforeUpdate(target,changes);return databaseSdk.update(target,changes);},
    onValue:(target,...args)=>{if(onWatch)onWatch(target.toString());return databaseSdk.onValue(target,...args);}
  };
  vm.createContext(context);
  const source=readFileSync(new URL('../firebase-service.js',import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replace(/\bexport (?=(?:const|async function|function)\b)/g,'');
  vm.runInContext(source,context);
  return (name,...args)=>{context.__arguments=args;return vm.runInContext(`${name}(...__arguments)`,context);};
}
