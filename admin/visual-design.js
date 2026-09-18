// Optional design metadata; no database migration or content replacement.
const num=(v,lo,hi,d)=>Number.isFinite(+v)?Math.max(lo,Math.min(hi,+v)):d;
const choice=(v,a,d)=>a.includes(v)?v:d;
export function cleanVisualDesign(p, safeUrl){
 if(!p||typeof p!=='object')return undefined;
 const out={};
 if(p.layout){const l=p.layout;out.layout={group:String(l.group||'').replace(/[^\w-]/g,'').slice(0,40),column:num(l.column,0,1,0)|0,ratio:num(l.ratio,25,75,60),reverse:!!l.reverse,mode:choice(l.mode,['columns','overlay'],'columns'),position:choice(l.position,['left','center','right'],'right'),offsetX:num(l.offsetX,-500,500,0),offsetY:num(l.offsetY,-400,400,0),overlap:num(l.overlap,0,160,64),cardWidth:num(l.cardWidth,25,90,40),padding:num(l.padding,0,64,24),radius:num(l.radius,0,40,16),shadow:l.shadow!==false,cardColor:/^#[0-9a-f]{6}$/i.test(l.cardColor||'')?l.cardColor:'#ffffff',placement:choice(l.placement,['inside','edge'],'edge')};}
 for(const [k,lo,hi,d] of [['spaceAbove',0,160,24],['spaceBelow',0,160,24],['head',20,80,36],['body',12,26,16],['line',1.1,2.3,1.6]])if(p[k]!=null)out[k]=num(p[k],lo,hi,d);
 if(p.stamp){const s=p.stamp;out.stamp={shape:choice(s.shape,['badge','ribbon','label','banner','original'],'badge'),x:num(s.x,0,100,75),y:num(s.y,0,100,4),size:num(s.size,10,30,14),mobileSize:num(s.mobileSize,10,24,12),rotation:num(s.rotation,-20,20,0),visibility:choice(s.visibility,['always','before','window'],'always'),from:String(s.from||'').slice(0,16),until:String(s.until||'').slice(0,16)};}
 if(p.countdown){const c=p.countdown;out.countdown={layout:choice(c.layout,['tiles','inline','days','card'],'tiles'),seconds:!!c.seconds,ending:choice(c.ending,['message','button','hide'],'message'),duration:num(c.duration,0,1440,120),nowText:String(c.nowText||'We’re gathering now.').slice(0,200),endText:String(c.endText||'Thank you for joining us.').slice(0,200),buttonText:String(c.buttonText||'See what’s next').slice(0,100),url:safeUrl(c.url||''),newTab:!!c.newTab};}
 return out;
}
