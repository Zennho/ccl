const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
function boot(options={}){
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window,calls=[],pending=[];require('./react-renderer-helper.cjs')(w);
 w.localStorage.setItem('ccl-settings',JSON.stringify({accountMode:'offline',selected:'1.20.1',gameDir:'/game'}));
 w.setInterval=()=>0;w.__icons={};w.createIcons=()=>{};w.isTauri=()=>true;w.getCurrentWindow=()=>({});w.listen=async()=>()=>{};w.openDialog=async()=>null;w.saveDialog=async()=>null;
 w.invoke=(name,args={})=>{calls.push({name,args});
  if(name==='list_versions'||name==='installed_versions')return Promise.resolve([{id:'1.20.1',name:'1.20.1',kind:'正式版',installed:true}]);
  if(name==='list_mods')return Promise.resolve([]);
  if(name==='list_worlds')return Promise.resolve([{folder:'world1',name:'我的世界',gameVersion:'1.20.1',lastPlayed:1760000000000}]);
  if(name==='list_backups')return Promise.resolve([{id:'b-1',scope:'world',world:'world1',created:1760000000,size:4096}]);
  if(name==='check_mod_conflicts')return Promise.resolve({checked:2,unknown:1,issues:[{kind:'missing',message:'缺少依赖 example',files:['a.jar']}]});
  if(name==='content_categories')return Promise.resolve([{id:'adventure',name:'Adventure'}]);
  if(name==='instance_overview')return Promise.resolve({gameVersion:'1.20.1',loader:'fabric',isolated:true,mods:5,resourcePacks:2,shaderPacks:1,sizeBytes:10485760,sizeIncomplete:false,lastLaunched:1760000000});
  if(name==='list_local_packs')return options.listPacks?options.listPacks(args):Promise.resolve(options.packs||[]);
  if(name==='shader_environment')return Promise.resolve(options.shaderEnv||{loader:'vanilla',detected:[],uncertain:false});
  if(name==='check_pack_updates')return Promise.resolve(options.packUpdates||{checked:0,unknown:0,failed:0,updates:[]});
  if(name==='remove_local_pack'){options.packs=(options.packs||[]).filter(p=>p.name!==args.name);return Promise.resolve();}
  if(name==='search_content')return Promise.resolve({hits:options.hits||[{id:'project1',title:'示例项目',description:'简介',installed:false},{id:'project2',title:'已安装项目',description:'简介',installed:true}],hasMore:!!options.hasMore});
  if(name==='content_links')return Promise.resolve({links:[],description:options.description||'详情'});
  if(name==='translate_content')return options.translate?options.translate(args):Promise.resolve(null);
  if(name==='translate_content_summaries')return options.translateSummaries?options.translateSummaries(args):Promise.resolve({});
  if(name==='lookup_mcmod')return options.lookup?options.lookup(args):Promise.resolve(null);
  if(name==='list_mod_versions')return Promise.resolve([]);
  if(name==='curseforge_description')return Promise.resolve('详情');
  if(name==='list_pack_versions')return Promise.resolve([{id:'pack1',name:'第一版',number:'1',date:'2025-01-01'},{id:'pack2',name:'第二版',number:'2',date:'2025-02-01'}]);
  if(name==='install_pack')return new Promise((resolve,reject)=>pending.push({resolve,reject,args}));
  if(name==='cancel_job'){const item=pending.find(p=>p.args.jobId===args.jobId);if(item)item.reject('任务已取消');return Promise.resolve();}
  return Promise.resolve();
 };
 w.appVersion=require('../package.json').version;
 w.eval(require('esbuild').transformSync(fs.readFileSync(path.join(__dirname,'../src/job-manager.ts'),'utf8'),{loader:'ts',format:'esm'}).code.replace(/export\s*\{[^}]*\};/g,''));
 const src=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/const icons = \{[^\r\n]+\};/,'const icons = window.__icons;');w.eval('"use strict";\n'+src+'\nwindow.render=render;window.refreshMods=refreshMods;');
 const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
 const change=(selector,value)=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 return {w,calls,pending,click,change,close:()=>w.close()};
}

