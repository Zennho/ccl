const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const installed = {id:'1.20.1',name:'1.20.1',kind:'正式版',installed:true};
function boot(check, settings={}, version=installed) {
  const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window,calls=[],intervals=[];require('./react-renderer-helper.cjs')(w);
  w.localStorage.setItem('ccl-settings',JSON.stringify({accountMode:'offline',selected:version.id,gameDir:'/game',...settings}));
  w.__icons={};w.createIcons=()=>{};w.isTauri=()=>true;w.getCurrentWindow=()=>({});w.listen=async()=>()=>{};
  w.openDialog=async()=>null;w.saveDialog=async()=>null;
  w.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
  w.invoke=async(name,args={})=>{calls.push({name,args});if(name==='list_versions'||name==='installed_versions')return [{isolated:false,...version}];if(name==='memory_info')return {totalMb:16384,availableMb:8192,recommendedMb:4096};if(name==='check_launcher_update')return check();};
  w.appVersion=require('../package.json').version;
  w.eval(require('esbuild').transformSync(fs.readFileSync(path.join(__dirname,'../src/job-manager.ts'),'utf8'),{loader:'ts',format:'esm'}).code.replace(/export\s*\{[^}]*\};/g,''));
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/const icons = \{[^\r\n]+\};/,'const icons = window.__icons;');
  w.eval('"use strict";\n'+source+'\nwindow.render=render;window.refreshMods=refreshMods;');
  const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
  return {w,calls,intervals,click,close:()=>w.close()};
}

test('keeps existing manual memory settings and allows precise adjustment',async()=>{
  const app=boot(()=>Promise.resolve({available:false}),{memory:6144});
  try {
    await tick();app.click('[data-page="settings"]');await tick();
    const doc=app.w.document;
    assert.equal(doc.querySelector('#memory-mode').value,'manual');
    assert.equal(doc.querySelector('#memory').value,'6144');
    assert.match(doc.querySelector('#memory-info').textContent,/16384 MB.*8192 MB/);
    doc.querySelector('#memory').value='7168';doc.querySelector('#memory').dispatchEvent(new app.w.Event('input',{bubbles:true}));
    assert.equal(doc.querySelector('#memory-range').value,'7168');
    doc.querySelector('#settings-form').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
    const saved=JSON.parse(app.w.localStorage.getItem('ccl-settings'));
    assert.equal(saved.memory,7168);assert.equal(saved.memoryMode,'manual');
    app.click('[data-page="home"]');app.click('[data-action="launch"]');await tick();
    const launch=app.calls.findLast(c=>c.name==='launch_game');
    assert.equal(launch.args.options.memoryMode,'manual');assert.equal(launch.args.options.memory,7168);
  } finally {app.close();}
});

test('automatic memory and per-version isolation are saved and used on launch',async()=>{
  const app=boot(()=>Promise.resolve({available:false}),{memory:6144});
  try {
    await tick();app.click('[data-page="settings"]');await tick();
    const doc=app.w.document,mode=doc.querySelector('#memory-mode');mode.value='auto';mode.dispatchEvent(new app.w.Event('change',{bubbles:true}));
    assert.ok(doc.querySelector('#memory-manual').hidden);assert.ok(doc.querySelector('#memory').disabled);
    doc.querySelector('#version-isolation').checked=true;
    doc.querySelector('#settings-form').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
    const call=app.calls.findLast(c=>c.name==='set_version_isolation');
    assert.equal(call.args.version,installed.id);assert.equal(call.args.isolated,true);
    const saved=JSON.parse(app.w.localStorage.getItem('ccl-settings'));assert.equal(saved.memoryMode,'auto');assert.equal(saved.memory,6144);
    app.click('[data-page="home"]');app.click('[data-action="launch"]');await tick();
    assert.equal(app.calls.findLast(c=>c.name==='launch_game').args.options.memoryMode,'auto');
  } finally {app.close();}
});

