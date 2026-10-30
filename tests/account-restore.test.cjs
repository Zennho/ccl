const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function waitFor(predicate, message) {
 const deadline=Date.now()+5000;while(Date.now()<deadline){if(await predicate())return;await tick();}assert.fail(message);
}
function cachedAvatar(database,uuid) {
 return new Promise((resolve,reject)=>{const open=database.open('ccl-appearance',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;if(!db.objectStoreNames.contains('images')){db.close();resolve(undefined);return;}const tx=db.transaction('images','readonly'),request=tx.objectStore('images').get(`online-avatar:${uuid}`);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.oncomplete=()=>db.close();};});
}

const installed = {id:'1.20.1',name:'1.20.1',kind:'正式版',installed:true};
function boot({preference='microsoft', known=false, restore, logout, launch, appearance, database, selectedSkin, versions=[installed], instanceSettings, savedAccounts, switchAccount, savedSettings, rememberAccount, listJava} = {}) {
  const dom = new JSDOM('<div id="app"></div>', {url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});
  const w = dom.window;require('./react-renderer-helper.cjs')(w);
  const calls = [];
  if(database) w.indexedDB=database;
  w.localStorage.setItem('ccl-settings', JSON.stringify({accountMode:preference,accountKnown:known,selected:installed.id,gameDir:'/game',...savedSettings}));
  if(instanceSettings)w.localStorage.setItem('ccl-instance-launch-settings',JSON.stringify(instanceSettings));
  w.setInterval=()=>0; w.__icons = {}; w.createIcons = () => {}; w.isTauri = () => true;
  w.getCurrentWindow = () => ({}); w.listen = async () => () => {};
  w.openDialog = async () => selectedSkin ? '/skin.png' : null; w.saveDialog = async () => null;
  w.invoke = async (name,args={}) => {
    calls.push({name,args});
    if(name==='configure_proxy')return;
    if(name==='list_versions'||name==='installed_versions')return versions;
    if(name==='restore_microsoft_account')return restore ? restore() : null;
    if(name==='logout_microsoft')return logout ? logout() : undefined;
    if(name==='remember_microsoft_account')return rememberAccount ? rememberAccount() : null;
    if(name==='list_java')return listJava ? listJava() : [];
    if(name==='launch_game')return launch ? launch(args) : undefined;
    if(name==='get_appearance')return appearance ? appearance() : {skin:null,model:'classic',capes:[]};
    if(name==='preview_texture')return selectedSkin;
    if(name==='list_microsoft_accounts')return savedAccounts || [];
    if(name==='switch_microsoft_account')return switchAccount ? switchAccount(args.uuid) : null;
  };
  w.appVersion = require('../package.json').version;
  w.eval(require('esbuild').transformSync(fs.readFileSync(path.join(__dirname,'../src/job-manager.ts'),'utf8'),{loader:'ts',format:'esm'}).code.replace(/export\s*\{[^}]*\};/g,''));
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/const icons = \{[^\r\n]+\};/,'const icons = window.__icons;');
  w.eval('"use strict";\n'+source+'\nwindow.render=render;window.refreshMods=refreshMods;');
  const click = selector => { const el=w.document.querySelector(selector);assert.ok(el,selector);el.click(); };
  return {w, calls, click, close:()=>w.close()};
}

test('restores account skin and cape even when login completes on the home page', async () => {
  const app=boot({known:true,restore:()=>Promise.resolve({name:'RealPlayer',uuid:'abc'}),appearance:()=>Promise.resolve({skin:'data:image/png;base64,skin',model:'slim',capes:[{id:'cape',name:'Cape',active:true,texture:'data:image/png;base64,cape'}]})});
  try {
    await tick();await tick();
    assert.equal(app.calls.filter(c=>c.name==='get_appearance').length,1);
    app.click('[data-page="account"]');await tick();
    assert.equal(app.calls.filter(c=>c.name==='get_appearance').length,1);
    assert.ok(!app.w.document.querySelector('#skin-preview').hidden);
    assert.equal(app.w.document.querySelector('#skin-model').value,'slim');
    assert.match(app.w.document.querySelector('.skin-source').textContent,/当前账户皮肤/);
    assert.match(app.w.document.querySelector('.preview-caption').textContent,/账户披风预览/);
  } finally {app.close();}
});

