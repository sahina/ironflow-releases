import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IronflowError } from '@ironflow/node';
import { jsonStore } from '../src/store.js';

test('raw SDK string puts round-trip exact cursors and projection failure identity as JSON strings',async()=>{
  const raw=new Map<string,string>();
  const store=jsonStore({getJSON:async key=>{if(!raw.has(key))throw new IronflowError('missing',{status:404});return {value:JSON.parse(raw.get(key)!),key,revision:1,created_at:'',operation:'put'};},put:async(key,value)=>{raw.set(key,typeof value==='string'?value:JSON.stringify(value));return {revision:1};}});
  for(const value of ['9007199254740993','["broken",4]',true,{runs:false,projections:true}]) {
    await store.put('key',value);assert.deepEqual(await store.get('key'),value);
  }
  assert.equal(await store.get('missing'),undefined);
});
test('KV errors other than missing keys are not converted into empty dedupe state',async()=>{
  const store=jsonStore({getJSON:async()=>{throw new IronflowError('forbidden',{status:403});},put:async()=>({revision:1})});
  await assert.rejects(store.get('cursor'),/forbidden/);
});
