const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
function boot(settings={},history=null){
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});const w=dom.window;require('./react-renderer-helper.cjs')(w);
 w.localStorage.setItem('ccl-settings',JSON.stringify({accountMode:'offline',selected:'1.20.1',gameDir:'/game',...settings}));if(history)w.localStorage.setItem('ccl-job-history',JSON.stringify(history));
 w.setInterval=()=>0;w.isTauri=()=>true;w.getCurrentWindow=()=>({});w.openDialog=async()=>null;w.saveDialog=async()=>null;
 const calls=[],listeners={},pending=[];w.listen=async(name,handler)=>{listeners[name]=handler;return ()=>{};};
 w.invoke=(name,args={})=>{calls.push({name,args});if(name==='list_versions'||name==='installed_versions')return Promise.resolve([{id:'1.20.1',kind:'正式版',name:'1.20.1',installed:true},{id:'1.21',kind:'正式版',name:'1.21',installed:false}]);if(name==='list_mods')return Promise.resolve([]);if(name==='content_categories')return Promise.resolve([]);if(name==='search_content')return Promise.resolve({hits:[{id:'test',title:'测试内容',description:'',author:'',downloads:1,installed:false},{id:'test2',title:'第二个内容',description:'',author:'',downloads:1,installed:false}],hasMore:false});if(name==='list_mod_versions')return Promise.resolve([{id:'v1',name:'版本 1',number:'1',date:'2026'}]);if(name==='content_links')return Promise.resolve({links:[],description:''});if(['install_version','install_mod','install_modpack'].includes(name))return new Promise((resolve,reject)=>pending.push({name,args,resolve,reject}));if(name==='cancel_job'){pending.find(p=>p.args.jobId===args.jobId)?.reject('任务已取消');return Promise.resolve();}return Promise.resolve(null);};
 w.appVersion=require('../package.json').version;require('./react-renderer-helper.cjs').runMain(w);const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
 return {w,calls,listeners,pending,click,close:()=>w.close()};
}

test('installing a game shows a blocking progress dialog that supports cancellation',async()=>{
 const a=boot();try{await tick();a.click('[data-page=versions]');a.click('[data-install="1.21"]');a.click('[data-action=confirm-install]');await tick();const job=a.pending.find(p=>p.name==='install_version');assert.ok(job);let dialog=a.w.document.querySelector('.download-progress-dialog');assert.ok(dialog);assert.equal(dialog.getAttribute('aria-modal'),'true');assert.ok(a.w.document.querySelector('.main').hasAttribute('inert'));a.listeners['install-progress']({payload:{jobId:job.args.jobId,message:'下载资源',current:2,total:4}});dialog=a.w.document.querySelector('.download-progress-dialog');assert.match(dialog.textContent,/2.*4/);a.click(`[data-cancel-job="${job.args.jobId}"]`);await tick();assert.match(a.w.document.querySelector('.download-progress-dialog').textContent,/已取消/);a.click('[data-action=close-download-progress]');assert.equal(a.w.document.querySelector('.download-progress-dialog'),null);}finally{a.close();}
});

test('mod downloads stay in background, can be cancelled and report success',async()=>{
 const a=boot();try{await tick();a.click('[data-page=content]');await tick();a.click('[data-content-install="0"]');await tick();a.click('[data-action=confirm-mod-install]');await tick();assert.equal(a.w.document.querySelector('.download-progress-dialog'),null);assert.ok(a.w.document.querySelector('[data-background-jobs]'));const job=a.pending.find(p=>p.name==='install_mod');job.resolve(1);await tick();await tick();assert.match(a.w.document.querySelector('#toast-root').textContent,/测试内容.*安装完成/);assert.equal(a.w.document.querySelector('[data-background-jobs]'),null);}finally{a.close();}
});


test('modpack installation displays progress and permits a retry after failure',async()=>{
 const a=boot();try{await tick();a.click('[data-page=content]');await tick();const select=a.w.document.querySelector('#content-form [name=kind]');select.value='modpack';select.dispatchEvent(new a.w.Event('change',{bubbles:true}));await tick();await tick();a.click('[data-content-install="0"]');await tick();let job=a.pending.find(p=>p.name==='install_modpack');assert.ok(job);assert.ok(a.w.document.querySelector('.download-progress-dialog'));a.listeners['install-progress']({payload:{jobId:job.args.jobId,message:'正在下载整合包文件',current:3,total:10}});assert.match(a.w.document.querySelector('.download-progress-dialog').textContent,/3.*10/);job.reject('网络不可用');await tick();await tick();assert.match(a.w.document.querySelector('.download-progress-dialog').textContent,/网络不可用/);a.click('[data-retry-job]');await tick();job=a.pending.filter(p=>p.name==='install_modpack').at(-1);assert.equal(a.pending.filter(p=>p.name==='install_modpack').length,2);job.resolve('pack');await tick();await tick();assert.match(a.w.document.querySelector('.download-progress-dialog').textContent,/安装完成/);a.click('[data-action=close-download-progress]');assert.equal(a.w.document.querySelector('.download-progress-dialog'),null);}finally{a.close();}
});

