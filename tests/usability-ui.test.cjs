const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function boot(history=[], hooks={}) {
  const dom = new JSDOM('<div id="app"></div>', {url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window; require('./react-renderer-helper.cjs')(w);
  const calls=[]; w.localStorage.setItem('ccl-settings',JSON.stringify({accountMode:'offline',selected:'one',gameDir:'/game'}));
  w.localStorage.setItem('ccl-job-history',JSON.stringify(history));
  w.setInterval=()=>0; w.isTauri=()=>true; w.getCurrentWindow=()=>({}); w.listen=async()=>()=>{}; w.openDialog=async()=>'/skin.png'; w.saveDialog=async()=>null;
  w.invoke=async(name,args={})=>{calls.push({name,args});
    if(name==='list_versions')return [{id:'1.20.1',kind:'正式版',installed:false},{id:'one',name:'Instance One',kind:'Fabric',installed:true},{id:'two',name:'Instance Two',kind:'Forge',installed:true}];
    if(name==='installed_versions')return [{id:'one',name:'Instance One',kind:'Fabric',installed:true},{id:'two',name:'Instance Two',kind:'Forge',installed:true}];
    if(name==='list_microsoft_accounts')return [{uuid:'saved-one',name:'SavedPlayer'}];
    if(name==='switch_microsoft_account')return {account:{uuid:args.uuid,name:'SavedPlayer'}};
    if(name==='get_appearance')return {skin:null,model:'classic',capes:[]};
    if(name==='list_mods')return [{name:'alpha.jar',enabled:true,displayName:'Alpha'}];
    if(name==='search_content')return {hits:[{id:'p',title:'Project',description:'Intro',author:'Author',downloads:1,installed:false}],hasMore:false};
    if(name==='content_categories')return [];
    if(name==='install_java')return new Promise(()=>{});
    if(name==='loader_compatibility'){if(hooks.loader)return hooks.loader(args);if(args.loader==='forge')return false;if(args.loader==='quilt')throw Error('offline');return true;}
    if(name==='required_java_version')return 21;
    if(name==='preview_texture')return 'data:image/png;base64,skin';
    if(name==='list_java')return [{path:'/java21',major:21,version:'21',managed:false}];
    if(name==='list_local_packs')return [];
    if(name==='content_links')return {links:[],description:'Intro'};
    if(name==='list_mod_versions')return [{id:'v1',name:'Version One',number:'1',date:'2026-01-01',requiredDependencies:['fabric-api']},{id:'v2',name:'Version Two',number:'2',date:'2026-01-02',requiredDependencies:[]}];
    if(name==='memory_info')return {totalMb:8192,availableMb:4096,recommendedMb:2048};
    return null;
  };
  w.appVersion=require('../package.json').version; require('./react-renderer-helper.cjs').runMain(w);
  const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
  return {w,calls,click,close:()=>w.close()};
}

test('home offers in-place instance switching and account management',async()=>{
 const a=boot();try{await tick();assert.ok(a.w.document.querySelector('[data-home-version-menu]'));a.click('[data-select="two"]');assert.match(a.w.document.querySelector('.launch-version').textContent,/Instance Two/);assert.equal(JSON.parse(a.w.localStorage.getItem('ccl-settings')).selected,'two');assert.ok(a.w.document.querySelector('.account-entry')); }finally{a.close();}
});
test('content separates discovery and installed views while preserving the search',async()=>{
 const a=boot();try{await tick();a.click('[data-page="content"]');await tick();assert.ok(a.w.document.querySelector('[data-content-view="installed"]'));const query=a.w.document.querySelector('#content-form [name=query]');query.value='example';a.click('[data-content-view="installed"]');assert.equal(a.w.document.querySelector('[data-content-panel="browse"]').hidden,true);assert.equal(a.w.document.querySelector('[data-content-panel="installed"]').hidden,false);a.click('[data-content-view="browse"]');assert.equal(a.w.document.querySelector('#content-form [name=query]').value,'example');}finally{a.close();}
});
test('downloads place active tasks before failed and completed history',async()=>{
 const a=boot([{id:'failed',title:'failure',kind:'java',status:'failed'},{id:'done',title:'finished',kind:'java',status:'done'}]);try{await tick();a.click('[data-page="java"]');await tick();a.click('[data-java-install="17"]');await tick();a.click('[data-page="downloads"]');const active=a.w.document.querySelector('[data-job-group="active"]');const finished=a.w.document.querySelector('[data-job-group="finished"]');assert.ok(active.querySelector('.job-card.running'));assert.equal(finished.querySelector('.job-card').dataset.jobId,'failed');assert.ok(active.compareDocumentPosition(finished)&a.w.Node.DOCUMENT_POSITION_FOLLOWING);}finally{a.close();}
});
test('settings expose common controls while advanced controls remain submitted',async()=>{
 const a=boot();try{await tick();a.click('[data-page="settings"]');await tick();const advanced=a.w.document.querySelector('[data-settings-advanced]');assert.ok(advanced);assert.equal(advanced.open,false);assert.ok(a.w.document.querySelector('#settings-form [name="jvmArgs"]'));}finally{a.close();}
});

test('account entry opens saved accounts and permits switching',async()=>{
 const a=boot();try{await tick();a.click('.account-entry');await tick();assert.ok(a.w.document.querySelector('[data-switch-account="saved-one"]'));a.click('[data-switch-account="saved-one"]');await tick();await tick();assert.match(a.w.document.querySelector('.profile').textContent,/SavedPlayer/);assert.equal(a.w.document.querySelector('.breadcrumbs strong').textContent,'账户与外观');assert.equal(JSON.parse(a.w.localStorage.getItem('ccl-settings')).accountMode,'microsoft');}finally{a.close();}
});
test('loader status and installation summary reflect actual selection',async()=>{
 const a=boot();try{await tick();a.click('[data-page="versions"]');a.click('[data-install="1.20.1"]');await tick();const doc=a.w.document;assert.equal(doc.querySelector('[name=draftLoader][value=forge]').disabled,true);assert.match(doc.querySelector('[name=draftLoader][value=quilt]').closest('label').textContent,/暂无法确认/);const fabric=doc.querySelector('[name=draftLoader][value=fabric]');fabric.checked=true;fabric.dispatchEvent(new a.w.Event('change',{bubbles:true}));const addon=doc.querySelector('[name=draftAddon][value=fabric-api]');addon.checked=true;addon.dispatchEvent(new a.w.Event('change',{bubbles:true}));assert.match(doc.querySelector('[aria-label="安装摘要"]').textContent,/Fabric API/);assert.match(doc.querySelector('[aria-label="安装摘要"]').textContent,/必需依赖/);}finally{a.close();}
});
test('Java guidance uses version metadata and marks unavailable metadata as unknown',async()=>{
 const a=boot();try{await tick();a.click('[data-page="java"]');await tick();assert.match(a.w.document.querySelector('.java-guidance').textContent,/Java 21/);assert.match(a.w.document.querySelector('.java-guidance').textContent,/已检测到/);assert.equal(a.calls.find(c=>c.name==='required_java_version').args.version,'one');}finally{a.close();}
});
test('local skin is clearly labelled as a preview',async()=>{
 const a=boot();try{await tick();a.click('[data-page="account"]');await tick();a.click('[data-action="choose-skin"]');await tick();assert.match(a.w.document.querySelector('.appearance-status').textContent,/本地皮肤 · 仅预览/);}finally{a.close();}
});

test('mod summary follows the selected version and reports declared dependencies',async()=>{
 const a=boot();try{await tick();a.click('[data-page="content"]');await tick();a.click('[data-content-details="0"]');await tick();let summary=a.w.document.querySelector('.mod-dialog [aria-label="安装摘要"]');assert.match(summary.textContent,/fabric-api/);const other=a.w.document.querySelector('[name=modVersion][value=v2]');other.click();assert.match(summary.textContent,/Version Two/);assert.match(summary.textContent,/没有声明直接必需依赖/);}finally{a.close();}
});

test('version menu closes when clicking outside and with Escape',async()=>{
 const a=boot();try{await tick();a.click('[data-home-version-menu] summary');let menu=a.w.document.querySelector('[data-home-version-menu]');assert.equal(menu.open,true);a.click('.hero');assert.equal(menu.open,false);a.click('[data-home-version-menu] summary');menu.querySelector('summary').dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(menu.open,false);}finally{a.close();}
});

test('late loader results do not change a newer installation dialog',async()=>{
 const pending=[];const a=boot([],{loader:args=>new Promise((resolve,reject)=>pending.push({args,resolve,reject}))});
 try{await tick();a.click('[data-page="versions"]');a.click('[data-install="1.20.1"]');const first=pending.slice();a.click('[data-action="close-install"]');a.click('[data-install="1.20.1"]');const fabric=a.w.document.querySelector('[name=draftLoader][value=fabric]');fabric.click();assert.equal(a.w.document.querySelector('[data-action=confirm-install]').disabled,true);for(const request of first)request.resolve(false);await tick();assert.equal(a.w.document.querySelector('[name=draftLoader][value=fabric]').disabled,false);for(const request of pending.slice(4))request.resolve(request.args.loader==='fabric');await tick();assert.equal(a.w.document.querySelector('[name=draftLoader][value=fabric]').checked,true);assert.equal(a.w.document.querySelector('[data-action=confirm-install]').disabled,false);}finally{a.close();}
});

test('switching content tabs and resource type keeps search input and selects the active target',async()=>{
 const a=boot();try{await tick();a.click('[data-page="content"]');await tick();const query=a.w.document.querySelector('#content-form [name=query]');query.value='unsent query';a.click('[data-content-view="installed"]');const type=a.w.document.querySelector('#installed-kind');type.value='resourcepack';type.dispatchEvent(new a.w.Event('change',{bubbles:true}));await tick();assert.ok(a.w.document.querySelector('#local-pack-list'));assert.equal(a.w.document.querySelector('#content-form [name=query]').value,'unsent query');a.click('[data-content-view="browse"]');assert.equal(a.w.document.querySelector('#content-form [name=kind]').value,'resourcepack');}finally{a.close();}
});

test('offline skin synchronization is labelled for the selected instance',async()=>{
 const a=boot();try{await tick();a.click('[data-page="account"]');await tick();a.click('[data-action="choose-skin"]');await tick();a.click('[data-action="apply-offline-skin"]');await tick();assert.match(a.w.document.querySelector('.appearance-status').textContent,/已开启实例启动同步/);a.click('[data-page="home"]');a.click('[data-select="two"]');a.click('[data-page="account"]');await tick();assert.match(a.w.document.querySelector('.appearance-status').textContent,/仅预览/);}finally{a.close();}
});

test('Java guidance does not guess when metadata lacks a requirement',async()=>{
 const a=boot([],{javaRequirement:null});try{const original=a.w.invoke;a.w.invoke=(name,args)=>name==='required_java_version'?Promise.resolve(null):original(name,args);await tick();a.click('[data-page="java"]');await tick();assert.match(a.w.document.querySelector('.java-guidance').textContent,/未提供明确的 Java 要求/);assert.equal(a.w.document.querySelector('.java-recommended'),null);}finally{a.close();}
});

test('avatar opens account and appearance directly while the sidebar stays concise',async()=>{
 const a=boot();try{await tick();const doc=a.w.document;assert.ok(!doc.querySelector('.sidebar [data-page="account"]'));assert.doesNotMatch(doc.querySelector('.sidebar').textContent,/版本服务已连接|本地工作区/);assert.match(doc.querySelector('.side-footer').textContent,/v\d/);assert.ok(doc.querySelector('.account-entry .account-entry-label'));assert.ok(doc.querySelector('.nav [data-page="settings"] .lucide-settings'));a.click('.account-entry');await tick();assert.equal(doc.querySelector('.breadcrumbs strong').textContent,'账户与外观');assert.ok(doc.querySelector('.identity-layout'));}finally{a.close();}
});