test('isolation preserves pack isolation and reports a rejected switch',async()=>{
  const pack={...installed,kind:'整合包',isolated:true};
  const app=boot(()=>Promise.resolve({available:false}),{},pack);
  try {
    await tick();app.click('[data-page="settings"]');await tick();
    const checkbox=app.w.document.querySelector('#version-isolation');
    assert.ok(checkbox.checked && checkbox.disabled,'packs remain isolated');
    assert.match(app.w.document.querySelector('.isolation-field').textContent,/整合包始终使用独立目录/);
  } finally {app.close();}
  const regular=boot(()=>Promise.resolve({available:false}));
  try {
    await tick();regular.click('[data-page="settings"]');await tick();
    const invoke=regular.w.invoke;regular.w.invoke=(name,args)=>name==='set_version_isolation'?Promise.reject('游戏正在运行'):invoke(name,args);
    regular.w.document.querySelector('#version-isolation').checked=true;
    regular.w.document.querySelector('#settings-form').dispatchEvent(new regular.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
    assert.match(regular.w.document.querySelector('.toast').textContent,/游戏正在运行/);
    regular.click('[data-page="home"]');regular.click('[data-page="settings"]');await tick();
    assert.ok(!regular.w.document.querySelector('#version-isolation').checked,'failed switch is not saved');
  } finally {regular.close();}
});

test('restores banner appearance after restarting',async()=>{
  const app=boot(()=>Promise.resolve({available:false}),{theme:{bannerOpacity:35,bannerFrost:60,bannerBlur:12}});
  try {
    await tick();app.click('[data-page="settings"]');
    assert.equal(app.w.document.querySelector('#theme-bannerFrost').value,'60');
    assert.equal(app.w.document.querySelector('#theme-bannerBlur').value,'12');
    assert.equal(app.w.document.documentElement.style.getPropertyValue('--ccl-banner-opacity'),'0.65');
    assert.equal(app.w.document.documentElement.style.getPropertyValue('--ccl-banner-frost'),'0.6');
    assert.equal(app.w.document.documentElement.style.getPropertyValue('--ccl-banner-blur'),'12px');
  } finally {app.close();}
});

test('checks automatically, shows the update and opens the fixed release command',async()=>{
  const app=boot(()=>Promise.resolve({currentVersion:'0.1.11',latestVersion:'0.1.12',available:true}));
  try {
    await tick();await tick();
    assert.equal(app.calls.filter(c=>c.name==='check_launcher_update').length,1);
    assert.match(app.w.document.querySelector('.update-pill').textContent,/0\.1\.12/);
    assert.equal(app.intervals.filter(i=>i.ms===6*60*60*1000).length,1);
    app.click('[data-action="open-update"]');await tick();
    assert.ok(app.calls.some(c=>c.name==='open_launcher_releases'));
    app.click('[data-action="dismiss-update"]');assert.ok(!app.w.document.querySelector('.update-pill'));
    app.click('[data-page="settings"]');
    assert.match(app.w.document.querySelector('#update-panel').textContent,/0\.1\.12/);
    app.click('[data-action="check-update"]');await tick();
    assert.ok(app.w.document.querySelector('.update-pill'),'manual check can show a dismissed update again');
  } finally {app.close();}
});

test('automatic failures are quiet and manual retry reports current version',async()=>{
  let failing=true;
  const app=boot(()=>failing?Promise.reject('网络失败'):Promise.resolve({currentVersion:'0.1.11',latestVersion:'0.1.11',available:false}));
  try {
    await tick();await tick();assert.ok(!app.w.document.querySelector('.toast'));
    app.click('[data-page="settings"]');
    assert.match(app.w.document.querySelector('#update-panel').textContent,/网络失败/);
    failing=false;app.click('[data-action="check-update"]');await tick();
    assert.match(app.w.document.querySelector('#update-panel').textContent,/最新正式版/);
    assert.ok(!app.w.document.querySelector('.update-pill'));
  } finally {app.close();}
});

test('background checks preserve settings input and surface a later release',async()=>{
  let complete,version='0.1.12';
  const app=boot(()=>new Promise(resolve=>{complete=()=>resolve({currentVersion:'0.1.11',latestVersion:version,available:true});}));
  try {
    await tick();app.click('[data-page="settings"]');
    const input=app.w.document.querySelector('#username');input.focus();input.value='Unsubmitted';
    complete();await tick();
    assert.strictEqual(app.w.document.querySelector('#username'),input);
    assert.equal(input.value,'Unsubmitted');assert.strictEqual(app.w.document.activeElement,input);
    app.click('[data-action="dismiss-update"]');version='0.1.13';app.intervals.find(i=>i.ms===6*60*60*1000).fn();await tick();complete();await tick();
    assert.match(app.w.document.querySelector('.update-pill').textContent,/0\.1\.13/);
  } finally {app.close();}
});