test('reuses an appearance request while navigating and retries after failure', async () => {
  let resolveAppearance, attempts=0;
  const app=boot({known:true,restore:()=>Promise.resolve({name:'RealPlayer',uuid:'abc'}),appearance:()=>++attempts===1?new Promise((resolve,reject)=>{resolveAppearance=reject;}):Promise.resolve({skin:'data:image/png;base64,skin',model:'classic',capes:[]})});
  try {
    await tick();app.click('[data-page="account"]');app.click('[data-page="home"]');app.click('[data-page="account"]');
    assert.equal(attempts,1,'navigation reuses the pending request');
    resolveAppearance('网络不可用');await tick();
    app.click('[data-page="home"]');app.click('[data-page="account"]');await tick();
    assert.equal(attempts,2,'returning to the account page retries');
    assert.ok(!app.w.document.querySelector('#skin-preview').hidden);
  } finally {app.close();}
});

test('online launch shares the background restore and waits before starting', async () => {
  let complete;
  const app=boot({known:true,restore:()=>new Promise(resolve=>{complete=resolve;})});
  try {
    await tick();
    const button=app.w.document.querySelector('[data-action="launch"]');
    assert.equal(button.disabled,false,'home can be used while login is pending');
    assert.match(app.w.document.querySelector('.profile small').textContent,/验证正版账户/);
    app.click('[data-action="launch"]');await tick();
    assert.match(app.w.document.querySelector('.launch-screen-copy').textContent,/正在验证正版账户/);
    assert.equal(app.calls.filter(c=>c.name==='restore_microsoft_account').length,1,'uses the pending restoration');
    assert.ok(!app.calls.some(c=>c.name==='launch_game'),'does not launch while unverified');
    complete({name:'RealPlayer',uuid:'abc',remembered:true});
    await tick();await tick();
    assert.equal(app.w.document.querySelector('.profile strong').textContent,'RealPlayer');
    assert.equal(app.calls.findLast(c=>c.name==='launch_game').args.options.accountMode,'microsoft');
    const settings=app.w.localStorage.getItem('ccl-settings');
    assert.equal(JSON.parse(settings).accountMode,'microsoft');
    assert.doesNotMatch(settings,/access_token|refresh_token/);
  } finally {app.close();}
});

test('offline mode does not restore on startup or block an offline launch', async () => {
  const app=boot({preference:'offline',known:true,restore:()=>Promise.resolve({name:'RealPlayer',uuid:'abc',remembered:true})});
  try {
    await tick();await tick();
    assert.ok(!app.calls.some(c=>c.name==='restore_microsoft_account'));
    assert.equal(app.w.document.querySelector('.profile strong').textContent,'Player');
    app.click('[data-action="launch"]');await tick();
    assert.equal(app.calls.findLast(c=>c.name==='launch_game').args.options.accountMode,'offline');
    app.click('[data-action="close-launch-view"]');app.click('[data-page="account"]');await tick();
    app.click('[data-action="use-microsoft"]');await tick();await tick();
    assert.equal(app.calls.filter(c=>c.name==='restore_microsoft_account').length,1);
    assert.equal(app.w.document.querySelector('.profile strong').textContent,'RealPlayer');
    assert.equal(JSON.parse(app.w.localStorage.getItem('ccl-settings')).accountMode,'microsoft');
  } finally {app.close();}
});

test('a failed background restore is retried on online launch', async () => {
  let attempts=0;
  const app=boot({known:true,restore:()=>++attempts===1?Promise.reject('网络暂不可用'):Promise.resolve({name:'RealPlayer',uuid:'abc',remembered:true})});
  try {
    await tick();await tick();assert.equal(attempts,1);
    assert.equal(app.w.document.querySelector('[data-action="launch"]').disabled,false);
    app.click('[data-action="launch"]');await tick();await tick();
    assert.equal(attempts,2);
    assert.equal(app.calls.findLast(c=>c.name==='launch_game').args.options.accountMode,'microsoft');
  } finally {app.close();}
});

