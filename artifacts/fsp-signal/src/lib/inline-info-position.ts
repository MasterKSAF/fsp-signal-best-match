export type InfoBounds = { left:number; top:number; width:number; height:number };
export function infoBounds(viewport:InfoBounds, dialog?:InfoBounds): InfoBounds {
  if (!dialog) return viewport;
  const left=Math.max(viewport.left,dialog.left),top=Math.max(viewport.top,dialog.top);
  const right=Math.min(viewport.left+viewport.width,dialog.left+dialog.width);
  const bottom=Math.min(viewport.top+viewport.height,dialog.top+dialog.height);
  return right>left&&bottom>top?{left,top,width:right-left,height:bottom-top}:viewport;
}
export function infoPosition(anchor:{left:number;top:number;bottom:number},box:{width:number;height:number},bounds:InfoBounds) {
  const padding=Math.min(12,bounds.width/4,bounds.height/4);
  const maxWidth=Math.max(1,bounds.width-padding*2),maxHeight=Math.max(1,bounds.height-padding*2);
  const width=Math.min(box.width,maxWidth),height=Math.min(box.height,maxHeight);
  const below=anchor.bottom+8,above=anchor.top-height-8;
  return {left:Math.max(bounds.left+padding,Math.min(anchor.left,bounds.left+bounds.width-padding-width)),
    top:Math.max(bounds.top+padding,Math.min(below+height<=bounds.top+bounds.height-padding?below:above,bounds.top+bounds.height-padding-height)),maxWidth,maxHeight};
}
