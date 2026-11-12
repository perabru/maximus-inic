import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {ARTICLE_RICH_PREFIX,articleRichRead,articleRichPlain,articleRichSerialize,articleRichFromDOM,articleRichPaste,articleRichRender,articleRichHTML,articleSafeLink,createArticleRichField} from '../article-richtext.js';

const dom=()=>parseHTML('<html><body></body></html>');
const encode=nodes=>ARTICLE_RICH_PREFIX+JSON.stringify(nodes);
const parse=(html,document)=>{const root=document.createElement('div');root.innerHTML=html;return articleRichFromDOM(root);};
function selectionFixture(document){
  class Range {
    constructor(start,startOffset=0,end=start,endOffset=startOffset){Object.assign(this,{startContainer:start,startOffset,endContainer:end,endOffset});}
    cloneRange(){return new Range(this.startContainer,this.startOffset,this.endContainer,this.endOffset);}
    setStart(node,offset){this.startContainer=node;this.startOffset=offset;}
    setEnd(node,offset){this.endContainer=node;this.endOffset=offset;}
    selectNodeContents(node){this.setStart(node,0);this.setEnd(node,node.childNodes.length);}
    collapse(toStart){if(toStart)this.setEnd(this.startContainer,this.startOffset);else this.setStart(this.endContainer,this.endOffset);}
  }
  let selected;
  document.getSelection=()=>({get rangeCount(){return selected?1:0;},get anchorNode(){return selected?.startContainer;},getRangeAt:()=>selected,removeAllRanges:()=>{selected=null;},addRange:range=>{selected=range;}});
  document.createRange=()=>new Range();
  return {at(node,offset){selected=new Range(node,offset);},get range(){return selected;}};
}

test('legacy text including HTML and invalid or future envelopes always stays literal',()=>{
  const {document}=dom(),target=document.createElement('div');
  for(const text of ['Texto antigo\nSegunda linha','<img src=x onerror=alert(1)>',ARTICLE_RICH_PREFIX+'{broken','INIC-RICH/2\n[]',encode([['script',{},['alert(1)']]]),encode([['span',{style:'position:fixed'},['Texto']]])]){
    articleRichRender(target,text);assert.equal(target.textContent,text);assert.equal(target.querySelector('script,img,span'),null);assert.equal(articleRichPlain(text),text);
  }
  const looksLikeEnvelope=encode([['strong',{},['Isto é texto literal']]]);
  const escaped=articleRichSerialize([looksLikeEnvelope]);articleRichRender(target,escaped);assert.equal(target.textContent,looksLikeEnvelope);assert.equal(target.querySelector('strong'),null);
});

test('permitted marks, lists, fonts and paragraphs round-trip without raw HTML storage',()=>{
  const {document}=dom();
  const nodes=parse('<h2>Resultados</h2><p style="text-align:justify;font-family:Georgia;font-size:14pt"><strong>Pesquisa</strong> com <em>método</em>, <u>fontes</u> e <s>revisões</s>.</p><ol><li>Primeiro</li><li>Segundo <sup>2</sup></li></ol>',document);
  const saved=articleRichSerialize(nodes),target=document.createElement('div');
  assert.ok(saved.startsWith(ARTICLE_RICH_PREFIX));assert.ok(!saved.includes('<strong>'));
  articleRichRender(target,saved);assert.equal(target.querySelector('strong').textContent,'Pesquisa');assert.equal(target.querySelectorAll('li').length,2);assert.equal(target.querySelector('p').style.textAlign,'justify');assert.equal(target.querySelector('p').style.fontSize,'14pt');
  assert.equal(articleRichSerialize(articleRichFromDOM(target)),saved);
  assert.equal(articleRichPlain(saved),'Resultados\nPesquisa com método, fontes e revisões.\nPrimeiro\nSegundo 2');
});

test('unformatted paragraphs preserve blank lines while using the legacy string format',()=>{
  const {document}=dom();
  assert.equal(articleRichSerialize(parse('Primeira<div>Segunda</div><div><br></div><div>Quarta</div>',document)),'Primeira\nSegunda\n\nQuarta');
  assert.equal(articleRichSerialize(parse('<p>A</p><p>B<br>C</p>',document)),'A\nB\nC');
  assert.equal(articleRichSerialize(['Última linha\n']),'Última linha\n');
});

