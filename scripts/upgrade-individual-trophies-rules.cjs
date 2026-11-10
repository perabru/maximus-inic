// Narrow, additive migration. Use the current rules as input to preserve other apps.
// The function is also usable on JSON copied from the Firebase rules editor.
function upgradeIndividualTrophyRules(input) {
  const output=JSON.parse(JSON.stringify(input));
  const app=output.rules?.maximusInic,group=app?.groups?.$gid;
  const invitation=app?.invitations?.$invite,admission=app?.admissions?.$gid?.$uid;
  const article=app?.articles?.$gid;
  if(!group||!invitation||!admission||!article?.$section)throw new Error('Unexpected INIC rules structure.');
  if(group.workMode||app.articleMilestones)throw new Error('The migration already exists; compare the current rules before changing them.');
  const and=(node,key,condition)=>{
    if(typeof node[key]!=='string')throw new Error('Expected a rule expression: '+key);
    node[key]='('+node[key]+')&&('+condition+')';
  };
  // Legacy groups keep their previous behavior. A chosen mode is immutable;
  // absence in old records is not silently interpreted as individual work.
  and(group,'.validate',"(!data.exists()||newData.child('workMode').val()===data.child('workMode').val())&&(data.exists()||!newData.child('workMode').exists()||newData.child('workMode').val()!=='individual'||(root.child('maximusInic/roles').child(newData.child('createdBy').val()).val()!=='advisor'&&root.child('maximusInic/roles').child(newData.child('createdBy').val()).val()!=='coordinator'))");
  and(group,'.write',"newData.exists()||!newData.parent().parent().child('articleMilestones').child($gid).exists()");
  group.workMode={'.validate':"newData.isString()&&(newData.val()==='individual'||newData.val()==='group')"};
  const onlyAuthor="newData.parent().parent().child('workMode').val()!=='individual'||$uid===newData.parent().parent().child('createdBy').val()";
  and(group.members.$uid,'.validate',onlyAuthor);
  and(group.memberNames.$uid,'.validate',onlyAuthor);
  // Check the prospective parent tree so an atomic create cannot smuggle in
  // colleague invitations for a newly created individual work.
  and(invitation,'.validate',"newData.child('type').val()!=='member'||(data.exists()&&newData.child('status').val()!=='pending'&&newData.child('status').val()!=='accepted')||newData.parent().parent().child('groups').child(newData.child('groupId').val()).child('workMode').val()!=='individual'");
  and(admission,'.validate',"root.child('maximusInic/groups').child($gid).child('workMode').val()!=='individual'||root.child('maximusInic/invitations').child(newData.val()).child('type').val()==='advisor'");
  const saved="root.child('maximusInic/articles').child($gid).child($section)";
  // Database rules replace every occurrence. Literal replacements also work
  // consistently in emulator versions whose regex whitespace sets differ.
  const nonempty=saved+".child('text').val()"+[' ','\t','\r','\n','\f','\v','\u00a0','\ufeff'].map(character=>'.replace('+JSON.stringify(character)+",'')").join('')+'.length>0';
  app.articleMilestones={
    $gid:{
      '.read':article['.read'],
      '.write':article['.write'],
      $section:{
        '.write':article.$section['.write'],
        '.validate':"newData.hasChildren(['revision','completedBy','completedByName','completedAt','firstCompletedAt'])&&"+saved+".child('text').isString()&&"+nonempty+"&&newData.child('revision').val()==="+saved+".child('revision').val()&&(!data.exists()||newData.child('revision').val()>data.child('revision').val())",
        revision:{'.validate':'newData.isNumber()&&newData.val()%1===0&&newData.val()>0'},
        completedBy:{'.validate':'newData.isString()&&newData.val()===auth.uid'},
        completedByName:{'.validate':'newData.isString()&&newData.val().length>0&&newData.val().length<=100'},
        completedAt:{'.validate':'newData.isNumber()&&newData.val()===now'},
        firstCompletedAt:{'.validate':"newData.isNumber()&&newData.val()===(data.exists()?data.val():now)"},
        $other:{'.validate':false}
      }
    }
  };
  return output;
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={upgradeIndividualTrophyRules};
  if(require.main===module){
    const fs=require('node:fs');
    const source=process.argv[2],destination=process.argv[3];
    if(!source||!destination)throw new Error('Usage: node scripts/upgrade-individual-trophies-rules.cjs source.json destination.json');
    const rules=upgradeIndividualTrophyRules(JSON.parse(fs.readFileSync(source,'utf8')));
    fs.writeFileSync(destination,JSON.stringify(rules)+'\n');
    console.log('Added individual work and article trophy rules. Other namespaces were preserved.');
  }
}
