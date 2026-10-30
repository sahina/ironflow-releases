import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { createInboxServer, MAX_BODY_BYTES } from '../src/http.js';
import { ApprovalInbox, FUNCTION_ID, GATE_EVENT } from '../src/approvals.js';

// audit-ignore: side-effect-outside-step — these HTTP clients exercise the standalone adapter, not a durable handler.
const request: typeof fetch = (...args) => fetch(...args);

test('HTTP simulator enforces CSRF boundaries, escapes titles, bounds bodies, and emits from its buttons', async () => {
  const stepId=`r1:approve.${GATE_EVENT}:0`; let sent=0; let persisted:unknown;
  const opts={port:0,pending:async()=>[{runId:'r1',stepId,title:'<script>bad</script>'}],inbox:new ApprovalInbox({getRun:async()=>({id:'r1',functionId:FUNCTION_ID,status:'waiting'}),getRunSteps:async()=>({steps:[{runId:'r1',stepId,waitEventName:GATE_EVENT,status:'waiting',stepType:'wait_for_event',input:{title:'Title'}}]}),emit:async(_event,data)=>{sent++;persisted=data;return {eventId:'e1'};},getEvent:async()=>({name:GATE_EVENT,data:persisted})})};
  const server=createInboxServer(opts);server.listen(0,'127.0.0.1');await once(server,'listening');opts.port=(server.address() as {port:number}).port;
  const url=`http://127.0.0.1:${opts.port}`;
  try {
    const html=await (await request(url)).text();
    const token=html.match(/const token='([a-f0-9]+)'/)![1];
    assert.ok(html.includes('title.textContent=gate.title')); assert.ok(!html.includes('innerHTML'));
    const headers={'content-type':'application/json',origin:url,'x-approval-token':token};
    const body=JSON.stringify({runId:'r1',stepId,approved:false});
    assert.equal((await request(url+'/decision',{method:'POST',headers:{...headers,origin:'https://evil.test'},body})).status,403);
    assert.equal((await request(url+'/decision',{method:'POST',headers:{...headers,'content-type':'text/plain'},body})).status,403);
    assert.equal((await request(url+'/decision',{method:'POST',headers,body:'x'.repeat(MAX_BODY_BYTES+1)})).status,413);
    assert.equal((await request(url+'/decision',{method:'POST',headers,body})).status,200);assert.equal(sent,1);
  } finally {server.closeAllConnections();server.close();await once(server,'close');}
});
test('matching retries succeed but a stale opposite decision returns a conflict', async () => {
  for (const approved of [true, false]) {
    const stepId = `r1:approve.${GATE_EVENT}:0`;
    const emitted: unknown[] = [];
    const opts = {
      port: 0,
      pending: async () => [],
      inbox: new ApprovalInbox({
        getRun: async () => ({id: 'r1', functionId: FUNCTION_ID, status: 'waiting'}),
        getRunSteps: async () => ({steps: [{runId: 'r1', stepId, waitEventName: GATE_EVENT, status: 'waiting', stepType: 'wait_for_event', input: {title: 'Title'}}]}),
        emit: async (_event, data) => { emitted.push(data); return {eventId: 'e1'}; },
        getEvent: async () => ({name: GATE_EVENT, data: emitted[0]}),
      }),
    };
    const server = createInboxServer(opts);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    opts.port = (server.address() as {port: number}).port;
    const url = `http://127.0.0.1:${opts.port}`;
    try {
      const html = await (await request(url)).text();
      const token = html.match(/const token='([a-f0-9]+)'/)![1];
      const decide = (choice: boolean) => request(url + '/decision', {
        method: 'POST',
        headers: {'content-type': 'application/json', origin: url, 'x-approval-token': token},
        body: JSON.stringify({runId: 'r1', stepId, approved: choice}),
      });
      assert.equal((await decide(approved)).status, 200);
      assert.equal((await decide(approved)).status, 200);
      assert.equal((await decide(!approved)).status, 409);
      assert.deepEqual(emitted, [{runId: 'r1', approved, approver: 'local-simulator'}]);
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  }
});
test('Slack mode hides local UI and mutation; signed callback emits and unsigned callback fails', async () => {
  const stepId=`r1:approve.${GATE_EVENT}:0`;let sent=0;let persisted:unknown;
  const opts={port:0,slack:{secret:'secret',channel:'C1'},pending:async()=>[],inbox:new ApprovalInbox({getRun:async()=>({id:'r1',functionId:FUNCTION_ID,status:'waiting'}),getRunSteps:async()=>({steps:[{runId:'r1',stepId,waitEventName:GATE_EVENT,status:'waiting',stepType:'wait_for_event',input:{title:'Title'}}]}),emit:async(_event,data)=>{sent++;persisted=data;return {eventId:'e1'};},getEvent:async()=>({name:GATE_EVENT,data:persisted})})};
  const server=createInboxServer(opts);server.listen(0,'127.0.0.1');await once(server,'listening');opts.port=(server.address() as {port:number}).port;
  const url=`http://127.0.0.1:${opts.port}`;
  try {
    assert.equal((await request(url)).status,404);
    assert.equal((await request(url+'/decision',{method:'POST'})).status,403);
    const body=new URLSearchParams({payload:JSON.stringify({type:'block_actions',channel:{id:'C1'},user:{id:'U1'},actions:[{action_id:'approval.approve',value:JSON.stringify({runId:'r1',stepId,approved:true})}]})}).toString();
    const timestamp=String(Math.floor(Date.now()/1000));const signature='v0='+createHmac('sha256','secret').update(`v0:${timestamp}:${body}`).digest('hex');
    const headers={'content-type':'application/x-www-form-urlencoded','x-slack-request-timestamp':timestamp,'x-slack-signature':signature};
    assert.equal((await request(url+'/slack/actions',{method:'POST',headers:{...headers,'x-slack-signature':'wrong'},body})).status,401);
    assert.equal((await request(url+'/slack/actions',{method:'POST',headers,body})).status,200);assert.equal(sent,1);
  } finally {server.closeAllConnections();server.close();await once(server,'close');}
});
test('a failed stored-event read reports uncertainty after the decision was persisted', async () => {
  const stepId = `r1:approve.${GATE_EVENT}:0`;
  let persisted: unknown;
  const opts = {port: 0, pending: async () => [], inbox: new ApprovalInbox({
    getRun: async () => ({id: 'r1', functionId: FUNCTION_ID, status: 'waiting'}),
    getRunSteps: async () => ({steps: [{runId: 'r1', stepId, waitEventName: GATE_EVENT, status: 'waiting', stepType: 'wait_for_event', input: {title: 'Title'}}]}),
    emit: async (_event, data) => { persisted = data; return {eventId: 'stored-event'}; },
    getEvent: async () => { throw Error('Event read unavailable'); },
  })};
  const server = createInboxServer(opts);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  opts.port = (server.address() as {port: number}).port;
  const url = `http://127.0.0.1:${opts.port}`;
  try {
    const html = await (await request(url)).text();
    const token = html.match(/const token='([a-f0-9]+)'/)![1];
    const response = await request(url + '/decision', {
      method: 'POST', headers: {'content-type': 'application/json', origin: url, 'x-approval-token': token},
      body: JSON.stringify({runId: 'r1', stepId, approved: true}),
    });
    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'Decision not confirmed; refresh to see whether the gate resolved');
    assert.deepEqual(persisted, {runId: 'r1', approved: true, approver: 'local-simulator'});
  } finally {
    server.closeAllConnections(); server.close(); await once(server, 'close');
  }
});
