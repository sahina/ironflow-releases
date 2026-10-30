import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IronflowError } from '@ironflow/node';
import { runFailureDemo } from '../src/demo.js';

test('demo waits for registration while start owns worker lifetime, emits, then stops and awaits cleanup',async()=>{
  let registered=0; let emitted=false; let stopped=false; let cleaned=false;
  let release!:()=>void;
  const worker={start:()=>new Promise<void>(resolve=>{release=resolve;}).then(()=>{cleaned=true;}),stop:()=>{stopped=true;release();}};
  const runId=await runFailureDemo(worker,{
    getFunction:async()=>{if(++registered===1)throw new IronflowError('not registered',{status:404});},
    emit:async()=>{assert.equal(registered,2);emitted=true;return {runIds:['demo-run']};},
    getRun:async()=>({id:'demo-run',status:'failed'}),
  });
  assert.equal(runId,'demo-run');assert.ok(emitted && stopped && cleaned);
});
test('demo stops on worker startup rejection without emitting',async()=>{
  let stopped=false;let emitted=false;
  const failure=Error('Registration denied');
  await assert.rejects(runFailureDemo({start:async()=>{throw failure;},stop:()=>{stopped=true;}},{
    getFunction:async()=>{throw new IronflowError('not registered',{status:404});},
    emit:async()=>{emitted=true;return {runIds:[]};},getRun:async()=>({id:'',status:'failed'}),
  }),failure);
  assert.ok(stopped);assert.equal(emitted,false);
});
test('demo rejects and cleans up when worker lifetime ends before registration completes', async () => {
  let stopped = false;
  let emitted = false;
  await assert.rejects(runFailureDemo({start: async () => {}, stop: () => { stopped = true; }}, {
    getFunction: () => new Promise(() => {}),
    emit: async () => { emitted = true; return {runIds: []}; },
    getRun: async () => ({id: '', status: 'running'}),
  }), /Demo worker stopped before failure was observed/);
  assert.ok(stopped);
  assert.equal(emitted, false);
});
test('demo stops and awaits worker cleanup when registration fails for a non-404 reason',async()=>{
  let release!:()=>void;let cleaned=false;
  await assert.rejects(runFailureDemo({start:()=>new Promise<void>(resolve=>{release=resolve;}).then(()=>{cleaned=true;}),stop:()=>release()},{
    getFunction:async()=>{throw new IronflowError('Forbidden',{status:403});},
    emit:async()=>{throw Error('must not emit');},getRun:async()=>({id:'',status:'failed'}),
  }),/Forbidden/);
  assert.ok(cleaned);
});