test('failed online authentication never silently falls back to offline mode', async () => {
  const app=boot({known:true,restore:()=>Promise.reject('凭据库已锁定')});
  try {
    await tick();await tick();app.click('[data-action="launch"]');await tick();await tick();
    assert.match(app.w.document.querySelector('.launch-screen-copy').textContent,/凭据库已锁定/);
    assert.ok(!app.calls.some(c=>c.name==='launch_game'));
    app.click('[data-action="launch-account"]');
    assert.match(app.w.document.querySelector('.identity-card').textContent,/凭据库已锁定/);
    app.click('[data-action="continue-offline"]');
    assert.equal(JSON.parse(app.w.localStorage.getItem('ccl-settings')).accountMode,'offline');
    app.click('[data-page="home"]');app.click('[data-action="launch"]');await tick();
    assert.equal(app.calls.findLast(c=>c.name==='launch_game').args.options.accountMode,'offline');
  } finally {app.close();}
});

test('missing credentials offer re-login instead of starting offline', async () => {
  const app=boot({known:true,restore:()=>Promise.resolve(null)});
  try {
    await tick();await tick();app.click('[data-action="launch"]');await tick();await tick();
    assert.match(app.w.document.querySelector('.launch-screen-copy').textContent,/未找到已保存的账户/);
    assert.ok(!app.calls.some(c=>c.name==='launch_game'));
    app.click('[data-action="launch-account"]');
    assert.ok(app.w.document.querySelector('[data-action="begin-login"]'));
  } finally {app.close();}
});

test('closing the launch page while authentication is pending does not start the game', async () => {
  let complete;
  const app=boot({known:true,restore:()=>new Promise(resolve=>{complete=resolve;})});
  try {
    await tick();app.click('[data-action="launch"]');await tick();
    app.click('[data-action="close-launch-view"]');
    complete({name:'RealPlayer',uuid:'abc',remembered:true});await tick();await tick();
    assert.ok(!app.calls.some(c=>c.name==='launch_game'));
  } finally {app.close();}
});

test('logout invalidates a pending restore and reports deletion errors', async () => {
  let complete;
  const app=boot({known:true,restore:()=>new Promise(resolve=>{complete=resolve;}),logout:()=>Promise.reject('已退出本次会话，但无法删除保存的账户')});
  try {
    await tick();app.click('[data-page="account"]');app.click('[data-action="logout-microsoft"]');await tick();
    complete({name:'RealPlayer',uuid:'abc',remembered:true});await tick();
    assert.ok(app.w.document.querySelector('[data-action="begin-login"]'));
    assert.equal(JSON.parse(app.w.localStorage.getItem('ccl-settings')).accountMode,'offline');
    assert.match(app.w.document.querySelector('.toast').textContent,/无法删除保存的账户/);
    assert.notEqual(app.w.document.querySelector('.profile strong').textContent,'RealPlayer');
  } finally {app.close();}
});

test('a new offline user does not attempt account restoration', async () => {
  const app=boot({restore:()=>Promise.reject('凭据库不可用')});
  try { await tick();await tick();assert.ok(!app.calls.some(c=>c.name==='restore_microsoft_account'));assert.equal(app.w.document.querySelector('[data-action="launch"]').disabled,false); }
  finally {app.close();}
});


test('switching to offline while a background restore finishes stays offline', async () => {
  let complete;
  const app=boot({known:true,restore:()=>new Promise(resolve=>{complete=resolve;})});
  try {
    await tick();app.click('[data-page="account"]');app.click('[data-action="use-offline"]');
    complete({name:'RealPlayer',uuid:'abc',remembered:true});await tick();await tick();
    assert.equal(app.w.document.querySelector('.profile strong').textContent,'Player');
    assert.equal(JSON.parse(app.w.localStorage.getItem('ccl-settings')).accountMode,'offline');
    app.click('[data-page="home"]');app.click('[data-action="launch"]');await tick();
    assert.equal(app.calls.findLast(c=>c.name==='launch_game').args.options.accountMode,'offline');
  } finally {app.close();}
});

