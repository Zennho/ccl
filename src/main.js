import './style.css';
import './journal-theme.css';
import './multiplayer.css';
import './custom-theme.css';
import './launch-screen.css';
import './management.css';
import './update.css';
import { createJobManager } from './job-manager.ts';
import { imageStore, validateThemeImage } from './lib/appearance.ts';
import { createThumbnailLoader } from './lib/thumbnails.ts';
import { createInputController } from './lib/input-controller.ts';
import { createAccountRestorer } from './lib/account-restore.ts';
import { createContentSearch } from './lib/content-search.ts';
import { createModManager } from './lib/mod-manager.ts';
import { createGameProfile } from './lib/game-profile.ts';
import { createInstanceManage } from './lib/instance-manage.ts';
import { createPackManager } from './lib/pack-manager.ts';
import { createGameEvents } from './lib/game-events.ts';
import { createSystemStatus } from './lib/system-status.ts';
import { syncMemoryControls as syncMemoryFields } from './lib/memory-controls.ts';
import { createMultiplayer, copyText } from './lib/multiplayer.ts';
import { createVersionManager } from './lib/version-manager.ts';
import { createAvatarStore } from './lib/avatar-store.ts';
import { createAccountAppearance } from './lib/account-appearance.ts';
import { createInstanceTheme, instanceColors, instanceKey } from './lib/instance-theme.ts';
import { readSettings, createInitialState, createTheme, persistSettings } from './lib/launcher-state.ts';
import { createAppearanceController } from './lib/appearance-controller.ts';
import { createContentDetail } from './lib/content-detail.ts';
import { createGameLauncher } from './lib/game-launcher.ts';
import { createRenderer } from './react/renderer.tsx';
import { HomePage, VersionsPage, JavaPage } from './react/pages.tsx';
import { InstanceSettingsDialog } from './react/instance-settings.tsx';
import { LanRoomPage } from './react/lan-room.tsx';
import { PublicServersPage } from './react/public-servers.tsx';
import { InstanceOverviewDialog } from './react/instance-overview.tsx';
import { LaunchScreen, CrashDialog } from './react/launch.tsx';
import { InstallDialog } from './react/install-dialog.tsx';
import { ArchiveDialog } from './react/archive-dialog.tsx';
import { DownloadsPage } from './react/downloads.tsx';
import { SettingsPage } from './react/settings.tsx';
import { AccountPage } from './react/account.tsx';
import { ManageDialog } from './react/manage-dialog.tsx';
import { InstanceThemeDialog } from './react/instance-theme.tsx';
import { GameProfileDialog } from './react/game-profile.tsx';
import { ContentPage } from './react/content.tsx';
import { ContentDialog } from './react/content-dialog.tsx';
import { Shell } from './react/shell.tsx';
import { normalizeInstanceSettings, resolveInstanceSettings } from './react/instance-settings-model.ts';
import { version as appVersion } from '../package.json';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

const saved=readSettings(localStorage);
const state=createInitialState(saved);
const theme=createTheme(saved);
const app = document.querySelector('#app');
const renderer = createRenderer(app);
let offlineSkinInstances={};
try { const value=JSON.parse(localStorage.getItem('ccl-offline-skin-instances')||'{}');if(value && typeof value==='object' && !Array.isArray(value))offlineSkinInstances=value; } catch {}
let instanceLaunchSettings={};
try { const value=JSON.parse(localStorage.getItem('ccl-instance-launch-settings')||'{}');if(value && typeof value==='object' && !Array.isArray(value))instanceLaunchSettings=value; } catch {}
function getLaunchSettings(gameDir,version) {
 return normalizeInstanceSettings(instanceLaunchSettings[instanceKey(gameDir,version)]);
}
function effectiveLaunchSettings(gameDir,version) {
 return resolveInstanceSettings(state,getLaunchSettings(gameDir,version));
}

const instanceTheme=createInstanceTheme({state,storage:localStorage,store:imageStore,validate:validateThemeImage,render,renderOverlay,applyTheme,flash});
const getInstanceTheme=instanceTheme.getTheme,loadInstanceCover=instanceTheme.load,loadInstalledCovers=instanceTheme.loadInstalled;
function currentInstanceCover(){return instanceTheme.getCover(state.gameDir,state.selected);}
const gameProfile=createGameProfile({state,render:renderOverlay,
 list:(gameDir,version,page)=>invoke('list_game_screenshots',{gameDir,version,page}),
 screenshot:(gameDir,version,name)=>invoke('game_screenshot',{gameDir,version,name}),
 stats:(gameDir,version)=>invoke('play_stats',{gameDir,version})});
const openGameProfile=gameProfile.open,loadProfileScreenshots=gameProfile.loadScreenshots;

const appearanceController=createAppearanceController({theme,instanceColor:()=>getInstanceTheme(state.gameDir,state.selected).color,instanceCover:currentInstanceCover,store:imageStore,validate:validateThemeImage,flash});
function applyTheme(){appearanceController.apply();}
const updateDefaultBanner=appearanceController.updateDefaultBanner,restoreThemeImages=appearanceController.restore;
const systemStatus=createSystemStatus({state,isDesktop:isTauri,getMemory:()=>invoke('memory_info'),getUpdate:()=>invoke('check_launcher_update'),
 renderMemory:()=>{if(state.page==='settings'&&app.querySelector('#memory-info'))renderSettingsPage();},renderChrome});
const refreshMemoryInfo=systemStatus.refreshMemoryInfo,checkLauncherUpdate=systemStatus.checkLauncherUpdate;
function syncMemoryControls(){syncMemoryFields(app);}

function versionVisual(version) {
 const instance=version?.id?getInstanceTheme(state.gameDir,version.id):null;
 return {color:instance?.color || instanceColors[0],cover:version?.id?instanceTheme.getCover(state.gameDir,version.id):null};
}
const hydrateThumbnails=createThumbnailLoader({container:app,fetchThumbnail:(kind,value)=>invoke('fetch_thumbnail',{kind,value})});
const persist=()=>persistSettings(localStorage,state,theme);
const usingOnlineAccount = () => state.accountPreference==='microsoft' && (state.accountKnown || !!state.account);
const playerName = () => usingOnlineAccount() ? (state.account?.name || state.accountName || '正版账户') : state.username;
const playerStatus = () => usingOnlineAccount() ? (state.account ? '微软账户' : state.accountRestoring ? '正在验证正版账户' : '正版账户 · 待验证') : '离线玩家';
const avatarStore=createAvatarStore({state,store:imageStore,render,renderChrome,flash});
const {cacheOnlineAvatar,restoreOnlineAvatar,saveLocalSkin,restoreLocalSkin}=avatarStore;

const selected = () => state.versions.find(v => v.id === state.selected);
function flash(message, kind = '') { state.notice = message; state.noticeKind = kind; state.noticeCrash=false; renderChrome(); }
function showCrashNotice(crash) {state.crash=crash;state.notice=`游戏 ${crash.version} 异常退出（代码 ${crash.code ?? '未知'}）。`;state.noticeKind='error';state.noticeCrash=true;renderChrome();}
function shellProps() {
 const uuid=state.account?.uuid || state.accountUuid;
 const skin=usingOnlineAccount() ? (state.appearance?.skin || avatarStore.get(uuid)) : state.localSkin?.data;
 return {page:state.page,name:playerName(),status:playerStatus(),skin:typeof skin==='string'&&skin.startsWith('data:image/png;base64,')?skin:'',online:state.online,version:appVersion,installedCount:state.versions.filter(v=>v.installed).length,jobCount:activeJobCount(),updateInfo:state.updateInfo,updateDismissed:state.updateDismissed,notice:state.notice,noticeKind:state.noticeKind,noticeCrash:!!(state.crash&&state.noticeCrash)};
}
function renderShell() { if(app.querySelector('.app-shell')) renderer.chrome(Shell,shellProps()); }
const multiplayer=createMultiplayer({state,render,flash,getAddresses:()=>invoke('ipv6_addresses'),getServers:()=>invoke('public_servers')});
const refreshLanAddresses=multiplayer.refreshAddresses,filteredServers=multiplayer.filteredServers,refreshPublicServers=multiplayer.refreshPublicServers;
const ADDONS = [
 { id:'fabric-api', title:'Fabric API', desc:'许多 Fabric 模组的基础依赖', loaders:['fabric'] },
 { id:'sodium', title:'Sodium', desc:'改善渲染性能', loaders:['fabric','neoforge'] },
 { id:'jei', title:'Just Enough Items', desc:'查看物品与配方', loaders:['fabric','quilt','forge','neoforge'] },
 { id:'jade', title:'Jade', desc:'查看方块与实体信息', loaders:['fabric','quilt','forge','neoforge'] },
];
function renderContentPage() { if(state.page==='content' && app.querySelector('.content')) { renderer.page(ContentPage,{state},'content'); hydrateThumbnails(); } }
function renderLocalPacks() { renderContentPage(); }
const packManager=createPackManager({state,render:renderLocalPacks,
 list:(gameDir,version,kind)=>invoke('list_local_packs',{gameDir,version,kind}),
 environment:(gameDir,version)=>invoke('shader_environment',{gameDir,version})});
