import {normalizeInstanceSettings,resolveInstanceSettings} from '../react/instance-settings-model';
import {instanceKey} from './instance-theme';
import type {GameVersion,InstanceLaunchOptions,InstanceSettings,MemoryMode} from '../react/types';
interface View {gameDir:string;version:string}
interface State extends InstanceLaunchOptions {gameDir:string;versions:GameVersion[];instanceSettingsView:View|null}
interface Options {state:State;storage:Pick<Storage,'getItem'|'setItem'>;render:()=>void;flash:(message:string,kind?:string)=>void}
export function createInstanceLaunchSettings({state,storage,render,flash}:Options) {
 let entries:Record<string,unknown>={};
 try{const value=JSON.parse(storage.getItem('ccl-instance-launch-settings')||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))entries=value;}catch{}
 const get=(gameDir:string,version:string)=>normalizeInstanceSettings(entries[instanceKey(gameDir,version)]);
 const effective=(gameDir:string,version:string)=>resolveInstanceSettings(state,get(gameDir,version));
 function reset(){
  const view=state.instanceSettingsView;if(!view)return;const key=instanceKey(view.gameDir,view.version),previous=entries[key];delete entries[key];
  try{storage.setItem('ccl-instance-launch-settings',JSON.stringify(entries));state.instanceSettingsView=null;render();flash('此实例已恢复使用全局设置。');}
  catch(error){if(previous)entries[key]=previous;flash(`无法保存实例设置：${error}`,'error');}
 }
 function save(form:HTMLFormElement){
  const view=state.instanceSettingsView;if(!view)return;
  if(view.gameDir!==state.gameDir||!state.versions.some(v=>v.id===view.version&&v.installed)){flash('实例已变更或不存在，请重新打开设置。','error');return;}
  function control(name:string):HTMLInputElement|HTMLSelectElement {
   const element=form.elements.namedItem(name);if(element instanceof HTMLInputElement||element instanceof HTMLSelectElement)return element;
   throw new Error(`实例设置缺少 ${name}`);
  }
  const checked=(name:string)=>{const element=control(name);return element instanceof HTMLInputElement&&element.checked;};
  const overrideJava=checked('overrideJava'),overrideMemory=checked('overrideMemory'),overrideArgs=checked('overrideArgs');
  const javaPath=control('javaPath').value.trim(),memory=Number(control('memory').value),memoryMode:MemoryMode=control('memoryMode').value==='manual'?'manual':'auto';
  if((overrideJava&&!javaPath)||(overrideMemory&&memoryMode==='manual'&&(!Number.isInteger(memory)||memory<512||memory>32768))){flash('请填写有效的 Java 路径和内存上限。','error');return;}
  const key=instanceKey(view.gameDir,view.version),previous=entries[key];
  if(overrideJava||overrideMemory||overrideArgs){const settings:InstanceSettings={overrideJava,overrideMemory,overrideArgs,javaPath:javaPath||state.javaPath,memory:Number.isInteger(memory)&&memory>=512&&memory<=32768?memory:state.memory,memoryMode,optimize:checked('optimize'),jvmArgs:control('jvmArgs').value,gameArgs:control('gameArgs').value};entries[key]=settings;}else delete entries[key];
  try{storage.setItem('ccl-instance-launch-settings',JSON.stringify(entries));state.instanceSettingsView=null;render();flash('实例启动设置已保存。');}
  catch(error){if(previous)entries[key]=previous;else delete entries[key];flash(`无法保存实例设置：${error}`,'error');}
 }
 return {get,effective,reset,save};
}