test('an expired backend session provides an account recovery action', async () => {
  const app=boot({known:true,restore:()=>Promise.resolve({name:'RealPlayer',uuid:'abc',remembered:true}),launch:()=>Promise.reject('微软登录授权失效，请重新登录')});
  try {
    await tick();await tick();app.click('[data-action="launch"]');await tick();
    assert.match(app.w.document.querySelector('.launch-screen-copy').textContent,/请重新登录/);
    app.click('[data-action="launch-account"]');
    assert.ok(app.w.document.querySelector('[data-action="logout-microsoft"]'));
  } finally {app.close();}
});


test('avatar follows active account skin and handles loading errors', async () => {
 const app=boot({known:true,database:new IDBFactory(),selectedSkin:'data:image/png;base64,local',restore:()=>Promise.resolve({name:'RealPlayer',uuid:'abc'}),appearance:()=>Promise.resolve({skin:'data:image/png;base64,online',model:'classic',capes:[]})});
 try {
  await tick();await tick();
  let avatar=app.w.document.querySelector('.avatar');
  assert.equal(avatar.querySelector('.avatar-face').src,'data:image/png;base64,online');
  assert.equal(avatar.querySelector('.avatar-overlay').src,'data:image/png;base64,online');
  avatar.querySelector('.avatar-face').dispatchEvent(new app.w.Event('load'));
  assert.ok(avatar.classList.contains('has-skin'));
  app.click('[data-page="account"]');app.click('[data-action="choose-skin"]');await tick();
  assert.equal(avatar.querySelector('.avatar-face').src,'data:image/png;base64,online','online identity keeps the applied account skin');
  app.click('[data-action="use-offline"]');
  assert.equal(avatar.querySelector('.avatar-face').src,'data:image/png;base64,local');
  avatar.querySelector('.avatar-face').dispatchEvent(new app.w.Event('error'));
  assert.ok(!avatar.classList.contains('has-skin'));
  assert.equal(avatar.querySelector('.avatar-fallback').textContent,'P');
  app.click('[data-action="clear-skin"]');
  assert.equal(avatar.querySelector('.avatar-face'),null);
 } finally {app.close();}
});

test('offline skin preview is restored after reopening and can be cleared', async () => {
 const database=new IDBFactory();
 const first=boot({preference:'offline',database,selectedSkin:'data:image/png;base64,local'});
 try {await tick();first.click('[data-page="account"]');first.click('[data-action="choose-skin"]');await tick();await tick();} finally {first.close();}
 const second=boot({preference:'offline',database});
 try {await tick();await tick();assert.equal(second.w.document.querySelector('.avatar-face').src,'data:image/png;base64,local');second.click('[data-page="account"]');second.click('[data-action="clear-skin"]');await tick();await tick();} finally {second.close();}
 const third=boot({preference:'offline',database});
 try {await tick();await tick();assert.equal(third.w.document.querySelector('.avatar-face'),null);} finally {third.close();}
});


