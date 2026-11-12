/* Local handwriting capture. No signature or form data leaves this component. */

const WIDTH=1200;
const HEIGHT=400;
const INK='#182033';
const PEN_WIDTH=4.4;
const PADDING=14;
const MAX_PNG_BYTES=200*1024;

/**
 * A fixed 3:1 drawing surface. CSS can resize it without clearing the backing
 * bitmap. Normalized strokes make undo/redraw independent of the display size.
 * onChange runs after each completed/cancelled stroke, clear or undo, and once
 * on creation. Cancelling a pointer preserves the handwriting already drawn.
 */
export function createSignaturePad(canvas,{onChange=()=>{},onError=()=>{}}={}){
  if(!canvas||typeof canvas.getContext!=='function')throw new Error('A área de assinatura não está disponível.');
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Este navegador não conseguiu abrir a área de assinatura.');
  const view=canvas.ownerDocument?.defaultView;
  const previousTouchAction=canvas.style.touchAction;
  const previousUserSelect=canvas.style.userSelect;
  canvas.width=WIDTH;
  canvas.height=HEIGHT;
  canvas.style.touchAction='none';
  canvas.style.userSelect='none';

  const strokes=[],processedMoves=new WeakSet();
  let activeId=null,current=null,initialRect=null,fallback=false,destroyed=false;

  function notify(){onChange({empty:strokes.length===0,canUndo:strokes.length>0});}
  function fail(message){const error=new Error(message);onError(error);throw error;}
  function prevent(event){if(event.cancelable!==false)event.preventDefault?.();}
  function setPen(target=context){target.lineWidth=PEN_WIDTH;target.lineCap='round';target.lineJoin='round';target.strokeStyle=INK;target.fillStyle=INK;}
  function dot(point){
    setPen();context.beginPath();context.arc(point.x*WIDTH,point.y*HEIGHT,PEN_WIDTH/2,0,Math.PI*2);context.fill();
  }
  function line(from,to){
    setPen();context.beginPath();context.moveTo(from.x*WIDTH,from.y*HEIGHT);context.lineTo(to.x*WIDTH,to.y*HEIGHT);context.stroke();
  }
  function redraw(){
    context.clearRect(0,0,WIDTH,HEIGHT);
    for(const stroke of strokes){dot(stroke[0]);for(let index=1;index<stroke.length;index++)line(stroke[index-1],stroke[index]);}
  }
  function point(event,rect){
    if(!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY)||rect.width<=0||rect.height<=0)return null;
    const insetX=PEN_WIDTH/2/WIDTH,insetY=PEN_WIDTH/2/HEIGHT;
    return {x:Math.max(insetX,Math.min(1-insetX,(event.clientX-rect.left)/rect.width)),y:Math.max(insetY,Math.min(1-insetY,(event.clientY-rect.top)/rect.height))};
  }
  function addPoint(sample,rect){
    const next=point(sample,rect);if(!next||!current)return;
    const previous=current[current.length-1];
    if(Math.hypot((next.x-previous.x)*WIDTH,(next.y-previous.y)*HEIGHT)<.35)return;
    current.push(next);line(previous,next);
  }
  function removeFallback(){
    if(!fallback)return;fallback=false;
    view?.removeEventListener('pointermove',move);
    view?.removeEventListener('pointerup',up);
    view?.removeEventListener('pointercancel',cancel);
  }
  function release(notifyChange=true){
    if(activeId===null)return;
    const releasedId=activeId;
    activeId=null;current=null;initialRect=null;removeFallback();
    // Clear activeId first: release can synchronously dispatch lostpointercapture.
    try{canvas.releasePointerCapture?.(releasedId);}catch{/* The browser may already have released this pointer. */}
    if(notifyChange)notify();
  }
  function down(event){
    if(destroyed||activeId!==null||event.isPrimary===false||event.button!==undefined&&event.button!==0||!Number.isFinite(event.pointerId))return;
    const rect=canvas.getBoundingClientRect(),first=point(event,rect);if(!first)return;
    prevent(event);activeId=event.pointerId;initialRect={width:rect.width,height:rect.height};
    current=[first];strokes.push(current);dot(first);
    let captured=false;
    try{if(typeof canvas.setPointerCapture==='function'){canvas.setPointerCapture(activeId);captured=true;}}catch{/* Some embedded browsers require document-level pointer tracking. */}
    if(!captured&&view?.addEventListener){
      fallback=true;
      view.addEventListener('pointermove',move,{passive:false});
      view.addEventListener('pointerup',up,{passive:false});
      view.addEventListener('pointercancel',cancel,{passive:false});
    }
  }
  function move(event){
    if(destroyed||event.pointerId!==activeId||activeId===null)return;
    // A canvas event also bubbles to the document fallback. Process its
    // coalesced samples once, so they cannot be replayed backwards.
    if(processedMoves.has(event))return;processedMoves.add(event);
    prevent(event);
    // A lost mouse-up must not connect a later hover to the previous signature.
    if(event.pointerType==='mouse'&&event.buttons===0){release();return;}
    const rect=canvas.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0||Math.abs(rect.width-initialRect.width)>.5||Math.abs(rect.height-initialRect.height)>.5){release();return;}
    let samples=[];
    try{samples=event.getCoalescedEvents?.()||[];}catch{/* Use the dispatched event if coalesced samples are unavailable. */}
    for(const sample of samples)addPoint(sample,rect);
    addPoint(event,rect);
  }
  function up(event){
    if(destroyed||event.pointerId!==activeId||activeId===null)return;
    prevent(event);
    const rect=canvas.getBoundingClientRect();
    if(rect.width>0&&rect.height>0&&Math.abs(rect.width-initialRect.width)<=.5&&Math.abs(rect.height-initialRect.height)<=.5)addPoint(event,rect);
    release();
  }
  function cancel(event){if(!destroyed&&activeId!==null&&event.pointerId===activeId){prevent(event);release();}}
  function lost(event){if(!destroyed&&activeId!==null&&event.pointerId===activeId)release();}
  function blur(){if(!destroyed)release();}

  canvas.addEventListener('pointerdown',down,{passive:false});
  canvas.addEventListener('pointermove',move,{passive:false});
  canvas.addEventListener('pointerup',up,{passive:false});
  canvas.addEventListener('pointercancel',cancel,{passive:false});
  canvas.addEventListener('lostpointercapture',lost);
  view?.addEventListener('blur',blur);

  function clear(){if(destroyed)return;release(false);strokes.length=0;context.clearRect(0,0,WIDTH,HEIGHT);notify();}
  function undo(){if(destroyed)return;release(false);strokes.pop();redraw();notify();}
  function isEmpty(){return strokes.length===0;}
  function toPng(){
    if(destroyed||isEmpty())return '';
    let minX=WIDTH,minY=HEIGHT,maxX=0,maxY=0;
    for(const stroke of strokes)for(const item of stroke){const x=item.x*WIDTH,y=item.y*HEIGHT;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    const left=Math.max(0,Math.floor(minX-PADDING)),top=Math.max(0,Math.floor(minY-PADDING));
    const width=Math.max(1,Math.min(WIDTH,Math.ceil(maxX+PADDING))-left);
    const height=Math.max(1,Math.min(HEIGHT,Math.ceil(maxY+PADDING))-top);
    const output=canvas.ownerDocument?.createElement('canvas');
    if(!output)fail('Não foi possível preparar a imagem da assinatura. Tente novamente.');
    let scale=1;
    for(let attempt=0;attempt<7;attempt++){
      output.width=Math.max(1,Math.round(width*scale));output.height=Math.max(1,Math.round(height*scale));
      const drawing=output.getContext('2d');if(!drawing)fail('Não foi possível preparar a imagem da assinatura. Tente novamente.');
      drawing.drawImage(canvas,left,top,width,height,0,0,output.width,output.height);
      let image;
      try{image=output.toDataURL('image/png');}catch{fail('Não foi possível exportar a assinatura. Refaça o desenho e tente novamente.');}
      if(typeof image!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))fail('O navegador não conseguiu exportar a assinatura em PNG.');
      const encoded=image.slice(22),padding=encoded.endsWith('==')?2:encoded.endsWith('=')?1:0;
      if(encoded.length%4!==0)fail('O navegador não conseguiu exportar a assinatura em PNG.');
      if(Math.floor(encoded.length*3/4)-padding<=MAX_PNG_BYTES)return image;
      scale*=.75;
    }
    return fail('A assinatura ficou muito grande. Limpe o campo e desenhe novamente.');
  }
  function destroy(){
    if(destroyed)return;release(false);destroyed=true;strokes.length=0;
    context.clearRect(0,0,WIDTH,HEIGHT);
    canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);
    canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);
    canvas.removeEventListener('lostpointercapture',lost);view?.removeEventListener('blur',blur);
    canvas.style.touchAction=previousTouchAction;canvas.style.userSelect=previousUserSelect;
  }
  notify();
  return {clear,undo,isEmpty,toPng,destroy};
}
