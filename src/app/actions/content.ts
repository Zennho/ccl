import type {invoke} from '@tauri-apps/api/core';
import type {LauncherState} from '../../lib/launcher-state';
import type {createContentInstall} from '../../lib/content-install';
import type {createModManager} from '../../lib/mod-manager';
import type {createPackManager} from '../../lib/pack-manager';
import type {ClickHandler} from './types';
interface Options {
  container:HTMLElement;state:LauncherState;invoke:typeof invoke;render:()=>void;renderOverlay:()=>void;
  flash:(message:string,kind?:string)=>void;search:(force?:boolean)=>Promise<unknown>;
  install:ReturnType<typeof createContentInstall>;mods:ReturnType<typeof createModManager>;packs:ReturnType<typeof createPackManager>;
}
export function createContentHandler({container,state,invoke,render,renderOverlay,flash,search,install,mods,packs}:Options):ClickHandler {
  return target => {
    const pageButton=target.closest<HTMLElement>('[data-content-page]');
    if(pageButton&&!state.contentBusy){const page=Number(pageButton.dataset.contentPage);if(page>=0&&page<=332&&(page<=state.contentPage||state.contentHasMore)){state.contentPage=page;return search().then(()=>{});}return true;}
    const project=target.closest<HTMLElement>('[data-open-project]');
    if(project)return (async()=>{const url=project.dataset.openProject;if(!url)return;try{await invoke('open_content_page',{url});}catch(error){flash(`无法打开项目网址：${error}`,'error');}})();
    const contentButton=target.closest<HTMLElement>('[data-content-install], [data-content-details]');
    if(contentButton&&!state.contentBusy){const details=contentButton.hasAttribute('data-content-details'),index=Number(details?contentButton.dataset.contentDetails:contentButton.dataset.contentInstall),item=state.contentResults[index];return item?install.select(item,details):true;}
    const packRemove=target.closest<HTMLElement>('[data-pack-remove]');
    if(packRemove&&!state.packWorking){const item=state.localPacks[Number(packRemove.dataset.packRemove)];if(item){state.packDelete={name:item.name,kind:state.contentKind,version:state.contentTarget,gameDir:state.gameDir};render();}return true;}
    const localDetails=target.closest<HTMLElement>('[data-local-mod-details]');
    if(localDetails){const mod=state.localMods[Number(localDetails.dataset.localModDetails)];if(mod){state.localModDetail=mod;renderOverlay();}return true;}
    const modToggle=target.closest<HTMLElement>('[data-mod-toggle]');
    if(modToggle&&!state.contentBusy&&!state.modWorking){const mod=state.localMods[Number(modToggle.dataset.modToggle)];return mod?mods.applyModChanges(mod.enabled?'disable':'enable',[mod.name]):true;}
    const modRemove=target.closest<HTMLElement>('[data-mod-remove]');
    if(modRemove&&!state.modWorking){const mod=state.localMods[Number(modRemove.dataset.modRemove)];if(mod){state.modDelete=[mod.name];render();}return true;}
    const action=target.closest<HTMLElement>('[data-action]')?.dataset.action;
    switch(action){
      case 'close-local-mod':state.localModDetail=null;renderOverlay();return true;
      case 'close-local-mod-backdrop':if(target.classList.contains('install-overlay')){state.localModDetail=null;renderOverlay();}return true;
      case 'toggle-content-language':if(state.modDraft){state.modDraft.showOriginal=!state.modDraft.showOriginal;renderOverlay();}return true;
      case 'close-mod-dialog':install.close();return true;
      case 'close-mod-backdrop':if(target.classList.contains('install-overlay'))install.close();return true;
      case 'confirm-mod-install':install.confirm(container.querySelector<HTMLInputElement>('input[name=modVersion]:checked')?.value);return true;
      case 'refresh-packs':return packs.refresh();
      case 'open-pack-folder':return (async()=>{if(!state.contentTarget)return;try{await invoke('open_pack_folder',{gameDir:state.gameDir,version:state.contentTarget,kind:state.contentKind});}catch(error){flash(`无法打开文件夹：${error}`,'error');}})();
      case 'find-shader-support':{
        state.contentKind='mod';state.contentQuery=target.closest<HTMLElement>('[data-query]')?.dataset.query||'Iris';state.contentPage=0;state.contentLoaded=false;state.contentResults=[];packs.invalidate();state.packDelete=null;
        const query=container.querySelector<HTMLInputElement>('#content-form [name=query]');if(query)query.value=state.contentQuery;render();return search().then(()=>{});
      }
      case 'cancel-pack-remove':state.packDelete=null;render();return true;
      case 'confirm-pack-remove':return packs.confirmRemove();
      case 'check-pack-updates':state.contentKey=String(container.querySelector<HTMLInputElement>('#content-form [name=apiKey]')?.value||state.contentKey).trim();return packs.checkUpdates();
      case 'cancel-mod-remove':state.modDelete=null;render();return true;
      case 'confirm-mod-remove':{const names=state.modDelete||[];state.modDelete=null;render();return mods.applyModChanges('delete',names);}
      case 'bulk-mod-enable':case 'bulk-mod-disable':return mods.applyModChanges(action==='bulk-mod-enable'?'enable':'disable',[...state.selectedMods]);
      case 'check-mod-conflicts':return mods.checkConflicts();
      case 'check-mod-updates':return mods.checkUpdates();
      case 'bulk-mod-delete':if(state.selectedMods.size&&!state.modWorking){state.modDelete=[...state.selectedMods];render();}return true;
      default:return false;
    }
  };
}
