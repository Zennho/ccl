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
import { createAccountActions } from './lib/account-actions.ts';
import { createInstanceLaunchSettings } from './lib/instance-launch-settings.ts';
import { createArchiveManager } from './lib/archive-manager.ts';
import { createVersionDelete } from './lib/version-delete.ts';
import { createSkinController } from './lib/skin-controller.ts';
import { createContentInstall } from './lib/content-install.ts';
import { createGlobalSettings } from './lib/global-settings.ts';
import { createContentControls } from './lib/content-controls.ts';
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
const instanceLaunch=createInstanceLaunchSettings({state,storage:localStorage,render:renderOverlay,flash});
const getLaunchSettings=instanceLaunch.get,effectiveLaunchSettings=instanceLaunch.effective;

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
const multiplayer=createMultiplayer({state,render,flash,getAddresses:()=>invoke('ipv6_addresses'),getServers:()=>invoke('public_servers'),startRoom:gamePort=>invoke('start_ipv6_room',{gamePort}),stopRoom:()=>invoke('stop_ipv6_room'),testConnection:address=>invoke('test_ipv6_connection',{address})});
const refreshLanAddresses=multiplayer.refreshAddresses,filteredServers=multiplayer.filteredServers,refreshPublicServers=multiplayer.refreshPublicServers;
const ADDONS = [
 { id:'fabric-api', title:'Fabric API', desc:'许多 Fabric 模组的基础依赖', loaders:['fabric'] },
 { id:'sodium', title:'Sodium', desc:'改善渲染性能', loaders:['fabric','neoforge'] },
 { id:'jei', title:'Just Enough Items', desc:'查看物品与配方', loaders:['fabric','quilt','forge','neoforge'] },
 { id:'jade', title:'Jade', desc:'查看方块与实体信息', loaders:['fabric','quilt','forge','neoforge'] },
];
function renderContentPage() { if(state.page==='content' && app.querySelector('.content')) { renderer.page(ContentPage,{state},'content'); hydrateThumbnails(); } }
function renderLocalPacks() { renderContentPage(); }
const packManager=createPackManager({state,render:renderLocalPacks,renderPage:render,flash,invalidateContent:()=>contentSearch.invalidate(),search:()=>searchContent(),
 remove:draft=>invoke('remove_local_pack',draft),updates:(gameDir,version,kind,apiKey)=>invoke('check_pack_updates',{gameDir,version,kind,apiKey}),
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
 setEnabled:(gameDir,version,name,enabled)=>invoke('set_mod_enabled',{gameDir,version,name,enabled}),
 conflicts:(gameDir,version)=>invoke('check_mod_conflicts',{gameDir,version}),updates:(gameDir,version)=>invoke('check_mod_updates',{gameDir,version})});
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
 const deleteVersion=event.target.closest('[data-delete-version]');if(deleteVersion){versionDelete.open(deleteVersion.dataset.deleteVersion);return;}
 const exportButton=event.target.closest('[data-export-game]'); if(exportButton) {archiveManager.openExport(exportButton.dataset.exportGame);return;}
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
  await contentInstallManager.select(item,isDetails);return;
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
 if(action==='cancel-version-delete'){versionDelete.cancel();return;}
 if(action==='confirm-version-delete'){await versionDelete.confirm(!!app.querySelector('#delete-instance-data')?.checked);return;}
 const lanView=event.target.closest('[data-lan-view]'); if(lanView) { state.lanView=lanView.dataset.lanView;render();if(state.lanView==='servers'&&!state.serverCatalog&&!state.serverLoading) await refreshPublicServers();return; }
 const serverCopy=event.target.closest('[data-server-copy]');if(serverCopy) { const entry=filteredServers()[Number(serverCopy.dataset.serverCopy)];if(entry) { try { await copyText(entry.address);flash('服务器地址已复制，在游戏中选择“多人游戏 → 直接连接”粘贴。'); } catch(e) { flash(`复制失败：${e}`,'error'); } }return; }
 const serverPage=event.target.closest('[data-server-page]');if(serverPage) { state.serverPage=Math.max(0,Number(serverPage.dataset.serverPage));render();return; }
 const copyIpv6=event.target.closest('[data-copy-ipv6]');
 if(copyIpv6 && state.lanRoom) { const address=state.lanAddresses[Number(copyIpv6.dataset.copyIpv6)]; if(address) { try { await copyText(`[${address.address}]:${state.lanRoom.port}`); flash('房间地址已复制。'); } catch(e) { flash(`复制失败，请手动复制地址：${e}`,'error'); } } return; }
 if(action==='refresh-public-servers') { await refreshPublicServers(); return; }
 if(action==='refresh-ipv6') { await refreshLanAddresses(); return; }
 if(action==='stop-ipv6-room')await multiplayer.stop();
 if(action==='import-game'){await archiveManager.openImport();return;}
 if(action==='close-archive'||(action==='close-archive-backdrop'&&event.target.classList.contains('install-overlay'))){archiveManager.close();return;}
 if(action==='confirm-export'){await archiveManager.confirmExport(!!app.querySelector('#archive-saves')?.checked,app.querySelector('input[name=archiveFormat]:checked')?.value||'ccl');return;}
 if(action==='confirm-import'){archiveManager.confirmImport(!!app.querySelector('#archive-settings')?.checked);return;}
 if(action==='close-launch-view') { const crash=state.launchView?.crash;state.launchView=null;if(crash?.diagnosis)showCrashNotice(crash);renderOverlay();return; }
 if(action==='launch-account') {state.launchView=null;state.page='account';render();return;}
 const switchAccount=event.target.closest('[data-switch-account]');
 if(switchAccount){await accountActions.switchTo(switchAccount.dataset.switchAccount);return;}
 if(action==='begin-login'){await accountActions.begin();return;}
 if(action==='cancel-login'){await accountActions.cancel();return;}
 if(action==='retry-save-account'){await accountActions.retrySave();return;}
 if(action==='retry-account-restore'){accountActions.retryRestore();return;}
 if(action==='open-microsoft-login'){await accountActions.openBrowser();return;}
 if(action==='use-offline'||action==='continue-offline'){accountActions.useOffline();return;}
 if(action==='use-microsoft'){accountActions.useMicrosoft();return;}
 if(action==='logout-microsoft'){await accountActions.signOut();return;}
 if(action==='choose-skin'||action==='choose-cape'){await skinController.choose(action==='choose-skin'?'skin':'cape');return;}
 if(action==='apply-offline-skin'){await skinController.applyToOffline();return;}
 if(action==='find-offline-skin-mod') {state.contentKind='mod';state.contentSource='modrinth';state.contentTarget=state.selected;state.contentQuery='CustomSkinLoader';state.contentPage=0;state.contentLoaded=false;state.contentResults=[];state.page='content';render();void searchContent(true);return;}
 if(action==='clear-skin'){skinController.clearSkin();return;}
 if(action==='clear-cape'){skinController.clearCape();return;}
 if(action==='upload-skin'){await skinController.upload();return;}
 if(action==='reset-skin'){await skinController.reset();return;}
 if(action==='hide-cape'){await skinController.hideCape();return;}
 const previewCape=event.target.closest('[data-preview-cape]');if(previewCape){skinController.previewCape(Number(previewCape.dataset.previewCape));return;}
 const applyCape=event.target.closest('[data-apply-cape]');if(applyCape){await skinController.applyCape(Number(applyCape.dataset.applyCape));return;}
 if(action==='close-instance-settings'){state.instanceSettingsView=null;renderOverlay();return;}
 if(action==='reset-instance-settings'){instanceLaunch.reset();return;}
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
 if(action==='close-mod-dialog'||(action==='close-mod-backdrop'&&event.target.classList.contains('install-overlay')))contentInstallManager.close();
 if(action==='confirm-mod-install')contentInstallManager.confirm(app.querySelector('input[name=modVersion]:checked')?.value);
 if (action === 'close-install' || (action === 'close-install-backdrop' && event.target.classList.contains('install-overlay'))) { state.installDraft = null; renderOverlay(); }
 if (action === 'confirm-install' && state.installDraft) { const draft={...state.installDraft,addons:[...state.installDraft.addons]}; state.installDraft=null; renderOverlay(); queueVersion(draft); }
 if (action === 'clear-jobs') { state.jobs=state.jobs.filter(j=>!['done','failed','cancelled'].includes(j.status));saveJobs(); if (state.page==='downloads') render(); else renderChrome(); }
 if (action === 'refresh') await refresh();
 if (action === 'refresh-java') await refreshJava();
 if(action==='refresh-packs') await refreshPacks();
 if(action==='open-pack-folder' && state.contentTarget) {try{await invoke('open_pack_folder',{gameDir:state.gameDir,version:state.contentTarget,kind:state.contentKind});}catch(e){flash(`无法打开文件夹：${e}`,'error');}}
 if(action==='find-shader-support') {state.contentKind='mod';state.contentQuery=event.target.closest('[data-query]')?.dataset.query||'Iris';state.contentPage=0;state.contentLoaded=false;state.contentResults=[];packManager.invalidate();state.packDelete=null;const query=app.querySelector('#content-form [name=query]');if(query)query.value=state.contentQuery;render();await searchContent();}
 if(action==='cancel-pack-remove') {state.packDelete=null;render();}
 if(action==='confirm-pack-remove')await packManager.confirmRemove();
 if(action==='check-pack-updates'){state.contentKey=String(app.querySelector('#content-form [name=apiKey]')?.value||state.contentKey).trim();await packManager.checkUpdates();}

 if (action === 'cancel-mod-remove') { state.modDelete = null; render(); }
 if (action === 'confirm-mod-remove') { const names=state.modDelete || [];state.modDelete=null;render();await applyModChanges('delete',names); }
 if (action === 'bulk-mod-enable' || action === 'bulk-mod-disable') await applyModChanges(action==='bulk-mod-enable'?'enable':'disable',[...state.selectedMods]);
 if(action==='check-mod-conflicts')await modManager.checkConflicts();
 if(action==='check-mod-updates')await modManager.checkUpdates();
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
 if(event.target.id==='skin-model'){skinController.setModel(event.target.value);return;}
 if(event.target.id==='job-limit') { state.jobLimit=Math.max(1,Math.min(5,Number(event.target.value)||3));persist();render();pumpJobs();return; }
 if(event.target.id==='local-mod-filter') {state.modFilter=event.target.value;renderLocalMods();return;}
 if(event.target.id==='mod-select-visible') {const matches=state.localMods.filter(m=>m.name.toLocaleLowerCase().includes(state.modQuery.trim().toLocaleLowerCase()) && (state.modFilter==='all'||m.enabled===(state.modFilter==='enabled')));for(const m of matches) event.target.checked?state.selectedMods.add(m.name):state.selectedMods.delete(m.name);renderLocalMods();return;}
 if(event.target.dataset.modSelect!==undefined) {const m=state.localMods[Number(event.target.dataset.modSelect)];if(m)event.target.checked?state.selectedMods.add(m.name):state.selectedMods.delete(m.name);renderLocalMods();return;}
 if(event.target.id==='contentTarget'){await contentControls.selectTarget(event.target.value);return;}
 if (event.target.name==='draftLoader' && state.installDraft) { state.installDraft.loader=event.target.value; state.installDraft.addons=state.installDraft.addons.filter(id=>ADDONS.find(a=>a.id===id)?.loaders.includes(state.installDraft.loader)); renderOverlay(); return; }
 if (event.target.name==='draftAddon' && state.installDraft) { const selected=state.installDraft.addons; state.installDraft.addons=event.target.checked ? [...new Set([...selected,event.target.value])] : selected.filter(x=>x!==event.target.value); return; }
 if(event.target.closest('#content-form')&&['source','kind','sort','category','loaderFilter','environment'].includes(event.target.name))await contentControls.changeFilters(event.target.closest('form'));

});
app.addEventListener('submit', async event => { if(event.target.id==='instance-settings-form') {event.preventDefault();instanceLaunch.save(event.target);return;
} if(event.target.id==='lan-host-form'){event.preventDefault();await multiplayer.host(Number(event.target.elements.lanGamePort.value));return;} if(event.target.id==='lan-test-form'){event.preventDefault();await multiplayer.test(event.target.elements.lanTarget.value);return;} if(event.target.id==='content-form'){event.preventDefault();await contentControls.submit(event.target);return;} if(event.target.id==='settings-form'){event.preventDefault();await globalSettings.save(event.target);} });
const contentControls=createContentControls({state,render,invalidateMods:modManager.invalidate,refreshMods,refreshPacks,loadCategories:loadContentCategories,search:searchContent});
const globalSettings=createGlobalSettings({state,render,persist,flash,invalidateMods:modManager.invalidate,refresh,
 configureProxy:proxyUrl=>invoke('configure_proxy',{proxyUrl}),setIsolation:(gameDir,version,isolated)=>invoke('set_version_isolation',{gameDir,version,isolated})});
