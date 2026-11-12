import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createSignaturePad} from '../signature-pad.js';

// Use the actual Canvas renderer, without opening a browser or touching a server.
// Local setup from tests/: npm install --no-save @napi-rs/canvas pngjs
const require=createRequire(import.meta.url);
const dependency=name=>require(require.resolve(name,{paths:[fileURLToPath(new URL('.',import.meta.url)),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const {createCanvas}=dependency('@napi-rs/canvas');
const {PNG}=dependency('pngjs');

function harness({capture='normal',width=600,height=200}={}){
  const canvas=createCanvas(1200,400),events=new EventTarget(),view=new EventTarget();
  const listeners=new Map(),attributes=new Map(),captures=new Set(),changes=[],errors=[];
  let rect={left:20,top:40,width,height};
  canvas.style={touchAction:'auto',cursor:''};
  canvas.ownerDocument={defaultView:view,createElement:tag=>{assert.equal(tag,'canvas');return createCanvas(1,1);}};
  canvas.addEventListener=(type,handler,options)=>{events.addEventListener(type,handler,options);if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(handler);};
  canvas.removeEventListener=(type,handler,options)=>{events.removeEventListener(type,handler,options);listeners.get(type)?.delete(handler);};
  canvas.getBoundingClientRect=()=>({...rect,right:rect.left+rect.width,bottom:rect.top+rect.height});
  canvas.setAttribute=(key,value)=>attributes.set(key,String(value));
  canvas.getAttribute=key=>attributes.get(key)??null;
  canvas.hasPointerCapture=id=>captures.has(id);
  if(capture!=='missing')canvas.setPointerCapture=id=>{if(capture==='throws')throw new Error('Capture unsupported');captures.add(id);};
  canvas.releasePointerCapture=id=>captures.delete(id);
  const pad=createSignaturePad(canvas,{onChange:state=>changes.push({...state}),onError:error=>errors.push(error)});
  function fire(type,x=.2,y=.5,options={}){
    const {target='canvas',...props}=options;
    const event=new Event(type,{cancelable:true});
    Object.assign(event,{pointerId:1,pointerType:'touch',button:0,buttons:type==='pointerup'?0:1,isPrimary:true,clientX:rect.left+x*rect.width,clientY:rect.top+y*rect.height,...props});
    (target==='window'?view:events).dispatchEvent(event);
    return event;
  }
  function stroke(points=[[.1,.7],[.25,.25],[.4,.55]],props={}){
    fire('pointerdown',...points[0],props);
    points.slice(1).forEach(point=>fire('pointermove',...point,props));
    fire('pointerup',...points.at(-1),props);
  }
  return {canvas,pad,fire,stroke,changes,errors,captures,listeners,resize:(w,h)=>{rect={...rect,width:w,height:h};view.dispatchEvent(new Event('resize'));}};
}
function decoded(uri){assert.match(uri,/^data:image\/png;base64,/);return PNG.sync.read(Buffer.from(uri.split(',')[1],'base64'));}
function ink(image){
  let count=0,left=image.width,top=image.height,right=-1,bottom=-1;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.data[(y*image.width+x)*4+3]>10){count++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  return {count,left,top,right,bottom};
}

test('blank canvas has no export, and a genuine stroke produces a bounded transparent PNG',()=>{
  const h=harness();
  assert.equal(h.pad.isEmpty(),true);assert.equal(h.pad.toPng(),'');
  assert.deepEqual(h.changes.at(-1),{empty:true,canUndo:false});
  h.stroke();
  assert.equal(h.pad.isEmpty(),false);
  const uri=h.pad.toPng(),png=decoded(uri),bounds=ink(png);
  assert.ok(bounds.count>100,'Actual pixels must be drawn');
  assert.ok(png.width<800&&png.height<400,'Export should crop the empty area');
  assert.ok(png.width<=1600&&png.height<=800);
  assert.ok(Buffer.from(uri.split(',')[1],'base64').length<=200*1024);
  assert.equal(png.data[3],0,'PNG background should be transparent');
  assert.ok(bounds.left>0&&bounds.top>0&&bounds.right<png.width-1&&bounds.bottom<png.height-1,'Ink must have padding on every edge');
  assert.deepEqual(h.changes.at(-1),{empty:false,canUndo:true});h.pad.destroy();
});

test('undo restores the exact first drawing and clear cannot resurrect a previous signature',()=>{
  const h=harness();h.stroke();const first=h.pad.toPng();
  h.stroke([[.6,.8],[.7,.25],[.88,.65]]);assert.notEqual(h.pad.toPng(),first);
  h.pad.undo();assert.equal(h.pad.toPng(),first);
  h.pad.clear();assert.equal(h.pad.isEmpty(),true);assert.equal(h.pad.toPng(),'');
  h.pad.undo();assert.equal(h.pad.toPng(),'');assert.deepEqual(h.changes.at(-1),{empty:true,canUndo:false});h.pad.destroy();
});

test('resizing and rotating the display preserve all existing ink and later strokes use the new rectangle',()=>{
  const h=harness();h.stroke();const first=h.pad.toPng();
  h.resize(300,100);assert.equal(h.pad.toPng(),first);
  h.stroke([[.6,.8],[.7,.25],[.88,.65]]);
  const resized=h.pad.toPng();
  const control=harness();control.stroke();control.stroke([[.6,.8],[.7,.25],[.88,.65]]);
  assert.equal(resized,control.pad.toPng(),'CSS size must not shift or distort the writing');
  h.resize(900,300);assert.equal(h.pad.toPng(),resized);h.pad.destroy();control.pad.destroy();
});

test('rotation during a stroke preserves its partial ink and does not connect to coordinates from the new viewport',()=>{
  const h=harness();h.fire('pointerdown',.12,.72);h.fire('pointermove',.35,.22);const before=h.pad.toPng();
  h.resize(300,100);h.fire('pointermove',.9,.9);h.fire('pointerup',.9,.9);
  assert.equal(h.pad.toPng(),before,'A geometry change must not add a diagonal across the signature');
  h.stroke([[.6,.8],[.7,.25],[.88,.65]]);h.pad.undo();assert.equal(h.pad.toPng(),before);h.pad.destroy();
});

test('a second finger and a right mouse button cannot add ink or terminate the active stroke',()=>{
  const h=harness();
  h.fire('pointerdown',.1,.7);h.fire('pointermove',.25,.25);
  h.fire('pointerdown',.8,.1,{pointerId:2,isPrimary:false});h.fire('pointermove',.9,.9,{pointerId:2,isPrimary:false});h.fire('pointerup',.9,.9,{pointerId:2,isPrimary:false});
  h.fire('pointermove',.4,.55);h.fire('pointerup',.4,.55);
  const first=h.pad.toPng();
  const control=harness();control.stroke();assert.equal(first,control.pad.toPng());
  h.stroke([[.7,.1],[.9,.8]],{pointerType:'mouse',button:2,buttons:2});assert.equal(h.pad.toPng(),first);
  h.pad.destroy();control.pad.destroy();
});

test('mouse and pen use the same drawing coordinates as touch',()=>{
  const results=['touch','mouse','pen'].map(pointerType=>{const h=harness();h.stroke(undefined,{pointerType});const result=h.pad.toPng();h.pad.destroy();return result;});
  assert.equal(results[0],results[1]);assert.equal(results[1],results[2]);
});

test('pointer cancellation preserves the completed ink, permits a new stroke, and keeps undo boundaries',()=>{
  const h=harness();
  h.fire('pointerdown',.12,.72);h.fire('pointermove',.35,.22);h.fire('pointercancel',.35,.22);
  const cancelled=h.pad.toPng();assert.ok(ink(decoded(cancelled)).count>30);
  h.fire('pointermove',.9,.9);assert.equal(h.pad.toPng(),cancelled,'Moves after cancellation must be ignored');
  h.stroke([[.6,.8],[.7,.25],[.88,.65]]);h.pad.undo();assert.equal(h.pad.toPng(),cancelled);h.pad.destroy();
});

test('lost pointer capture finalizes the current drawing without drawing a line to unrelated coordinates',()=>{
  const h=harness();h.fire('pointerdown',.15,.7);h.fire('pointermove',.3,.2);
  h.fire('lostpointercapture',0,0);const saved=h.pad.toPng();
  h.fire('pointerup',.95,.95);assert.equal(h.pad.toPng(),saved);
  h.stroke([[.6,.8],[.7,.25],[.88,.65]]);h.pad.undo();assert.equal(h.pad.toPng(),saved);h.pad.destroy();
});

test('fallback window events finish a stroke when pointer capture is unsupported',()=>{
  for(const capture of ['missing','throws']){
    const h=harness({capture});h.fire('pointerdown',.15,.7);h.fire('pointermove',.3,.2,{target:'window'});h.fire('pointerup',.4,.5,{target:'window'});
    const first=h.pad.toPng();assert.ok(ink(decoded(first)).count>30);
    h.fire('pointermove',.9,.9,{target:'window'});assert.equal(h.pad.toPng(),first);
    h.stroke([[.65,.2],[.85,.75]]);h.pad.undo();assert.equal(h.pad.toPng(),first);h.pad.destroy();
  }
});

test('clear during a stroke removes its partial pixels and ignores late events from that pointer',()=>{
  const h=harness();h.fire('pointerdown',.2,.2);h.fire('pointermove',.5,.6);h.pad.clear();
  h.fire('pointermove',.8,.8);h.fire('pointerup',.8,.8);assert.equal(h.pad.isEmpty(),true);assert.equal(h.pad.toPng(),'');
  h.stroke();assert.equal(h.pad.isEmpty(),false);h.pad.destroy();
});

test('an initially hidden canvas ignores invalid geometry and works once visible',()=>{
  const h=harness({width:0,height:0});h.stroke();assert.equal(h.pad.isEmpty(),true);assert.equal(h.pad.toPng(),'');
  h.resize(300,100);h.stroke();assert.equal(h.pad.isEmpty(),false);assert.equal(h.errors.length,0);h.pad.destroy();
});

test('destroy detaches drawing listeners and prevents callbacks or drawing after teardown',()=>{
  const h=harness({capture:'missing'});h.stroke();h.pad.destroy();
  const png=h.canvas.toDataURL('image/png'),count=h.changes.length;
  h.stroke();h.fire('pointerdown',.2,.2,{target:'window'});h.fire('pointermove',.8,.8,{target:'window'});h.fire('pointerup',.8,.8,{target:'window'});
  assert.equal(h.canvas.toDataURL('image/png'),png);assert.equal(h.changes.length,count);
  assert.ok([...h.listeners.values()].every(set=>set.size===0));
});
