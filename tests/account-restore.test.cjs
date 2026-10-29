const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const installed = {id:'1.20.1',name:'1.20.1',kind:'正式版',installed:true};
function boot({preference='microsoft', known=false, restore, logout} = {}) {
  const dom = new JSDOM('<div id="app"></div>', {url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});
  const w = dom.window;
  const calls = [];
  w.localStorage.setItem('ccl-settings', JSON.stringify({accountMode:preference,accountKnown:known,selected:installed.id,gameDir:'/game'}));
  w.__icons = {}; w.createIcons = () => {}; w.isTauri = () => true;
  w.getCurrentWindow = () => ({}); w.listen = async () => () => {};
  w.openDialog = async () => null; w.saveDialog = async () => null;
  w.invoke = async (name,args={}) => {
    calls.push({name,args});
    if(name==='configure_proxy')return;
    if(name==='list_versions'||name==='installed_versions')return [installed];
    if(name==='restore_microsoft_account')return restore ? restore() : null;
    if(name==='logout_microsoft')return logout ? logout() : undefined;
    if(name==='get_appearance')return {skin:null,model:'classic',capes:[]};
  };
  w.appVersion = require('../package.json').version;
  w.eval(fs.readFileSync(path.join(__dirname,'../src/job-manager.js'),'utf8').replace('export function createJobManager','function createJobManager'));
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/const icons = \{[^\r\n]+\};/,'const icons = window.__icons;');
  w.eval(source);
  const click = selector => { const el=w.document.querySelector(selector);assert.ok(el,selector);el.click(); };
  return {w, calls, click, close:()=>w.close()};
}

test('restores the saved account before enabling online launch', async () => {
  let complete;
  const app=boot({restore:()=>new Promise(resolve=>{complete=resolve;})});
  try {
    await tick();
    const button=app.w.document.querySelector('[data-action="launch"]');
    assert.ok(button.disabled);assert.match(button.textContent,/恢复登录/);
    complete({name:'RealPlayer',uuid:'abc',remembered:true});
    await tick();await tick();
    assert.equal(app.w.document.querySelector('.profile strong').textContent,'RealPlayer');
    assert.equal(app.w.document.querySelector('[data-action="launch"]').disabled,false);
    app.click('[data-action="launch"]');await tick();
    assert.equal(app.calls.findLast(c=>c.name==='launch_game').args.options.accountMode,'microsoft');
    const settings=app.w.localStorage.getItem('ccl-settings');
    assert.equal(JSON.parse(settings).accountMode,'microsoft');
    assert.doesNotMatch(settings,/access_token|refresh_token/);
  } finally {app.close();}
});

test('preserves the offline choice when an account is restored', async () => {
  const app=boot({preference:'offline',restore:()=>Promise.resolve({name:'RealPlayer',uuid:'abc',remembered:true})});
  try {
    await tick();await tick();
    assert.equal(app.w.document.querySelector('.profile strong').textContent,'Player');
    app.click('[data-page="account"]');await tick();
    assert.ok(app.w.document.querySelector('[data-action="use-microsoft"]'));
    app.click('[data-action="use-microsoft"]');
    assert.equal(JSON.parse(app.w.localStorage.getItem('ccl-settings')).accountMode,'microsoft');
  } finally {app.close();}
});

test('reports restore and deletion errors without leaving the UI stuck', async () => {
  let shouldFail=true;
  const app=boot({known:true,restore:()=>shouldFail?Promise.reject('凭据库已锁定'):Promise.resolve({name:'RealPlayer',uuid:'abc',remembered:true}),logout:()=>Promise.reject('已退出本次会话，但无法删除保存的账户')});
  try {
    await tick();await tick();app.click('[data-page="account"]');
    assert.match(app.w.document.querySelector('.identity-card').textContent,/凭据库已锁定/);app.click('[data-page="home"]');assert.ok(app.w.document.querySelector('[data-action="launch"]').disabled,'failed online restoration cannot silently launch offline');app.click('[data-page="account"]');
    shouldFail=false;app.click('[data-action="retry-account-restore"]');await tick();await tick();
    assert.ok(app.w.document.querySelector('[data-action="logout-microsoft"]'));
    app.click('[data-action="logout-microsoft"]');await tick();
    assert.ok(app.w.document.querySelector('[data-action="begin-login"]'));
    assert.equal(JSON.parse(app.w.localStorage.getItem('ccl-settings')).accountMode,'offline');
    assert.match(app.w.document.querySelector('.toast').textContent,/无法删除保存的账户/);
  } finally {app.close();}
});


test('a missing saved credential requires an explicit offline choice', async () => {
  const app=boot({known:true,restore:()=>Promise.resolve(null)});
  try {
    await tick();await tick();
    assert.ok(app.w.document.querySelector('[data-action="launch"]').disabled);
    app.click('[data-page="account"]');
    assert.match(app.w.document.querySelector('.identity-card').textContent,/未找到已保存的账户/);
    app.click('[data-action="continue-offline"]');
    assert.equal(JSON.parse(app.w.localStorage.getItem('ccl-settings')).accountMode,'offline');
    app.click('[data-page="home"]');
    assert.equal(app.w.document.querySelector('[data-action="launch"]').disabled,false);
  } finally {app.close();}
});


test('an unavailable credential store does not block a new offline user', async () => {
  const app=boot({restore:()=>Promise.reject('凭据库不可用')});
  try { await tick();await tick();assert.equal(app.w.document.querySelector('[data-action="launch"]').disabled,false); }
  finally {app.close();}
});
