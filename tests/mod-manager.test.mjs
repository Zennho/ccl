import test from 'node:test';
import assert from 'node:assert/strict';
import { createModManager } from '../src/lib/mod-manager.ts';

test('a stale mod-list failure cannot erase another game directory', async () => {
  let rejectOld;
  const state = {page:'content',contentTarget:'1.20.1',gameDir:'/old',localMods:[],selectedMods:new Set(),modWorking:false,modUpdates:null,modConflicts:null,contentResults:[],notice:'',noticeKind:''};
  const manager=createModManager({state,render(){},search:async()=>{},flash(){},list:()=>new Promise((_,reject)=>{rejectOld=reject;}),remove:async()=>{},setEnabled:async()=>{}});
  const request=manager.refreshMods();
  state.gameDir='/new';state.localMods=[{name:'new.jar',enabled:true}];
  rejectOld(new Error('old directory unavailable'));
  await request;
  assert.deepEqual(state.localMods,[{name:'new.jar',enabled:true}]);
  assert.equal(state.notice,'');
});
