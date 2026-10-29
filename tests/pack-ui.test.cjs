const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
function boot(){
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window,calls=[],pending=[];
 w.localStorage.setItem('ccl-settings',JSON.stringify({accountMode:'offline',selected:'1.20.1',gameDir:'/game'}));
 w.setInterval=()=>0;w.__icons={};w.createIcons=()=>{};w.isTauri=()=>true;w.getCurrentWindow=()=>({});w.listen=async()=>()=>{};w.openDialog=async()=>null;w.saveDialog=async()=>null;
 w.invoke=(name,args={})=>{calls.push({name,args});
  if(name==='list_versions'||name==='installed_versions')return Promise.resolve([{id:'1.20.1',name:'1.20.1',kind:'正式版',installed:true}]);
  if(name==='list_mods')return Promise.resolve([]);
  if(name==='search_content')return Promise.resolve({hits:[{id:'project1',title:'示例项目',description:'简介',installed:false},{id:'project2',title:'已安装项目',description:'简介',installed:true}],hasMore:false});
  if(name==='content_links')return Promise.resolve({links:[],description:'详情'});
  if(name==='curseforge_description')return Promise.resolve('详情');
  if(name==='list_pack_versions')return Promise.resolve([{id:'pack1',name:'第一版',number:'1',date:'2025-01-01'},{id:'pack2',name:'第二版',number:'2',date:'2025-02-01'}]);
  if(name==='install_pack')return new Promise((resolve,reject)=>pending.push({resolve,reject,args}));
  if(name==='cancel_job'){const item=pending.find(p=>p.args.jobId===args.jobId);if(item)item.reject('任务已取消');return Promise.resolve();}
  return Promise.resolve();
 };
 w.appVersion=require('../package.json').version;
 w.eval(fs.readFileSync(path.join(__dirname,'../src/job-manager.js'),'utf8').replace('export function createJobManager','function createJobManager'));
 const src=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/const icons = \{[^\r\n]+\};/,'const icons = window.__icons;');w.eval(src);
 const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
 const change=(selector,value)=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 return {w,calls,pending,click,change,close:()=>w.close()};
}

test('downloads selected resource pack version to the chosen vanilla game and can cancel',async()=>{
 const app=boot();try {
  await tick();app.click('[data-page="content"]');await tick();
  app.change('#content-form [name=kind]','resourcepack');await tick();await tick();
  assert.equal(app.calls.findLast(c=>c.name==='search_content').args.kind,'resourcepack');
  assert.equal(app.calls.findLast(c=>c.name==='search_content').args.version,'1.20.1');
  assert.ok(app.w.document.querySelector('[data-content-install="1"]').disabled);
  assert.match(app.w.document.querySelector('[data-content-install="1"]').textContent,/已安装/);
  assert.ok(!app.w.document.querySelector('#local-mod-list'));
  app.click('[data-content-install="0"]');await tick();
  assert.equal(app.calls.findLast(c=>c.name==='list_pack_versions').args.kind,'resourcepack');
  const radio=app.w.document.querySelector('[name=modVersion][value=pack2]');radio.checked=true;
  app.click('[data-action=confirm-mod-install]');await tick();
  const install=app.calls.findLast(c=>c.name==='install_pack');assert.equal(install.args.kind,'resourcepack');assert.equal(install.args.version,'1.20.1');assert.equal(install.args.packVersionId,'pack2');
  app.click('[data-page=downloads]');app.click(`[data-cancel-job="${install.args.jobId}"]`);await tick();await tick();
  assert.ok(app.w.document.querySelector(`[data-job-id="${install.args.jobId}"]`).classList.contains('cancelled'));
 } finally {app.close();}
});

test('shader packs support CurseForge without persisting its API key',async()=>{
 const app=boot();try {
  await tick();app.click('[data-page=content]');await tick();app.change('#content-form [name=source]','curseforge');await tick();
  const input=app.w.document.querySelector('#content-form [name=apiKey]');input.value='sample-secret-key';
  app.w.document.querySelector('#content-form').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  app.change('#content-form [name=kind]','shader');await tick();await tick();
  assert.match(app.w.document.querySelector('.content-search').textContent,/Iris、OptiFine/);
  assert.equal(app.calls.findLast(c=>c.name==='search_content').args.source,'curseforge');
  app.click('[data-content-install="0"]');await tick();app.click('[data-action=confirm-mod-install]');await tick();
  const install=app.calls.findLast(c=>c.name==='install_pack');assert.equal(install.args.kind,'shader');assert.equal(install.args.source,'curseforge');assert.equal(install.args.apiKey,'sample-secret-key');
  assert.doesNotMatch(app.w.localStorage.getItem('ccl-job-history'),/sample-secret-key/);
  app.click('[data-page=downloads]');app.click(`[data-cancel-job="${install.args.jobId}"]`);await tick();
 } finally {app.close();}
});