test('instance launch settings are isolated per version and can return to global defaults', async () => {
 const other={id:'1.21.1',name:'1.21.1',kind:'正式版',installed:true};
 const app=boot({preference:'offline',versions:[installed,other]});
 try {
  await tick();app.click('[data-page="settings"]');assert.equal(app.w.document.querySelector('#instance-settings-form'),null);app.click('[data-page="versions"]');app.click('[data-instance-settings="1.20.1"]');
  const form=app.w.document.querySelector('#instance-settings-form');
  for(const key of ['overrideJava','overrideMemory','overrideArgs']){form.elements[key].checked=true;form.elements[key].dispatchEvent(new app.w.Event('change',{bubbles:true}));}
  form.elements.javaPath.value='/java/one';form.elements.memoryMode.value='manual';form.elements.memoryMode.dispatchEvent(new app.w.Event('change',{bubbles:true}));
  const slider=form.querySelector('#instance-memory-range'),memory=form.elements.memory;assert.equal(form.querySelector('#instance-memory-manual').hidden,false);assert.equal(slider.disabled,false);
  slider.value='6144';slider.dispatchEvent(new app.w.Event('input',{bubbles:true}));assert.equal(memory.value,'6144');
  memory.value='7168';memory.dispatchEvent(new app.w.Event('input',{bubbles:true}));assert.equal(slider.value,'7168');
  memory.value='6144';memory.dispatchEvent(new app.w.Event('input',{bubbles:true}));form.elements.jvmArgs.value='-Dexample=true';form.elements.gameArgs.value='--width 1200';
  form.dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));
  const stored=JSON.parse(app.w.localStorage.getItem('ccl-instance-launch-settings'));
  assert.equal(stored[JSON.stringify(['/game','1.20.1'])].javaPath,'/java/one');
  app.click('[data-page="home"]');app.click('[data-action="launch"]');await tick();
  const first=app.calls.findLast(c=>c.name==='launch_game').args.options;
  assert.equal(first.javaPath,'/java/one');assert.equal(first.memory,6144);assert.equal(first.jvmArgs,'-Dexample=true');
  app.click('[data-action="close-launch-view"]');app.click('[data-page="versions"]');app.click('[data-select="1.21.1"]');app.click('[data-page="home"]');app.click('[data-action="launch"]');await tick();
  const second=app.calls.findLast(c=>c.name==='launch_game').args.options;
  assert.equal(second.javaPath,'java');assert.notEqual(second.memory,6144);
  app.click('[data-action="close-launch-view"]');app.click('[data-page="versions"]');app.click('[data-instance-settings="1.20.1"]');app.click('[data-action="reset-instance-settings"]');
  assert.equal(JSON.parse(app.w.localStorage.getItem('ccl-instance-launch-settings'))[JSON.stringify(['/game','1.20.1'])],undefined);
 } finally {app.close();}
});

test('Java and memory overrides inherit global settings independently for each version', async () => {
 const other={id:'1.21.1',name:'1.21.1',kind:'正式版',installed:true};
 const app=boot({preference:'offline',versions:[installed,other],savedSettings:{javaPath:'/java/global',memory:4096,memoryMode:'manual',jvmArgs:'-Dglobal=true'}});
 try {
  await tick();app.click('[data-page="versions"]');
  // Configure a version without selecting it as the current game.
  app.click('[data-instance-settings="1.21.1"]');let form=app.w.document.querySelector('#instance-settings-form');
  form.elements.overrideJava.checked=true;form.elements.overrideJava.dispatchEvent(new app.w.Event('change',{bubbles:true}));form.elements.javaPath.value='/java/other';
  assert.ok(form.querySelector('#instance-memory-fields').disabled);
  form.dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));
  app.click('[data-instance-settings="1.20.1"]');form=app.w.document.querySelector('#instance-settings-form');
  form.elements.overrideMemory.checked=true;form.elements.overrideMemory.dispatchEvent(new app.w.Event('change',{bubbles:true}));
  form.elements.memoryMode.value='manual';form.elements.memoryMode.dispatchEvent(new app.w.Event('change',{bubbles:true}));form.elements.memory.value='6144';
  form.dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));
  app.click('[data-page="settings"]');const global=app.w.document.querySelector('#settings-form');global.elements.javaPath.value='/java/changed';global.elements.memory.value='8192';global.elements.jvmArgs.value='-Dchanged=true';global.dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  app.click('[data-page="home"]');app.click('[data-action="launch"]');await tick();
  let options=app.calls.findLast(c=>c.name==='launch_game').args.options;
  assert.equal(options.version,'1.20.1');assert.equal(options.javaPath,'/java/changed');assert.equal(options.memory,6144);assert.equal(options.jvmArgs,'-Dchanged=true');
  app.click('[data-action="close-launch-view"]');app.click('[data-page="versions"]');app.click('[data-select="1.21.1"]');app.click('[data-page="home"]');app.click('[data-action="launch"]');await tick();
  options=app.calls.findLast(c=>c.name==='launch_game').args.options;
  assert.equal(options.javaPath,'/java/other');assert.equal(options.memory,8192);assert.equal(options.jvmArgs,'-Dchanged=true');
 } finally {app.close();}
});

