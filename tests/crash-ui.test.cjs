const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
function boot(){
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window,calls=[],listeners={};require('./react-renderer-helper.cjs')(w);
 w.localStorage.setItem('ccl-settings',JSON.stringify({accountMode:'offline',selected:'1.20.1',gameDir:'/game'}));
 w.setInterval=()=>0;w.__icons={};w.createIcons=()=>{};w.isTauri=()=>true;w.getCurrentWindow=()=>({});w.listen=async(name,callback)=>{listeners[name]=callback;return ()=>{};};w.openDialog=async()=>null;w.saveDialog=async()=>null;
 w.invoke=async(name,args={})=>{calls.push({name,args});if(name==='list_versions'||name==='installed_versions')return [{id:'1.20.1',name:'1.20.1',kind:'正式版',installed:true}];if(name==='launch_game')return '/game/logs/ccl/launch-1.log';if(name==='list_mods')return [];return null;};
 w.appVersion=require('../package.json').version;
 w.eval(fs.readFileSync(path.join(__dirname,'../src/job-manager.js'),'utf8').replace('export function createJobManager','function createJobManager'));
 const src=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/const icons = \{[^\r\n]+\};/,'const icons = window.__icons;');w.eval(src);
 const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
 return {w,calls,listeners,click,close:()=>w.close()};
}
const diag={category:'memory',title:'内存可能不足',steps:['调整内存','关闭其他程序'],source:'启动日志末尾'};

test('shows diagnosis and the exact log for a crash before the game window',async()=>{
 const app=boot();try {
  await tick();app.click('[data-action=launch]');await tick();const id=app.calls.findLast(c=>c.name==='launch_game').args.options.launchId;
  app.listeners['game-exit']({payload:{success:false,launchId:id,version:'1.20.1',gameDir:'/game',logPath:'/game/logs/ccl/launch-1.log',code:1,diagnosis:diag}});
  app.listeners['game-window-ready']({payload:{launchId:id,version:'1.20.1'}});assert.ok(app.w.document.querySelector('.launch-screen'),'a delayed window event cannot hide a crash');
  assert.match(app.w.document.querySelector('.crash-diagnosis').textContent,/内存可能不足/);
  assert.match(app.w.document.querySelector('.crash-diagnosis').textContent,/调整内存/);
  app.click('[data-action=open-crash-log]');await tick();assert.equal(app.calls.findLast(c=>c.name==='open_game_log').args.logName,'launch-1.log');
  app.click('[data-action=close-launch-view]');assert.ok(app.w.document.querySelector('[data-action=open-crash-diagnosis]'));
  app.click('[data-action=open-crash-diagnosis]');assert.match(app.w.document.querySelector('.crash-dialog').textContent,/内存可能不足/);
  app.click('[data-action=close-crash-dialog]');
 } finally {app.close();}
});

test('shows diagnosis after window appears and keeps unrelated process logs separate',async()=>{
 const app=boot();try {
  await tick();app.click('[data-action=launch]');await tick();const id=app.calls.findLast(c=>c.name==='launch_game').args.options.launchId;
  app.listeners['game-exit']({payload:{success:false,launchId:'other',version:'other-version',gameDir:'/other',logPath:'/other/logs/ccl/launch-other.log',code:1,diagnosis:{...diag,title:'其他进程'}}});
  assert.ok(app.w.document.querySelector('.launch-screen'));
  app.listeners['game-exit']({payload:{success:false,launchId:id,version:'1.20.1',gameDir:'/game',logPath:'/game/logs/ccl/launch-current.log',code:1,diagnosis:diag}});
  app.click('[data-action=open-crash-log]');await tick();assert.equal(app.calls.findLast(c=>c.name==='open_game_log').args.logName,'launch-current.log');
  app.click('[data-action=close-launch-view]');app.click('[data-action=launch]');await tick();const later=app.calls.findLast(c=>c.name==='launch_game').args.options.launchId;
  app.listeners['game-window-ready']({payload:{launchId:later,version:'1.20.1'}});
  app.listeners['game-exit']({payload:{success:false,launchId:later,version:'1.20.1',gameDir:'/game',logPath:'/game/logs/ccl/launch-later.log',code:1,diagnosis:{...diag,title:'<内存不足>'}}});
  app.click('[data-action=open-crash-diagnosis]');assert.match(app.w.document.querySelector('.crash-dialog').textContent,/<内存不足>/);assert.equal(app.w.document.querySelector('.crash-dialog').querySelector('内存不足'),null);
  app.click('[data-action=open-crash-log]');await tick();assert.equal(app.calls.findLast(c=>c.name==='open_game_log').args.logName,'launch-later.log');
 } finally {app.close();}
});

test('does not diagnose a successful exit and does not open an unrelated log when the path is missing',async()=>{
 const app=boot();try {
  await tick();app.click('[data-action=launch]');await tick();const id=app.calls.findLast(c=>c.name==='launch_game').args.options.launchId;
  app.listeners['game-exit']({payload:{success:true,launchId:id,version:'1.20.1',gameDir:'/game',logPath:'/game/logs/ccl/launch-ok.log',code:0}});
  assert.match(app.w.document.querySelector('.launch-screen-copy').textContent,/未检测到游戏窗口/);assert.equal(app.w.document.querySelector('.crash-diagnosis'),null);
  app.click('[data-action=close-launch-view]');app.click('[data-action=launch]');await tick();const bad=app.calls.findLast(c=>c.name==='launch_game').args.options.launchId;
  app.listeners['game-exit']({payload:{success:false,launchId:bad,version:'1.20.1',gameDir:'/game',code:1,diagnosis:diag}});
  app.click('[data-action=open-crash-log]');await tick();assert.equal(app.calls.filter(c=>c.name==='open_game_log').length,0);
 } finally {app.close();}
});
