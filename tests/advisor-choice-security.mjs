import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {runAdvisorChoiceTests} from './automatic-orientation.test.mjs';
const env=await initializeTestEnvironment({projectId:'demo-maximus-inic',database:{host:'127.0.0.1',port:9000,rules:readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')}});
const db=uid=>env.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:true}).database();
let passed=0;
const count=name=>{passed++;console.log('PASS',name);};
const ok=async(name,promise)=>{const result=await assertSucceeds(promise);count(name);return result;};
const no=async(name,promise)=>{await assertFails(promise);count(name);};
try{await runAdvisorChoiceTests({env,db,ok,no,count});console.log(`ADVISOR CHOICE SECURITY TESTS PASSED: ${passed}`);}finally{await env.cleanup();}