test('legacy instance settings keep all independent values after upgrading', async () => {
 const key=JSON.stringify(['/game','1.20.1']);
 const app=boot({preference:'offline',instanceSettings:{[key]:{javaPath:'/java/legacy',memory:7000,memoryMode:'manual',optimize:false,jvmArgs:'-Dlegacy=true',gameArgs:'--width 1200'}}});
 try {
  await tick();app.click('[data-page="versions"]');app.click('[data-instance-settings="1.20.1"]');
  const form=app.w.document.querySelector('#instance-settings-form');assert.ok(form.elements.overrideJava.checked && form.elements.overrideMemory.checked && form.elements.overrideArgs.checked);
  app.click('[data-action="close-instance-settings"]');app.click('[data-page="home"]');app.click('[data-action="launch"]');await tick();
  const options=app.calls.findLast(c=>c.name==='launch_game').args.options;
  assert.equal(options.javaPath,'/java/legacy');assert.equal(options.memory,7000);assert.equal(options.jvmArgs,'-Dlegacy=true');assert.equal(options.optimize,false);
 } finally {app.close();}
});

test('detected Java environments arrive without replacing unsaved instance edits', async () => {
 let finishJava;
 const app=boot({preference:'offline',listJava:()=>new Promise(resolve=>{finishJava=resolve;})});
 try {
  await tick();app.click('[data-page="versions"]');app.click('[data-instance-settings="1.20.1"]');
  const form=app.w.document.querySelector('#instance-settings-form');form.elements.overrideJava.checked=true;form.elements.overrideJava.dispatchEvent(new app.w.Event('change',{bubbles:true}));form.elements.javaPath.value='/custom/java';
  finishJava([{path:'/java/21',major:21}]);await tick();
  assert.equal(app.w.document.querySelector('#instance-java').value,'/custom/java');
  assert.ok(app.w.document.querySelector('#instance-java-list option[value="/java/21"]'));
 } finally {app.close();}
});


test('switches between saved online accounts and refreshes their skins', async () => {
 let current='one';const accounts=[{uuid:'one',name:'First'},{uuid:'two',name:'Second'}];
 const app=boot({known:true,savedAccounts:accounts,restore:()=>({uuid:'one',name:'First'}),switchAccount:uuid=>{current=uuid;return {account:{uuid,name:'Second'},error:null};},appearance:()=>({skin:`data:image/png;base64,${current}`,model:'classic',capes:[]})});
 try {await tick();await tick();app.click('[data-page="account"]');await tick();app.click('[data-switch-account="two"]');await tick();await tick();assert.equal(app.w.document.querySelector('.profile strong').textContent,'Second');assert.equal(app.w.document.querySelector('.avatar-face').src,'data:image/png;base64,two');assert.equal(JSON.parse(app.w.localStorage.getItem('ccl-settings')).accountMode,'microsoft');assert.doesNotMatch(app.w.localStorage.getItem('ccl-settings'),/token/);} finally {app.close();}
});

test('applies chosen offline skin to an instance and syncs it at launch', async () => {
 const app=boot({preference:'offline',database:new IDBFactory(),selectedSkin:'data:image/png;base64,local'});
 try {await tick();app.click('[data-page="account"]');app.click('[data-action="choose-skin"]');await tick();app.click('[data-action="apply-offline-skin"]');await tick();assert.equal(app.calls.findLast(c=>c.name==='apply_offline_skin').args.version,'1.20.1');app.click('[data-page="home"]');app.click('[data-action="launch"]');await tick();const calls=app.calls.filter(c=>['apply_offline_skin','launch_game'].includes(c.name));assert.equal(calls.map(c=>c.name).join(','),'apply_offline_skin,apply_offline_skin,launch_game');} finally {app.close();}
});


