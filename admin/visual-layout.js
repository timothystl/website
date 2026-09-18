import {cleanVisualDesign} from './visual-design.js';
export function visualParts(blocks,opts,{renderBlock,pairHalves,safeUrl,esc}){
 const editing=!!opts.editing;
 const groups=new Map();for(const b of blocks){const l=b.pilot?.layout;if(l?.group){if(!groups.has(l.group))groups.set(l.group,[]);groups.get(l.group).push(b);}}
 const done=new Set();const one=b=>renderBlock(b,{...opts,index:blocks.indexOf(b),total:blocks.length,siblings:blocks});
 let html='',parts=[],plain=[];const flush=()=>{if(plain.length){parts.push(...pairHalves(plain,{...opts,siblings:blocks}));plain=[]}};for(const b of blocks){const l=b.pilot?.layout;if(!l?.group){plain.push(b);continue}flush();if(done.has(l.group))continue;done.add(l.group);const members=groups.get(l.group),layout=cleanVisualDesign(members[0].pilot,safeUrl).layout;html='';
 const overlay=layout.mode==='overlay';
 html+=`<div class="${overlay?'lp-overlay lp-overlay--'+layout.position+' lp-overlay--'+layout.placement:'lp-columns'}${layout.reverse?' lp-reverse':''}" data-layout="${esc(l.group)}" style="--lp-card-x:${layout.offsetX||0}px;--lp-card-y:${layout.offsetY||0}px;--lp-card-width:${layout.cardWidth}%;--lp-overlap:${layout.overlap}px;--lp-card-padding:${layout.padding}px;--lp-card-radius:${layout.radius}px;--lp-card-color:${layout.cardColor};--lp-card-shadow:${layout.shadow?'0 12px 36px #182a3426':'none'};--lp-ratio:${layout.ratio}%;grid-template-columns:minmax(0,${layout.ratio}fr) minmax(0,${100-layout.ratio}fr)">`;
 for(let col=0;col<2;col++)html+=`<div class="lp-column" data-column="${col}" data-group="${esc(l.group)}">${editing&&overlay&&col===1?'<button class="lp-card-move" aria-label="Move overlapping card" title="Drag to position; arrow keys move; Shift moves 10 pixels">⠿ Move card</button>':''}${members.filter(x=>x.pilot.layout.column===col).map(one).join('')}${editing?`<button class="lp-insert" data-slot="${col}" data-group="${esc(l.group)}">＋ ${overlay?(col?'Add card content':'Add background content'):'Add here'}</button>`:''}</div>`;
 if(editing&&!overlay)html+='<button class="lp-divider" aria-label="Resize columns" title="Drag to resize columns; arrow keys adjust">⋮</button>';
 html+='</div>';parts.push(html);
 }
 flush();return parts;
}