const gameEvents=createGameEvents({state,render,renderOverlay,showCrash:showCrashNotice,refreshStats:gameProfile.loadStats});
const restoreAccount=createAccountRestorer({state,restore:()=>invoke('restore_microsoft_account'),restoreAvatar:restoreOnlineAvatar,refreshAppearance:()=>refreshAppearance({reuse:true}),render,persist,flash});
const accountActions=createAccountActions({state,render,persist,flash,restore:restoreAccount,restoreAvatar:restoreOnlineAvatar,cacheAvatar:cacheOnlineAvatar,refreshAppearance,refreshAccounts:refreshAccountList,
 switchAccount:uuid=>invoke('switch_microsoft_account',{uuid}),beginLogin:()=>invoke('begin_microsoft_login'),completeLogin:()=>invoke('complete_microsoft_login'),cancelLogin:()=>invoke('cancel_microsoft_login'),remember:()=>invoke('remember_microsoft_account'),openLogin:()=>invoke('open_microsoft_login'),logout:()=>invoke('logout_microsoft')});
const skinController=createSkinController({state,storage:localStorage,isOnline:usingOnlineAccount,render,flash,saveSkin:saveLocalSkin,refreshAppearance,
 chooseFile:()=>openDialog({multiple:false,directory:false,filters:[{name:'PNG 图片',extensions:['png']}]}),
 previewTexture:(path,kind)=>invoke('preview_texture',{path,kind}),applyOffline:(gameDir,version,username,skin)=>invoke('apply_offline_skin',{gameDir,version,username,skin}),
 uploadSkin:(path,model)=>invoke('upload_account_skin',{path,model}),resetSkin:()=>invoke('reset_account_skin'),setCape:capeId=>invoke('set_account_cape',{capeId})});
