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
  const state={gameDir:'/game',versions:[{id:'24w14a',kind:'快照版',installed:false},{id:'b1.7.3',kind:'旧版 Beta',installed:false}],selected:'',online:true,page:'versions',loading:false,notice:'',noticeKind:'',javaLoading:false,javaRuntimes:[]};
  const manager=createVersionManager({state,render(){},renderChrome(){},persist(){},loadCovers(){},flash(){},listVersions:async()=>[],installed:async()=>[],listJava:async()=>[]});
  await manager.refreshInstalled('/game');
  assert.deepEqual(state.versions.map(v=>v.id),['24w14a','b1.7.3']);
});
