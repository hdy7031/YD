export interface Rect { x:number; y:number; width:number; height:number }
export function keepVisible(x:number,y:number,a:Rect,size=76,snap=false){
  let nx=Math.max(a.x,Math.min(a.x+Math.max(0,a.width-size),Math.round(x)));
  const ny=Math.max(a.y,Math.min(a.y+Math.max(0,a.height-size),Math.round(y)));
  if(snap){if(nx-a.x<32)nx=a.x;else if(a.x+a.width-size-nx<32)nx=a.x+a.width-size;}
  return {x:nx,y:ny};
}
// Keep a whole window inside one work area. Unlike keepVisible (square helper
// used by the old floating ball) this honours the real width and height, so a
// tall companion window can still be dragged against the right screen edge
// without being pushed back, and a removed display can never strand it.
export function clampToArea(x:number,y:number,width:number,height:number,a:Rect,snap=false){
  const maxX=a.x+Math.max(0,a.width-width),maxY=a.y+Math.max(0,a.height-height);
  let nx=Math.max(a.x,Math.min(maxX,Math.round(x))),ny=Math.max(a.y,Math.min(maxY,Math.round(y)));
  if(snap){
    if(nx-a.x<32)nx=a.x;else if(maxX-nx<32)nx=maxX;
    if(ny-a.y<24)ny=a.y;else if(maxY-ny<24)ny=maxY;
  }
  return {x:nx,y:ny};
}

// 拖动时的坐标决策：渲染层指针增量与系统光标增量一致时按指针走；两者对不上
// （CSS 像素 / DIP / 显示器缩放不一致）时改用系统光标，并按当前位置重新对齐锚点。
// 抽成纯函数是为了让“越拖越偏”这一类问题可以脱离真实鼠标被验证。
export interface DragAnchor {
  windowX:number;
  windowY:number;
  pointerX:number;
  pointerY:number;
  cursorX:number;
  cursorY:number;
  cursorMode:boolean;
  width:number;
  height:number;
}
export interface DragStep {
  cursorMode:boolean;
  delta:{x:number;y:number};
  // 是否在这一步从指针模式切换到光标模式（调用方需要按当前位置重新对齐锚点）。
  adoptedCursor:boolean;
}
export function resolveDragStep(anchor:DragAnchor,pointer:{x:number;y:number},cursor:{x:number;y:number},tolerance=4):DragStep {
  const pointerDelta={x:pointer.x-anchor.pointerX,y:pointer.y-anchor.pointerY};
  const cursorDelta={x:cursor.x-anchor.cursorX,y:cursor.y-anchor.cursorY};
  const cursorMoved=Math.abs(cursorDelta.x)+Math.abs(cursorDelta.y)>=tolerance;
  const mismatch=Math.abs(cursorDelta.x-pointerDelta.x)+Math.abs(cursorDelta.y-pointerDelta.y)>tolerance;
  if(anchor.cursorMode)return {cursorMode:true,delta:cursorDelta,adoptedCursor:false};
  if(cursorMoved&&mismatch)return {cursorMode:true,delta:cursorDelta,adoptedCursor:true};
  return {cursorMode:false,delta:pointerDelta,adoptedCursor:false};
}