const refreshPacks=packManager.refresh;

const instanceManage=createInstanceManage({state,render:renderOverlay,flash,
 list:(kind,gameDir,version)=>invoke(kind==='backups'?'list_backups':'list_worlds',{gameDir,version}),
 operation:(command,args)=>invoke(command,args)});
const loadManage=instanceManage.load,openManage=instanceManage.open,manageOperation=instanceManage.perform;
function renderLocalMods() { renderContentPage(); }
const modManager=createModManager({state,render:renderLocalMods,search:()=>searchContent(),flash,
 list:(gameDir,version)=>invoke('list_mods',{gameDir,version}),
 remove:(gameDir,version,name)=>invoke('remove_mod',{gameDir,version,name}),
 setEnabled:(gameDir,version,name,enabled)=>invoke('set_mod_enabled',{gameDir,version,name,enabled})});
function applyModChanges(action,names){return modManager.applyModChanges(action,names);}
function refreshMods(){return modManager.refreshMods();}
const contentSearch=createContentSearch({state,modRevision:modManager.revision,render,renderContent:renderContentPage,
 categories:(source,kind,apiKey)=>invoke('content_categories',{source,kind,apiKey}),
 search:snapshot=>invoke('search_content',snapshot),
 translate:(source,items)=>invoke('translate_content_summaries',{source,items})});
const {loadContentCategories,searchContent}=contentSearch;

const contentDetail=createContentDetail({state,render:renderOverlay,
 lookup:(source,kind,projectUrl,title)=>invoke('lookup_mcmod',{source,kind,projectUrl,title}),
 links:(source,projectId,apiKey)=>invoke('content_links',{source,projectId,apiKey}),
 curseDescription:(projectId,apiKey)=>invoke('curseforge_description',{projectId,apiKey}),
 versions:(kind,gameDir,version,source,projectId,apiKey)=>invoke(kind==='mod'?'list_mod_versions':'list_pack_versions',{gameDir,version,source,projectId,apiKey,...(kind==='mod'?{}:{kind})}),
 translate:(source,projectId,description,summary)=>invoke('translate_content',{source,projectId,description,summary})});
const accountAppearance=createAccountAppearance({state,container:app,render,renderChrome,flash,cacheAvatar:cacheOnlineAvatar,
 getAccounts:()=>invoke('list_microsoft_accounts'),getAppearance:()=>invoke('get_appearance'),
 createPreview:(canvas,skin,cape,model)=>import('./appearance-preview.ts').then(m=>m.createAppearancePreview(canvas,skin,cape,model))});
const {refreshAccountList,refreshPreview,refreshAppearance}=accountAppearance;
const versionManager=createVersionManager({state,render,renderChrome,persist,loadCovers:loadInstalledCovers,flash,
 listVersions:gameDir=>invoke('list_versions',{gameDir}),installed:gameDir=>invoke('installed_versions',{gameDir}),listJava:()=>invoke('list_java')});
