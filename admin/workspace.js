import { handleGoogleCalendar, calendarLink } from './calendar-google.js';
import { GOOGLE_CALENDAR_CLIENT } from './calendar-google-client.js';
// New entry points over existing records; no copied page content or parallel event store.
import { html, sidebarShell, escapeHtml as esc } from './helpers.js';
import { hasPermission, logAudit } from './auth.js';
import { parseBlocks, sanitizeBlocks, BLOCK_DEFS } from './blocks.js';
import { churchDate } from './when.js';
import { activeCategories, mergedCategories, parseCalendarIds, fetchGoogleEvents, readNewsEvents, readGymBookings, readLocalIntakeEvents, readBibleClassEvents } from './calendar.js';
import { getGCalAccessToken } from './gym.js';
import { ROOMS, TYPES } from './intake.js';
import { WORKSPACE_CLIENT, WORKSPACE_CSS } from './workspace-client.js';
const denied=()=>new Response('Access denied.',{status:403});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const scriptData=v=>JSON.stringify(v).replace(/</g,'\\u003c');
const hp=(u,p)=>hasPermission(u,p), any=(u,ps)=>ps.some(p=>hp(u,p));
const canCalendar=u=>any(u,['intake_manage','news_edit','gym_manage','pages_edit']);
const sharedPerms=['pages_edit','staff_edit','sermons_edit','news_edit','ministries_edit'];
export function safeWorkspaceReturn(v){const s=String(v||'');return /^\/pages\/[a-zA-Z0-9_-]+\/overview$/.test(s)||s==='/shared-content'||s==='/settings'?s:'/shared-content';}
function shell(tab,user,badges,title,body){const r=html(`${sidebarShell(tab,user,'',badges)}${WORKSPACE_CSS}<main class="ws-wrap"><h1 class="page-title">${esc(title)}</h1>${body}</main>`,`${title} — TLC Admin`);r.headers.set('Cache-Control','no-store');return r;}
function link(href,label){return `<a class="btn btn-sm" href="${esc(href)}">${esc(label)}</a>`;}
function entry(u,p,href,title,description){return hp(u,p)?`<article class="card"><h2>${esc(title)}</h2><p>${esc(description)}</p>${link(href,'Open '+title)}</article>`:'';}
export function workspaceSearchEntries(user, query) {
  return [
    {on:canCalendar(user),label:'Calendar & events',meta:'Month, week, list, and add event',href:'/calendar-workspace'},
    {on:any(user,sharedPerms),label:'Shared content',meta:'Church details, staff, values, sermons',href:'/shared-content'},
    {on:hp(user,'pages_edit'),label:'Worship times',meta:'Shared service day, time, and notes',href:'/shared-content/services'},
    {on:hp(user,'settings_manage'),label:'Find settings',meta:'Search settings across workspaces',href:'/settings'},
  ].filter(r=>r.on&&(r.label+' '+r.meta).toLowerCase().includes(query.toLowerCase()))
    .map(({on,...r})=>({section:'Workspace',...r}));
}
export function workspaceTabs(user,active,badges={}){const tabs=[[canCalendar(user),'/calendar-workspace','Calendar','calendar'],[hp(user,'intake_manage'),'/event-intake','Office follow-up','intake'],[hp(user,'events_manage')||hp(user,'market_manage')||Object.keys(badges.eventPerms||{}).some(p=>hp(user,p)),'/events','Registrations','events'],[hp(user,'pages_edit'),'/calendar-categories','Categories & colors','calcats']];return `<nav class="ws-tabs" aria-label="Calendar workspace">${tabs.filter(t=>t[0]).map(([,href,label,id])=>`<a href="${href}"${id===active?' aria-current="page"':''}>${label}</a>`).join('')}</nav>`;}
// Preserve unfamiliar lines and return unchanged structured rows byte-for-byte.
export function serviceRows(raw){return String(raw??'').split('\n').map((line,index)=>{const p=line.split('|');return p.length>=2&&p.length<=3?{index,day:p[0].trim(),time:p[1].trim(),note:(p[2]||'').trim(),original:line}:{index,raw:line,original:line};});}
export function serializeServiceRows(raw,submitted){
 if(!Array.isArray(submitted)||submitted.length>100)throw Error('Use at most 100 service rows.');
 const old=serviceRows(raw),seen=new Set();
 const lines=submitted.map(r=>{if(!r||typeof r!=='object')throw Error('Invalid service row.');let prior;
  if(r.index!==null){if(!Number.isInteger(r.index)||!old[r.index]||seen.has(r.index))throw Error('Invalid service row.');seen.add(r.index);prior=old[r.index];}
  if(prior&&'raw' in prior){if(typeof r.raw!=='string'||r.raw.includes('\n'))throw Error('Keep one line per legacy row.');return r.raw;}
  const f=['day','time','note'].map(k=>{if(typeof r[k]!=='string'||/[\r\n|]/.test(r[k]))throw Error('Day, time, and note must each fit on one line without a | character.');return r[k];});
  return prior&&f.every((s,i)=>s===prior[['day','time','note'][i]])?prior.original:f.join(' | ');
 });const value=lines.join('\n');if(value.length>20000)throw Error('The record is too long. No changes were saved.');return value;
}
export function realDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))return false;const d=new Date(v+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===v;}
const validTime=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export function calendarInput(data){
 const title=String(data.title||'').trim(),date=String(data.date||''),endDate=String(data.endDate||date),allDay=data.allDay===true,start=String(data.time||''),end=String(data.endTime||'');
 if(!title||title.length>300)throw Error('Enter an event name of up to 300 characters.');
 if(!realDate(date)||!realDate(endDate)||endDate<date)throw Error('Choose a valid date range.');
 if(!allDay&&(!validTime(start)||(end&&!validTime(end))))throw Error('Enter valid times, or select All day.');
 if(!allDay&&end&&endDate===date&&end<=start)throw Error('End time must be later than start time. For overnight events, set the end date.');
 const room=String(data.room||''),type=String(data.type||'');
 if(room&&!ROOMS.includes(room))throw Error('Choose a listed room.');
 if(type&&!Object.hasOwn(TYPES,type))throw Error('Choose a listed office type.');
 return {local_title:title,local_event_date:date,local_end_date:endDate===date?null:endDate,local_event_time:allDay?null:start,local_end_time:allDay?null:(end||null),room,event_type:type||null};
}
const localFields=['local_title','local_event_date','local_end_date','local_event_time','local_end_time','room','event_type'];
async function revision(row){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(localFields.map(k=>row[k]??null))));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export function pageDependencies(page){
 const result=new Map(),add=(key,label,href,permission,note)=>result.set(key,{key,label,href,permission,note});
 const church=()=>add('church','Church details','/pages/details','pages_edit','Shared address and contact information.');
 const services=()=>add('services','Worship times','/shared-content/services','pages_edit','Service times read from the shared church record.');
 const catalog={staff:['Staff profiles','/staff','staff_edit'],sermon:['Sermons','/sermons','sermons_edit'],sermonlist:['Sermons','/sermons','sermons_edit'],news:['News & Events','/newsitems','news_edit'],newsfeed:['News & Events','/newsitems','news_edit'],classes:['Christian education','/christian-education','news_edit'],partners:['Partners','/partners','pages_edit'],values:['Core values','/values','pages_edit'],newsletterarchive:['Newsletter archive','/newsletters','newsletter_edit'],marketfacts:['Christmas Market details','/market','market_manage'],marketapp:['Vendor application','/market','market_manage'],giving:['Giving','/giving','giving_manage'],give:['Giving','/giving','giving_manage'],amounts:['Giving','/giving','giving_manage']};
 for(const b of sanitizeBlocks(parseBlocks(page.blocks))){
  if(b.type==='servicetimes')services();if(['map','contact'].includes(b.type))church();
  if(BLOCK_DEFS[b.type]?.infoCard&&['left','right'].includes(b.card)){if(!b.cardShows||b.cardShows==='services'){services();church();}if(['contact','address'].includes(b.cardShows))church();}
  if(catalog[b.type]){const [label,href,permission]=catalog[b.type];add(href,label,href,permission,'Content is managed here; placement and appearance stay in the page editor.');}
  if(b.type==='events'||(b.type==='calendar'&&(!b.url||/google\.com\/calendar|calendar\.google\.com/.test(b.url))))add('calendar','Church calendar','/calendar-workspace','calendar','Events come from the calendar sources; layout stays on this page.');
  if(b.type==='countdown'&&b.newsId!=='custom')add('countdown','Countdown event','/newsitems','news_edit','Uses a dated News & Events record.');
  if(b.type==='registration')add('registrations','Event registration','/events','events_manage','Fields, capacity, and sign-ups belong to the selected event.');
  if(b.type==='posts')add('posts','Ministry posts','/ministries','ministries_edit','Posts belong to this ministry; the page controls their placement.');
 }
 if(['sidebar','sectionside'].includes(page.template)){church();services();}return [...result.values()];
}
export function renderPageOverview(page,user,badges){
 const base='/pages/'+encodeURIComponent(page.id),deps=pageDependencies(page),blocks=sanitizeBlocks(parseBlocks(page.blocks)),access=d=>d.permission==='calendar'?canCalendar(user):d.key==='registrations'?(hp(user,'events_manage')||hp(user,'market_manage')||Object.keys(badges.eventPerms||{}).some(p=>hp(user,p))):hp(user,d.permission);
 return shell('pages',user,badges,page.title,`<p>${esc(page.slug)} · Page workspace</p><div class="ws-tabs">${link('/pages','All pages')}${link(base+'/edit','Open editor')}${link(base+'/details','Page settings')}</div><div class="ws-columns"><section class="card"><h2>Page content</h2><p>The draft’s existing blocks. Shared records remain at their source.</p><ol>${blocks.map(b=>`<li>${esc(BLOCK_DEFS[b.type]?.label||b.type)}${b.title?' — '+esc(b.title):''}</li>`).join('')}</ol>${link(base+'/edit','Edit content and layout')}</section><section class="card"><h2>Used on this page</h2>${deps.length?deps.map(d=>`<article class="ws-dependency"><h3>${esc(d.label)}</h3><p>${esc(d.note)}</p>${access(d)?link(d.href+(d.key==='services'?'?returnTo='+encodeURIComponent(base+'/overview'):''),'Manage '+d.label):'<p>Your account does not have access to manage this source.</p>'}</article>`).join(''):'<p>No shared feeds were found in this draft. Edit its content on the page.</p>'}<p class="ws-muted">This describes the current draft. Published content is unchanged until you publish. Site-wide header and footer settings are separate.</p></section></div>`);
}
export async function handleWorkspaceRoutes(request,env,path,method,user,url,badges={}){
 if(!(path==='/shared-content'||path.startsWith('/shared-content/')||path==='/calendar-workspace'||path.startsWith('/calendar-workspace/')))return null;
 if(path.startsWith('/calendar-workspace')){
  if(!canCalendar(user))return denied();
  const googleResponse=await handleGoogleCalendar(request,env,path,method,user,url);if(googleResponse)return googleResponse;
  if(path==='/calendar-workspace'&&method==='GET'){
   const rows=await env.DB.prepare('SELECT key, name, color_id, palette, sort_order, active FROM calendar_categories').all();
   const editorCategories=activeCategories(mergedCategories(rows.results||[])).filter(c=>c.colorId).map(c=>({id:c.colorId,name:c.name}));
   return shell('calendar',user,badges,'Calendar & events',`${workspaceTabs(user,'calendar',badges)}<p>Click a date to add an event, or open a Google event to edit it here. Google holds linked scheduling details; website posts keep their promotional content. All times are church time (America/Chicago).</p><div id="workspace-calendar"></div><noscript>Enable JavaScript for the interactive calendar. Existing event forms remain available.</noscript><script type="application/json" id="workspace-data">${scriptData({mode:'calendar',googleEnabled:hp(user,'intake_manage'),startDate:realDate(url.searchParams.get('date'))?url.searchParams.get('date'):churchDate(),googleColors:editorCategories,today:churchDate(),canAdd:hp(user,'intake_manage'),canNews:hp(user,'news_edit'),canGym:hp(user,'gym_manage'),rooms:ROOMS,types:Object.entries(TYPES).map(([key,v])=>({key,label:v.label}))})}</script><script>${GOOGLE_CALENDAR_CLIENT}</script><script>${WORKSPACE_CLIENT}</script>`);
  }
  if(path==='/calendar-workspace/feed'&&method==='GET'){
   const from=url.searchParams.get('from'),to=url.searchParams.get('to');
   if(!realDate(from)||!realDate(to)||to<from||(new Date(to)-new Date(from))/86400000>62)return json({error:'Choose a calendar range of up to 63 days.'},400);
   try{
    const [catRows,idRow]=await Promise.all([env.DB.prepare('SELECT key, name, color_id, palette, sort_order, active FROM calendar_categories').all(),env.DB.prepare("SELECT value FROM site_settings WHERE key = 'calendar_google_ids'").first()]);
    const cats=mergedCategories(catRows.results||[]);
    const links=(await env.DB.prepare("SELECT * FROM calendar_event_links").all()).results||[];
    const [google,news,building,local,classes]=await Promise.all([fetchGoogleEvents(env,{ids:parseCalendarIds(idRow?.value),from,to,getToken:getGCalAccessToken,cats,includeEditLinks:true}),readNewsEvents(env,from,to,cats,{strict:true}),readGymBookings(env,from,to,{strict:true}),readLocalIntakeEvents(env,from,to,cats,{strict:true}),readBibleClassEvents(env,from,to,cats)]);
    // Only unlinked sources remain separate. A linked post is publishing metadata for Google.
    for(const ev of [...news,...local]){const link=links.find(l=>l.source_key===ev.id);if(link)ev.googleLink=link;}
    for(const ev of google.events){const link=links.find(l=>l.calendar_id===ev.googleCalendarId&&l.event_id===ev.googleEventId&&l.source_key.startsWith('n:'));if(link)ev.newsId=link.source_key.slice(2);}
    const linked=new Set(links.filter(l=>['synced','cancelled','error'].includes(l.state)).map(l=>l.source_key));
    return json({events:[...google.events,...news.filter(e=>!linked.has(e.id)),...building,...local.filter(e=>!linked.has(e.id)),...classes].filter(e=>e.start.slice(0,10)<=to&&(e.end||e.start).slice(0,10)>=from),categories:cats,google:google.ok,googleReason:google.reason,syncErrors:links.filter(l=>l.last_error).map(l=>({sourceKey:l.source_key,error:l.last_error}))});
   }catch(e){console.error('Admin calendar read failed',e);return json({error:'The calendar could not be loaded. Retry before making changes.'},503);}
  }
  const localMatch=path.match(/^\/calendar-workspace\/local\/(\d+)$/);
  if(localMatch&&method==='GET'){
   if(!hp(user,'intake_manage'))return denied();
   const row=await env.DB.prepare("SELECT * FROM event_intake WHERE id = ? AND source_kind = 'local'").bind(localMatch[1]).first();
   return row?json({event:Object.fromEntries(localFields.map(k=>[k,row[k]])),revision:await revision(row)}):json({error:'This local event no longer exists.'},404);
  }
  if((path==='/calendar-workspace/local'||localMatch)&&method==='POST'){
   if(!hp(user,'intake_manage'))return denied();
   if(localMatch&&await calendarLink(env,'l:'+localMatch[1]))return json({error:'This event is linked to Google. Edit it from the calendar to keep one scheduling record.'},409);
   let body,values;
   try{body=await request.json();values=calendarInput(body);}catch(e){return json({error:e.message||'Invalid event.'},400);}
   let id=localMatch?.[1];
   if(id){
    const old=await env.DB.prepare("SELECT * FROM event_intake WHERE id = ? AND source_kind = 'local'").bind(id).first();if(!old)return json({error:'This event no longer exists.'},404);
    if(body.revision!==await revision(old))return json({error:'This event changed in another session. Close this panel and reopen it before saving.'},409);
    const result=await env.DB.prepare(`UPDATE event_intake SET ${localFields.map(k=>k+' = ?').join(', ')}, event_date = ?, updated_at = ?, updated_by = ? WHERE id = ? AND source_kind = 'local' AND ${localFields.map(k=>k+' IS ?').join(' AND ')}`).bind(...localFields.map(k=>values[k]),values.local_event_date,new Date().toISOString(),user.username,id,...localFields.map(k=>old[k]??null)).run();
    if(!result.meta?.changes)return json({error:'This event changed in another session. Reopen it before saving.'},409);
   }else{
    const result=await env.DB.prepare(`INSERT INTO event_intake (source_kind,${localFields.join(',')},event_date,updated_by) VALUES ('local',${localFields.map(()=>'?').join(',')},?,?)`).bind(...localFields.map(k=>values[k]),values.local_event_date,user.username).run();id=result.meta.last_row_id;
   }
   await logAudit(env.DB,user,localMatch?'update':'create','calendar_event',String(id),values.local_title);return json({id,saved:true});
  }return new Response('Not found.',{status:404});
 }
 if(!any(user,sharedPerms))return denied();
 if(path==='/shared-content'&&method==='GET')return shell('shared',user,badges,'Shared content',`<p>Information reused by your pages. Change it at its source, then return to the page you were working on.</p><div class="ws-cards">${entry(user,'pages_edit','/shared-content/services','Worship times','Service rows with day, time, and optional notes.')}${entry(user,'pages_edit','/pages/details','Church details','Address, phone, email, and social links.')}${entry(user,'pages_edit','/values','Core values','Wording and images.')}${entry(user,'staff_edit','/staff','Staff profiles','People shown by staff blocks.')}${entry(user,'pages_edit','/partners','Partners','Shared ministry relationships.')}${entry(user,'sermons_edit','/sermons','Sermons','The sermon library and sermon blocks.')}${entry(user,'news_edit','/christian-education','Christian education','Classes displayed on your pages.')}${entry(user,'ministries_edit','/ministries','Ministry content','Ministry information and posts.')}</div>`);
 if(path==='/shared-content/services'){
  if(!hp(user,'pages_edit'))return denied();const row=await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'church_service_times'").first();
  if(!row)return new Response('Service times are unavailable. No changes were made.',{status:503});
  if(method==='POST'){
   const form=await request.formData(),original=String(form.get('original')??''),back=safeWorkspaceReturn(form.get('returnTo'));let value;
   try{value=serializeServiceRows(original,JSON.parse(String(form.get('rows'))));}catch(e){return new Response(e.message,{status:400});}
   const result=await env.DB.prepare("UPDATE site_settings SET value = ? WHERE key = 'church_service_times' AND value = ?").bind(value,original).run();
   if(!result.meta?.changes)return new Response('Service times changed in another session. Go back and reload before saving. Your submitted changes were not applied.',{status:409});
   await logAudit(env.DB,user,'update','settings','church_service_times','Worship times',{value:original},{value});
   return new Response('',{status:303,headers:{Location:'/shared-content/services?saved=1&returnTo='+encodeURIComponent(back),'Cache-Control':'no-store'}});
  }
  if(method==='GET'){
   const back=safeWorkspaceReturn(url.searchParams.get('returnTo')),pages=await env.DB.prepare('SELECT id,title,blocks,template,published_blocks FROM pages ORDER BY title').all();
   const used=(pages.results||[]).map(p=>({p,draft:pageDependencies(p).some(d=>d.key==='services'),live:pageDependencies({...p,blocks:p.published_blocks}).some(d=>d.key==='services')})).filter(x=>x.draft||x.live);
   return shell('shared',user,badges,'Worship times',`${link(back,'Back to where you were')}<p>One shared record, used by service-time blocks and page sidebars. Times remain text so labels such as “After worship” are preserved.</p>${url.searchParams.has('saved')?'<div class="alert alert-success">Saved. Pages that use these times will pick up the change within a couple of minutes.</div>':''}<form method="POST" action="/shared-content/services" id="service-form"><input type="hidden" name="original" value="${esc(row.value)}"><input type="hidden" name="returnTo" value="${esc(back)}"><input type="hidden" name="rows" id="service-json"><div class="card" id="service-rows"></div><div class="btn-row"><button type="button" class="btn" id="add-service">Add service</button><button class="btn btn-primary" id="save-services" disabled>Save shared times</button></div><p role="status" id="service-error"></p></form><noscript>JavaScript is required for the row editor. The <a href="/pages/details">Church details form</a> remains available.</noscript><section class="card"><h2>Used on these pages</h2><ul>${used.map(({p,draft,live})=>`<li><a href="/pages/${encodeURIComponent(p.id)}/overview">${esc(p.title)}</a> — ${[draft?'draft':'',live?'published':''].filter(Boolean).join(' and ')}</li>`).join('')||'<li>No page blocks currently reference service times.</li>'}</ul><p>Site-wide header and footer displays may also read church details.</p></section><script type="application/json" id="workspace-data">${scriptData({mode:'services',rows:serviceRows(row.value)})}</script><script>${WORKSPACE_CLIENT}</script>`);
  }
 }return new Response('Not found.',{status:404});
}