const launchGame=createGameLauncher({state,isOnline:usingOnlineAccount,restoreAccount:()=>restoreAccount({notify:false}),
 shouldApplySkin:skinController.shouldApply,
 applySkin:(gameDir,version,username,skin)=>invoke('apply_offline_skin',{gameDir,version,username,skin}),
 settings:effectiveLaunchSettings,launch:options=>invoke('launch_game',{options}),render:renderOverlay,flash});
const versionDelete=createVersionDelete({state,render,persist,flash,refreshInstalled,remove:(gameDir,version,removeInstance)=>invoke('delete_version',{gameDir,version,removeInstance})});
const contentInstallManager=createContentInstall({state,render:renderOverlay,enqueue:enqueueJob,runnerFor,openDetails:contentDetail.open,
 installModpack:args=>invoke('install_modpack',args),installMod:args=>invoke('install_mod',args)});
const archiveManager=createArchiveManager({state,render:renderOverlay,persist,flash,enqueue:enqueueJob,
 chooseImport:()=>openDialog({multiple:false,directory:false,filters:[{name:'CCL 或 PCL 兼容整合包',extensions:['zip','mrpack']}]}),
 chooseExport:(version,format)=>saveDialog({defaultPath:`CCL-${version}.${format==='pcl'?'mrpack':'zip'}`,filters:[{name:format==='pcl'?'PCL 兼容整合包':'CCL 游戏导出包',extensions:[format==='pcl'?'mrpack':'zip']}]}),
 inspect:path=>invoke('inspect_game_archive',{path}),exportGame:args=>invoke('export_game',args),importGame:args=>invoke('import_game',args)});
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
