import assert from 'node:assert/strict';
import test from 'node:test';
import {planSchoolYearMigration,applySchoolYearPlan,migrateSchoolYears} from '../scripts/school-years/migrate.mjs';

function fixture(){return {
  groups:{g1:{name:'Grupo preservado',year:2027,createdBy:'s1',members:{s1:true,s2:true,teacher:true},memberNames:{s1:'Privado',s2:'Privado',teacher:'Privado'},proposal:{filename:'trabalho.pdf'},status:'active'}},
  users:{s1:{name:'Privado',email:'private1@example.com',year:'2º ano'},s2:{name:'Privado',email:'private2@example.com',year:'2º ano'},teacher:{year:''}},
  roles:{teacher:'advisor'},
  userGroups:{s1:{g1:true},s2:{g1:true},teacher:{g1:true}},
  peopleDirectory:{s1:{role:'student',year:'2º ano',groupId:'g1'},s2:{role:'student',year:'2º ano',groupId:'g1'},teacher:{role:'advisor',year:'',groupId:''}},
  messages:{g1:{m1:{text:'Texto preservado'}}},
  agreementFiles:{2027:{s1:{base64:'synthetic-private-payload'}}}
};}
const reason=(snapshot,expected)=>assert.ok(planSchoolYearMigration(snapshot).skipped.some(item=>item.reason===expected));

test('plans the school year without changing event edition or any source data',()=>{
  const data=fixture(),before=structuredClone(data),plan=planSchoolYearMigration(data);
  assert.deepEqual(plan.assignments,[{groupId:'g1',schoolYear:'2º ano'}]);
  assert.deepEqual(data,before);
  const after=applySchoolYearPlan(data,plan),expected=structuredClone(data);expected.groups.g1.schoolYear='2º ano';
  assert.deepEqual(after,expected);assert.equal(after.groups.g1.year,2027);
});
test('does not treat approved advisor school years as student memberships',()=>{
  const data=fixture();data.users.teacher.year='3º ano';
  assert.equal(planSchoolYearMigration(data).assignments[0].schoolYear,'2º ano');
});
test('missing role is a student and cannot masquerade as requested teacher',()=>{
  const data=fixture();data.users.s2.requestedRole='advisor';data.users.s2.year='3º ano';data.peopleDirectory.s2.year='3º ano';
  reason(data,'mixed-school-years');
});
test('leaves mixed groups untouched and preserves all members',()=>{
  const data=fixture();data.users.s2.year='1º ano';data.peopleDirectory.s2.year='1º ano';
  const plan=planSchoolYearMigration(data);reason(data,'mixed-school-years');
  assert.deepEqual(plan.assignments,[]);assert.strictEqual(applySchoolYearPlan(data,plan),data);
  assert.equal(data.groups.g1.members.s2,true);
});
test('requires canonical years for every student',()=>{
  for(const value of ['',2027,'Segundo ano','2o ano',null]){const data=fixture();data.users.s2.year=value;reason(data,'invalid-student-year');}
});
test('does not guess missing profiles',()=>{const data=fixture();delete data.users.s2;reason(data,'missing-profile');});
test('requires a membership index even for staff before classification',()=>{
  for(const uid of ['s1','teacher']){const data=fixture();delete data.userGroups[uid];reason(data,'missing-membership-index');}
});
test('requires a consistent sole student membership',()=>{
  const data=fixture();data.groups.g2={...data.groups.g1,members:{s1:true}};data.userGroups.s1.g2=true;
  reason(data,'student-multiple-groups');assert.deepEqual(planSchoolYearMigration(data).assignments,[]);
});
test('rejects a stale second index even without the second actual group',()=>{
  const data=fixture();data.userGroups.s1.stale=true;reason(data,'student-multiple-groups');
});
test('requires the public claim and year to match the private registration',()=>{
  for(const patch of [{groupId:''},{year:'3º ano'},{role:'advisor'}]){
    const data=fixture();Object.assign(data.peopleDirectory.s1,patch);reason(data,'directory-needs-reconciliation');
  }
});
test('never assigns a grade to teacher-only or empty groups automatically',()=>{
  for(const members of [{teacher:true},{}]){const data=fixture();data.groups.g1.members=members;reason(data,'no-students');}
});
test('never rewrites a conflicting existing school year',()=>{
  for(const schoolYear of ['1º ano','',2027]){const data=fixture();data.groups.g1.schoolYear=schoolYear;reason(data,'existing-school-year-conflict');}
});
test('rerunning the migration is idempotent',()=>{
  const data=fixture(),after=applySchoolYearPlan(data,planSchoolYearMigration(data));
  const second=planSchoolYearMigration(after);
  assert.deepEqual(second.assignments,[]);assert.equal(second.alreadyClassified,1);assert.strictEqual(applySchoolYearPlan(after,second),after);
});
test('groups being deleted and malformed memberships are never classified',()=>{
  const deleting=fixture();deleting.groups.g1.status='deleting';reason(deleting,'group-deleting');
  const malformed=fixture();malformed.groups.g1.members.s2='yes';reason(malformed,'invalid-membership');
});
test('reports have IDs, years and reason codes only',()=>{
  const report=JSON.stringify(planSchoolYearMigration(fixture()));
  assert.ok(!report.includes('@example.com')&&!report.includes('Privado')&&!report.includes('synthetic-private-payload')&&!report.includes('Texto preservado'));
});