test('background downloads can be cancelled from the compact indicator',async()=>{
 const a=boot();try{await tick();a.click('[data-page=content]');await tick();a.click('[data-content-install="0"]');await tick();a.click('[data-action=confirm-mod-install]');await tick();const job=a.pending.find(p=>p.name==='install_mod');a.click('[data-background-jobs] summary');a.click(`[data-cancel-job="${job.args.jobId}"]`);await tick();await tick();assert.ok(a.calls.some(c=>c.name==='cancel_job'&&c.args.jobId===job.args.jobId));assert.equal(a.w.document.querySelector('[data-background-jobs]'),null);assert.equal(a.w.document.querySelector('.download-progress-dialog'),null);}finally{a.close();}
});

test('a queued foreground installation can be cancelled without interrupting a background job',async()=>{
 const a=boot({jobLimit:1});try{await tick();a.click('[data-page=content]');await tick();a.click('[data-content-install="0"]');await tick();a.click('[data-action=confirm-mod-install]');await tick();const mod=a.pending.find(p=>p.name==='install_mod');a.click('[data-page=versions]');a.click('[data-install="1.21"]');a.click('[data-action=confirm-install]');await tick();assert.match(a.w.document.querySelector('.download-progress-dialog').textContent,/等待下载任务空位/);assert.equal(a.pending.filter(p=>p.name==='install_version').length,0);a.click('.download-progress-dialog [data-cancel-job]');await tick();assert.match(a.w.document.querySelector('.download-progress-dialog').textContent,/已取消/);assert.equal(a.calls.filter(c=>c.name==='cancel_job').length,0);a.click('[data-action=close-download-progress]');mod.resolve(1);await tick();}finally{a.close();}
});

test('background failure shows the reason and retries without blocking the interface',async()=>{
 const a=boot();try{await tick();a.click('[data-page=content]');await tick();a.click('[data-content-install="0"]');await tick();a.click('[data-action=confirm-mod-install]');await tick();a.pending.find(p=>p.name==='install_mod').reject('网络不可用');await tick();await tick();assert.match(a.w.document.querySelector('#toast-root').textContent,/网络不可用/);a.click('#toast-root [data-retry-job]');await tick();const jobs=a.pending.filter(p=>p.name==='install_mod');assert.equal(jobs.length,2);assert.equal(a.w.document.querySelector('.download-progress-dialog'),null);jobs[1].resolve(1);await tick();await tick();assert.match(a.w.document.querySelector('#toast-root').textContent,/安装完成/);}finally{a.close();}
});


test('concurrent background downloads keep separate completion notifications',async()=>{
 const a=boot();try{await tick();a.click('[data-page=content]');await tick();a.click('[data-content-install="0"]');await tick();a.click('[data-action=confirm-mod-install]');await tick();a.click('[data-content-install="1"]');await tick();a.click('[data-action=confirm-mod-install]');await tick();const jobs=a.pending.filter(p=>p.name==='install_mod');assert.equal(jobs.length,2);jobs[0].resolve(1);jobs[1].resolve(1);await tick();await tick();const notices=a.w.document.querySelectorAll('#toast-root [data-dismiss-job]');assert.equal(notices.length,2);assert.match(a.w.document.querySelector('#toast-root').textContent,/测试内容/);assert.match(a.w.document.querySelector('#toast-root').textContent,/第二个内容/);notices[0].click();assert.equal(a.w.document.querySelectorAll('#toast-root [data-dismiss-job]').length,1);}finally{a.close();}
});


test('interrupted retryable downloads are surfaced after restart',async()=>{
 const recipe={type:'mod',gameDir:'/game',version:'1.20.1',source:'modrinth',projectId:'test',modVersionId:'v1'};
 const a=boot({},[{id:'old-job',key:'mod:old',kind:'mod',title:'中断的模组',status:'running',recipe}]);try{await tick();assert.match(a.w.document.querySelector('#toast-root').textContent,/任务因启动器关闭而中断/);a.click('#toast-root [data-retry-job]');await tick();const job=a.pending.find(p=>p.name==='install_mod');assert.ok(job);job.resolve(1);await tick();await tick();assert.match(a.w.document.querySelector('#toast-root').textContent,/安装完成/);}finally{a.close();}
});
