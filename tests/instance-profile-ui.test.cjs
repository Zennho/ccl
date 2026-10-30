const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {indexedDB}=require('fake-indexeddb');
const tick=()=>new Promise(r=>setTimeout(r,12));
async function waitFor(predicate, message) { const deadline=Date.now()+3000;while(!predicate()&&Date.now()<deadline)await tick();assert.ok(predicate(),message); }
function boot(){
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});const w=dom.window,calls=[];let statsResolve,objectCounter=0;require('./react-renderer-helper.cjs')(w);
 w.indexedDB=indexedDB;w.localStorage.setItem('ccl-settings',JSON.stringify({accountMode:'offline',selected:'one',gameDir:'/profile-game'}));w.setInterval=()=>0;w.__icons={};w.createIcons=()=>{};w.isTauri=()=>true;w.getCurrentWindow=()=>({});w.listen=async()=>()=>{};w.openDialog=async()=>null;w.saveDialog=async()=>null;
 w.URL.createObjectURL=()=>`blob:test-${++objectCounter}`;w.URL.revokeObjectURL=()=>{};w.Image=class{constructor(){this.naturalWidth=500;this.naturalHeight=300;}set src(value){queueMicrotask(()=>this.onload?.());}};
 w.invoke=(name,args={})=>{calls.push({name,args});if(name==='list_versions'||name==='installed_versions')return Promise.resolve([{id:'one',name:'One',kind:'Fabric',installed:true,isolated:true},{id:'two',name:'Two',kind:'Forge',installed:true}]);if(name==='play_stats')return new Promise(resolve=>statsResolve=resolve);if(name==='list_game_screenshots')return Promise.resolve({items:[{name:args.page?'second.png':'first.png'}],hasMore:args.page===0,isolated:true});if(name==='game_screenshot')return Promise.resolve('data:image/png;base64,aGVsbG8=');if(name==='list_mods')return Promise.resolve([]);return Promise.resolve();};
 w.appVersion=require('../package.json').version;w.eval(require('esbuild').transformSync(fs.readFileSync(path.join(__dirname,'../src/job-manager.ts'),'utf8'),{loader:'ts',format:'esm'}).code.replace(/export\s*\{[^}]*\};/g,''));const src=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/const icons = \{[^\r\n]+\};/,'const icons = window.__icons;');w.eval('"use strict";\n'+src+'\nwindow.render=render;window.refreshMods=refreshMods;');
 const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};return {w,calls,click,stats:value=>statsResolve(value),close:()=>w.close()};
}
test('instance themes save cover and description per game version and fall back on switch',async()=>{
 const app=boot();try{await tick();app.click('[data-page=versions]');app.click('[data-instance-theme=one]');await tick();
 const input=app.w.document.querySelector('[data-instance-cover]');Object.defineProperty(input,'files',{configurable:true,value:[new app.w.File(['test'],'cover.png',{type:'image/png'})]});input.dispatchEvent(new app.w.Event('change',{bubbles:true}));await waitFor(()=>!!app.w.document.querySelector('.instance-theme-preview img'),'主题封面应完成加载');
 const description=app.w.document.querySelector('#instance-description');description.value='我的冒险';description.dispatchEvent(new app.w.Event('input',{bubbles:true}));app.click('[data-instance-color="#6d91a3"]');app.click('[data-action=save-instance-theme]');await waitFor(()=>!app.w.document.querySelector('.instance-theme-dialog'),'主题应完成保存');
 const settings=JSON.parse(app.w.localStorage.getItem('ccl-instance-themes'));assert.equal(settings['["/profile-game","one"]'].description,'我的冒险');assert.equal(settings['["/profile-game","one"]'].color,'#6d91a3');assert.ok(settings['["/profile-game","one"]'].hasCover);
 app.click('[data-page=home]');assert.match(app.w.document.querySelector('.launch-panel').textContent,/我的冒险/);assert.match(app.w.document.documentElement.style.getPropertyValue('--ccl-banner-image'),/blob:test/);
 app.click('[data-page=versions]');app.click('[data-select=two]');assert.equal(app.w.document.documentElement.style.getPropertyValue('--ccl-banner-image'),'var(--ccl-default-banner)');app.click('[data-select=one]');assert.match(app.w.document.documentElement.style.getPropertyValue('--ccl-banner-image'),/blob:test/);
 app.click('[data-instance-theme=one]');await tick();app.click('[data-action=remove-instance-cover]');app.click('[data-action=save-instance-theme]');await waitFor(()=>!app.w.document.querySelector('.instance-theme-dialog'),'主题应完成保存');assert.equal(app.w.document.documentElement.style.getPropertyValue('--ccl-banner-image'),'var(--ccl-default-banner)');
 }finally{app.close();}
});
test('game profile loads screenshots and stats independently, pages and previews',async()=>{
 const app=boot();try{await tick();app.click('[data-page=versions]');app.click('[data-game-profile=one]');await tick();await tick();assert.equal(app.calls.filter(c=>c.name==='game_screenshot').length,1);assert.equal(app.w.document.querySelector('[data-profile-image="0"]').hidden,false);
 app.stats({launches:3,seconds:3900,lastStarted:1760000000,lastDuration:600});await tick();assert.match(app.w.document.querySelector('.profile-stats').textContent,/1 小时 5 分钟/);assert.equal(app.calls.filter(c=>c.name==='game_screenshot').length,1);assert.equal(app.w.document.querySelector('[data-profile-image="0"]').hidden,false);
 app.click('[data-profile-shot="0"]');assert.match(app.w.document.querySelector('.profile-lightbox').textContent,/first.png/);app.click('[data-action=close-profile-preview]');app.click('[data-profile-page="1"]');await tick();await tick();assert.equal(app.calls.findLast(c=>c.name==='list_game_screenshots').args.page,1);assert.equal(app.calls.findLast(c=>c.name==='game_screenshot').args.name,'second.png');app.click('[data-action=open-screenshot-folder]');await tick();assert.equal(app.calls.findLast(c=>c.name==='open_screenshot_folder').args.version,'one');
 }finally{app.close();}
});