test('shows a verified encyclopedia page and toggles between translated and original descriptions',async()=>{
 const app=boot({hits:[{id:'AANobbMI',title:'Sodium',description:'Original summary',projectUrl:'https://modrinth.com/mod/sodium'}],description:'Original description',lookup:()=>Promise.resolve({url:'https://www.mcmod.cn/class/2785.html',summary:'中文摘要'}),translate:()=>Promise.resolve('中文翻译'),translateSummaries:()=>Promise.resolve({AANobbMI:'中文列表简介'})});
 try{
  await tick();app.click('[data-page=content]');await tick();assert.match(app.w.document.querySelector('[data-content-summary="0"]').textContent,/中文列表简介/);app.click('[data-content-details="0"]');await tick();await tick();
  assert.match(app.w.document.querySelector('.project-description').textContent,/中文翻译/);
  assert.match(app.w.document.querySelector('.project-description').textContent,/AI 翻译/);
  assert.ok(app.w.document.querySelector('[data-open-project="https://www.mcmod.cn/class/2785.html"]'));
  assert.ok(!app.w.document.querySelector('[data-open-project^="https://search.mcmod.cn"]'));
  app.click('[data-action=toggle-content-language]');assert.match(app.w.document.querySelector('.project-description').textContent,/Original description/);
  app.click('[data-action=toggle-content-language]');assert.match(app.w.document.querySelector('.project-description').textContent,/中文翻译/);
 }finally{app.close();}
});

test('keeps original text and encyclopedia search when services fail',async()=>{
 const app=boot({hits:[{id:'project1',title:'Unknown',description:'Original summary',projectUrl:'https://modrinth.com/mod/unknown'}],description:'Original description',lookup:()=>Promise.reject('offline'),translate:()=>Promise.reject('offline')});
 try{
  await tick();app.click('[data-page=content]');await tick();app.click('[data-content-details="0"]');await tick();await tick();
  assert.match(app.w.document.querySelector('.project-description').textContent,/Original description/);
  assert.ok(app.w.document.querySelector('[data-open-project^="https://search.mcmod.cn"]'));
  assert.ok(!app.w.document.querySelector('[data-action=toggle-content-language]'));
 }finally{app.close();}
});

test('ignores late translations and encyclopedia results after switching projects',async()=>{
 let resolveTranslation,resolveLookup;
 const app=boot({hits:[{id:'first',title:'First',description:'First summary',projectUrl:'https://modrinth.com/mod/first'},{id:'second',title:'Second',description:'Second summary',projectUrl:'https://modrinth.com/mod/second'}],translate:({projectId})=>projectId==='first'?new Promise(resolve=>{resolveTranslation=resolve;}):Promise.resolve('第二个译文'),lookup:({title})=>title==='First'?new Promise(resolve=>{resolveLookup=resolve;}):Promise.resolve(null)});
 try{
  await tick();app.click('[data-page=content]');await tick();app.click('[data-content-details="0"]');await tick();
  app.click('[data-action=close-mod-dialog]');app.click('[data-content-details="1"]');await tick();
  resolveTranslation('过期译文');resolveLookup({url:'https://www.mcmod.cn/class/1.html',summary:'过期摘要'});await tick();
  assert.match(app.w.document.querySelector('.project-description').textContent,/第二个译文/);
  assert.ok(!app.w.document.querySelector('[data-open-project="https://www.mcmod.cn/class/1.html"]'));
 }finally{app.close();}
});

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


