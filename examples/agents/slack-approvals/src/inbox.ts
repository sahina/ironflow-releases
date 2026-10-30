import type { IronflowClient } from '@ironflow/node';
import { FUNCTION_ID, pendingGate, type Gate } from './approvals.js';

export async function listPending(client: Pick<IronflowClient,'listRuns'|'getRunSteps'>): Promise<Gate[]> {
  const gates:Gate[]=[];
  let cursor: string | undefined;
  do {
    const page=await client.listRuns({functionId:FUNCTION_ID,status:'waiting',limit:100,cursor});
    for(const run of page.runs) {
      const {steps}=await client.getRunSteps(run.id);
      const gate=pendingGate(run,steps);
      if(gate) gates.push(gate);
    }
    cursor=page.nextCursor;
  } while(cursor);
  return gates;
}

export async function postSlack(gate:Gate,token:string,channel:string): Promise<void> {
  // audit-ignore: side-effect-outside-step — the inbox is a standalone adapter, not a durable handler.
  const response=await fetch('https://slack.com/api/chat.postMessage',{
    method:'POST', headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify({channel,text:`Approval requested: ${gate.title}`,blocks:[
      {type:'section',text:{type:'plain_text',text:`${gate.title}\nRun: ${gate.runId}`}},
      {type:'actions',elements:[true,false].map(approved=>({type:'button',action_id:approved?'approval.approve':'approval.reject',text:{type:'plain_text',text:approved?'Approve':'Reject'},value:JSON.stringify({runId:gate.runId,stepId:gate.stepId,approved})}))},
    ]}),signal:AbortSignal.timeout(10_000),redirect:'error',
  });
  const result=await response.json() as {ok?:boolean;error?:string};
  if(!response.ok || !result.ok) throw Error(`Slack message failed (${response.status}, ${result.error ?? 'unknown error'})`);
}
