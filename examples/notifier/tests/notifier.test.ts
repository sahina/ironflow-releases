import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Notifier, type Store } from '../src/notifier.js';

function fixture() {
  const values = new Map<string, unknown>();
  const store: Store = { get: async k => values.get(k), put: async (k,v) => { values.set(k,v); } };
  const sent: string[] = [];
  return { values, store, sent, send: async (s: string) => { sent.push(s); } };
}
const run = (sequence: number, status = 'failed') => ({ topic: `system.run.r.${status}`, data: { id: 'r', functionId: 'broken', status, attempt: 1, updatedAt: 'now' }, meta: { sequence } });
const health = (sequence: number, status: string, error = 'broken') => ({ topic: 'system.projection_health.orders', data: { name: 'orders', status, error_message: error, last_event_seq: 4 }, meta: { sequence } });

test('filters lifecycle steps and healthy runs; checkpoints non-alert frames', async () => {
  const f = fixture(); const n = new Notifier(f.store, f.send);
  await n.process('runs', run(1,'completed'));
  await n.process('runs', { ...run(2), topic: 'system.run.r.step.s.failed' });
  assert.equal(f.sent.length,0); assert.equal(await n.cursor('runs'),'2');
});
test('replayed failure and a duplicate transition remain deduped after restart', async () => {
  const f=fixture(); await new Notifier(f.store,f.send).process('runs',run(3));
  const restarted=new Notifier(f.store,f.send);
  await restarted.process('runs',run(3)); await restarted.process('runs',run(4));
  assert.equal(f.sent.length,1); assert.equal(await restarted.cursor('runs'),'4');
});
test('failed delivery leaves cursor unchanged and can be retried', async () => {
  const f=fixture(); let fail=true;
  const n=new Notifier(f.store,async s => { if(fail) throw Error('offline'); await f.send(s); });
  await assert.rejects(n.process('runs',run(7)),/offline/);
  assert.equal(await n.cursor('runs'),'0'); fail=false;
  await n.process('runs',run(7)); assert.equal(f.sent.length,1);
});
test('successful delivery is not repeated while its KV checkpoint retries', async () => {
  for (const stream of ['runs', 'health'] as const) {
    const f = fixture();
    let failures = 2;
    const store: Store = {
      get: f.store.get,
      put: async (key, value) => {
        if (key.startsWith(stream === 'runs' ? 'sent.' : 'health.') && failures-- > 0) throw Error('KV unavailable');
        await f.store.put(key, value);
      },
    };
    const notifier = new Notifier(store, f.send);
    const frame = stream === 'runs' ? run(1) : health(1, 'error');
    await assert.rejects(notifier.process(stream, frame), /KV unavailable/);
    await assert.rejects(notifier.process(stream, frame), /KV unavailable/);
    await notifier.process(stream, frame);
    assert.equal(f.sent.length, 1, stream);
    assert.equal(await notifier.cursor(stream), '1');
  }
});
test('projection snapshots dedupe an ongoing error but alert a new failure after recovery', async () => {
  const f=fixture(); const n=new Notifier(f.store,f.send);
  await n.process('health',health(1,'error'));
  await new Notifier(f.store,f.send).process('health',health(2,'error'));
  await n.process('health',health(3,'active',''));
  await n.process('health',health(4,'error'));
  assert.equal(f.sent.length,2);
});
test('KV rules disable a delivery; exact uint64 cursor survives restart', async () => {
  const f=fixture(); f.values.set('rules',{runs:false,projections:true});
  const n=new Notifier(f.store,f.send);
  await n.process('runs',{...run(1),meta:{sequenceExact:'9007199254740993'}});
  assert.equal(f.sent.length,0); assert.equal(await n.cursor('runs'),'9007199254740993');
});
test('missing sequence or invalid rules fail closed without sending', async () => {
  const f=fixture(); const n=new Notifier(f.store,f.send);
  await assert.rejects(n.process('runs',{...run(1),meta:undefined}),/sequence/);
  f.values.set('rules',{runs:'no'});
  await assert.rejects(n.process('runs',run(1)),/rules/); assert.equal(f.sent.length,0);
});