test('manages local packs including manually added files and checks updates',async()=>{
 const app=boot({packs:[{name:'manual.zip',directory:false},{name:'known.zip',source:'modrinth',projectId:'project1'}],packUpdates:{checked:1,unknown:1,failed:0,updates:[{name:'known.zip',latest:'known-new.zip',projectUrl:'https://modrinth.com/resourcepack/project1'}]}});try {
  await tick();app.click('[data-page=content]');await tick();app.change('#content-form [name=kind]','resourcepack');await tick();await tick();
  assert.match(app.w.document.querySelector('#local-pack-list').textContent,/manual.zip/);
  assert.match(app.w.document.querySelector('#local-pack-list').textContent,/手动添加或来源未知/);
  app.click('[data-action=check-pack-updates]');await tick();
  assert.match(app.w.document.querySelector('#local-pack-list').textContent,/known-new.zip/);
  assert.match(app.w.document.querySelector('#pack-update-summary').textContent,/已检查 1 个/);
  app.click('[data-action=open-pack-folder]');await tick();assert.equal(app.calls.findLast(c=>c.name==='open_pack_folder').args.kind,'resourcepack');
  const search=app.w.document.querySelector('#local-pack-search');search.value='manual';search.dispatchEvent(new app.w.Event('input',{bubbles:true}));
  assert.doesNotMatch(app.w.document.querySelector('#local-pack-list').textContent,/known.zip/);
  app.click('[data-pack-remove="0"]');assert.match(app.w.document.querySelector('.confirm-box').textContent,/共用此目录/);
  app.click('[data-action=confirm-pack-remove]');await tick();await tick();
  assert.equal(app.calls.findLast(c=>c.name==='remove_local_pack').args.name,'manual.zip');
  assert.doesNotMatch(app.w.document.querySelector('#local-pack-list').textContent,/manual.zip/);
 } finally {app.close();}
});

test('shader detection reports uncertainty and offers matching component search',async()=>{
 const app=boot({shaderEnv:{loader:'fabric',detected:[],uncertain:true}});try {
  await tick();app.click('[data-page=content]');await tick();app.change('#content-form [name=kind]','shader');await tick();await tick();
  assert.match(app.w.document.querySelector('#shader-status').textContent,/无法完全确认/);
  app.click('[data-action=find-shader-support]');await tick();await tick();
  const search=app.calls.findLast(c=>c.name==='search_content');assert.equal(search.args.kind,'mod');assert.equal(search.args.query,'Iris');
 } finally {app.close();}
});

test('shader detection reports installed component without claiming compatibility',async()=>{
 const app=boot({shaderEnv:{loader:'fabric',detected:['Iris'],uncertain:false}});try {
  await tick();app.click('[data-page=content]');await tick();app.change('#content-form [name=kind]','shader');await tick();await tick();
  assert.match(app.w.document.querySelector('#shader-status').textContent,/已检测到 Iris/);
  assert.match(app.w.document.querySelector('#shader-status').textContent,/实际运行/);
  app.click('[data-content-install="0"]');await tick();assert.match(app.w.document.querySelector('.pack-dialog-status').textContent,/已检测到 Iris/);
 } finally {app.close();}
});


test('ignores a stale local pack response after switching type',async()=>{
 let resolveShader;
 const app=boot({listPacks:({kind})=>kind==='shader'?new Promise(resolve=>{resolveShader=resolve;}):Promise.resolve([{name:'resource.zip'}])});try {
  await tick();app.click('[data-page=content]');await tick();app.change('#content-form [name=kind]','shader');await tick();
  app.change('#content-form [name=kind]','resourcepack');await tick();await tick();
  resolveShader([{name:'stale-shader.zip'}]);await tick();
  assert.match(app.w.document.querySelector('#local-pack-list').textContent,/resource.zip/);
  assert.doesNotMatch(app.w.document.querySelector('#local-pack-list').textContent,/stale-shader.zip/);
 } finally {app.close();}
});


test('filters modpacks and reuses recent results when paging back',async()=>{
 const app=boot({hasMore:true});try {
  await tick();app.click('[data-page=content]');await tick();app.change('#content-form [name=kind]','modpack');await tick();await tick();
  app.change('#content-category','adventure');await tick();
  const game=app.w.document.querySelector('[name=gameFilter]');game.value='1.20.1';
  app.w.document.querySelector('#content-form').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  app.change('[name=loaderFilter]','fabric');await tick();
  let search=app.calls.findLast(c=>c.name==='search_content');assert.equal(search.args.kind,'modpack');assert.equal(search.args.category,'adventure');assert.equal(search.args.gameFilter,'1.20.1');assert.equal(search.args.loaderFilter,'fabric');
  app.change('[name=environment]','client_only');await tick();search=app.calls.findLast(c=>c.name==='search_content');assert.equal(search.args.environment,'client_only');
  app.click('[data-content-page="1"]');await tick();const count=app.calls.filter(c=>c.name==='search_content').length;
  app.click('[data-content-page="0"]');await tick();assert.equal(app.calls.filter(c=>c.name==='search_content').length,count);
 } finally {app.close();}
});

