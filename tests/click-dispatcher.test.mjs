import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installClickDispatcher} from '../src/app/click-dispatcher.ts';

test('dispatches SVG clicks synchronously and stops at the first matching handler',()=>{
 const dom=new JSDOM('<div id="app"><button><svg><path/></svg></button></div>');
 const previous=globalThis.Element;globalThis.Element=dom.window.Element;
 try{
  const container=dom.window.document.querySelector('#app'),calls=[];
  installClickDispatcher({container,beforeDispatch:()=>calls.push('before'),onError:error=>{throw error;},handlers:[()=>{calls.push('skip');return false;},target=>{assert.equal(target.tagName,'path');calls.push('handled');return true;},()=>{calls.push('unexpected');return true;}]});
  container.querySelector('path').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
  assert.deepEqual(calls,['before','skip','handled']);
 }finally{globalThis.Element=previous;dom.window.close();}
});

test('reports asynchronous handler failures',async()=>{
 const dom=new JSDOM('<div id="app"><button>go</button></div>');
 const previous=globalThis.Element;globalThis.Element=dom.window.Element;
 try{
  const container=dom.window.document.querySelector('#app');let reject;
  const reported=new Promise(resolve=>{reject=resolve;});
  installClickDispatcher({container,beforeDispatch(){},onError:reject,handlers:[()=>Promise.reject(new Error('offline'))]});
  container.querySelector('button').click();
  assert.match(String(await reported),/offline/);
 }finally{globalThis.Element=previous;dom.window.close();}
});
