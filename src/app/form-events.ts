import type {LauncherState} from '../lib/launcher-state';
import type {createInstanceTheme} from '../lib/instance-theme';
import type {createAppearanceController} from '../lib/appearance-controller';
import type {createSkinController} from '../lib/skin-controller';
import type {createContentControls} from '../lib/content-controls';
import type {createInstanceLaunchSettings} from '../lib/instance-launch-settings';
import type {createGlobalSettings} from '../lib/global-settings';
import type {createMultiplayer} from '../lib/multiplayer';
interface Addon {id:string;loaders:string[]}
interface Options {
 container:HTMLElement;state:LauncherState;render:()=>void;renderOverlay:()=>void;renderMods:()=>void;syncMemory:()=>void;updateSearch:(kind:'server'|'version')=>void;persist:()=>void;pumpJobs:()=>void;addons:Addon[];
 theme:ReturnType<typeof createInstanceTheme>;appearance:ReturnType<typeof createAppearanceController>;skin:ReturnType<typeof createSkinController>;content:ReturnType<typeof createContentControls>;instanceSettings:ReturnType<typeof createInstanceLaunchSettings>;settings:ReturnType<typeof createGlobalSettings>;multiplayer:ReturnType<typeof createMultiplayer>;
}
export function installFormEvents(options:Options):void {
 const {container,state,render,renderOverlay,renderMods,multiplayer}=options;
 container.addEventListener('change',async event=>{
  if(!(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement))return;
  const target=event.target;
  if(target instanceof HTMLInputElement&&target.matches('[data-instance-cover]')&&state.themeView){const file=target.files?.[0];if(file)await options.theme.chooseCover(file);return;}
  if(target instanceof HTMLInputElement&&target.dataset.themeImage){const kind=target.dataset.themeImage,file=target.files?.[0];target.value='';if(file)await options.appearance.choose(kind,file);return;}
  if(target.id==='memory-mode'||target.id==='instance-memory-mode'||['overrideJava','overrideMemory','overrideArgs'].includes(target.name)){options.syncMemory();return;}
  if(target.id==='server-status'){state.serverStatus=target.value;state.serverPage=0;options.updateSearch('server');return;}
  if(target.id==='server-page-jump'){const max=Math.max(0,Math.ceil(multiplayer.filteredServers().length/40)-1),page=Number(target.value);if(Number.isInteger(page)){state.serverPage=Math.max(0,Math.min(max,page-1));options.updateSearch('server');}return;}
  if(target.id==='skin-model'){options.skin.setModel(target.value);return;}
  if(target.id==='job-limit'){state.jobLimit=Math.max(1,Math.min(5,Number(target.value)||3));options.persist();render();options.pumpJobs();return;}
  if(target.id==='local-mod-filter'){state.modFilter=target.value;renderMods();return;}
  if(target instanceof HTMLInputElement&&target.id==='mod-select-visible'){const matches=state.localMods.filter(mod=>mod.name.toLocaleLowerCase().includes(state.modQuery.trim().toLocaleLowerCase())&&(state.modFilter==='all'||mod.enabled===(state.modFilter==='enabled')));for(const mod of matches)target.checked?state.selectedMods.add(mod.name):state.selectedMods.delete(mod.name);renderMods();return;}
  if(target instanceof HTMLInputElement&&target.dataset.modSelect!==undefined){const mod=state.localMods[Number(target.dataset.modSelect)];if(mod)target.checked?state.selectedMods.add(mod.name):state.selectedMods.delete(mod.name);renderMods();return;}
  if(target.id==='contentTarget'){await options.content.selectTarget(target.value);return;}
  if(target.name==='draftLoader'&&state.installDraft){const draft=state.installDraft;draft.loader=target.value;draft.addons=draft.addons.filter(id=>options.addons.find(addon=>addon.id===id)?.loaders.includes(draft.loader));renderOverlay();return;}
  if(target instanceof HTMLInputElement&&target.name==='draftAddon'&&state.installDraft){const selected=state.installDraft.addons;state.installDraft.addons=target.checked?[...new Set([...selected,target.value])]:selected.filter(value=>value!==target.value);return;}
  if(target.closest('#content-form')&&['source','kind','sort','category','loaderFilter','environment'].includes(target.name)){const form=target.closest('form');if(form)await options.content.changeFilters(form);}
 });
 container.addEventListener('submit',async event=>{
  if(!(event.target instanceof HTMLFormElement))return;
  const form=event.target;
  switch(form.id){
   case 'instance-settings-form':event.preventDefault();options.instanceSettings.save(form);return;
   case 'lan-host-form':event.preventDefault();await multiplayer.host(Number((form.elements.namedItem('lanGamePort') as HTMLInputElement).value));return;
   case 'lan-test-form':event.preventDefault();await multiplayer.test((form.elements.namedItem('lanTarget') as HTMLInputElement).value);return;
   case 'content-form':event.preventDefault();await options.content.submit(form);return;
   case 'settings-form':event.preventDefault();await options.settings.save(form);return;
  }
 });
}