test('bold or italic block styles preserve paragraph boundaries in TXT and on reload',()=>{
  const {document}=dom();
  for(const style of ['font-weight:bold','font-style:italic','font-weight:bold;font-style:italic;text-decoration:underline']){
    const value=articleRichSerialize(articleRichPaste(`<p style="${style}">Primeiro</p><p style="${style}">Segundo</p>`,'Primeiro\nSegundo',document)),target=document.createElement('div');
    assert.equal(articleRichPlain(value),'Primeiro\nSegundo');articleRichRender(target,value);assert.equal(target.children[0].tagName,'P');assert.equal(target.children[1].tagName,'P');assert.equal(articleRichSerialize(articleRichFromDOM(target)),value);
  }
  assert.equal(articleRichPlain(articleRichSerialize(parse('<strong><p>Primeiro</p></strong><em><p>Segundo</p></em>',document))),'Primeiro\nSegundo');
});

test('pasted active HTML, event attributes and arbitrary CSS cannot reach a rendered document',()=>{
  const {document}=dom();
  const html='<script>alert(1)</script><style>body{display:none}</style><iframe src="https://bad.example"></iframe><svg onload="alert(1)"><text>SVG</text></svg><form><input name="secret"></form><p id="steal" class="bad" contenteditable="false" onclick="alert(1)" style="position:fixed;left:0;background-image:url(https://bad.example);font-family:evil;font-size:99px;color:expression(alert(1))">Seguro <b>negrito</b><img src="https://bad.example/image" onerror="alert(1)"></p>';
  const value=articleRichSerialize(articleRichPaste(html,'',document)),target=document.createElement('div');articleRichRender(target,value);
  assert.equal(articleRichPlain(value),'Seguro negrito');assert.ok(target.querySelector('strong'));assert.equal(target.querySelector('script,style,iframe,svg,form,input,img'),null);
  assert.doesNotMatch(target.innerHTML,/onclick|onerror|contenteditable|position:|background-image|bad\.example|evil|steal/u);
});

test('pasted inline CSS is converted only to known text attributes',()=>{
  const {document}=dom(),value=articleRichSerialize(articleRichPaste('<span style="font-family:Times New Roman;font-size:16px;font-weight:700;font-style:italic;text-decoration:underline;color:rgb(29,78,216);background-color:rgb(254,240,138)">Dado</span>','',document));
  const target=document.createElement('div');articleRichRender(target,value);assert.ok(target.querySelector('strong'));assert.ok(target.querySelector('em'));assert.ok(target.querySelector('u'));const span=target.querySelector('span');assert.match(span.style.fontFamily,/Times New Roman/);assert.equal(span.style.fontSize,'12pt');assert.equal(span.style.color,'#1d4ed8');assert.equal(span.style.backgroundColor,'#fef08a');
});

test('native font-size values and explicit mark resets survive serialization',()=>{
  const {document}=dom(),value=articleRichSerialize(parse('<strong>Marcado <span style="font-weight:normal;font-style:normal;font-size:18px">Normal</span></strong>',document)),target=document.createElement('div');articleRichRender(target,value);
  const span=target.querySelector('span');assert.equal(span.style.fontWeight,'400');assert.equal(span.style.fontStyle,'normal');assert.equal(span.style.fontSize,'14pt');assert.equal(articleRichSerialize(articleRichFromDOM(target)),value);
});

test('links permit only absolute web and mail addresses and never event attributes',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','vbscript:msgbox(1)','//evil.example','/relative','https://user:secret@example.com','java\nscript:alert(1)','https://good.example/\u0000bad'])assert.equal(articleSafeLink(url),'',url);
  assert.equal(articleSafeLink('https://example.org/artigo'),'https://example.org/artigo');assert.equal(articleSafeLink('mailto:aluno@example.org'),'mailto:aluno@example.org');
  const {document}=dom(),value=articleRichSerialize(articleRichPaste('<a href="javascript:alert(1)">Ruim</a> <a href="https://example.org" onclick="alert(1)" target="parent">Fonte</a>','',document)),target=document.createElement('div');articleRichRender(target,value);
  assert.equal(target.querySelectorAll('a').length,1);assert.equal(target.querySelector('a').getAttribute('href'),'https://example.org/');assert.equal(target.querySelector('a').getAttribute('rel'),'noopener noreferrer');assert.equal(target.querySelector('a').getAttribute('target'),'_blank');assert.equal(target.querySelector('[onclick]'),null);assert.equal(articleRichPlain(value),'Ruim Fonte');
});

