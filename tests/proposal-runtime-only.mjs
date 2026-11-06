import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {runProposalRuntimeTests} from './proposal-runtime.test.mjs';
const env=await initializeTestEnvironment({projectId:'demo-maximus-inic',database:{host:'127.0.0.1',port:9000,rules:readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')}});
const db=uid=>env.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:true}).database();let passed=0;const count=name=>{passed++;console.log('PASS',name);};
const ok=async(name,promise)=>{await assertSucceeds(promise);count(name);},no=async(name,promise)=>{await assertFails(promise);count(name);};
try{await runProposalRuntimeTests({env,db,ok,no,count});console.log('PROPOSAL RUNTIME TESTS PASSED:',passed);}finally{await env.cleanup();}
