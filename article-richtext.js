// Versioned rich text stays inside the existing `text` field. Only this small
// vocabulary is persisted; pasted HTML and arbitrary CSS are never stored.
export const ARTICLE_RICH_PREFIX='INIC-RICH/1\n';
export const articleFonts=Object.freeze({arial:'Arial',calibri:'Calibri',times:'Times New Roman',georgia:'Georgia',verdana:'Verdana',courier:'Courier New'});
export const articleFontSizes=Object.freeze([8,10,12,14,18,24,36]);
const fontStacks={arial:'Arial, sans-serif',calibri:'Calibri, Arial, sans-serif',times:'"Times New Roman", serif',georgia:'Georgia, serif',verdana:'Verdana, sans-serif',courier:'"Courier New", monospace'};
const tags=new Set(['p','h2','h3','blockquote','ul','ol','li','br','strong','em','u','s','sub','sup','span','a']);
const blocks=new Set(['p','h2','h3','blockquote','ul','ol','li']);
const skipped=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','VIDEO','AUDIO','CANVAS','FORM','INPUT','BUTTON','TEXTAREA','SELECT','OPTION','LINK','META','BASE','TEMPLATE','NOSCRIPT','HEAD']);
const alignments=new Set(['left','center','right','justify']);
const colors=new Set(['#000000','#111827','#1d4ed8','#15803d','#b91c1c','#7e22ce','#ea580c','#475569']);
const highlights=new Set(['#fef08a','#bbf7d0','#bfdbfe','#fbcfe8']);
const namedColors={black:'#111827',blue:'#1d4ed8',green:'#15803d',red:'#b91c1c',purple:'#7e22ce',orange:'#ea580c'};
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