test('account switch failures preserve the previous session or expose a retry', async () => {
 const accounts=[{uuid:'one',name:'First'},{uuid:'two',name:'Second'}];let fail=true;
 const app=boot({known:true,savedAccounts:accounts,restore:()=>({uuid:'one',name:'First'}),switchAccount:()=>{if(fail){fail=false;throw new Error('凭据库已锁定');}return {account:null,error:'网络不可用'};},appearance:()=>({skin:'data:image/png;base64,one',model:'classic',capes:[]})});
 try {await tick();await tick();app.click('[data-page="account"]');await tick();app.click('[data-switch-account="two"]');await tick();assert.equal(app.w.document.querySelector('.profile strong').textContent,'First');app.click('[data-switch-account="two"]');await tick();assert.equal(app.w.document.querySelector('.profile strong').textContent,'Second');assert.match(app.w.document.querySelector('.identity-card').textContent,/网络不可用/);assert.ok(app.w.document.querySelector('[data-action="retry-account-restore"]'));} finally {app.close();}
});


test('cached online avatar appears before restoration and updates after a skin change', async () => {
 const database=new IDBFactory();
 const first=boot({known:true,database,restore:()=>({name:'RealPlayer',uuid:'account-one'}),appearance:()=>({skin:'data:image/png;base64,old',model:'classic',capes:[]})});
 try {await tick();await tick();assert.equal(first.w.document.querySelector('.avatar-face').src,'data:image/png;base64,old');assert.equal(JSON.parse(first.w.localStorage.getItem('ccl-settings')).accountUuid,'account-one');await tick();} finally {first.close();}
 let completeRestore,completeAppearance;
 const second=boot({known:true,database,savedSettings:{accountUuid:'account-one',accountName:'RealPlayer'},restore:()=>new Promise(resolve=>{completeRestore=resolve;}),appearance:()=>new Promise(resolve=>{completeAppearance=resolve;})});
 try {
  await tick();await tick();assert.equal(second.w.document.querySelector('.avatar-face').src,'data:image/png;base64,old');
  assert.equal(second.calls.filter(c=>c.name==='get_appearance').length,0);
  completeRestore({name:'RealPlayer',uuid:'account-one'});await tick();
  assert.equal(second.w.document.querySelector('.avatar-face').src,'data:image/png;base64,old');
  completeAppearance({skin:'data:image/png;base64,new',model:'classic',capes:[]});await tick();await tick();
  assert.equal(second.w.document.querySelector('.avatar-face').src,'data:image/png;base64,new');
 } finally {second.close();}
 let resolveRestore;
 const third=boot({known:true,database,savedSettings:{accountUuid:'account-one',accountName:'RealPlayer'},restore:()=>new Promise(resolve=>{resolveRestore=resolve;})});
 try {await tick();await tick();assert.equal(third.w.document.querySelector('.avatar-face').src,'data:image/png;base64,new');} finally {third.close();}
});

test('cached avatars are separated by account and are hidden for offline mode', async () => {
 const database=new IDBFactory();const accounts=[{uuid:'one',name:'First'},{uuid:'two',name:'Second'}];
 const first=boot({known:true,database,restore:()=>({uuid:'one',name:'First'}),appearance:()=>({skin:'data:image/png;base64,one',model:'classic',capes:[]})});
 try {await tick();await tick();}finally{first.close();}
 const second=boot({known:true,database,restore:()=>({uuid:'two',name:'Second'}),appearance:()=>({skin:'data:image/png;base64,two',model:'classic',capes:[]})});
 try {await tick();await tick();}finally{second.close();}
 let completeSwitch;
 const app=boot({known:true,database,savedSettings:{accountUuid:'one',accountName:'First'},savedAccounts:accounts,restore:()=>({uuid:'one',name:'First'}),appearance:()=>({skin:'data:image/png;base64,one',model:'classic',capes:[]}),switchAccount:()=>new Promise(resolve=>{completeSwitch=resolve;})});
 try {
  await tick();await tick();app.click('[data-page="account"]');await tick();app.click('[data-switch-account="two"]');await tick();
  assert.equal(app.w.document.querySelector('.avatar-face').src,'data:image/png;base64,two','selected account uses its own cached avatar');
  app.click('[data-action="use-offline"]');assert.equal(app.w.document.querySelector('.avatar-face'),null,'offline mode does not show an online skin');
  completeSwitch({account:{uuid:'two',name:'Second'},error:null});await tick();
  assert.equal(app.w.document.querySelector('.avatar-face'),null,'late authentication does not replace offline avatar');
 } finally {app.close();}
});