test('loads instance overview on demand and shows directory scope',async()=>{
 const app=boot();try {
  await tick();app.click('[data-page=versions]');assert.equal(app.calls.filter(c=>c.name==='instance_overview').length,0);
  app.click('[data-instance-overview="1.20.1"]');await tick();const dialog=app.w.document.querySelector('.instance-dialog');assert.match(dialog.textContent,/1.20.1/);assert.match(dialog.textContent,/fabric/);assert.match(dialog.textContent,/10.0 MB/);assert.match(dialog.textContent,/独立游戏目录/);assert.equal(app.calls.findLast(c=>c.name==='instance_overview').args.version,'1.20.1');
  app.click('[data-action=close-instance]');assert.equal(app.w.document.querySelector('.instance-dialog'),null);
 } finally {app.close();}
});


test('instance backup and world management use the selected version and confirm destructive actions',async()=>{
 const app=boot();try {
  await tick();app.click('[data-page=versions]');app.click('[data-manage-worlds="1.20.1"]');await tick();
  assert.match(app.w.document.querySelector('.manage-dialog').textContent,/我的世界/);
  app.click('[data-world-backup="0"]');await tick();await tick();let call=app.calls.findLast(c=>c.name==='create_backup');assert.equal(call.args.world,'world1');assert.equal(call.args.scope,'world');assert.equal(call.args.version,'1.20.1');
  app.click('[data-manage-delete="0"]');assert.match(app.w.document.querySelector('.manage-confirm').textContent,/自动备份/);assert.equal(app.calls.filter(c=>c.name==='delete_world').length,0);
  app.click('[data-action=manage-confirm]');await tick();await tick();assert.equal(app.calls.findLast(c=>c.name==='delete_world').args.folder,'world1');
  app.click('[data-action=switch-backups]');await tick();assert.match(app.w.document.querySelector('.manage-dialog').textContent,/存档备份/);
  app.click('[data-manage-restore="0"]');assert.match(app.w.document.querySelector('.manage-confirm').textContent,/自动备份整个实例/);app.click('[data-action=manage-confirm]');await tick();await tick();call=app.calls.findLast(c=>c.name==='restore_backup');assert.equal(call.args.backupId,'b-1');assert.equal(call.args.gameDir,'/game');
  app.click('[data-action=create-instance-backup]');await tick();await tick();assert.equal(app.calls.findLast(c=>c.name==='create_backup').args.scope,'instance');
 } finally {app.close();}
});

test('reports mod conflict findings and unknown files',async()=>{
 const app=boot();try {await tick();app.click('[data-page=content]');await tick();app.click('[data-action=check-mod-conflicts]');await tick();assert.match(app.w.document.querySelector('#mod-conflict-report').textContent,/缺少依赖 example/);assert.match(app.w.document.querySelector('#mod-conflict-report').textContent,/1 个文件无法识别/);assert.equal(app.calls.findLast(c=>c.name==='check_mod_conflicts').args.version,'1.20.1');}finally{app.close();}
});


test('keeps a selected version when project details finish loading asynchronously',async()=>{
 let resolveTranslation;
 const app=boot({translate:()=>new Promise(resolve=>{resolveTranslation=resolve;})});
 try {
  await tick();app.click('[data-page=content]');await tick();app.change('#content-form [name=kind]','resourcepack');await tick();await tick();
  app.click('[data-content-install="0"]');await tick();
  const second=app.w.document.querySelector('[name=modVersion][value=pack2]');assert.ok(second);second.checked=true;
  resolveTranslation('中文介绍');await tick();
  assert.strictEqual(app.w.document.querySelector('[name=modVersion][value=pack2]'),second);
  assert.equal(second.checked,true);
  app.click('[data-action=confirm-mod-install]');await tick();
  assert.equal(app.calls.findLast(c=>c.name==='install_pack').args.packVersionId,'pack2');
 } finally {app.close();}
});
