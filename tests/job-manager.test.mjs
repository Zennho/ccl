import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobManager } from '../src/job-manager.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(invoke = async () => {}, onJobFinished = async () => {}) {
  const entries = new Map();
  const storage = {getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value)};
  const state = {jobs: [], jobLimit: 2, page: 'home', javaPath: 'java', contentKey: ''};
  const manager = createJobManager({
    state, storage, invoke, app: {querySelector: () => null},
    persist() {}, esc: String, icon: () => '', hydrateIcons() {}, renderChrome() {},
    flash() {}, render() {}, refreshInstalled: async () => {}, onJobFinished,
  });
  return {manager, state, storage};
}

test('respects concurrency and never starts a canceled queued task', async () => {
  const releases = [];
  const calls = [];
  const {manager, state} = setup(async (name, args) => { calls.push([name, args]); });
  const task = key => ({key, kind: 'game', title: key, run: () => new Promise(resolve => releases.push(resolve))});
  manager.enqueueJob(task('a')); manager.enqueueJob(task('b')); manager.enqueueJob(task('c'));
  await tick();
  assert.equal(releases.length, 2);
  assert.equal(state.jobs[2].status, 'queued');
  await manager.requestJobCancel(state.jobs[2]);
  releases[0](); releases[1]();
  await tick(); await tick();
  assert.equal(releases.length, 2);
  assert.equal(state.jobs[2].status, 'cancelled');
  assert.equal(calls.filter(([name]) => name === 'begin_job').length, 2);
  assert.equal(calls.filter(([name]) => name === 'end_job').length, 2);
});

test('cancellation while registering prevents the task from starting', async () => {
  let finishRegistration;
  const calls = [];
  const {manager, state} = setup((name) => {
    calls.push(name);
    return name === 'begin_job' ? new Promise(resolve => { finishRegistration = resolve; }) : Promise.resolve();
  });
  let ran = false;
  manager.enqueueJob({key: 'a', kind: 'game', title: 'A', run: async () => { ran = true; }});
  await tick();
  await manager.requestJobCancel(state.jobs[0]);
  finishRegistration();
  await tick(); await tick();
  assert.equal(ran, false);
  assert.equal(state.jobs[0].status, 'cancelled');
  assert.deepEqual(calls, ['begin_job', 'cancel_job', 'end_job']);
});

test('restores interrupted tasks without automatically restarting them or saving API keys', async () => {
  const calls = [];
  const {manager, state, storage} = setup(async (name, args) => { calls.push([name, args]); });
  state.contentKey = 'secret-key';
  storage.setItem('ccl-job-history', JSON.stringify([
    {id:'old-1', key:'mod:x', kind:'mod', title:'X', status:'running', recipe:{type:'mod', source:'curseforge', gameDir:'/game', version:'v', projectId:'1', modVersionId:'2'}},
    {id:'old-2', key:'import:x', kind:'import', title:'Import', status:'queued'},
  ]));
  manager.restoreJobs();
  assert.deepEqual(state.jobs.map(job => job.status), ['failed', 'failed']);
  assert.equal(typeof state.jobs[0].run, 'function');
  assert.equal(state.jobs[1].run, null);
  assert.equal(calls.length, 0);
  manager.saveJobs();
  assert.ok(!storage.getItem('ccl-job-history').includes('secret-key'));
  await state.jobs[0].run({id:'retry-1'});
  assert.equal(calls[0][0], 'install_mod');
  assert.equal(calls[0][1].apiKey, 'secret-key');
});


test('a refresh failure does not stall the remaining queue', async () => {
  let release;
  const {manager, state} = setup(async () => {}, async () => { throw new Error('refresh failed'); });
  state.jobLimit = 1;
  let secondRan = false;
  manager.enqueueJob({key:'first',kind:'game',title:'First',run:() => new Promise(resolve => { release=resolve; })});
  manager.enqueueJob({key:'second',kind:'game',title:'Second',run:async () => { secondRan=true; }});
  await tick();
  assert.equal(secondRan, false);
  release();
  await tick(); await tick();
  assert.equal(secondRan, true);
  assert.equal(state.jobs[1].status, 'done');
});


test('resource pack downloads report byte speed with and without a known length', async () => {
 const {manager,state}=setup();let finish;
 manager.enqueueJob({key:'pack',kind:'shader',title:'Shader',run:()=>new Promise(resolve=>{finish=resolve;})});await tick();
 const job=state.jobs[0], realNow=Date.now;
 try {
  Date.now=()=>1000;manager.jobEvent({jobId:job.id,message:'正在下载资源包',current:0,total:4*1048576});
  Date.now=()=>2000;manager.jobEvent({jobId:job.id,message:'正在下载资源包',current:1048576,total:4*1048576});
  assert.match(job.metrics,/1.00 MB\/s/);assert.match(job.metrics,/预计 3 秒/);
  Date.now=()=>3000;manager.jobEvent({jobId:job.id,message:'正在下载资源包',current:1048576,total:0});
  Date.now=()=>4000;manager.jobEvent({jobId:job.id,message:'正在下载资源包',current:2*1048576,total:0});
  assert.match(job.metrics,/1.00 MB\/s/);assert.doesNotMatch(job.metrics,/预计/);
 } finally {Date.now=realNow;finish();await tick();}
});
