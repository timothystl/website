import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { renderGiveStaxMockupHtml } from '../give-stax-mockup.js';
const html=renderGiveStaxMockupHtml();
const start=html.indexOf('  var paymentBusy = false;');
const end=html.indexOf('})();',start);
assert(start>0 && end>start);
const source=html.slice(start,end);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<8;i++)await tick();}
function page(store,checkout){
 let submit,posts=[];
 const elements=new Map();
 const context={
  step:2,gifts:[{fundId:'1',amount:'10.00'}],coverFees:false,freq:'',configured:true,
  CHMS_API:'https://synthetic.invalid',crypto:{randomUUID},
  sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  document:{getElementById(id){if(!elements.has(id))elements.set(id,{value:id==='stxEmail'?'synthetic@example.invalid':'Synthetic',textContent:'Give',addEventListener(type,fn){if(id==='stxForm'&&type==='submit')submit=fn;},reset(){}});return elements.get(id);}},
  staxInstance:{tokenize:async()=>({id:'pm_synthetic'})},
  fetch:async(url,init)=>{const b=JSON.parse(init.body);posts.push({url,b});if(url.endsWith('/stax-customer'))return Response.json({customerId:'cus_synthetic'});return checkout(b);},
  showMsg(){},goToStep(){},renderGifts(){},renderFreqRow(){},updateTotal(){},mountStaxCardFields(){},cardErrorMsg(){return 'invalid';},console,
 };
 vm.runInNewContext(source,context);
 return {submit:()=>submit({preventDefault(){}}),posts};
}
test('a double click makes one request and an uncertain retry/reload keeps the same opaque intent',async()=>{
 const store=new Map();const first=page(store,async()=>{throw Error('lost response');});first.submit();first.submit();await settle();
 let sent=first.posts.filter(x=>x.url.endsWith('/checkout'));assert.equal(sent.length,1);const id=sent[0].b.intent_id;
 first.submit();await settle();sent=first.posts.filter(x=>x.url.endsWith('/checkout'));assert.equal(sent[1].b.intent_id,id);
 const reload=page(store,async()=>Response.json({pending:true,error:'pending'},{status:409}));reload.submit();await settle();
 assert.equal(reload.posts.find(x=>x.url.endsWith('/checkout')).b.intent_id,id);
 assert.deepEqual([...store.values()],[id]);assert.match(id,/^[a-f0-9-]{36}$/);
});
test('only a confirmed success or explicitly safe decline clears the pending identity',async()=>{
 for(const response of [()=>Response.json({ok:true}),()=>Response.json({error:'declined',retry_safe:true},{status:402})]){
  const store=new Map();const p=page(store,async()=>response());p.submit();await settle();assert.equal(store.size,0);
 }
});
test('unavailable browser storage refuses payment before any provider request',async()=>{
 const store={get(){throw Error('blocked');}};const p=page(store,async()=>{throw Error('must not charge');});p.submit();await settle();assert.equal(p.posts.length,0);
});
