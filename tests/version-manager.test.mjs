import test from 'node:test';
import assert from 'node:assert/strict';
import {createVersionManager} from '../src/lib/version-manager.ts';

test('ignores an installed-version response for an old game directory',async()=>{
 let resolveOld;
 const state={gameDir:'/old',versions:[],selected:'',online:false,page:'versions',loading:false,notice:'',noticeKind:'',javaLoading:false,javaRuntimes:[]};
 const manager=createVersionManager({state,render(){},renderChrome(){},persist(){},loadCovers(){},flash(){},listVersions:async()=>[],installed:()=>new Promise(resolve=>{resolveOld=resolve;}),listJava:async()=>[]});
 const pending=manager.refreshInstalled('/old');
 state.gameDir='/new';state.versions=[{id:'new',kind:'Fabric',installed:true}];state.selected='new';
 resolveOld([{id:'old',kind:'Fabric',installed:true}]);await pending;
 assert.equal(state.selected,'new');assert.equal(state.versions[0].id,'new');
});


test('refreshing installed versions preserves available snapshots and legacy releases', async () => {
  const state={gameDir:'/game',versions:[{id:'24w14a',kind:'快照版',official:true,installed:false},{id:'b1.7.3',kind:'旧版 Beta',official:true,installed:false}],selected:'',online:true,page:'versions',loading:false,notice:'',noticeKind:'',javaLoading:false,javaRuntimes:[]};
  const manager=createVersionManager({state,render(){},renderChrome(){},persist(){},loadCovers(){},flash(){},listVersions:async()=>[],installed:async()=>[],listJava:async()=>[]});
  await manager.refreshInstalled('/game');
  assert.deepEqual(state.versions.map(v=>v.id),['24w14a','b1.7.3']);
});


test('refresh keeps official catalog entries while removing deleted local-only versions', async () => {
 const official={id:'1.20.1',kind:'正式版',official:true,installed:true};
 const custom={id:'local-custom',kind:'正式版',official:false,installed:true};
 const state={gameDir:'/game',versions:[official,custom],selected:'1.20.1',online:true,page:'versions',loading:false,notice:'',noticeKind:'',javaLoading:false,javaRuntimes:[]};
 const manager=createVersionManager({state,render(){},renderChrome(){},persist(){},loadCovers(){},flash(){},listVersions:async()=>[],installed:async()=>[],listJava:async()=>[]});
 await manager.refreshInstalled('/game');
 assert.equal(state.versions.length,1);assert.equal(state.versions[0].id,'1.20.1');assert.equal(state.versions[0].official,true);assert.equal(state.versions[0].installed,false);
});