export function articleSafeLink(value){
  const text=String(value||'').trim();
  if(!text||text.length>2048||/[\u0000-\u0020\u007f]/u.test(text))return '';
  try{const url=new URL(text);return ['https:','http:','mailto:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
function checkedAttrs(value,tag){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  for(const [key,item]of Object.entries(value)){
    if(key==='a'&&blocks.has(tag)&&alignments.has(item))continue;
    if(key==='f'&&typeof item==='string'&&own(articleFonts,item))continue;
    if(key==='s'&&articleFontSizes.includes(item))continue;
    if(key==='c'&&colors.has(item))continue;
    if(key==='h'&&highlights.has(item))continue;
    if((key==='w'||key==='i')&&(item===0||item===1))continue;
    if(key==='d'&&['underline','line-through','underline line-through'].includes(item))continue;
    if(key==='l'&&tag==='a'&&articleSafeLink(item)===item)continue;
    return false;
  }
  return true;
}
function validNodes(nodes,depth=0,budget={count:0}){
  if(!Array.isArray(nodes)||depth>40)return false;
  for(const node of nodes){
    if(++budget.count>6000)return false;
    if(typeof node==='string')continue;
    if(!Array.isArray(node)||node.length!==3||!tags.has(node[0])||!checkedAttrs(node[1],node[0])||!validNodes(node[2],depth+1,budget))return false;
    if(node[0]==='br'&&(Object.keys(node[1]).length||node[2].length))return false;
  }
  return true;
}
export function articleRichRead(value){
  const text=String(value||'');
  if(text.startsWith(ARTICLE_RICH_PREFIX)){
    try{const nodes=JSON.parse(text.slice(ARTICLE_RICH_PREFIX.length));if(validNodes(nodes))return {nodes,rich:true};}catch{}
  }
  // Legacy strings, malformed data and future versions remain literal text.
  return {nodes:text?[text]:[],rich:false};
}
function blockNode(node){return Array.isArray(node)&&(blocks.has(node[0])||node[2].some(blockNode));}
function plainNodes(nodes){
  let result='',previousBlock=false;
  for(const [index,node]of nodes.entries()){
    const block=blockNode(node);
    if(index>0&&(previousBlock||block))result+='\n';
    if(typeof node==='string')result+=node;
    else if(node[0]==='br')result+='\n';
    else if(!(block&&node[2].length===1&&Array.isArray(node[2][0])&&node[2][0][0]==='br'))result+=plainNodes(node[2]);
    previousBlock=block;
  }
  return result;
}
export const articleRichPlain=value=>plainNodes(articleRichRead(value).nodes);
function plainOnly(nodes){return nodes.every(node=>typeof node==='string'||(['p','br','span'].includes(node[0])&&!Object.keys(node[1]).length&&plainOnly(node[2])));}
export function articleRichSerialize(nodes){
  if(!validNodes(nodes))throw new Error('A formatação desta seção é muito complexa. Simplifique alguns trechos antes de salvar.');
  const text=plainNodes(nodes);
  if(plainOnly(nodes)&&!text.startsWith(ARTICLE_RICH_PREFIX))return text;
  return ARTICLE_RICH_PREFIX+JSON.stringify(nodes);
}
function colorKey(value,allowed){
  let color=String(value||'').toLowerCase().trim();
  if(namedColors[color])color=namedColors[color];
  const rgb=/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/u.exec(color);
  if(rgb)color='#'+rgb.slice(1).map(n=>Math.min(255,Number(n)).toString(16).padStart(2,'0')).join('');
  return allowed.has(color)?color:'';
}
function fontKey(value){const name=String(value||'').split(',')[0].replace(/["']/gu,'').trim().toLowerCase();return Object.keys(articleFonts).find(key=>articleFonts[key].toLowerCase()===name)||'';}
function fontSize(value){
  const named={'x-small':8,small:10,medium:12,large:14,'x-large':18,'xx-large':24,'xxx-large':36};
  const text=String(value||'').toLowerCase().trim();if(own(named,text))return named[text];
  const match=/^(\d+(?:\.\d+)?)(pt|px)$/u.exec(text);if(!match)return 0;
  const nativePixels={10:8,13:10,16:12,18:14,24:18,32:24,48:36};
  if(match[2]==='px'&&own(nativePixels,match[1]))return nativePixels[match[1]];
  const size=Number(match[1])*(match[2]==='px'?.75:1);return articleFontSizes.find(n=>Math.abs(n-size)<.1)||0;
}
export function articleRichFromDOM(root){
  let count=0;
  function walk(node,depth){
    if(++count>6000||depth>40)throw new Error('A formatação é muito complexa. Cole como texto sem formatação (Ctrl+Shift+V).');
    if(node.nodeType===3)return [node.nodeValue||''];
    if(node.nodeType!==1)return [];
    const source=node.tagName.toUpperCase();if(skipped.has(source))return [];
    if(source==='IMG')return node.getAttribute('alt')?[node.getAttribute('alt')]:[];
    const mapped={DIV:'p',H1:'h2',H4:'h3',H5:'h3',H6:'h3',B:'strong',I:'em',STRIKE:'s',DEL:'s',FONT:'span',TD:'p',TH:'p'};
    const tag=mapped[source]||source.toLowerCase();
    const children=[...node.childNodes].flatMap(child=>walk(child,depth+1));
    if(!tags.has(tag))return children;
    if(tag==='br')return [['br',{},[]]];
    const style=node.style||{},attrs={};
    const alignment=String(style.textAlign||node.getAttribute('align')||'').toLowerCase();if(blocks.has(tag)&&alignments.has(alignment))attrs.a=alignment;
    const font=fontKey(style.fontFamily||node.getAttribute('face'));if(font)attrs.f=font;
    const size=fontSize(style.fontSize)||(source==='FONT'?articleFontSizes[Number(node.getAttribute('size'))-1]:0);if(size)attrs.s=size;
    const color=colorKey(style.color||node.getAttribute('color'),colors);if(color)attrs.c=color;
    const highlight=colorKey(style.backgroundColor,highlights);if(highlight)attrs.h=highlight;
    // Native editors can turn a mark off inside an existing marked span. Keep
    // those explicit resets, otherwise remote readers would see it marked again.
    if(style.fontWeight==='normal'||style.fontWeight==='400')attrs.w=0;
    if(style.fontStyle==='normal')attrs.i=0;
    if(tag==='a'){const href=articleSafeLink(node.getAttribute('href'));if(href)attrs.l=href;}
    const weight=String(style.fontWeight||'');
    const decoration=String(style.textDecorationLine||style.textDecoration||'');
    const bold=weight==='bold'||/^\d+$/u.test(weight)&&Number(weight)>=600;
    // Paragraph styling belongs to its block. An inline wrapper around <p>
    // would hide paragraph boundaries from plain-text export and caret mapping.
    if(blocks.has(tag)){
      if(bold)attrs.w=1;if(style.fontStyle==='italic')attrs.i=1;
      const lines=['underline','line-through'].filter(value=>decoration.includes(value));if(lines.length)attrs.d=lines.join(' ');
      return [[tag,attrs,children]];
    }
    let result=(tag==='a'&&!attrs.l)||tag==='span'&&!Object.keys(attrs).length?children:[[tag,attrs,children]];
    if(tag!=='strong'&&bold)result=[['strong',{},result]];
    if(tag!=='em'&&style.fontStyle==='italic')result=[['em',{},result]];
    if(tag!=='u'&&decoration.includes('underline'))result=[['u',{},result]];
    if(tag!=='s'&&decoration.includes('line-through'))result=[['s',{},result]];
    return result;
  }
  return [...root.childNodes].flatMap(node=>walk(node,0));
}
export function articleRichPaste(html,plain,doc){
  if(String(html||'').length>300000||String(plain||'').length>300000)throw new Error('A colagem é muito grande. Cole o texto em partes menores.');
  if(!html)return plain?[String(plain)]:[];
  const template=doc.createElement('template');template.innerHTML=String(html);
  return articleRichFromDOM(template.content);
}
function renderNodes(nodes,target,doc){
  for(const node of nodes){
    if(typeof node==='string'){target.append(doc.createTextNode(node));continue;}
    const [tag,attrs,children]=node,el=doc.createElement(tag);
    if(attrs.a)el.style.textAlign=attrs.a;
    if(attrs.f)el.style.fontFamily=fontStacks[attrs.f];
    if(attrs.s)el.style.fontSize=attrs.s+'pt';
    if(attrs.c)el.style.color=attrs.c;
    if(attrs.h)el.style.backgroundColor=attrs.h;
    if(attrs.w!==undefined)el.style.fontWeight=attrs.w?'700':'400';
    if(attrs.i!==undefined)el.style.fontStyle=attrs.i?'italic':'normal';
    if(attrs.d)el.style.textDecoration=attrs.d;
    if(tag==='a'&&attrs.l){el.href=attrs.l;el.target='_blank';el.rel='noopener noreferrer';}
    renderNodes(children,el,doc);target.append(el);
  }
}
export function articleRichRender(target,value){target.replaceChildren();renderNodes(articleRichRead(value).nodes,target,target.ownerDocument);}
export function articleRichHTML(value,doc){const container=doc.createElement('div');articleRichRender(container,value);return container.innerHTML;}

export function createArticleRichField({document:doc,id,name,label,placeholder,onChange=()=>{},onBlur=()=>{},onComposition=()=>{}}){
  const make=(tag,css,text)=>{const el=doc.createElement(tag);if(css)el.className=css;if(text!==undefined)el.textContent=text;return el;};
  const wrapper=make('div','article-writing'),toolbar=make('div','article-toolbar');toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label',`Formatação de ${label}`);
  const input=make('div','article-input article-rich-content');input.id=id;input.dataset.section=name;input.setAttribute('role','textbox');input.setAttribute('aria-multiline','true');input.setAttribute('aria-label',`Texto: ${label}`);input.setAttribute('data-placeholder',placeholder||'Escreva aqui…');input.setAttribute('spellcheck','true');input.setAttribute('lang','pt-BR');
  const help=make('p','article-format-help','Selecione o texto para formatar. Atalhos: Ctrl+B, Ctrl+I, Ctrl+U e Ctrl+Z.');
  const feedback=make('p','article-format-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');feedback.hidden=true;
  wrapper.append(toolbar,input,help,feedback);
  let disabled=true,destroyed=false,current='',savedRange=null,history=[{value:'',selection:null}],historyIndex=0,lastEdit=0,groupStarted=0,lastKind='',commandRunning=false,composing=false,plainPaste=false;
  const listeners=[],controls=[],states=[];
  const listen=(el,event,handler,options)=>{el.addEventListener(event,handler,options);listeners.push(()=>el.removeEventListener(event,handler,options));};
  const message=text=>{feedback.textContent=text;feedback.hidden=!text;};
  const selection=()=>doc.getSelection?.()||doc.defaultView?.getSelection?.();
  const inInput=node=>Boolean(node&&(node===input||input.contains(node)));
  function remember(){const selected=selection();if(selected?.rangeCount){const range=selected.getRangeAt(0);if(inInput(range.startContainer)&&inInput(range.endContainer))savedRange=range.cloneRange();}}
  function restore(){input.focus();const selected=selection();if(!selected)return false;if(savedRange&&inInput(savedRange.startContainer)&&inInput(savedRange.endContainer)){selected.removeAllRanges();selected.addRange(savedRange);return true;}const range=doc.createRange();range.selectNodeContents(input);range.collapse(false);selected.removeAllRanges();selected.addRange(range);savedRange=range.cloneRange();return true;}
  function semanticIndex(){
    // Use the same paragraph/BR separators as the portable plain representation.
    // DOM paths are an exact-position hint, validated against these offsets, so
    // <b>→<strong>, removed spans and plain-string rendering remain compatible.
    let position=0;const bounds=new Map(),paths=new Map(),texts=[],empty=[],points=[];
    const block=node=>node.nodeType===1&&(/^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE)$/u.test(node.tagName.toUpperCase())||[...node.childNodes].some(block));
    function visit(node,path){
      paths.set(node,path);
      if(node.nodeType===3){const length=(node.nodeValue||'').length;texts.push({node,start:position,end:position+length,path});position+=length;return;}
      if(node.nodeType!==1)return;
      if(node.tagName.toUpperCase()==='BR'){bounds.set(node,[position]);points.push({node,offset:0,position,path});position++;return;}
      if(node!==input&&block(node)&&node.childNodes.length===1&&node.firstChild.nodeType===1&&node.firstChild.tagName.toUpperCase()==='BR'){
        bounds.set(node,[position,position]);bounds.set(node.firstChild,[position]);paths.set(node.firstChild,[...path,0]);empty.push({node,position,path});points.push({node,offset:0,position,path});return;
      }
      const offsets=[];bounds.set(node,offsets);let previousBlock=false,seen=0;
      for(const [index,child]of [...node.childNodes].entries()){
        const visible=child.nodeType===1||child.nodeType===3,childBlock=block(child);
        if(visible&&seen>0&&(previousBlock||childBlock))position++;
        offsets[index]=position;points.push({node,offset:index,position,path});visit(child,[...path,index]);offsets[index+1]=position;
        if(visible){previousBlock=childBlock;seen++;}
      }
      if(!node.childNodes.length)offsets[0]=position;
      points.push({node,offset:node.childNodes.length,position,path});
    }
    visit(input,[]);
    const offsetOf=(node,offset)=>{const text=texts.find(item=>item.node===node);return text?text.start+Math.min(offset,text.end-text.start):bounds.get(node)?.[offset];};
    return {bounds,paths,texts,empty,points,offsetOf};
  }
  function bookmark(){
    remember();if(!savedRange||!inInput(savedRange.startContainer)||!inInput(savedRange.endContainer))return null;
    const index=semanticIndex(),describe=(node,offset)=>({position:index.offsetOf(node,offset),path:index.paths.get(node)||[],offset,text:node.nodeType===3,edge:offset===0?'start':node.nodeType===3&&offset===(node.nodeValue||'').length?'end':'middle',empty:index.empty.some(item=>item.node===node||item.node.contains(node))});
    return {start:describe(savedRange.startContainer,savedRange.startOffset),end:describe(savedRange.endContainer,savedRange.endOffset)};
  }
  function place(mark){
    savedRange=null;if(!mark||!doc.createRange)return;
    const index=semanticIndex(),locate=description=>{
      let hinted=input;for(const part of description.path||[])hinted=hinted?.childNodes[part];
      if(hinted&&(hinted.nodeType===3)===description.text&&description.offset<=(hinted.nodeType===3?(hinted.nodeValue||'').length:hinted.childNodes.length)&&index.offsetOf(hinted,description.offset)===description.position)return {node:hinted,offset:description.offset};
      if(description.empty){const empty=index.empty.find(item=>item.position===description.position);if(empty)return {node:empty.node,offset:0};}
      const matching=index.texts.filter(item=>description.position>=item.start&&description.position<=item.end);
      const text=matching.find(item=>description.edge==='start'?item.start===description.position:description.edge==='end'?item.end===description.position:false)||matching[0];
      if(text)return {node:text.node,offset:description.position-text.start};
      const point=index.points.filter(item=>item.position===description.position).sort((a,b)=>b.path.length-a.path.length)[0];
      return point||{node:input,offset:input.childNodes.length};
    };
    const start=locate(mark.start),end=locate(mark.end),range=doc.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);savedRange=range;restore();
  }
  function paint(){
    for(const el of controls)el.disabled=disabled||composing;
    undoButton.disabled=disabled||composing||historyIndex<=0;redoButton.disabled=disabled||composing||historyIndex>=history.length-1;
    for(const {button,command}of states){let active=false;try{active=Boolean(doc.queryCommandState?.(command));}catch{}button.setAttribute('aria-pressed',String(!disabled&&active));}
    if(!disabled&&inInput(selection()?.anchorNode)){
      const query=command=>{try{return String(doc.queryCommandValue?.(command)||'');}catch{return '';}};
      const choose=(el,value)=>{if(!value)return;for(const option of el.options)option.selected=option.value===value;};
      choose(fontSelect,fontKey(query('fontName')));
      const rawSize=query('fontSize'),size=/^[1-7]$/u.test(rawSize)?rawSize:String(articleFontSizes.indexOf(fontSize(rawSize))+1);if(size!=='0')choose(sizeSelect,size);
      choose(paragraphSelect,query('formatBlock').replace(/[<>]/gu,'').toLowerCase());
      for(const command of ['justifyLeft','justifyCenter','justifyRight','justifyFull']){try{if(doc.queryCommandState?.(command)){choose(alignmentSelect,command);break;}}catch{}}
    }
  }
  function commit(kind='command'){
    if(disabled||destroyed)return;
    let value,warning='';try{value=articleRichSerialize(articleRichFromDOM(input));}catch{
      // Extreme browser-generated nesting must never make a newly typed draft
      // disappear from autosave/export. Retain all visible text as plain text.
      const mark=bookmark(),plain=String(input.innerText??input.textContent??'');value=articleRichSerialize(plain?[plain]:[]);if(!composing){articleRichRender(input,value);place(mark);}warning='A formatação ficou muito complexa e foi simplificada. Todo o texto foi preservado.';
    }
    if(value===current&&(composing||history[historyIndex].value===value)){paint();return;}
    if(composing){current=value;onChange(value);paint();return;}
    const mark=bookmark(),now=Date.now(),coalesce=kind==='typing'&&lastKind==='typing'&&now-lastEdit<700&&now-groupStarted<2000&&historyIndex===history.length-1&&historyIndex>0;
    current=value;history.splice(historyIndex+1);
    if(coalesce)history[historyIndex]={value,selection:mark};else{groupStarted=now;history.push({value,selection:mark});historyIndex++;if(history.length>100){history.shift();historyIndex--;}}
    lastEdit=now;lastKind=kind;message(warning);onChange(value);paint();
  }
  function travel(direction){
    if(disabled||destroyed||composing)return;const next=historyIndex+direction;if(next<0||next>=history.length)return;
    history[historyIndex].selection=bookmark();historyIndex=next;current=history[next].value;articleRichRender(input,current);place(history[next].selection);lastKind='history';message('');onChange(current);paint();
  }
  function execute(command,value){
    if(disabled||destroyed||composing)return;remember();history[historyIndex].selection=bookmark();restore();
    if(typeof doc.execCommand!=='function'){message('Este navegador não oferece esse comando de formatação. Experimente um navegador atualizado.');return;}
    commandRunning=true;
    try{doc.execCommand('styleWithCSS',false,true);const changed=doc.execCommand(command,false,value);if(!changed)message('Selecione um trecho do texto e tente o comando novamente.');}
    catch{message('Não foi possível aplicar esse comando ao trecho selecionado.');}
    finally{commandRunning=false;commit();remember();paint();}
  }
  function group(label){const el=make('div','article-tool-group');el.setAttribute('role','group');el.setAttribute('aria-label',label);toolbar.append(el);return el;}
  function button(parent,text,title,handler,command){const el=make('button','article-tool',text);el.type='button';el.title=title;el.setAttribute('aria-label',title);if(command){el.setAttribute('aria-pressed','false');states.push({button:el,command});}listen(el,'pointerdown',event=>{remember();event.preventDefault();});listen(el,'mousedown',event=>{remember();event.preventDefault();});listen(el,'click',handler);parent.append(el);controls.push(el);return el;}
  function select(parent,title,items,handler){const el=make('select','article-tool-select');el.title=title;el.setAttribute('aria-label',title);for(const [value,text]of items){const option=make('option','',text);option.value=value;el.append(option);}listen(el,'pointerdown',remember);listen(el,'focus',remember);listen(el,'change',()=>handler(el.value));parent.append(el);controls.push(el);return el;}
  const historyGroup=group('Histórico');
  const undoButton=button(historyGroup,'↶','Desfazer (Ctrl+Z)',()=>travel(-1));
  const redoButton=button(historyGroup,'↷','Refazer (Ctrl+Y)',()=>travel(1));
  const fontGroup=group('Fonte e tamanho');
  const fontSelect=select(fontGroup,'Fonte',Object.entries(articleFonts),value=>execute('fontName',articleFonts[value]));
  const sizeSelect=select(fontGroup,'Tamanho da fonte',articleFontSizes.map((size,index)=>[String(index+1),size+' pt']),value=>execute('fontSize',value));sizeSelect.querySelector('option[value="3"]').selected=true;
  const marks=group('Estilo do texto');
  button(marks,'N','Negrito (Ctrl+B)',()=>execute('bold'), 'bold').classList.add('article-tool-bold');
  button(marks,'I','Itálico (Ctrl+I)',()=>execute('italic'),'italic').classList.add('article-tool-italic');
  button(marks,'S','Sublinhado (Ctrl+U)',()=>execute('underline'),'underline').classList.add('article-tool-underline');
  button(marks,'abc','Tachado',()=>execute('strikeThrough'),'strikeThrough').classList.add('article-tool-strike');
  const paragraph=group('Parágrafo');
  const paragraphSelect=select(paragraph,'Estilo do parágrafo',[['p','Texto normal'],['h2','Subtítulo'],['h3','Subtítulo menor'],['blockquote','Citação']],value=>execute('formatBlock',value));
  const alignmentSelect=select(paragraph,'Alinhamento',[['justifyLeft','À esquerda'],['justifyCenter','Centralizado'],['justifyRight','À direita'],['justifyFull','Justificado']],value=>execute(value));
  button(paragraph,'• Lista','Lista com marcadores',()=>execute('insertUnorderedList'),'insertUnorderedList');
  button(paragraph,'1. Lista','Lista numerada',()=>execute('insertOrderedList'),'insertOrderedList');
  const colorsGroup=group('Cores');
  select(colorsGroup,'Cor do texto',[['','Cor do texto'],['#111827','Preto'],['#1d4ed8','Azul'],['#15803d','Verde'],['#b91c1c','Vermelho'],['#7e22ce','Roxo'],['#ea580c','Laranja']],value=>{if(value)execute('foreColor',value);});
  select(colorsGroup,'Marca-texto',[['','Marca-texto'],['#fef08a','Amarelo'],['#bbf7d0','Verde claro'],['#bfdbfe','Azul claro'],['#fbcfe8','Rosa'],['transparent','Sem marcação']],value=>{if(value)execute('hiliteColor',value);});
  const extras=group('Outras ferramentas');
  button(extras,'x₂','Subscrito',()=>execute('subscript'),'subscript');button(extras,'x²','Sobrescrito',()=>execute('superscript'),'superscript');
  button(extras,'Limpar','Limpar formatação do texto selecionado',()=>execute('removeFormat'));
  const linkForm=make('div','article-link-form');linkForm.hidden=true;
  const urlLabel=make('label','','Endereço do link'),urlInput=make('input','');urlInput.type='url';urlInput.placeholder='https://…';urlInput.setAttribute('aria-label','Endereço do link');urlLabel.append(urlInput);linkForm.append(urlLabel);controls.push(urlInput);
  button(extras,'Link','Inserir ou editar link',()=>{remember();linkForm.hidden=!linkForm.hidden;if(!linkForm.hidden)urlInput.focus();});
  button(linkForm,'Aplicar link','Aplicar link ao texto selecionado',()=>{const href=articleSafeLink(urlInput.value);if(!href){message('Use um endereço completo começando com https://, http:// ou mailto:.');return;}if(!savedRange||savedRange.collapsed||!inInput(savedRange.startContainer)||!inInput(savedRange.endContainer)){message('Selecione o texto que receberá o link e clique em Aplicar link.');return;}execute('createLink',href);linkForm.hidden=true;urlInput.value='';});
  button(linkForm,'Remover link','Remover link do texto selecionado',()=>{execute('unlink');linkForm.hidden=true;});
  button(linkForm,'Cancelar','Cancelar edição do link',()=>{linkForm.hidden=true;urlInput.value='';restore();});
  wrapper.insertBefore(linkForm,input);
  function insertClipboard(data,asPlain=false){
    if(disabled||destroyed)return;
    try{const nodes=articleRichPaste(asPlain?'':data?.getData('text/html')||'',data?.getData('text/plain')||'',doc);if(!nodes.length)return;const safe=make('div');renderNodes(nodes,safe,doc);execute('insertHTML',safe.innerHTML);}catch(error){message(error.message);}
  }
  listen(input,'input',event=>{if(!commandRunning)commit(event.inputType==='insertText'||event.inputType?.startsWith('delete')?'typing':'command');});
  listen(input,'beforeinput',event=>{if(disabled){event.preventDefault();return;}if(event.inputType==='historyUndo'||event.inputType==='historyRedo'){event.preventDefault();travel(event.inputType==='historyUndo'?-1:1);}else if(!composing)history[historyIndex].selection=bookmark();});
  listen(input,'compositionstart',()=>{if(disabled||destroyed)return;history[historyIndex].selection=bookmark();composing=true;onComposition(true);paint();});
  listen(input,'compositionend',()=>{composing=false;commit('composition');onComposition(false);paint();});
  listen(input,'paste',event=>{event.preventDefault();remember();insertClipboard(event.clipboardData,plainPaste);plainPaste=false;});
  // A dragged web page can contain active HTML too. Use the same sanitizer.
  listen(input,'drop',event=>{event.preventDefault();remember();insertClipboard(event.dataTransfer);});
  listen(input,'dragover',event=>event.preventDefault());
  listen(input,'keydown',event=>{if(!(event.ctrlKey||event.metaKey)||event.altKey||event.isComposing)return;const key=event.key.toLowerCase();if(key==='v'&&event.shiftKey){plainPaste=true;}else if(key==='z'){event.preventDefault();travel(event.shiftKey?1:-1);}else if(key==='y'){event.preventDefault();travel(1);}else if(['b','i','u'].includes(key)){event.preventDefault();execute({b:'bold',i:'italic',u:'underline'}[key]);}});
  listen(input,'keyup',()=>{plainPaste=false;remember();paint();});listen(input,'mouseup',()=>{remember();paint();});
  listen(input,'blur',()=>{remember();onBlur();});
  listen(doc,'selectionchange',()=>{if(inInput(selection()?.anchorNode)){remember();paint();}});
  function reset(value=''){composing=false;current=String(value||'');articleRichRender(input,current);savedRange=null;history=[{value:current,selection:null}];historyIndex=0;lastKind='';lastEdit=0;groupStarted=0;plainPaste=false;urlInput.value='';linkForm.hidden=true;message('');paint();}
  function setDisabled(value){disabled=Boolean(value);if(disabled)composing=false;input.setAttribute('contenteditable',String(!disabled));input.setAttribute('aria-disabled',String(disabled));input.tabIndex=disabled?-1:0;paint();}
  setDisabled(true);
  return {element:wrapper,input,get value(){return current;},setValue(value){if(String(value||'')!==current)reset(value);},setDisabled,reset,destroy(){if(destroyed)return;destroyed=true;disabled=true;for(const remove of listeners)remove();reset();setDisabled(true);wrapper.replaceChildren();}};
}
