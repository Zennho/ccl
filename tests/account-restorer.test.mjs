import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountRestorer} from '../src/lib/account-restore.ts';

test('canceling an account restore permits a new attempt and ignores the old result',async()=>{
 let resolveFirst,resolveSecond,calls=0;
 const state={restoreAttempt:null,accountRestoring:false,accountRestoreError:'',account:null,accountKnown:true,accountName:'',accountUuid:'',accountMode:'offline',accountPreference:'microsoft',loginAttempt:null,appearance:null};
 const restore=createAccountRestorer({state,restore:()=>new Promise(resolve=>{if(++calls===1)resolveFirst=resolve;else resolveSecond=resolve;}),restoreAvatar:async()=>{},refreshAppearance:async()=>{},render(){},persist(){},flash(){}});
 const old=restore();restore.cancel();const current=restore();
 assert.equal(calls,2);resolveFirst({uuid:'old',name:'Old'});await old;assert.equal(state.account,null);assert.equal(state.accountRestoring,true);
 resolveSecond({uuid:'new',name:'New'});await current;assert.equal(state.account.uuid,'new');assert.equal(state.accountRestoring,false);
});
