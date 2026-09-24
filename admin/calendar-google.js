// Scheduling belongs to Google; local records retain publishing and office metadata.
import { getGCalAccessToken } from './gym.js';
import { parseCalendarIds, addDays, normalizeGoogleEvent, plainText } from './calendar.js';
import { hasPermission, logAudit } from './auth.js';
export const CALENDAR_LINK_SCHEMA = `CREATE TABLE IF NOT EXISTS calendar_event_links (
 source_key TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', last_error TEXT, synced_at TEXT
)`;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const CALENDAR_NEWS_LINK_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS calendar_news_google_event ON calendar_event_links(calendar_id,event_id) WHERE source_key GLOB 'n:*'`;
export async function configuredCalendars(env){
 const row=await env.DB.prepare("SELECT value FROM site_settings WHERE key='calendar_google_ids'").first();
 return [...new Set(parseCalendarIds(row?.value))];
}
async function connection(env,calendarId){
 if(!(await configuredCalendars(env)).includes(calendarId))throw fail('Choose a configured church calendar.',403);
 const token=await getGCalAccessToken(env);
 if(!token)throw fail('Google is not connected for editing. An administrator needs to check the service-account connection.',503);
 return token;
}
async function google(token,calendarId,eventId='',options={}){
 const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events'+(eventId?'/'+encodeURIComponent(eventId):''));
 url.searchParams.set('timeZone','America/Chicago');
 if(options.method)url.searchParams.set('sendUpdates','none');
 let r;try{r=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});}catch{throw fail('Google did not confirm the save. Retry without creating a second event.',503);}
 if(r.status===412)throw fail('This event changed in Google. Reopen it before saving so you can review the latest version.',409);
 if(r.status===403)throw fail('The church connection cannot edit this calendar. Its owner must grant the service account “Make changes to events”.',403);
 if(r.status===404||r.status===410)throw fail('This Google event is no longer available.',404);
 if(r.status===409)throw fail('This event already exists.',409);
 if(!r.ok)throw fail('Google Calendar is temporarily unavailable. Your changes were not confirmed; retry.',503);
 return r.status===204?{}:r.json();
}
export function recurrenceUntil(day,allDay){
 if(allDay)return day.replaceAll('-','');
 const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',timeZoneName:'shortOffset'}).formatToParts(new Date(day+'T18:00:00Z')).find(p=>p.type==='timeZoneName').value;
 const hours=Number(/GMT([+-]\d+)/.exec(offset)?.[1]||0);
 return new Date(Date.parse(day+'T23:59:59Z')-hours*3600000).toISOString().replace(/[-:]/g,'').replace('.000','');
}
function realDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const d=new Date(s+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;}
export function googleEventInput(data){
 const title=String(data.title||'').trim(),date=String(data.date||''),endDate=String(data.endDate||date),time=String(data.time||''),endTime=String(data.endTime||'');
 if(!title||title.length>300)throw fail('Enter an event name of up to 300 characters.');
 if(!realDate(date)||!realDate(endDate)||endDate<date)throw fail('Choose a valid date range.');
 const allDay=data.allDay===true;
 if(!allDay&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)||(date===endDate&&endTime<=time)))throw fail('Enter a start and later end time, or select All day.');
 const location=String(data.location||'').trim(),description=String(data.description||'');
 if(location.length>500||description.length>20000)throw fail('Shorten the location or description.');
 const colorId=String(data.colorId||'');if(colorId&&!/^(?:[1-9]|10|11)$/.test(colorId))throw fail('Choose a listed category.');
 return {summary:title,location,description,colorId:colorId||null,
 start:allDay?{date}:{dateTime:date+'T'+time+':00',timeZone:'America/Chicago'},
 end:allDay?{date:addDays(endDate,1)}:{dateTime:endDate+'T'+endTime+':00',timeZone:'America/Chicago'}};
}
function editable(e){if(e.status==='cancelled')throw fail('This event was cancelled in Google.',404);if(e.eventType&&e.eventType!=='default')throw fail('This special Google event type must be edited in Google.',400);}
function formEvent(e){const n=normalizeGoogleEvent(e);if(!n)throw fail('Google returned an event without a supported date.',400);return {title:e.summary||'',date:n.start.slice(0,10),endDate:n.end.slice(0,10),time:n.allDay?'':n.start.slice(11,16),endTime:n.allDay?'':n.end.slice(11,16),allDay:n.allDay,location:e.location||'',description:e.description||'',colorId:e.colorId||'',etag:e.etag,eventId:e.id,recurringEventId:e.recurringEventId||'',recurrence:e.recurrence||[],htmlLink:e.htmlLink||''};}
async function sourceRecord(env,key){
 const match=/^(n|l):(\d+)$/.exec(key||'');if(!match)throw fail('Choose an existing dated post or local event.');
 const row=await env.DB.prepare(match[1]==='n'?'SELECT * FROM news_items WHERE id=?':"SELECT * FROM event_intake WHERE id=? AND source_kind='local'").bind(match[2]).first();if(!row)throw fail('The source record no longer exists.',404);
 const data=match[1]==='n'?{title:row.title,date:row.event_date,endDate:row.event_end_date||row.event_date,time:row.event_time,endTime:row.event_end_time,location:row.event_location,description:plainText(row.summary||row.body||'')}:{title:row.local_title,date:row.local_event_date,endDate:row.local_end_date||row.local_event_date,time:row.local_event_time,endTime:row.local_end_time,location:row.room,description:''};
 return {...data,allDay:!data.time};
}
export async function calendarLink(env,key){return env.DB.prepare('SELECT * FROM calendar_event_links WHERE source_key=?').bind(key).first();}
// Refresh only scheduling fields. Photos, promotional copy, channels and office checks are untouched.
async function cacheSchedule(env,link,event){
 const n=normalizeGoogleEvent(event),cancelled=event.status==='cancelled';
 if(!n&&!cancelled)throw fail('Google returned an unsupported date.',503);
 const day=cancelled?null:n.start.slice(0,10),end=cancelled?null:n.end.slice(0,10),time=cancelled||n.allDay?null:n.start.slice(11,16),endTime=cancelled||n.allDay?null:n.end.slice(11,16);
 const [kind,id]=link.source_key.split(':');
 if(kind==='n')await env.DB.prepare('UPDATE news_items SET event_date=?,event_end_date=?,event_time=?,event_end_time=?,event_location=? WHERE id=?').bind(day,end,time,endTime,event.location||'',id).run();
 if(kind==='l')await env.DB.prepare("UPDATE event_intake SET local_event_date=?,local_end_date=?,local_event_time=?,local_end_time=?,room=?,event_date=? WHERE id=? AND source_kind='local'").bind(day,end,time,endTime,event.location||'',day,id).run();
 await env.DB.prepare("UPDATE calendar_event_links SET state=?,last_error=NULL,synced_at=? WHERE source_key=?").bind(cancelled?'cancelled':'synced',new Date().toISOString(),link.source_key).run();
}
export async function refreshCalendarLinks(env,{strict=false,sourceKeys=null}={}){
 const links=(await env.DB.prepare('SELECT * FROM calendar_event_links WHERE state IN (\'synced\',\'error\',\'cancelled\')').all()).results||[];
 const wanted=sourceKeys?links.filter(l=>sourceKeys.includes(l.source_key)):links;
 const selected=strict?wanted:wanted.filter(l=>!l.synced_at||Date.now()-Date.parse(l.synced_at)>60000);
 if(!selected.length)return;
 const tokens=new Map();
 let cursor=0,firstError;
 await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{while(cursor<selected.length){const link=selected[cursor++];try{
  if(!tokens.has(link.calendar_id))tokens.set(link.calendar_id,connection(env,link.calendar_id));
  const e=await google(await tokens.get(link.calendar_id),link.calendar_id,link.event_id);
  await cacheSchedule(env,link,e);
 }catch(e){await env.DB.prepare('UPDATE calendar_event_links SET last_error=? WHERE source_key=?').bind(e.message,link.source_key).run();firstError ||= e;}}}));
 if(strict&&firstError)throw firstError;
}
export async function handleGoogleCalendar(request,env,path,method,user,url){
 if(!path.startsWith('/calendar-workspace/google'))return null;
 if(!hasPermission(user,'intake_manage'))return json({error:'Calendar editing permission is required.'},403);
 try{
  if(path==='/calendar-workspace/google/connection'&&method==='GET'){
   const ids=await configuredCalendars(env),calendars=[];
   for(const id of ids){try{const token=await connection(env,id);const r=await fetch('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(id)+'/events?maxResults=1',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw fail('Google did not allow access to this calendar.',r.status===403?403:503);const b=await r.json();calendars.push({id,name:b.summary||id,writable:['owner','writer'].includes(b.accessRole),error:['owner','writer'].includes(b.accessRole)?'':'Read-only: calendar owner must grant Make changes to events.'});}catch(e){calendars.push({id,name:id,writable:false,error:e.message});}}
   return json({calendars});
  }
  const data=method==='GET'?Object.fromEntries(url.searchParams):await request.json();
  if(!data||typeof data!=='object'||Array.isArray(data))throw fail('Submit an event form.');
  const calendarId=String(data.calendarId||''),token=await connection(env,calendarId),eventId=String(data.eventId||'');
  if(path==='/calendar-workspace/google/event'&&method==='GET'){
   if(!eventId)throw fail('Choose an event.');const e=await google(token,calendarId,eventId);editable(e);return json({event:formEvent(e)});
  }
  if(path==='/calendar-workspace/google/event'&&method==='POST'){
   if(!eventId)throw fail('Choose an event.');
   if(typeof data.etag!=='string'||!/^"[^"\r\n]+"$/.test(data.etag))throw fail('Reopen the event before saving.');
   const old=await google(token,calendarId,eventId);editable(old);
   if(old.etag!==data.etag)throw fail('This event changed in Google. Reopen it before saving.',409);
   const patch=data.cancel===true?{status:'cancelled'}:googleEventInput(data);
   const result=await google(token,calendarId,eventId,{method:'PATCH',headers:{'If-Match':data.etag},body:JSON.stringify(patch)});
   const links=(await env.DB.prepare('SELECT * FROM calendar_event_links WHERE calendar_id=? AND event_id=?').bind(calendarId,eventId).all()).results||[];
   let cacheWarning=false;for(const link of links){try{await cacheSchedule(env,link,result);}catch{cacheWarning=true;}}
   await logAudit(env.DB,user,'update','google_calendar_event',eventId,patch.summary);
   return json({saved:true,event:result.status==='cancelled'?{eventId:result.id,cancelled:true}:formEvent(result),warning:cacheWarning?'Saved to Google; linked publishing details will refresh on the next read.':''});
  }
  if(path==='/calendar-workspace/google/create'&&method==='POST'){
   if(!/^[a-f0-9]{32}$/.test(data.requestId||''))throw fail('Reopen the event panel before saving.');
   const payload=googleEventInput(data),id='tlc'+data.requestId;
   if(data.repeat){if(!['DAILY','WEEKLY','MONTHLY'].includes(data.repeat))throw fail('Choose a listed repeat pattern.');if(data.repeatUntil&&(!realDate(data.repeatUntil)||data.repeatUntil<data.date))throw fail('Repeat end must be on or after the start date.');payload.recurrence=['RRULE:FREQ='+data.repeat+(data.repeatUntil?';UNTIL='+recurrenceUntil(data.repeatUntil,data.allDay===true):'')];}
   let result,recovered=false;try{result=await google(token,calendarId,'',{method:'POST',body:JSON.stringify({...payload,id,extendedProperties:{private:{tlcRequest:data.requestId}}})});}catch(e){if(e.status!==409)throw e;result=await google(token,calendarId,id);if(result.extendedProperties?.private?.tlcRequest!==data.requestId)throw e;recovered=true;}
   await logAudit(env.DB,user,'create','google_calendar_event',id,payload.summary);return json({saved:true,event:formEvent(result),warning:recovered?'The earlier save was found in Google; no duplicate was created. Reopen the event if you changed details after that attempt.':''});
  }
  if(path==='/calendar-workspace/google/promote'&&method==='POST'){
   if(!hasPermission(user,'news_edit'))throw fail('News editing permission is required.',403);
   if(!eventId)throw fail('Choose an event.');
   const existing=await env.DB.prepare("SELECT source_key FROM calendar_event_links WHERE calendar_id=? AND event_id=? AND source_key GLOB 'n:*'").bind(calendarId,eventId).first();
   if(existing)return json({url:'/newsitems/edit/'+existing.source_key.slice(2)});
   const e=await google(token,calendarId,eventId);editable(e);if(e.recurrence?.length)throw fail('Choose an occurrence to promote, rather than an entire series.');
   const n=normalizeGoogleEvent(e);if(!n)throw fail('This event has no supported date.');
   const id=Number.parseInt(crypto.randomUUID().replaceAll('-','').slice(0,12),16);
   // D1 batch is atomic: no orphan post if another request links this event first.
   try{await env.DB.batch([
    env.DB.prepare("INSERT INTO news_items (id,title,summary,publish_date,event_date,event_end_date,event_time,event_end_time,event_location,channels) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,e.summary||'Event',plainText(e.description||''),new Date().toISOString().slice(0,10),n.start.slice(0,10),n.end.slice(0,10),n.allDay?null:n.start.slice(11,16),n.allDay?null:n.end.slice(11,16),e.location||'','calendar'),
    env.DB.prepare("INSERT INTO calendar_event_links (source_key,calendar_id,event_id,state,synced_at) VALUES (?,?,?,'synced',?)").bind('n:'+id,calendarId,eventId,new Date().toISOString())
   ]);}catch(error){const linked=await env.DB.prepare("SELECT source_key FROM calendar_event_links WHERE calendar_id=? AND event_id=? AND source_key GLOB 'n:*'").bind(calendarId,eventId).first();if(linked)return json({url:'/newsitems/edit/'+linked.source_key.slice(2)});throw error;}
   await logAudit(env.DB,user,'create','news_item',String(id),'Google event promotion');
   return json({url:'/newsitems/edit/'+id});
  }
  if(path==='/calendar-workspace/google/publish'&&method==='POST'){
   const key=String(data.sourceKey||'');if(key.startsWith('n:')&&!hasPermission(user,'news_edit'))throw fail('News editing permission is required.',403);
   const original=await sourceRecord(env,key);
   // Staff review missing legacy end times in the panel; all other source values are prefilled.
   const payload=data.linkEventId?null:googleEventInput({...original,...data});
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));const id='tlc'+Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
   let existingGoogle=null;if(data.linkEventId){existingGoogle=await google(token,calendarId,String(data.linkEventId));editable(existingGoogle);if(existingGoogle.recurrence?.length)throw fail('Choose an occurrence to link, not an entire series.');}
   await env.DB.prepare('INSERT OR IGNORE INTO calendar_event_links (source_key,calendar_id,event_id) VALUES (?,?,?)').bind(key,calendarId,data.linkEventId||id).run();
   const link=await calendarLink(env,key);if(!link)throw fail('This Google event is already linked to another post.',409);if(link.calendar_id!==calendarId||link.event_id!==(data.linkEventId||id))throw fail('This record is already assigned to another Google event. Reopen it to see the existing link.',409);
   try{
    let result;
    if(data.linkEventId){result=existingGoogle;}
    else{try{result=await google(token,calendarId,'',{method:'POST',body:JSON.stringify({...payload,id,extendedProperties:{private:{tlcSource:key}}})});}catch(e){if(e.status!==409)throw e;result=await google(token,calendarId,id);if(result.extendedProperties?.private?.tlcSource!==key)throw fail('Google event identity conflict; ask an administrator to review the link.',409);}}
    await cacheSchedule(env,link,result);await logAudit(env.DB,user,'publish','google_calendar_event',result.id,key);return json({saved:true,event:formEvent(result)});
   }catch(e){await env.DB.prepare("UPDATE calendar_event_links SET last_error=? WHERE source_key=?").bind(e.message,key).run();throw e;}
  }
  return json({error:'Not found.'},404);
 }catch(e){return json({error:e.status?e.message:'Google Calendar could not be updated. Retry or ask an administrator to check the connection.'},e.status||503);}
}