const refreshInstalled=versionManager.refreshInstalled,refreshJava=versionManager.refreshJava,refresh=versionManager.refresh;
const { saveJobs, runnerFor, restoreJobs, renderJobList, hasJob, enqueueJob, pumpJobs, requestJobCancel, jobEvent, queueVersion, activeJobCount } = createJobManager({
 state, invoke, persist, renderChrome, flash, render, refreshInstalled, renderDownloads,
 onJobFinished: async job => {
  if(['resourcepack','shader'].includes(job.kind) && job.version===state.contentTarget && job.gameDir===state.gameDir && state.contentKind===job.kind) { contentSearch.invalidate(); state.contentLoaded=false; if(state.page==='content') await Promise.all([refreshPacks(),searchContent()]); }
  if (job.kind==='mod' && job.version===state.contentTarget && job.gameDir===state.gameDir) {
   modManager.invalidate();state.modUpdates=null;state.modConflicts=null;
   if(state.page==='content'){await refreshMods();if(state.contentKind==='shader')await refreshPacks();await searchContent();}
  }
 }
});
let renderedPage = null;
const inputController=createInputController({container:app,state,theme,render,renderSettings:renderSettingsPage,renderMods:renderLocalMods,renderPacks:renderLocalPacks,updateSearch:updateSearchResults,applyTheme,persist});
function renderChrome() {
 renderShell();
 if(state.page==='settings' && app.querySelector('#update-panel'))renderSettingsPage();
}
function renderOverlay() {
 const root=app.querySelector('#modal-root');if(!root)return;
 if(state.launchView) {
  renderer.overlay(LaunchScreen,{view:state.launchView},`launch:${state.launchView.id}`);
 } else if(state.crashDialog) {
  renderer.overlay(CrashDialog,{crash:state.crashDialog}); } else if(state.instanceSettingsView && !state.launchView && !state.crashDialog) {
  const d=state.instanceSettingsView,savedSettings=getLaunchSettings(d.gameDir,d.version);
  renderer.overlay(InstanceSettingsDialog,{name:d.name,values:{...state,...savedSettings},saved:savedSettings,runtimes:Array.isArray(state.javaRuntimes)?state.javaRuntimes:[]},`instance-settings:${d.version}`);
 } else if(state.themeView) {
  const d=state.themeView,cover=d.preview||(!d.removeCover?instanceTheme.getCover(d.gameDir,d.version):null)||null;
  renderer.overlay(InstanceThemeDialog,{draft:d,cover,colors:instanceColors});
 } else if(state.profileView) {
  renderer.overlay(GameProfileDialog,{view:state.profileView},`profile:${state.profileView.version}`);
 } else if(state.manageView) {
  renderer.overlay(ManageDialog,{view:state.manageView});
 } else if(state.instanceView && !state.launchView && !state.crashDialog && !state.themeView && !state.profileView && !state.manageView) {
  renderer.overlay(InstanceOverviewDialog,{view:state.instanceView});
 } else if(state.installDraft && !state.themeView && !state.profileView && !state.manageView && !state.instanceView) {
  renderer.overlay(InstallDialog,{draft:state.installDraft,addons:ADDONS});
 } else if(state.archiveDraft && !state.themeView && !state.profileView && !state.manageView && !state.instanceView && !state.modDraft) {
  renderer.overlay(ArchiveDialog,{draft:state.archiveDraft});
 } else if(state.modDraft) {
  renderer.overlay(ContentDialog,{draft:state.modDraft,shaderEnv:state.shaderEnv,shaderEnvLoading:state.shaderEnvLoading},`content:${state.modDraft.source}:${state.modDraft.projectId}`);
 } else renderer.overlay();
 syncMemoryControls();

}
function renderPage() {
 if(state.page==='home'){const v=selected();renderer.page(HomePage,{version:v,visual:versionVisual(v),description:v?.installed?getInstanceTheme(state.gameDir,v.id).description:''});return;}
 if(state.page==='versions'){renderVersionsPage();return;}
 if(state.page==='java'){renderer.page(JavaPage,{runtimes:state.javaRuntimes,javaPath:state.javaPath,loading:state.javaLoading,deleteIndex:state.javaDelete,hasJob});return;}
 if(state.page==='content'){renderContentPage();return;}
 if(state.page==='downloads'){renderDownloads();return;}
 if(state.page==='settings'){renderSettingsPage();return;}
 if(state.page==='account'){renderer.page(AccountPage,{state,usingOnline:usingOnlineAccount(),playerName:playerName(),selected:selected()});return;}
 if(state.page==='multiplayer' && state.lanView==='room'){renderer.page(LanRoomPage,{room:state.lanRoom,busy:state.lanBusy,addresses:state.lanAddresses,port:state.lanPort,target:state.lanTarget,test:state.lanTest});return;}
 if(state.page==='multiplayer' && state.lanView==='servers'){renderServerPage();return;}
 renderer.page();
}
function render() {
 if(!inputController.beforeRender(renderedPage===state.page))return;
 const first = !app.querySelector('.app-shell');
 if (first) { renderer.mount(Shell,shellProps()); renderPage(); }
 else {
  const content = app.querySelector('.content');
  const same = renderedPage === state.page;
  const main=app.querySelector('.main'),scrollTop=main?.scrollTop,scrollLeft=main?.scrollLeft,docScroll=document.scrollingElement||document.documentElement,docTop=docScroll.scrollTop,docLeft=docScroll.scrollLeft;
  const values = same ? [...content.querySelectorAll('form input, form select')].filter(x => x.name).map(x => ({name:x.name, value:x.value, checked:x.checked, type:x.type})) : [];
  const active = same && content.contains(document.activeElement) ? document.activeElement : null;
  const focus = active ? { name:active.name, id:active.id, start:active.selectionStart, end:active.selectionEnd } : null;
  renderPage();
  for (const saved of values) { const el = [...content.querySelectorAll('form input, form select')].find(x => x.name === saved.name && x.type === saved.type); if (el) { el.value = saved.value; if (el.type === 'checkbox' || el.type === 'radio') el.checked = saved.checked; } }
  if (focus) { const el = [...content.querySelectorAll('input, select')].find(x => focus.id ? x.id === focus.id : x.name === focus.name); if (el) { el.focus({preventScroll:true}); if (focus.start != null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(focus.start, focus.end); } catch {} } } }
  if(same && main){main.scrollTop=scrollTop;main.scrollLeft=scrollLeft;docScroll.scrollTop=docTop;docScroll.scrollLeft=docLeft;}
 }
 renderedPage = state.page; syncMemoryControls(); applyTheme(); renderChrome(); if(!(state.modDraft && app.querySelector("#modal-root .mod-dialog")) && !(state.archiveDraft && app.querySelector("#modal-root .archive-dialog"))) renderOverlay(); hydrateThumbnails(); refreshPreview();
}
function renderSettingsPage() {
 renderer.page(SettingsPage,{...state,version:appVersion,selectedVersion:state.versions.find(v=>v.id===state.selected && v.installed),theme},'settings');
}
function renderDownloads() {
 if(!app.querySelector('#job-list') && state.page!=='downloads')return;
 renderer.page(DownloadsPage,{jobs:state.jobs,limit:state.jobLimit},'downloads');
}
function renderServerPage() {
 renderer.page(PublicServersPage,{catalog:state.serverCatalog,filtered:filteredServers(),query:state.serverQuery,status:state.serverStatus,page:state.serverPage,loading:state.serverLoading,error:state.serverError},'public-servers');
}
function renderVersionsPage() { renderer.page(VersionsPage,{versions:state.versions,query:state.versionQuery,selected:state.selected,loading:state.loading,versionVisual,deleteVersion:state.versionDelete,deleting:state.versionDeleting},'versions'); }
function updateSearchResults(kind) {
 if(kind==='server') {renderServerPage();hydrateThumbnails();return;}
 renderVersionsPage();
}
app.addEventListener('pointerdown', event => { const edge=event.target.closest('[data-resize]'); if (edge && event.button===0 && isTauri()) getCurrentWindow().startResizeDragging(edge.dataset.resize).catch(e=>flash(`无法调整窗口大小：${e}`,'error')); });
app.addEventListener('click', async event => {
 const themeReset=event.target.closest('[data-theme-reset]');
 if(themeReset) {await appearanceController.reset(themeReset.dataset.themeReset);return;}
 const menuSummary=event.target.closest('.version-menu summary');
 app.querySelectorAll('.version-menu[open]').forEach(menu=>{ if(!menuSummary || menuSummary.parentElement!==menu) menu.open=false; });
 const windowControl=event.target.closest('[data-window]');
 if (windowControl) { if (isTauri()) { try { const win=getCurrentWindow(); if (windowControl.dataset.window==='minimize') await win.minimize(); else if(windowControl.dataset.window==='maximize') await win.toggleMaximize(); else if(windowControl.dataset.window==='close') await win.close(); } catch(e) { flash(`窗口操作失败：${e}`,'error'); } } return; }
 const page = event.target.closest('[data-page]'); if (page) { state.page = page.dataset.page; render(); if (state.page === 'account') {void refreshAccountList();if(state.account && !state.appearance)void refreshAppearance({reuse:true});} if (state.page === 'settings') void refreshMemoryInfo(); if (state.page === 'java') await refreshJava(); if (state.page === 'multiplayer' && state.lanView==='room') await refreshLanAddresses(); if (state.page === 'multiplayer' && state.lanView==='servers' && !state.serverCatalog) await refreshPublicServers(); if (state.page === 'content') { if(!state.contentTarget || !state.versions.some(v=>v.installed && v.id===state.contentTarget)) {state.contentTarget=state.selected || '';state.selectedMods.clear();state.modUpdates=null;modManager.invalidate();state.contentPage=0;state.contentLoaded=false;} await refreshMods();await refreshPacks();void loadContentCategories();if(!state.contentLoaded) await searchContent(); } return; }
 const profileButton=event.target.closest('[data-game-profile]');if(profileButton){await openGameProfile(profileButton.dataset.gameProfile);return;}
 const profilePage=event.target.closest('[data-profile-page]');if(profilePage&&state.profileView&&!state.profileView.loading){const d=state.profileView,n=Number(profilePage.dataset.profilePage);if(n>=0&&(n<d.page||d.hasMore)){d.page=n;d.preview=null;await loadProfileScreenshots(d);}return;}
 const profileShot=event.target.closest('[data-profile-shot]');if(profileShot&&state.profileView){const d=state.profileView,index=Number(profileShot.dataset.profileShot),data=d.images[index];if(data){d.preview={data,name:d.shots[index].name};renderOverlay();}return;}
 const instanceSettingsButton=event.target.closest('[data-instance-settings]');
 if(instanceSettingsButton){const version=instanceSettingsButton.dataset.instanceSettings,item=state.versions.find(v=>v.id===version&&v.installed);if(!item)return;const menu=instanceSettingsButton.closest('details');if(menu)menu.open=false;const view={version,gameDir:state.gameDir,name:item.name||version};state.instanceSettingsView=view;renderOverlay();void invoke('list_java').then(runtimes=>{if(state.instanceSettingsView!==view || !Array.isArray(runtimes))return;state.javaRuntimes=runtimes;renderOverlay();}).catch(()=>{});return;}
 const themeButton=event.target.closest('[data-instance-theme]');if(themeButton){await instanceTheme.open(themeButton.dataset.instanceTheme);return;}
 const colorButton=event.target.closest('[data-instance-color]');if(colorButton&&state.themeView){instanceTheme.setColor(colorButton.dataset.instanceColor);return;}
 const manageButton=event.target.closest('[data-manage-backups],[data-manage-worlds]');if(manageButton){await openManage(manageButton.hasAttribute('data-manage-backups')?'backups':'worlds',manageButton.dataset.manageBackups||manageButton.dataset.manageWorlds);return;}
 const restoreButton=event.target.closest('[data-manage-restore]');if(restoreButton&&state.manageView&&!state.manageView.busy){const item=state.manageView.items[Number(restoreButton.dataset.manageRestore)];if(item){state.manageView.confirm={action:'restore',item};renderOverlay();}return;}
 const manageDelete=event.target.closest('[data-manage-delete]');if(manageDelete&&state.manageView&&!state.manageView.busy){const item=state.manageView.items[Number(manageDelete.dataset.manageDelete)];if(item){state.manageView.confirm={action:'delete',item};renderOverlay();}return;}
 const worldOpen=event.target.closest('[data-world-open]');if(worldOpen&&state.manageView){const d=state.manageView,item=d.items[Number(worldOpen.dataset.worldOpen)];if(item){try{await invoke('open_world_folder',{gameDir:d.gameDir,version:d.version,folder:item.folder});}catch(e){d.error=String(e);renderOverlay();}}return;}
 const worldBackup=event.target.closest('[data-world-backup]');if(worldBackup&&state.manageView){const item=state.manageView.items[Number(worldBackup.dataset.worldBackup)];if(item)await manageOperation('create_backup',{scope:'world',world:item.folder},'存档备份已创建。');return;}
 const overviewButton=event.target.closest('[data-instance-overview]');if(overviewButton){const version=overviewButton.dataset.instanceOverview,gameDir=state.gameDir,item=state.versions.find(v=>v.id===version&&v.installed);if(!item)return;const view={version,gameDir,name:item.name||version,loading:true,info:null,error:''};state.instanceView=view;renderOverlay();try{const info=await invoke('instance_overview',{gameDir,version});if(state.instanceView===view)view.info=info;}catch(e){if(state.instanceView===view)view.error=String(e);}finally{if(state.instanceView===view){view.loading=false;renderOverlay();}}return;}
 const openFolder = event.target.closest('[data-open-version-folder]'); if (openFolder) { try { await invoke('open_version_folder',{gameDir:state.instanceView?.version===openFolder.dataset.openVersionFolder?state.instanceView.gameDir:state.gameDir,version:openFolder.dataset.openVersionFolder}); } catch(e) { flash(String(e),'error'); } return; }
 const deleteVersion=event.target.closest('[data-delete-version]');if(deleteVersion) {const version=state.versions.find(v=>v.id===deleteVersion.dataset.deleteVersion&&v.installed);if(version){state.versionDelete={id:version.id,name:version.name||version.id,isolated:!!(version.isolated||version.hasInstanceData),gameDir:state.gameDir};render();}return;}
 const exportButton=event.target.closest('[data-export-game]'); if(exportButton) { state.archiveDraft={kind:'export',version:exportButton.dataset.exportGame,gameDir:state.gameDir}; renderOverlay(); return; }
 const select = event.target.closest('[data-select]'); if (select) { state.selected = select.dataset.select; persist(); render();void loadInstanceCover(state.gameDir,state.selected); flash(`已选择 ${state.selected}`); return; }
 const install = event.target.closest('[data-install]'); if (install) { state.installDraft={version:install.dataset.install,loader:'vanilla',addons:[]}; renderOverlay(); return; }
 const contentPageButton=event.target.closest('[data-content-page]');if(contentPageButton && !state.contentBusy) {const page=Number(contentPageButton.dataset.contentPage);if(page>=0 && page<=332 && (page<=state.contentPage||state.contentHasMore)){state.contentPage=page;await searchContent();}return;}
 const projectLink=event.target.closest('[data-open-project]');
 if(projectLink) {const url=projectLink.dataset.openProject;if(url){try {await invoke('open_content_page',{url});} catch(e) {flash(`无法打开项目网址：${e}`,'error');}}return;}
 if(event.target.closest('[data-action="toggle-content-language"]') && state.modDraft){state.modDraft.showOriginal=!state.modDraft.showOriginal;renderOverlay();return;}
 const contentInstall = event.target.closest('[data-content-install], [data-content-details]');
 if (contentInstall && !state.contentBusy) {
  const isDetails=contentInstall.hasAttribute('data-content-details');
  const item=state.contentResults[Number(isDetails?contentInstall.dataset.contentDetails:contentInstall.dataset.contentInstall)]; if(!item) return;
  const kind=state.contentKind,source=state.contentSource,apiKey=state.contentKey,gameDir=state.gameDir,javaPath=state.javaPath;
  if(kind==='modpack' && !isDetails) {enqueueJob({key:`modpack:${source}:${item.id}:${gameDir}`,kind,title:item.title,gameDir,recipe:{type:'modpack',gameDir,source,projectId:item.id,javaPath},run:job=>invoke('install_modpack',{gameDir,source,projectId:item.id,apiKey,javaPath,jobId:job.id})});return;}
  await contentDetail.open(item);return;
 }
 const packRemove=event.target.closest('[data-pack-remove]');if(packRemove && !state.packWorking){const item=state.localPacks[Number(packRemove.dataset.packRemove)];if(item){state.packDelete={name:item.name,kind:state.contentKind,version:state.contentTarget,gameDir:state.gameDir};render();}return;}
 const modToggle = event.target.closest('[data-mod-toggle]');
 if (modToggle && !state.contentBusy && !state.modWorking) { const m=state.localMods[Number(modToggle.dataset.modToggle)];if(m) await applyModChanges(m.enabled?'disable':'enable',[m.name]);return; }
 const modRemove = event.target.closest('[data-mod-remove]'); if (modRemove && !state.modWorking) { const mod=state.localMods[Number(modRemove.dataset.modRemove)];if(mod){state.modDelete=[mod.name];render();}return; }
 const javaSelect = event.target.closest('[data-java-select]');
 if (javaSelect) { const java = state.javaRuntimes[Number(javaSelect.dataset.javaSelect)]; if (java) { state.javaPath = java.path; persist(); render(); flash(`已选择 Java ${java.version}`); } return; }
 const javaRemove = event.target.closest('[data-java-remove]');
 if (javaRemove) { state.javaDelete = Number(javaRemove.dataset.javaRemove); render(); return; }
 const javaInstall = event.target.closest('[data-java-install]');
 if (javaInstall && !state.javaLoading) {
  const major=Number(javaInstall.dataset.javaInstall);
  const recipe={type:'java',major};enqueueJob({key:`java:${major}`,kind:'java',title:`Java ${major} · Eclipse Temurin`,recipe,run:runnerFor(recipe)}); if(state.page==='java') render(); return;
 }
 const retry=event.target.closest('[data-retry-job]'); if (retry) { const old=state.jobs.find(j=>j.id===retry.dataset.retryJob); if (old?.run) enqueueJob({key:old.key,kind:old.kind,title:old.title,gameDir:old.gameDir,version:old.version,run:old.run,recipe:old.recipe}); return; }
 const removeJob=event.target.closest('[data-remove-job]');if(removeJob){state.jobs=state.jobs.filter(j=>j.id!==removeJob.dataset.removeJob||!['done','failed','cancelled'].includes(j.status));saveJobs();renderJobList();return;}
 const cancelJob=event.target.closest('[data-cancel-job]');if(cancelJob){const job=state.jobs.find(j=>j.id===cancelJob.dataset.cancelJob);if(job){await requestJobCancel(job);pumpJobs();}return;}
 const action = event.target.closest('[data-action]')?.dataset.action;
 if(action==='cancel-all-jobs'){await Promise.all(state.jobs.filter(j=>j.status==='queued'||j.status==='running').map(requestJobCancel));pumpJobs();return;}
 if(action==='cancel-version-delete'){state.versionDelete=null;render();return;}
 if(action==='confirm-version-delete' && state.versionDelete && !state.versionDeleting){const d=state.versionDelete,removeInstance=!!app.querySelector('#delete-instance-data')?.checked;if(state.jobs.some(j=>j.gameDir===d.gameDir&&['queued','running','canceling'].includes(j.status))){flash('该游戏目录有进行中或等待中的任务，请先取消或等待结束。','error');return;}state.versionDeleting=true;render();try{await invoke('delete_version',{gameDir:d.gameDir,version:d.id,removeInstance});state.versionDelete=null;if(state.selected===d.id)state.selected='';if(state.contentTarget===d.id){state.contentTarget='';state.localMods=[];state.contentResults=[];}await refreshInstalled(d.gameDir);persist();flash('版本已删除。');}catch(e){flash(`删除失败：${e}`,'error');}finally{state.versionDeleting=false;render();}return;}
 const lanView=event.target.closest('[data-lan-view]'); if(lanView) { state.lanView=lanView.dataset.lanView;render();if(state.lanView==='servers'&&!state.serverCatalog&&!state.serverLoading) await refreshPublicServers();return; }
 const serverCopy=event.target.closest('[data-server-copy]');if(serverCopy) { const entry=filteredServers()[Number(serverCopy.dataset.serverCopy)];if(entry) { try { await copyText(entry.address);flash('服务器地址已复制，在游戏中选择“多人游戏 → 直接连接”粘贴。'); } catch(e) { flash(`复制失败：${e}`,'error'); } }return; }
 const serverPage=event.target.closest('[data-server-page]');if(serverPage) { state.serverPage=Math.max(0,Number(serverPage.dataset.serverPage));render();return; }
 const copyIpv6=event.target.closest('[data-copy-ipv6]');
 if(copyIpv6 && state.lanRoom) { const address=state.lanAddresses[Number(copyIpv6.dataset.copyIpv6)]; if(address) { try { await copyText(`[${address.address}]:${state.lanRoom.port}`); flash('房间地址已复制。'); } catch(e) { flash(`复制失败，请手动复制地址：${e}`,'error'); } } return; }
 if(action==='refresh-public-servers') { await refreshPublicServers(); return; }
 if(action==='refresh-ipv6') { await refreshLanAddresses(); return; }
 if(action==='stop-ipv6-room' && !state.lanBusy) { state.lanBusy=true;render();try { await invoke('stop_ipv6_room');state.lanRoom=null;flash('房间已关闭。'); } catch(e) { flash(`关闭房间失败：${e}`,'error'); } finally { state.lanBusy=false;render(); } return; }
 if(action==='import-game') { try { const path=await openDialog({multiple:false,directory:false,filters:[{name:'CCL 或 PCL 兼容整合包',extensions:['zip','mrpack']}]}); if(path && typeof path==='string') { const manifest=await invoke('inspect_game_archive',{path}); state.archiveDraft={kind:'import',path,manifest,gameDir:state.gameDir,javaPath:state.javaPath}; renderOverlay(); } } catch(e) { flash(`无法读取导入包：${e}`,'error'); } return; }
 if(action==='close-archive' || (action==='close-archive-backdrop' && event.target.classList.contains('install-overlay'))) { state.archiveDraft=null; renderOverlay(); return; }
 if(action==='confirm-export' && state.archiveDraft?.kind==='export') { const d=state.archiveDraft,includeSaves=!!app.querySelector('#archive-saves')?.checked,exportFormat=app.querySelector('input[name=archiveFormat]:checked')?.value||'ccl'; try { const path=await saveDialog({defaultPath:`CCL-${d.version}.${exportFormat==='pcl'?'mrpack':'zip'}`,filters:[{name:exportFormat==='pcl'?'PCL 兼容整合包':'CCL 游戏导出包',extensions:[exportFormat==='pcl'?'mrpack':'zip']}]}); if(!path) return; const launchSettings={memory:Number(state.memory),memoryMode:state.memoryMode,optimize:state.optimize,jvmArgs:state.jvmArgs,gameArgs:state.gameArgs}; state.archiveDraft=null;renderOverlay(); enqueueJob({key:`export:${d.gameDir}:${d.version}:${path}`,kind:'export',title:`导出 · ${d.version}`,gameDir:d.gameDir,run:job=>invoke('export_game',{gameDir:d.gameDir,version:d.version,path,includeSaves,launchSettings,exportFormat,jobId:job.id})}); } catch(e) { flash(`导出失败：${e}`,'error'); } return; }
 if(action==='confirm-import' && state.archiveDraft?.kind==='import') { const d=state.archiveDraft,restoreSettings=!!app.querySelector('#archive-settings')?.checked; state.archiveDraft=null;renderOverlay();enqueueJob({key:`import:${d.gameDir}:${d.path}`,kind:'import',title:`导入 · ${d.manifest.name}`,gameDir:d.gameDir,run:async job=>{const result=await invoke('import_game',{gameDir:d.gameDir,path:d.path,javaPath:d.javaPath,jobId:job.id}); if(d.gameDir===state.gameDir) { state.selected=result.version; if(restoreSettings && result.launchSettings) Object.assign(state,result.launchSettings,{memoryMode:result.launchSettings.memoryMode==='auto'?'auto':'manual'}); persist(); } }});return; }
 if(action==='close-launch-view') { const crash=state.launchView?.crash;state.launchView=null;if(crash?.diagnosis)showCrashNotice(crash);renderOverlay();return; }
 if(action==='launch-account') {state.launchView=null;state.page='account';render();return;}
 const switchAccount=event.target.closest('[data-switch-account]');
 if(switchAccount && !state.accountBusy && !state.loginAttempt) {const uuid=switchAccount.dataset.switchAccount;if(uuid===state.account?.uuid)return;const previous={account:state.account,appearance:state.appearance,accountName:state.accountName,accountUuid:state.accountUuid,accountMode:state.accountMode,accountPreference:state.accountPreference,accountKnown:state.accountKnown};restoreAccount.cancel();state.accountBusy=true;state.appearance=null;state.account=null;state.accountPreference='microsoft';state.accountKnown=true;const target=state.savedAccounts.find(a=>a.uuid===uuid);state.accountName=target?.name||'';state.accountUuid=uuid;state.accountRestoreError='';void restoreOnlineAvatar(uuid);render();try{const result=await invoke('switch_microsoft_account',{uuid});if(result?.error || !result?.account){state.accountMode='offline';state.accountRestoreError=`账户恢复失败：${result?.error||'未找到保存的账户'}。可检查网络后重试或重新登录。`;persist();flash(state.accountRestoreError,'error');}else{const account=result.account;state.account=account;state.accountName=account.name;state.accountUuid=account.uuid;state.accountMode=state.accountPreference==='offline'?'offline':'microsoft';persist();await refreshAppearance();}}catch(e){Object.assign(state,previous);persist();flash(`无法切换账户：${e}`,'error');}finally{state.accountBusy=false;render();void refreshAccountList();}return;}
 if(action==='begin-login' && !state.accountRestoring) {
  const attempt={}; state.loginAttempt=attempt;state.browserPrompt=null;render();
  try { const prompt=await invoke('begin_microsoft_login'); if(state.loginAttempt!==attempt) return; state.browserPrompt=prompt;render(); const account=await invoke('complete_microsoft_login'); if(state.loginAttempt!==attempt) return; if(state.account?.uuid!==account.uuid)state.appearance=null;state.account=account;state.accountName=account.name;state.accountUuid=account.uuid;state.accountMode='microsoft';state.accountKnown=true;state.accountPreference='microsoft';state.accountRestoreError='';state.loginAttempt=null;state.browserPrompt=null;void restoreOnlineAvatar(account.uuid);persist();render();if(account.remembered===false)flash(`登录成功，但无法保存登录状态：${account.rememberError || '请检查系统凭据库。'}`,'error');await refreshAppearance();void refreshAccountList(); }
  catch(e) { if(state.loginAttempt===attempt) { state.loginAttempt=null;state.browserPrompt=null;render();flash(`登录失败：${e}`,'error'); } } return;
 }
 if(action==='cancel-login') { state.loginAttempt=null;state.browserPrompt=null;state.accountBusy=true;render(); try { await invoke('cancel_microsoft_login'); } catch(e) { flash(String(e),'error'); } finally { state.accountBusy=false;render(); } return; }
 if(action==='retry-save-account' && state.account && !state.accountBusy) {const current=state.account;state.accountBusy=true;render();try{const account=await invoke('remember_microsoft_account');if(state.account!==current)return;Object.assign(current,account);if(account.remembered){flash('登录状态已保存。');void refreshAccountList();}else flash(`仍无法保存登录状态：${account.rememberError || '请检查系统凭据库。'}`,'error');}catch(e){flash(`无法重试保存：${e}`,'error');}finally{state.accountBusy=false;render();}return;}
 if(action==='retry-account-restore' && !state.accountRestoring) {void restoreAccount({notify:true});return;}
 if(action==='open-microsoft-login') { try { await invoke('open_microsoft_login'); } catch(e) { flash(String(e),'error'); } return; }
 if(action==='use-offline' || action==='continue-offline') { state.accountMode='offline';state.accountPreference='offline';persist();render();return; }
 if(action==='use-microsoft' && (state.account || state.accountKnown)) { state.accountMode=state.account?'microsoft':'offline';state.accountPreference='microsoft';void restoreOnlineAvatar(state.account?.uuid||state.accountUuid);persist();render();if(!state.account)void restoreAccount({notify:false});return; }
 if(action==='logout-microsoft') { const oldUuid=state.account?.uuid||state.accountUuid;restoreAccount.cancel();state.accountBusy=true;render();try { await invoke('logout_microsoft'); } catch(e) { flash(String(e),'error'); } finally { state.account=null;state.accountName='';state.accountUuid='';cacheOnlineAvatar(oldUuid,null);state.accountMode='offline';state.accountKnown=false;state.accountPreference='offline';state.accountRestoreError='';state.appearance=null;state.previewCapeId='';state.accountBusy=false;persist();render();void refreshAccountList(); } return; }
 if(action==='choose-skin' || action==='choose-cape') { const kind=action==='choose-skin'?'skin':'cape';try { const path=await openDialog({multiple:false,directory:false,filters:[{name:'PNG 图片',extensions:['png']}]}); if(typeof path!=='string') return;const data=await invoke('preview_texture',{path,kind});const file={path,data,name:path.split(/[\\/]/).pop(),...(kind==='skin'?{model:state.skinModel}:{})};if(kind==='skin') {state.localSkin=file;saveLocalSkin(file);}else state.localCape=file;render(); } catch(e) { flash(`无法预览图片：${e}`,'error'); } return; }
 if(action==='apply-offline-skin' && state.localSkin && !usingOnlineAccount() && selected()?.installed) {const version=state.selected,gameDir=state.gameDir,skin=state.localSkin.data,username=state.username;state.accountBusy=true;render();try{await invoke('apply_offline_skin',{gameDir,version,username,skin});offlineSkinInstances[instanceKey(gameDir,version)]=true;localStorage.setItem('ccl-offline-skin-instances',JSON.stringify(offlineSkinInstances));flash('皮肤已保存到实例；请确保已安装 CustomSkinLoader。');}catch(e){flash(`无法应用离线皮肤：${e}`,'error');}finally{state.accountBusy=false;render();}return;}
 if(action==='find-offline-skin-mod') {state.contentKind='mod';state.contentSource='modrinth';state.contentTarget=state.selected;state.contentQuery='CustomSkinLoader';state.contentPage=0;state.contentLoaded=false;state.contentResults=[];state.page='content';render();void searchContent(true);return;}
 if(action==='clear-skin') { state.localSkin=null;saveLocalSkin(null);render();return; }
 if(action==='clear-cape') { state.localCape=null;render();return; }
 if(action==='upload-skin' && state.localSkin && state.account) { state.accountBusy=true;render();try { await invoke('upload_account_skin',{path:state.localSkin.path,model:state.skinModel});state.localSkin=null;saveLocalSkin(null);await refreshAppearance();flash('皮肤已应用到正版账户。'); } catch(e) { flash(`应用皮肤失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 if(action==='reset-skin' && state.account) { state.accountBusy=true;render();try { await invoke('reset_account_skin');state.localSkin=null;saveLocalSkin(null);await refreshAppearance();flash('已恢复账户默认皮肤。'); } catch(e) { flash(`恢复皮肤失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 if(action==='hide-cape' && state.account) { state.accountBusy=true;render();try { await invoke('set_account_cape',{capeId:null});state.localCape=null;await refreshAppearance();flash('已隐藏账户披风。'); } catch(e) { flash(`更新披风失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 const previewCape=event.target.closest('[data-preview-cape]'); if(previewCape) { const cape=state.appearance?.capes[Number(previewCape.dataset.previewCape)];if(cape) {state.previewCapeId=cape.id;state.localCape=null;render();}return; }
 const applyCape=event.target.closest('[data-apply-cape]'); if(applyCape && state.account) { const cape=state.appearance?.capes[Number(applyCape.dataset.applyCape)];if(!cape)return;state.accountBusy=true;render();try { await invoke('set_account_cape',{capeId:cape.id});state.localCape=null;await refreshAppearance();flash('已更新账户披风。'); } catch(e) { flash(`更新披风失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 if(action==='close-instance-settings'){state.instanceSettingsView=null;renderOverlay();return;}
 if(action==='reset-instance-settings' && state.instanceSettingsView) {const view=state.instanceSettingsView,key=instanceKey(view.gameDir,view.version),previous=instanceLaunchSettings[key];delete instanceLaunchSettings[key];try{localStorage.setItem('ccl-instance-launch-settings',JSON.stringify(instanceLaunchSettings));state.instanceSettingsView=null;renderOverlay();flash('此实例已恢复使用全局设置。');}catch(e){if(previous)instanceLaunchSettings[key]=previous;flash(`无法保存实例设置：${e}`,'error');}return;}
 if(action==='check-update') {void checkLauncherUpdate(true);return;}
 if(action==='open-update') {try {await invoke('open_launcher_releases');}catch(e){flash(`无法打开下载页面：${e}`,'error');}return;}
 if(action==='dismiss-update') {state.updateDismissed=state.updateInfo?.latestVersion||'';renderChrome();return;}
 if (action === 'dismiss') { state.notice = '';state.noticeCrash=false; renderChrome(); }
 if(action==='open-crash-diagnosis' && state.crash) {state.crashDialog=state.crash;renderOverlay();}
 if(action==='close-crash-dialog') {state.crashDialog=null;renderOverlay();}
 if(action==='close-instance') {state.instanceView=null;renderOverlay();}
 if(action==='close-game-profile' && state.profileView){state.profileView.generation++;state.profileView=null;renderOverlay();}
 if(action==='close-profile-preview' && state.profileView){const d=state.profileView;d.preview=null;renderOverlay();}
 if(action==='refresh-game-profile' && state.profileView && !state.profileView.loading){const d=state.profileView;void gameProfile.loadStats(d);await loadProfileScreenshots(d);}
 if(action==='open-screenshot-folder' && state.profileView){const d=state.profileView;try{await invoke('open_screenshot_folder',{gameDir:d.gameDir,version:d.version});}catch(e){flash(`无法打开截图目录：${e}`,'error');}}

 if(action==='close-instance-theme')instanceTheme.close();
 if(action==='remove-instance-cover')instanceTheme.removeCover();
 if(action==='save-instance-theme')await instanceTheme.save(String(app.querySelector('#instance-description')?.value||''));

 if(action==='close-manage' && state.manageView && !state.manageView.busy){state.manageView=null;renderOverlay();}
 if(action==='switch-worlds' && state.manageView && !state.manageView.busy){await openManage('worlds',state.manageView.version,state.manageView.gameDir);}
 if(action==='switch-backups' && state.manageView && !state.manageView.busy){await openManage('backups',state.manageView.version,state.manageView.gameDir);}
 if(action==='refresh-manage' && state.manageView && !state.manageView.busy)await loadManage();
 if(action==='open-saves-folder' && state.manageView){const d=state.manageView;try{await invoke('open_world_folder',{gameDir:d.gameDir,version:d.version,folder:null});}catch(e){d.error=String(e);renderOverlay();}}
 if(action==='create-instance-backup')await manageOperation('create_backup',{scope:'instance',world:null},'实例备份已创建。');
 if(action==='manage-cancel' && state.manageView && !state.manageView.busy){state.manageView.confirm=null;renderOverlay();}
 if(action==='manage-confirm' && state.manageView?.confirm && !state.manageView.busy){const d=state.manageView,choice=d.confirm;if(choice.action==='restore')await manageOperation('restore_backup',{backupId:choice.item.id},'备份已恢复，恢复前的实例也已备份。');else if(d.kind==='backups')await manageOperation('delete_backup',{backupId:choice.item.id},'备份已删除。');else await manageOperation('delete_world',{folder:choice.item.folder},'存档已删除，并已创建备份。');}

 if (action === 'open-log' || action === 'open-crash-log') { const crash=state.crashDialog || state.launchView?.crash || state.crash;const version=action==='open-crash-log' ? crash?.version : state.selected; const gameDir=action==='open-crash-log' ? crash?.gameDir : state.gameDir; if(version) { try { if(action==='open-crash-log' && !crash.logName)throw new Error('无法确定本次启动的日志文件');await invoke('open_game_log',{gameDir,version,logName:action==='open-crash-log' ? crash.logName : null}); } catch(e) { flash(String(e),'error'); } } }
 if(action==='close-mod-dialog' || (action==='close-mod-backdrop' && event.target.classList.contains('install-overlay'))) { state.modDraft=null; renderOverlay(); }
 if(action==='confirm-mod-install' && state.modDraft) { const draft=state.modDraft;if(draft.installed)return;const modVersionId=app.querySelector('input[name=modVersion]:checked')?.value;if(draft.kind!=='modpack'&&!modVersionId)return;state.modDraft=null;renderOverlay();if(draft.kind==='modpack') enqueueJob({key:`modpack:${draft.source}:${draft.projectId}:${draft.gameDir}`,kind:'modpack',title:draft.title,gameDir:draft.gameDir,recipe:{type:'modpack',gameDir:draft.gameDir,source:draft.source,projectId:draft.projectId,javaPath:draft.javaPath},run:job=>invoke('install_modpack',{gameDir:draft.gameDir,source:draft.source,projectId:draft.projectId,apiKey:draft.apiKey,javaPath:draft.javaPath,jobId:job.id})});else if(draft.kind==='mod') enqueueJob({key:`mod:${draft.source}:${draft.projectId}:${draft.gameDir}:${draft.target}`,kind:'mod',title:`${draft.title} · ${draft.target}`,gameDir:draft.gameDir,version:draft.target,recipe:{type:'mod',gameDir:draft.gameDir,version:draft.target,source:draft.source,projectId:draft.projectId,modVersionId},run:job=>invoke('install_mod',{gameDir:draft.gameDir,version:draft.target,source:draft.source,projectId:draft.projectId,apiKey:draft.apiKey,modVersionId,jobId:job.id})});else {const recipe={type:'pack',kind:draft.kind,gameDir:draft.gameDir,version:draft.target,source:draft.source,projectId:draft.projectId,packVersionId:modVersionId};enqueueJob({key:`${draft.kind}:${draft.source}:${draft.projectId}:${draft.gameDir}:${draft.target}`,kind:draft.kind,title:`${draft.title} · ${draft.target}`,gameDir:draft.gameDir,version:draft.target,recipe,run:runnerFor(recipe)});} }
 if (action === 'close-install' || (action === 'close-install-backdrop' && event.target.classList.contains('install-overlay'))) { state.installDraft = null; renderOverlay(); }
 if (action === 'confirm-install' && state.installDraft) { const draft={...state.installDraft,addons:[...state.installDraft.addons]}; state.installDraft=null; renderOverlay(); queueVersion(draft); }
 if (action === 'clear-jobs') { state.jobs=state.jobs.filter(j=>!['done','failed','cancelled'].includes(j.status));saveJobs(); if (state.page==='downloads') render(); else renderChrome(); }
 if (action === 'refresh') await refresh();
 if (action === 'refresh-java') await refreshJava();
 if(action==='refresh-packs') await refreshPacks();
 if(action==='open-pack-folder' && state.contentTarget) {try{await invoke('open_pack_folder',{gameDir:state.gameDir,version:state.contentTarget,kind:state.contentKind});}catch(e){flash(`无法打开文件夹：${e}`,'error');}}
 if(action==='find-shader-support') {state.contentKind='mod';state.contentQuery=event.target.closest('[data-query]')?.dataset.query||'Iris';state.contentPage=0;state.contentLoaded=false;state.contentResults=[];packManager.invalidate();state.packDelete=null;const query=app.querySelector('#content-form [name=query]');if(query)query.value=state.contentQuery;render();await searchContent();}
 if(action==='cancel-pack-remove') {state.packDelete=null;render();}
 if(action==='confirm-pack-remove' && state.packDelete && !state.packWorking) {const item=state.packDelete;state.packDelete=null;state.packWorking=true;render();try{await invoke('remove_local_pack',item);flash('资源包已删除。');if(item.version===state.contentTarget&&item.gameDir===state.gameDir&&item.kind===state.contentKind){await refreshPacks();contentSearch.invalidate();state.contentLoaded=false;await searchContent();}}catch(e){flash(`删除失败：${e}`,'error');}finally{state.packWorking=false;if(state.page==='content')render();}}
 if(action==='check-pack-updates' && !state.packChecking && !state.packWorking && state.contentTarget) {const version=state.contentTarget,gameDir=state.gameDir,kind=state.contentKind,epoch=packManager.revision();state.contentKey=String(app.querySelector('#content-form [name=apiKey]')?.value || state.contentKey).trim();state.packChecking=true;state.packUpdates=null;renderLocalPacks();try{const result=await invoke('check_pack_updates',{gameDir,version,kind,apiKey:state.contentKey});if(epoch===packManager.revision() && version===state.contentTarget && gameDir===state.gameDir && kind===state.contentKind)state.packUpdates=result;}catch(e){flash(`检查更新失败：${e}`,'error');}finally{state.packChecking=false;renderLocalPacks();}}

 if (action === 'cancel-mod-remove') { state.modDelete = null; render(); }
 if (action === 'confirm-mod-remove') { const names=state.modDelete || [];state.modDelete=null;render();await applyModChanges('delete',names); }
 if (action === 'bulk-mod-enable' || action === 'bulk-mod-disable') await applyModChanges(action==='bulk-mod-enable'?'enable':'disable',[...state.selectedMods]);
 if(action==='check-mod-conflicts' && !state.modConflictsLoading && !state.modWorking && state.contentTarget){const version=state.contentTarget,gameDir=state.gameDir,epoch=modManager.revision();state.modConflictsLoading=true;state.modConflicts=null;renderLocalMods();try{const result=await invoke('check_mod_conflicts',{gameDir,version});if(epoch===modManager.revision() && version===state.contentTarget && gameDir===state.gameDir)state.modConflicts=result;}catch(e){flash(`排查失败：${e}`,'error');}finally{state.modConflictsLoading=false;renderLocalMods();}}
 if (action === 'check-mod-updates' && !state.modChecking && !state.modWorking && state.contentTarget) {const version=state.contentTarget,gameDir=state.gameDir,epoch=modManager.revision();state.modChecking=true;state.modUpdates=null;renderLocalMods();try {const result=await invoke('check_mod_updates',{gameDir,version});if(version===state.contentTarget && gameDir===state.gameDir && epoch===modManager.revision() && !state.modWorking)state.modUpdates=result;}catch(e){flash(`检查更新失败：${e}`,'error');}finally{state.modChecking=false;if(state.page==='content')renderLocalMods();} }
 if (action === 'bulk-mod-delete' && state.selectedMods.size && !state.modWorking) { state.modDelete=[...state.selectedMods];render(); }
 if (action === 'cancel-java-remove') { state.javaDelete = null; render(); }
 if (action === 'confirm-java-remove') { const java = state.javaRuntimes[state.javaDelete]; state.javaDelete = null; if (java?.managed) { try { await invoke('remove_java', { major: java.major }); if (state.javaPath === java.path) { state.javaPath = 'java'; persist(); } state.notice = `Java ${java.major} 已删除。`; state.noticeKind = ''; await refreshJava(); } catch (e) { flash(`删除失败：${e}`, 'error'); } } }
 if(action==='launch')await launchGame();
});
app.addEventListener('change', async event => {
 if(event.target.matches('[data-instance-cover]') && state.themeView){const file=event.target.files?.[0];if(file)await instanceTheme.chooseCover(file);return;}

 if(event.target.dataset.themeImage) {
  const kind=event.target.dataset.themeImage,file=event.target.files?.[0];event.target.value='';if(file)await appearanceController.choose(kind,file);return;
 }
 if(event.target.id==='memory-mode' || event.target.id==='instance-memory-mode' || ['overrideJava','overrideMemory','overrideArgs'].includes(event.target.name)) {syncMemoryControls();return;}
 if(event.target.id==='server-status') { state.serverStatus=event.target.value;state.serverPage=0;updateSearchResults('server');return; }
 if(event.target.id==='server-page-jump'){const max=Math.max(0,Math.ceil(filteredServers().length/40)-1),n=Number(event.target.value);if(Number.isInteger(n)){state.serverPage=Math.max(0,Math.min(max,n-1));updateSearchResults('server');}return;}
 if(event.target.id==='skin-model') { state.skinModel=event.target.value;if(state.localSkin){state.localSkin.model=state.skinModel;saveLocalSkin(state.localSkin);}render();return; }
 if(event.target.id==='job-limit') { state.jobLimit=Math.max(1,Math.min(5,Number(event.target.value)||3));persist();render();pumpJobs();return; }
 if(event.target.id==='local-mod-filter') {state.modFilter=event.target.value;renderLocalMods();return;}
 if(event.target.id==='mod-select-visible') {const matches=state.localMods.filter(m=>m.name.toLocaleLowerCase().includes(state.modQuery.trim().toLocaleLowerCase()) && (state.modFilter==='all'||m.enabled===(state.modFilter==='enabled')));for(const m of matches) event.target.checked?state.selectedMods.add(m.name):state.selectedMods.delete(m.name);renderLocalMods();return;}
 if(event.target.dataset.modSelect!==undefined) {const m=state.localMods[Number(event.target.dataset.modSelect)];if(m)event.target.checked?state.selectedMods.add(m.name):state.selectedMods.delete(m.name);renderLocalMods();return;}
 if(event.target.id==='contentTarget') { state.selectedMods.clear();modManager.invalidate();state.modUpdates=null;state.modConflicts=null;state.contentTarget=event.target.value; state.contentResults=[]; state.localMods=[];state.contentPage=0;state.contentLoaded=false;await refreshMods();await refreshPacks();await searchContent(); return; }
 if (event.target.name==='draftLoader' && state.installDraft) { state.installDraft.loader=event.target.value; state.installDraft.addons=state.installDraft.addons.filter(id=>ADDONS.find(a=>a.id===id)?.loaders.includes(state.installDraft.loader)); renderOverlay(); return; }
 if (event.target.name==='draftAddon' && state.installDraft) { const selected=state.installDraft.addons; state.installDraft.addons=event.target.checked ? [...new Set([...selected,event.target.value])] : selected.filter(x=>x!==event.target.value); return; }
 if (event.target.closest('#content-form') && ['source','kind','sort','category','loaderFilter','environment'].includes(event.target.name)) { const form=event.target.closest('form'); const data=new FormData(form);const changedSource=state.contentSource!==data.get('source'),changedKind=state.contentKind!==data.get('kind'); state.contentSource=data.get('source'); state.contentKind=data.get('kind'); state.contentSort=data.get('sort');state.contentQuery=String(data.get('query') || '').trim();state.contentKey=String(data.get('apiKey') || state.contentKey);state.contentCategory=changedSource||changedKind?'':String(data.get('category')||'');state.contentGameFilter=String(data.get('gameFilter')||state.contentGameFilter).trim();state.contentLoaderFilter=String(data.get('loaderFilter')||'');state.contentEnvironment=state.contentSource==='modrinth'?String(data.get('environment')||''):'';state.contentResults=[];state.contentPage=0;state.contentHasMore=false;state.contentLoaded=false;state.contentError='';state.packDelete=null;if(changedSource||changedKind)state.contentCategories=[];render();if(changedSource||changedKind)void loadContentCategories();await Promise.all([refreshPacks(),searchContent()]); }

});
app.addEventListener('submit', async event => { if(event.target.id==='instance-settings-form') {
 event.preventDefault();const form=event.target,view=state.instanceSettingsView;if(!view)return;
 if(view.gameDir!==state.gameDir || !state.versions.some(v=>v.id===view.version && v.installed)){flash('实例已变更或不存在，请重新打开设置。','error');return;}
 const overrideJava=form.elements.overrideJava.checked,overrideMemory=form.elements.overrideMemory.checked,overrideArgs=form.elements.overrideArgs.checked;
 const javaPath=form.elements.javaPath.value.trim(),memory=Number(form.elements.memory.value),memoryMode=form.elements.memoryMode.value==='manual'?'manual':'auto';
 if((overrideJava && !javaPath) || (overrideMemory && memoryMode==='manual' && (!Number.isInteger(memory)||memory<512||memory>32768))){flash('请填写有效的 Java 路径和内存上限。','error');return;}
 const key=instanceKey(view.gameDir,view.version),previous=instanceLaunchSettings[key];
 if(overrideJava||overrideMemory||overrideArgs)instanceLaunchSettings[key]={overrideJava,overrideMemory,overrideArgs,javaPath:javaPath||state.javaPath,memory:Number.isInteger(memory)&&memory>=512&&memory<=32768?memory:state.memory,memoryMode,optimize:form.elements.optimize.checked,jvmArgs:form.elements.jvmArgs.value,gameArgs:form.elements.gameArgs.value};else delete instanceLaunchSettings[key];
 try{localStorage.setItem('ccl-instance-launch-settings',JSON.stringify(instanceLaunchSettings));state.instanceSettingsView=null;renderOverlay();flash('实例启动设置已保存。');}catch(e){if(previous)instanceLaunchSettings[key]=previous;else delete instanceLaunchSettings[key];flash(`无法保存实例设置：${e}`,'error');}return;
} if(event.target.id==='lan-host-form') { event.preventDefault(); if(state.lanBusy||state.lanRoom) return; const port=Number(event.target.elements.lanGamePort.value); if(!Number.isInteger(port)||port<1||port>65535) { flash('请输入 1–65535 的游戏局域网端口。','error');return; } state.lanPort=String(port);state.lanBusy=true;render();try { const relayPort=await invoke('start_ipv6_room',{gamePort:port});state.lanRoom={port:relayPort};await refreshLanAddresses(); } catch(e) { flash(`创建房间失败：${e}`,'error'); } finally { state.lanBusy=false;render(); } return; } if(event.target.id==='lan-test-form') { event.preventDefault();if(state.lanBusy)return;state.lanTarget=event.target.elements.lanTarget.value.trim();state.lanTest='';state.lanBusy=true;render();try { await invoke('test_ipv6_connection',{address:state.lanTarget});state.lanTest='TCP 连接成功；游戏能否加入还取决于版本、模组和服务器状态。'; } catch(e) { state.lanTest=String(e); } finally { state.lanBusy=false;render(); } return; } if (event.target.id === 'content-form') { event.preventDefault(); const data = new FormData(event.target); state.contentSource = data.get('source'); state.contentKind = data.get('kind'); state.contentSort=data.get('sort');state.contentQuery = String(data.get('query') || '').trim(); state.contentKey = String(data.get('apiKey') || state.contentKey);state.contentCategory=String(data.get('category')||state.contentCategory);state.contentGameFilter=String(data.get('gameFilter')||'').trim();state.contentLoaderFilter=String(data.get('loaderFilter')||'');state.contentEnvironment=String(data.get('environment')||'');state.contentPage=0;state.contentHasMore=false;void loadContentCategories(); await searchContent(true); return; } if (event.target.id !== 'settings-form') return; event.preventDefault(); const data = new FormData(event.target); const proxyUrl = String(data.get('proxyUrl') || '').trim(); const changed = state.gameDir !== data.get('gameDir').trim() || state.proxyUrl !== proxyUrl; const selectedVersion=state.versions.find(v=>v.id===state.selected && v.installed),isolationControl=event.target.querySelector('#version-isolation'),isolationChanged=selectedVersion && isolationControl && !isolationControl.disabled && isolationControl.checked!==!!selectedVersion.isolated; if(isolationChanged && state.gameDir!==data.get('gameDir').trim()) {flash('请先保存游戏目录，再修改版本隔离。','error');return;} if(isolationChanged && state.jobs.some(j=>j.gameDir===state.gameDir && ['queued','running','canceling'].includes(j.status))) {flash('该游戏目录有进行中或等待中的任务，请先取消或等待结束。','error');return;} try { await invoke('configure_proxy', { proxyUrl }); } catch (e) { const input = event.target.querySelector('#proxyUrl'); input.setCustomValidity(String(e)); input.reportValidity(); return; } if(isolationChanged) { try { await invoke('set_version_isolation',{gameDir:state.gameDir,version:selectedVersion.id,isolated:isolationControl.checked});selectedVersion.isolated=isolationControl.checked;state.localMods=[];state.contentResults=[];state.contentLoaded=false;state.modUpdates=null;state.selectedMods.clear();modManager.invalidate(); } catch(e) {flash(`无法修改版本隔离：${e}`,'error');return;} } Object.assign(state, { username: data.get('username').trim(), javaPath: data.get('javaPath').trim(), proxyUrl, gameDir: data.get('gameDir').trim(), memory: Number(data.get('memory') ?? state.memory), memoryMode:data.get('memoryMode')==='auto'?'auto':'manual', optimize:data.has('optimize'), jvmArgs:String(data.get('jvmArgs')||''), gameArgs:String(data.get('gameArgs')||'') }); persist(); if(changed){state.selectedMods.clear();state.modUpdates=null;state.modConflicts=null;modManager.invalidate();} render(); flash('设置已保存。'); if (changed) await refresh(); });
const gameEvents=createGameEvents({state,render,renderOverlay,showCrash:showCrashNotice,refreshStats:gameProfile.loadStats});
const restoreAccount=createAccountRestorer({state,restore:()=>invoke('restore_microsoft_account'),restoreAvatar:restoreOnlineAvatar,refreshAppearance:()=>refreshAppearance({reuse:true}),render,persist,flash});
const launchGame=createGameLauncher({state,isOnline:usingOnlineAccount,restoreAccount:()=>restoreAccount({notify:false}),
 shouldApplySkin:(gameDir,version)=>offlineSkinInstances[instanceKey(gameDir,version)]===true,
 applySkin:(gameDir,version,username,skin)=>invoke('apply_offline_skin',{gameDir,version,username,skin}),
 settings:effectiveLaunchSettings,launch:options=>invoke('launch_game',{options}),render:renderOverlay,flash});
async function init() {
 updateDefaultBanner();
 window.setInterval(updateDefaultBanner,60*1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateDefaultBanner();});
 restoreJobs();render();
 restoreThemeImages();void restoreLocalSkin();if(usingOnlineAccount())void restoreOnlineAvatar(state.accountUuid);
 if (!isTauri()) { state.notice = '请在 Tauri 桌面应用中使用启动器。'; state.noticeKind = 'error'; render(); return; }
 try { await invoke('configure_proxy', { proxyUrl: state.proxyUrl }); if (!state.gameDir) state.gameDir = await invoke('default_game_dir'); await listen('java-progress', e => jobEvent(e.payload)); await listen('install-progress', e => jobEvent(e.payload)); await listen('game-window-ready',e=>gameEvents.windowReady(e.payload)); await listen('game-window-status',e=>gameEvents.windowStatus(e.payload)); await listen('game-exit',e=>gameEvents.exit(e.payload || {})); void checkLauncherUpdate();window.setInterval(()=>void checkLauncherUpdate(),6*60*60*1000);if(usingOnlineAccount())void restoreAccount({notify:false}); await refresh(); } catch (e) { state.accountRestoring=false;render();flash(String(e), 'error'); }
}
init();
