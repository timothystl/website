// Exercise the shipped client after the same keepNames transform Wrangler uses.
// Source-only execution misses helpers captured by Function.toString().
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(path.join(process.env.NODE_PATH || path.resolve('node_modules'), 'test.cjs'));
const { build } = require('esbuild');
const { chromium } = require('playwright');
const dir = await mkdtemp(path.join(tmpdir(), 'workspace-browser-'));
let browser;
try {
 const outfile = path.join(dir, 'client.mjs');
 await build({entryPoints:[process.env.WORKSPACE_TEST_ENTRY || 'admin/workspace-client.js'],bundle:true,format:'esm',keepNames:true,outfile});
 const { WORKSPACE_CLIENT, WORKSPACE_CSS } = await import(pathToFileURL(outfile));
 browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page = await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let failFeed=false, saved;
 const event={id:'n:7',source:'news',title:'Community meal',start:'2026-09-23T18:00:00',end:'2026-09-23T19:00:00',category:'special',description:'All welcome',location:'Hall'};
 const config={mode:'calendar',today:'2026-09-23',canAdd:true,canNews:true,rooms:['Hall'],types:[]};
 const html=()=>`<!doctype html>${WORKSPACE_CSS}<div id="workspace-calendar"></div><script id="workspace-data" type="application/json">${JSON.stringify(config)}</script><script>${WORKSPACE_CLIENT}</script>`;
 await page.route('https://workspace.test/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/feed'))return route.fulfill({status:failFeed?503:200,json:failFeed?{error:'Calendar unavailable.'}:{events:[event],categories:[{key:'special',name:'Special'}],google:true}});
  if(url.pathname.endsWith('/local')){saved=route.request().postDataJSON();return route.fulfill({json:{id:42}});}
  return route.fulfill({contentType:'text/html',body:html()});
 });
 await page.goto('https://workspace.test/calendar-workspace');
 assert.deepEqual(errors,[], 'Calendar script must boot after production bundling');
 await page.locator('.ws-day').first().waitFor();
 assert.ok(await page.locator('.ws-day').count()>=35);
 await page.locator('[data-event="n:7"]').click();
 assert.equal(await page.locator('dialog a').getAttribute('href'),'/newsitems/edit/7');
 await page.getByRole('button',{name:'Close event panel'}).click();
 await page.locator('[data-add="2026-09-24"]').click();
 assert.equal(await page.locator('[name=date]').inputValue(),'2026-09-24');
 await page.locator('[name=title]').fill('Test local event');
 await page.getByRole('button',{name:'Add to public calendar'}).click();
 await page.getByText('Event saved to the public calendar.',{exact:false}).waitFor();
 assert.equal(saved.date,'2026-09-24');
 assert.equal(saved.title,'Test local event');
 await page.locator('[data-view=week]').click();await page.locator('.ws-slot').first().waitFor();
 await page.locator('.ws-slot').first().click();assert.equal(await page.locator('[name=time]').inputValue(),'08:00');
 await page.getByRole('button',{name:'Close event panel'}).click();
 await page.locator('[data-view=list]').click();await page.locator('.ws-list-row').waitFor();
 failFeed=true;await page.locator('[data-move="1"]').click();await page.locator('[data-retry]').waitFor();
 failFeed=false;await page.locator('[data-retry]').click();await page.locator('.ws-list-row').waitFor();
 await page.setViewportSize({width:390,height:844});await page.reload();await page.locator('.ws-list-row').waitFor();
 assert.equal(await page.locator('[data-view=list]').getAttribute('aria-pressed'),'true');
 // The services editor shares this client and formerly failed at the same helper.
 config.mode='services';config.rows=[{index:0,day:'Sunday',time:'9 am',note:'Worship'}];
 await page.unroute('https://workspace.test/**');
 await page.route('https://workspace.test/**',r=>r.fulfill({contentType:'text/html',body:`<form id="service-form"><div id="service-rows"></div><input id="service-json"><button id="save-services" disabled>Save</button></form><button id="add-service">Add</button><p id="service-error"></p><script id="workspace-data" type="application/json">${JSON.stringify(config)}</script><script>${WORKSPACE_CLIENT}</script>`}));
 await page.goto('https://workspace.test/services');assert.equal(await page.locator('#save-services').isEnabled(),true);
 await page.locator('#add-service').click();assert.equal(await page.locator('.ws-service').count(),2);
 assert.deepEqual(errors,[]);
 console.log('Bundled calendar and services browser interactions passed.');
} finally {await browser?.close();await rm(dir,{recursive:true,force:true});}
