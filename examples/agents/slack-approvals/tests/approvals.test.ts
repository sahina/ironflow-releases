import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ApprovalInbox, DecisionConflictError, pendingGate, parseDecision, verifySlack, parseSlackAction, localRequestAllowed, FUNCTION_ID, GATE_EVENT } from '../src/approvals.js';
const run = { id:'r1', functionId:FUNCTION_ID, status:'waiting' };
const step = { runId:'r1', stepId:`r1:approve.${GATE_EVENT}:0`, status:'waiting', stepType:'wait_for_event', waitEventName:GATE_EVENT, input:{ title:'Deploy the demo' } };

test('discovers the gate from direct step input and rejects other functions, events, and states', () => {
  assert.equal(pendingGate(run,[step])?.title,'Deploy the demo');
  for(const other of [{...run,functionId:'someone-else'},{...run,status:'completed'}]) assert.equal(pendingGate(other,[step]),undefined);
  for(const other of [{...step,waitEventName:'arbitrary'},{...step,status:'completed'},{...step,input:{payload:{title:'wrong shape'}}},{...step,runId:'other'}]) assert.equal(pendingGate(run,[other]),undefined);
});
test('decision parser rejects malformed booleans, ids, extra event names, and missing step identity', () => {
  assert.deepEqual(parseDecision({runId:'r1',stepId:step.stepId,approved:false}),{runId:'r1',stepId:step.stepId,approved:false});
  for(const bad of [null,{}, {runId:'r1',approved:'true'}, {runId:'r1',stepId:step.stepId,approved:true,event:'other'}, {runId:'../r',stepId:step.stepId,approved:true}]) assert.throws(()=>parseDecision(bad));
});
test('approves and rejects only the current pending gate; duplicate input emits once', async () => {
  for(const approved of [true,false]) {
    const emissions: unknown[][]=[];
    const client={ getRun:async()=>run, getRunSteps:async()=>({steps:[step]}), emit:async(...args: unknown[])=>{emissions.push(args);return {eventId:'e1'};}, getEvent:async()=>({name:GATE_EVENT,data:emissions[0][1]}) };
    const inbox=new ApprovalInbox(client);
    const decision={runId:'r1',stepId:step.stepId,approved};
    assert.equal(await inbox.decide(decision,'local'),'accepted');
    assert.equal(await inbox.decide(decision,'local'),'duplicate');
    assert.equal(emissions.length,1); assert.equal(emissions[0][0],GATE_EVENT);
    assert.deepEqual(emissions[0][1],{runId:'r1',approved,approver:'local'});
    await assert.rejects(new ApprovalInbox({...client,getRun:async()=>({...run,functionId:'other'})}).decide(decision,'local'),/pending/);
  }
});
test('failed emit remains retryable and overlapping opposite decisions cannot race', async () => {
  let fail=true; let calls=0; let persisted:unknown;
  const inbox=new ApprovalInbox({getRun:async()=>run,getRunSteps:async()=>({steps:[step]}),emit:async(_event,data)=>{calls++;if(fail)throw Error('offline');persisted=data;return {eventId:'e1'};},getEvent:async()=>({name:GATE_EVENT,data:persisted})});
  const d={runId:'r1',stepId:step.stepId,approved:true};
  await assert.rejects(inbox.decide(d,'local'),/offline/); fail=false;
  const result=await Promise.allSettled([inbox.decide(d,'local'),inbox.decide({...d,approved:false},'local')]);
  assert.equal(result[0].status,'fulfilled'); assert.equal(result[1].status,'rejected'); assert.equal(calls,2);
});
test('response loss and inbox restart cannot acknowledge an opposite persisted decision', async () => {
  for (const approved of [true, false]) {
    let persisted: unknown;
    const client = {
      getRun: async () => run,
      getRunSteps: async () => ({steps: [step]}),
      emit: async (_name: string, data: unknown) => {
        if (!persisted) {
          persisted = data;
          throw Error('Response lost after commit');
        }
        return {eventId: 'original-event'};
      },
      getEvent: async () => ({name: GATE_EVENT, data: persisted}),
    };
    const inbox = new ApprovalInbox(client);
    const decision = {runId: 'r1', stepId: step.stepId, approved};
    await assert.rejects(inbox.decide(decision, 'local'), /Response lost/);
    await assert.rejects(inbox.decide({...decision, approved: !approved}, 'local'), DecisionConflictError);
    assert.equal(await inbox.decide(decision, 'local'), 'duplicate');
    await assert.rejects(new ApprovalInbox(client).decide({...decision, approved: !approved}, 'local'), DecisionConflictError);
    assert.deepEqual(persisted, {runId: 'r1', approved, approver: 'local'});
  }
});
test('unreadable or malformed persisted decisions never acknowledge success', async () => {
  for (const stored of [null, {name: 'other', data: {runId: 'r1', approved: true}}, {name: GATE_EVENT, data: {runId: 'other', approved: true}}, {name: GATE_EVENT, data: {runId: 'r1', approved: 'true'}}]) {
    const client = {
      getRun: async () => run,
      getRunSteps: async () => ({steps: [step]}),
      emit: async () => ({eventId: 'original-event'}),
      getEvent: async () => { if (stored === null) throw Error('Event read failed'); return stored; },
    };
    await assert.rejects(new ApprovalInbox(client).decide({runId: 'r1', stepId: step.stepId, approved: true}, 'local'), /Event read failed|Invalid stored approval/);
  }
});
test('Slack signs raw form body, rejects tampering, stale/future timestamps and malformed signatures', () => {
  const body=Buffer.from('payload=%7B%7D'); const now=1700000000; const timestamp=String(now);
  const signature='v0='+createHmac('sha256','secret').update(`v0:${timestamp}:`).update(body).digest('hex');
  assert.equal(verifySlack(body,timestamp,signature,'secret',now),true);
  for(const [b,t,s] of [[Buffer.from('payload={}'),timestamp,signature],[body,String(now-301),signature],[body,String(now+301),signature],[body,timestamp,'v0=bad'],[body,'1e9',signature]] as const) assert.equal(verifySlack(b,t,s,'secret',now),false);
});
test('Slack action uses configured channel and a single allowlisted action', () => {
  const payload={type:'block_actions',channel:{id:'C1'},user:{id:'U1'},actions:[{action_id:'approval.approve',value:JSON.stringify({runId:'r1',stepId:step.stepId,approved:true})}]};
  const body=Buffer.from(new URLSearchParams({payload:JSON.stringify(payload)}).toString());
  assert.equal(parseSlackAction(body,'C1').actor,'slack:U1');
  assert.throws(()=>parseSlackAction(body,'C2'));
  assert.throws(()=>parseSlackAction(Buffer.from('payload=bad'),'C1'));
});
test('local mutation requires local host, origin, JSON and session token and is disabled in Slack mode', () => {
  const h={host:'127.0.0.1:9138',origin:'http://127.0.0.1:9138','content-type':'application/json','x-approval-token':'secret'};
  assert.equal(localRequestAllowed(h,'secret',9138,false),true);
  for(const changed of [{origin:'https://evil.test'},{host:'evil.test:9138'},{'content-type':'text/plain'},{'x-approval-token':'wrong'}]) assert.equal(localRequestAllowed({...h,...changed},'secret',9138,false),false);
  assert.equal(localRequestAllowed(h,'secret',9138,true),false);
});