function memoryRef(initial,{concurrentChange}={}){
  let data=structuredClone(initial),transactions=0,reads=[];
  return {
    child:key=>({once:async()=>{reads.push(key);return {val:()=>data[key]};}}),
    once:async()=>{reads.push('root');return {val:()=>data};},
    transaction:async updater=>{
      transactions++;
      const first=updater(data);
      if(concurrentChange)data=concurrentChange(structuredClone(data));
      const latest=concurrentChange?updater(data):first;
      if(latest===undefined)return {committed:false,snapshot:{val:()=>data}};
      data=latest;return {committed:true,snapshot:{val:()=>data}};
    },
    state:()=>({data,transactions,reads})
  };
}
test('dry-run reads only required collections and never begins a transaction',async()=>{
  const ref=memoryRef(fixture()),report=await migrateSchoolYears(ref);
  assert.equal(report.mode,'dry-run');assert.equal(report.committed,false);assert.equal(ref.state().transactions,0);
  assert.deepEqual(ref.state().reads,['groups','users','roles','userGroups','peopleDirectory']);
  assert.equal(ref.state().data.groups.g1.schoolYear,undefined);
});
test('explicit application commits only the schoolYear field',async()=>{
  const data=fixture(),ref=memoryRef(data),report=await migrateSchoolYears(ref,{apply:true});
  assert.equal(report.committed,true);assert.equal(ref.state().transactions,1);
  const expected=structuredClone(data);expected.groups.g1.schoolYear='2º ano';assert.deepEqual(ref.state().data,expected);
});
test('concurrent profile-year change forces a new plan and preserves the now-mixed group',async()=>{
  const ref=memoryRef(fixture(),{concurrentChange:data=>{data.users.s2.year='3º ano';data.peopleDirectory.s2.year='3º ano';return data;}});
  const report=await migrateSchoolYears(ref,{apply:true});
  assert.equal(report.committed,false);assert.equal(ref.state().data.groups.g1.schoolYear,undefined);
  assert.ok(report.skipped.some(item=>item.reason==='mixed-school-years'));assert.equal(ref.state().data.groups.g1.members.s2,true);
});
test('concurrent membership or role change is rechecked before commit',async()=>{
  for(const concurrentChange of [
    data=>{data.groups.g1.members.unknown=true;return data;},
    data=>{delete data.roles.teacher;return data;}
  ]){
    const ref=memoryRef(fixture(),{concurrentChange});const report=await migrateSchoolYears(ref,{apply:true});
    assert.equal(report.committed,false);assert.equal(ref.state().data.groups.g1.schoolYear,undefined);
  }
});
test('a concurrent valid reclassification is preserved without another write',async()=>{
  const ref=memoryRef(fixture(),{concurrentChange:data=>{data.groups.g1.schoolYear='2º ano';return data;}});
  const report=await migrateSchoolYears(ref,{apply:true});assert.equal(report.committed,false);assert.equal(report.alreadyClassified,1);
  assert.equal(ref.state().data.groups.g1.schoolYear,'2º ano');
});
