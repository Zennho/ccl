const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const installed = {id:'1.20.1',name:'1.20.1',kind:'正式版',installed:true};
function boot(check, settings={}) {
  const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window,calls=[],intervals=[];
  w.localStorage.setItem('ccl-settings',JSON.stringify({accountMode:'offline',selected:installed.id,gameDir:'/game',...settings}));
  w.__icons={};w.createIcons=()=>{};w.isTauri=()=>true;w.getCurrentWindow=()=>({});w.listen=async()=>()=>{};
  w.openDialog=async()=>null;w.saveDialog=async()=>null;
  w.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
  w.invoke=async(name,args={})=>{calls.push({name,args});if(name==='list_versions'||name==='installed_versions')return [installed];if(name==='check_launcher_update')return check();};
  w.appVersion=require('../package.json').version;
  w.eval(fs.readFileSync(path.join(__dirname,'../src/job-manager.js'),'utf8').replace('export function createJobManager','function createJobManager'));
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/const icons = \{[^\r\n]+\};/,'const icons = window.__icons;');
  w.eval(source);
  const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
  return {w,calls,intervals,click,close:()=>w.close()};
}

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
