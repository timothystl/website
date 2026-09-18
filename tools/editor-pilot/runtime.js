// Shared by the local editor and its preview. No network or content mutations.
(function(){
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.pilotDecorate=function(root,blocks,phase='live'){
 for(const b of blocks){const n=root.querySelector('[data-id="'+b.id+'"]')||root.querySelector('#'+CSS.escape(b.anchorId||b.id));if(!n)continue;const p=b.pilot||{};
 for(const [key,css] of [['spaceAbove','--tlcb-space-above'],['spaceBelow','--tlcb-space-below'],['head','--tlcb-head'],['body','--tlcb-body']])if(p[key]!=null)n.style.setProperty(css,p[key]+'px');if(p.head!=null)n.style.setProperty('--tlcb-hero',p.head+'px');
 if(p.line)n.querySelectorAll('p').forEach(el=>el.style.lineHeight=p.line);
 let timer=n.querySelector('[data-pilot-target]'),original=n.querySelector('[data-countdown]');
 if(original&&p.countdown&&!timer){timer=document.createElement('div');timer.dataset.pilotTarget=original.dataset.countdown;timer.className='lp-timer';original.parentNode.replaceWith(timer);}
 let target=timer?Date.parse(timer.dataset.pilotTarget):original?Date.parse(original.dataset.countdown):NaN;
 const c=p.countdown||{},duration=(c.duration??120)*60000;
 let clock=phase==='before'&&Number.isFinite(target)?target-3*86400000-4*3600000-23*60000:phase==='now'&&Number.isFinite(target)?target+Math.min(duration/2,60000):phase==='after'&&Number.isFinite(target)?target+duration+60000:Date.now();
 if(timer&&Number.isFinite(target)){let html='';const started=clock>=target,ended=clock>=target+duration;timer.className='lp-timer lp-timer-'+c.layout;timer.hidden=started&&c.ending==='hide';
 if(started){if(c.ending==='button'){html=c.url?'<a class="lp-end-button" href="'+esc(c.url)+'"'+(c.newTab?' target="_blank" rel="noopener noreferrer"':'')+'>'+esc(c.buttonText)+'</a>':'<span class="lp-end-message">Set a destination for “'+esc(c.buttonText)+'” in Countdown settings.</span>'}else if(c.ending==='message')html='<div class="lp-end-message">'+esc(ended?c.endText:c.nowText)+'</div>'}
 else{let s=Math.max(0,Math.floor((target-clock)/1000)),v=[Math.floor(s/86400),Math.floor(s%86400/3600),Math.floor(s%3600/60),s%60],labels=['days','hours','min','sec'];if(c.layout==='days')html='<strong>'+v[0]+'</strong> days to go';else if(c.layout==='inline')html='Starts in '+v[0]+'d '+v[1]+'h '+v[2]+'m'+(c.seconds?' '+v[3]+'s':'');else html='<div class="lp-digits">'+v.slice(0,c.seconds?4:3).map((x,i)=>'<div><strong>'+String(x).padStart(2,'0')+'</strong><small>'+labels[i]+'</small></div>').join('')+'</div>'}
 if(timer.innerHTML!==html)timer.innerHTML=html;
 }
 const st=n.querySelector('.tlcb-stamp');if(st&&p.stamp){const s=p.stamp;st.classList.add('lp-stamp');st.dataset.shape=s.shape;st.style.setProperty('--lp-stamp-size',s.size+'px');st.style.setProperty('--lp-stamp-mobile',s.mobileSize+'px');st.style.setProperty('--lp-stamp-rotation',s.rotation+'deg');st.style.setProperty('--lp-stamp-x',s.x+'%');st.style.setProperty('--lp-stamp-y',s.y+'%');
 // Visibility dates use church time, resolved by the server; never parse them in the visitor's timezone.
 const a=s.fromInstant?Date.parse(s.fromInstant):NaN,z=s.untilInstant?Date.parse(s.untilInstant):NaN;
 st.hidden=s.visibility==='before'&&(!Number.isFinite(target)||clock>=target)||s.visibility==='window'&&(!(clock>=a)||!(clock<z));
 }
 }
};
})();
