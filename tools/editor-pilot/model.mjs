// Pilot-only envelope: production blocks and routes are deliberately unchanged.
import {sanitizeBlock, renderPage, renderBlock, BLOCK_CSS, safeUrl, esc} from '../../admin/blocks.js';
const num=(v,lo,hi,d)=>Number.isFinite(+v)?Math.max(lo,Math.min(hi,+v)):d;
const choice=(v,a,d)=>a.includes(v)?v:d;
export function cleanPilot(p){
 if(!p||typeof p!=='object')return undefined;
 const out={};
 if(p.layout){const l=p.layout;out.layout={group:String(l.group||'').replace(/[^\w-]/g,'').slice(0,40),column:num(l.column,0,1,0)|0,ratio:num(l.ratio,25,75,60),reverse:!!l.reverse,mode:choice(l.mode,['columns','overlay'],'columns'),position:choice(l.position,['left','center','right'],'right'),offsetX:num(l.offsetX,-500,500,0),offsetY:num(l.offsetY,-400,400,0),overlap:num(l.overlap,0,160,64),cardWidth:num(l.cardWidth,25,90,40),padding:num(l.padding,0,64,24),radius:num(l.radius,0,40,16),shadow:l.shadow!==false,cardColor:/^#[0-9a-f]{6}$/i.test(l.cardColor||'')?l.cardColor:'#ffffff',placement:choice(l.placement,['inside','edge'],'edge')};}
 for(const [k,lo,hi,d] of [['spaceAbove',0,160,24],['spaceBelow',0,160,24],['head',20,80,36],['body',12,26,16],['line',1.1,2.3,1.6]])if(p[k]!=null)out[k]=num(p[k],lo,hi,d);
 if(p.stamp){const s=p.stamp;out.stamp={shape:choice(s.shape,['badge','ribbon','label','banner','original'],'badge'),x:num(s.x,0,100,75),y:num(s.y,0,100,4),size:num(s.size,10,30,14),mobileSize:num(s.mobileSize,10,24,12),rotation:num(s.rotation,-20,20,0),visibility:choice(s.visibility,['always','before','window'],'always'),from:String(s.from||'').slice(0,16),until:String(s.until||'').slice(0,16)};}
 if(p.countdown){const c=p.countdown;out.countdown={layout:choice(c.layout,['tiles','inline','days','card'],'tiles'),seconds:!!c.seconds,ending:choice(c.ending,['message','button','hide'],'message'),duration:num(c.duration,0,1440,120),nowText:String(c.nowText||'We’re gathering now.').slice(0,200),endText:String(c.endText||'Thank you for joining us.').slice(0,200),buttonText:String(c.buttonText||'See what’s next').slice(0,100),url:safeUrl(c.url||''),newTab:!!c.newTab};}
 return out;
}
export function cleanBlocks(input){
 if(!Array.isArray(input)||input.length>120)throw Error('The draft must contain no more than 120 blocks.');
 const ids=new Set();return input.map(b=>{const c=sanitizeBlock(b);if(!c)throw Error('Unknown block type; the draft was not saved.');if(ids.has(c.id))throw Error('Duplicate block ID; the draft was not saved.');ids.add(c.id);if(b.pilot)c.pilot=cleanPilot(b.pilot);return c;});
}
export function renderPilot(blocks,{editing=true,data={}}={}){
 if(!blocks.some(b=>b.pilot?.layout?.group))return renderPage(blocks,{editing,withCss:true,data,slug:'foodpantry'});
 const groups=new Map();for(const b of blocks){const l=b.pilot?.layout;if(l?.group){if(!groups.has(l.group))groups.set(l.group,[]);groups.get(l.group).push(b);}}
 const done=new Set();const one=b=>renderBlock(b,{editing,data,slug:'foodpantry',blocks,total:blocks.length,index:blocks.indexOf(b)});
 let html='';for(const b of blocks){const l=b.pilot?.layout;if(!l?.group){html+=one(b);continue}if(done.has(l.group))continue;done.add(l.group);const members=groups.get(l.group),layout=members[0].pilot.layout;
 const overlay=layout.mode==='overlay';
 html+=`<div class="${overlay?'lp-overlay lp-overlay--'+layout.position+' lp-overlay--'+layout.placement:'lp-columns'}${layout.reverse?' lp-reverse':''}" data-layout="${esc(l.group)}" style="--lp-card-x:${layout.offsetX||0}px;--lp-card-y:${layout.offsetY||0}px;--lp-card-width:${layout.cardWidth}%;--lp-overlap:${layout.overlap}px;--lp-card-padding:${layout.padding}px;--lp-card-radius:${layout.radius}px;--lp-card-color:${layout.cardColor};--lp-card-shadow:${layout.shadow?'0 12px 36px #182a3426':'none'};--lp-ratio:${layout.ratio}%;grid-template-columns:minmax(0,${layout.ratio}fr) minmax(0,${100-layout.ratio}fr)">`;
 for(let col=0;col<2;col++)html+=`<div class="lp-column" data-column="${col}" data-group="${esc(l.group)}">${editing&&overlay&&col===1?'<button class="lp-card-move" aria-label="Move overlapping card" title="Drag to position; arrow keys move; Shift moves 10 pixels">⠿ Move card</button>':''}${members.filter(x=>x.pilot.layout.column===col).map(one).join('')}${editing?`<button class="lp-insert" data-slot="${col}" data-group="${esc(l.group)}">＋ ${overlay?(col?'Add card content':'Add background content'):'Add here'}</button>`:''}</div>`;
 if(editing&&!overlay)html+='<button class="lp-divider" aria-label="Resize columns" title="Drag to resize columns; arrow keys adjust">⋮</button>';
 html+='</div>';
 }
 return BLOCK_CSS+'<div class="tlcb-page">'+html+'</div>';
}
