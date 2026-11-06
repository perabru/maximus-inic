import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../tcc-proposal.js',import.meta.url),'utf8');
const {createProposalEditor,createProposalView,validateProposalFile}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.events={};this.attributes={};this.value='';this.disabled=false;this._text='';}
  append(...items){this.children.push(...items);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(key,callback){this.events[key]=callback;}
  dispatch(key){this.events[key]?.({currentTarget:this,target:this});}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(item=>item.textContent||'').join('');}
}
globalThis.document={createElement:tag=>new Element(tag)};
const walk=(node,predicate)=>[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>walk(child,predicate))];
const fields=editor=>walk(editor.element,node=>node.tagName==='TEXTAREA');
function choose(editor,mode){const radio=walk(editor.element,node=>node.type==='radio'&&node.value===mode)[0];radio.checked=true;radio.dispatch('change');}
const pdf=(size=100)=>({name:'proposta.pdf',type:'application/pdf',size});

test('empty or whitespace proposal cannot precede an invitation',()=>{const editor=createProposalEditor();assert.throws(()=>editor.read(),/Escreva ao menos/);fields(editor)[0].value=' \n\t ';assert.throws(()=>editor.read(),/Escreva ao menos/);editor.destroy();});
test('one to four canonical topics are accepted without creating extra topics',()=>{const editor=createProposalEditor();fields(editor)[2].value='  Testar sensores de temperatura na sala.  ';assert.deepEqual(editor.read(),{proposal:{mode:'text',topics:{method:'Testar sensores de temperatura na sala.'}},proposalFile:null});for(const [index,field] of fields(editor).entries())field.value='Tópico '+index;assert.equal(Object.keys(editor.read().proposal.topics).length,4);editor.destroy();});
test('oversized topic is rejected even when set outside normal HTML constraints',()=>{const editor=createProposalEditor();fields(editor)[0].value='a'.repeat(2001);assert.throws(()=>editor.read(),/2.000 caracteres/);editor.destroy();});
test('file mode requires an attachment before initial creation',()=>{const editor=createProposalEditor();choose(editor,'file');assert.throws(()=>editor.read(),/Anexe sua proposta/);assert.ok(fields(editor).every(field=>field.disabled));editor.destroy();});
test('selected file stays in memory and text mode does not submit hidden file bytes',()=>{const file=pdf();const editor=createProposalEditor({proposalFile:file});assert.equal(editor.read().proposalFile,file);choose(editor,'text');fields(editor)[0].value='Comparar o consumo de água na escola.';assert.equal(editor.read().proposalFile,null);assert.equal(editor.read().proposal.mode,'text');editor.destroy();});
test('attachment limit accepts exactly 3 MiB and rejects one extra byte',()=>{assert.equal(validateProposalFile(pdf(3*1024*1024)).size,3*1024*1024);assert.throws(()=>validateProposalFile(pdf(3*1024*1024+1)),/3 MiB/);assert.throws(()=>validateProposalFile(pdf(0)),/Selecione/);});
test('only explicit PDF JPEG and PNG types with safe matching extensions are accepted',()=>{for(const file of [{name:'foto.jpg',type:'image/jpeg',size:10},{name:'foto.png',type:'image/png',size:10},pdf()])assert.equal(validateProposalFile(file),file);for(const file of [{name:'proposta.svg',type:'image/svg+xml',size:10},{name:'proposta.html',type:'application/pdf',size:10},{name:'proposta.pdf',type:'',size:10}])assert.throws(()=>validateProposalFile(file),/PDF, JPG ou PNG/);});
test('existing attachment may be retained with its version and no replacement bytes',()=>{const value={mode:'file',filename:'proposta.pdf',size:200,version:'v1'};const editor=createProposalEditor({value});assert.deepEqual(editor.read(),{proposal:value,proposalFile:null});editor.destroy();});
test('attachment metadata without a current version cannot substitute for uploaded bytes',()=>{const editor=createProposalEditor({value:{mode:'file',filename:'fake.pdf',size:10}});assert.throws(()=>editor.read(),/Anexe sua proposta/);editor.destroy();});
test('disposing an editor clears its file input and prevents a stale submission',()=>{let changed=0;const editor=createProposalEditor({proposalFile:pdf(),onChange:()=>changed++});const input=walk(editor.element,node=>node.type==='file')[0];input.value='fakepath';editor.destroy();assert.equal(input.value,'');assert.ok(input.disabled);assert.throws(()=>editor.read(),/Abra a proposta/);fields(editor)[0].dispatch('input');assert.equal(changed,0);});
test('proposal text and hostile filenames are rendered literally without HTML nodes',()=>{const view=createProposalView({proposal:{mode:'text',topics:{problem:'<img src=x onerror=alert(1)>',objective:'Objetivo seguro'}}});assert.match(view.textContent,/<img src=x/);assert.equal(walk(view,node=>node.tagName==='IMG').length,0);const fileView=createProposalView({proposal:{mode:'file',filename:'<script>alert(1)</script>.pdf',size:100}});assert.equal(walk(fileView,node=>node.tagName==='SCRIPT').length,0);assert.match(fileView.textContent,/<script>/);});
test('attachment opens only after the caller handles an explicit button action',()=>{let requested=0;const view=createProposalView({proposal:{mode:'file',filename:'proposta.pdf'},onDownload:()=>requested++});assert.equal(requested,0);walk(view,node=>node.tagName==='BUTTON')[0].dispatch('click');assert.equal(requested,1);});
test('legacy invitation uses an honest explanation instead of an invented proposal',()=>{const view=createProposalView();assert.match(view.textContent,/antes da exigência/);assert.equal(walk(view,node=>node.tagName==='BUTTON').length,0);});