test('unsafe envelope attributes and excessive nesting are treated as literal text',()=>{
  const malicious=[encode([['a',{l:'javascript:alert(1)'},['Abrir']]]),encode([['span',{f:'__proto__'},['Texto']]]),encode([['p',{a:'left;position:fixed'},['Texto']]]),encode([['span',{s:999},['Texto']]])];
  let nested='Texto';for(let i=0;i<45;i++)nested=['strong',{},[nested]];malicious.push(encode([nested]));
  for(const value of malicious){assert.equal(articleRichRead(value).rich,false);assert.equal(articleRichPlain(value),value);}
});

test('clipboard guard rejects extreme input before mutating the current draft',()=>{
  const {document}=dom();assert.throws(()=>articleRichPaste('','a'.repeat(300001),document),/muito grande/);assert.throws(()=>articleRichPaste('<b>'.repeat(45)+'Texto'+'</b>'.repeat(45),'Texto',document),/muito complexa/);
});

test('undo and redo are scoped to a field and cleared by reset or access loss',()=>{
  const {document,window}=dom(),updates=[];
  const field=createArticleRichField({document,id:'test',name:'introduction',label:'Introdução',onChange:value=>updates.push(value)});document.body.append(field.element);field.setDisabled(false);field.setValue('Inicial');
  const button=title=>field.element.querySelector(`button[aria-label="${title}"]`);
  field.input.textContent='Primeira revisão';field.input.dispatchEvent(new window.Event('input'));field.input.innerHTML='<strong>Segunda revisão</strong>';field.input.dispatchEvent(new window.Event('input'));
  button('Desfazer (Ctrl+Z)').click();assert.equal(field.input.textContent,'Primeira revisão');assert.equal(field.value,'Primeira revisão');
  button('Refazer (Ctrl+Y)').click();assert.equal(field.input.querySelector('strong').textContent,'Segunda revisão');assert.ok(field.value.startsWith(ARTICLE_RICH_PREFIX));
  field.reset();field.setDisabled(true);button('Desfazer (Ctrl+Z)').click();assert.equal(field.value,'');assert.equal(field.input.textContent,'');assert.equal(button('Desfazer (Ctrl+Z)').disabled,true);assert.ok(updates.length>=4);field.destroy();assert.equal(field.element.childNodes.length,0);
});

test('undo restores the caret in an empty paragraph and through canonical markup changes',()=>{
  for(const mode of ['rich-empty','plain-empty','inline-normalized']){
    const {document,window}=dom(),selection=selectionFixture(document),field=createArticleRichField({document,id:'caret',name:'introduction',label:'Introdução'});document.body.append(field.element);field.setDisabled(false);
    const rich=articleRichSerialize([['p',{},['A']],['p',{},[['br',{},[]]]],['p',{},[['strong',{},['B']]]]]);
    field.setValue(mode==='plain-empty'?'A\n\nB':rich);
    if(mode==='plain-empty')field.input.innerHTML='<p>A</p><p><br></p><p>B</p>';
    if(mode==='inline-normalized')field.input.innerHTML='<p>A</p><p><br></p><p><span><b>B</b></span></p>';
    const target=mode==='inline-normalized'?field.input.querySelector('b').firstChild:field.input.children[1];selection.at(target,mode==='inline-normalized'?1:0);
    const before=new window.Event('beforeinput');Object.defineProperty(before,'inputType',{value:'insertText'});field.input.dispatchEvent(before);
    if(mode==='inline-normalized'){target.nodeValue='BC';selection.at(target,2);}else{target.textContent='C';selection.at(target.firstChild,1);}
    const input=new window.Event('input');Object.defineProperty(input,'inputType',{value:'insertText'});field.input.dispatchEvent(input);field.element.querySelector('button[aria-label="Desfazer (Ctrl+Z)"]').click();
    if(mode==='rich-empty'){assert.equal(selection.range.startContainer,field.input.children[1]);assert.equal(selection.range.startOffset,0);}
    else if(mode==='plain-empty'){assert.equal(selection.range.startContainer,field.input.firstChild);assert.equal(selection.range.startOffset,2);assert.equal(field.input.textContent,'A\n\nB');}
    else{assert.equal(selection.range.startContainer,field.input.querySelector('strong').firstChild);assert.equal(selection.range.startOffset,1);assert.equal(field.input.querySelector('span,b'),null);}
    field.destroy();
  }
});

test('plain-text HTML-looking paste and HTML export remain escaped',()=>{
  const {document}=dom(),value=articleRichSerialize(articleRichPaste('','<script>alert(1)</script>',document));
  assert.equal(articleRichPlain(value),'<script>alert(1)</script>');assert.equal(articleRichHTML(value,document),'&lt;script&gt;alert(1)&lt;/script&gt;');
});