test('logout removes the selected cached avatar', async () => {
 const database=new IDBFactory();
 const first=boot({known:true,database,restore:()=>({uuid:'one',name:'First'}),appearance:()=>({skin:'data:image/png;base64,one',model:'classic',capes:[]})});
 try {await tick();await tick();first.click('[data-page="account"]');await tick();first.click('[data-action="logout-microsoft"]');await tick();await tick();}finally{first.close();}
 const second=boot({known:true,database,savedSettings:{accountUuid:'one',accountName:'First'},restore:()=>new Promise(()=>{})});
 try {await tick();await tick();assert.equal(second.w.document.querySelector('.avatar-face'),null);}finally{second.close();}
});


test('failed skin refresh keeps the cached avatar until a successful empty response', async () => {
 const database=new IDBFactory();const first=boot({known:true,database,restore:()=>({uuid:'one',name:'First'}),appearance:()=>({skin:'data:image/png;base64,one',model:'classic',capes:[]})});
 try {await waitFor(()=>cachedAvatar(database,'one').then(value=>value==='data:image/png;base64,one'),'头像应写入缓存');}finally{first.close();}
 let attempt=0;
 const app=boot({known:true,database,savedSettings:{accountUuid:'one',accountName:'First'},restore:()=>({uuid:'one',name:'First'}),appearance:()=>++attempt===1?Promise.reject('网络错误'):{skin:null,model:'classic',capes:[]}});
 try {
  await waitFor(()=>app.w.document.querySelector('.avatar-face')?.src==='data:image/png;base64,one','已缓存头像应显示');
  app.click('[data-page="account"]');
  await waitFor(()=>attempt>=2&&!app.w.document.querySelector('.avatar-face'),'成功获取空皮肤应清除旧头像');
  await waitFor(()=>cachedAvatar(database,'one').then(value=>value===undefined),'旧头像应从缓存移除');
 }finally{app.close();}
 const again=boot({known:true,database,savedSettings:{accountUuid:'one',accountName:'First'},restore:()=>new Promise(()=>{})});
 try {await tick();await tick();assert.equal(again.w.document.querySelector('.avatar-face'),null);}finally{again.close();}
});


test('shows a safe keychain error and can retry saving without signing in again', async () => {
 const app=boot({known:true,restore:()=>({name:'RealPlayer',uuid:'abc',remembered:false,rememberError:'写入系统钥匙串失败（macOS 错误 -25308）'}),rememberAccount:()=>({name:'RealPlayer',uuid:'abc',remembered:true})});
 try {
  await tick();await tick();app.click('[data-page="account"]');await tick();
  assert.match(app.w.document.querySelector('.identity-card').textContent,/macOS 错误 -25308/);
  assert.ok(app.w.document.querySelector('[data-action="retry-save-account"]'));
  app.click('[data-action="retry-save-account"]');await tick();
  assert.ok(!app.w.document.querySelector('[data-action="retry-save-account"]'));
  assert.equal(app.calls.filter(c=>c.name==='remember_microsoft_account').length,1);
  assert.equal(app.calls.filter(c=>c.name==='restore_microsoft_account').length,1);
  assert.match(app.w.document.querySelector('.toast').textContent,/登录状态已保存/);
 } finally {app.close();}
});
