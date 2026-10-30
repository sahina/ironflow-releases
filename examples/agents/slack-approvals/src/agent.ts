import { agent } from '@ironflow/node/agent';
import { NonRetryableError } from '@ironflow/node';
import { FUNCTION_ID, GATE_EVENT, TRIGGER_EVENT } from './approvals.js';

export const approvalsAgent=agent({
  id:FUNCTION_ID,
  description:'A deterministic draft waits for a human decision through Slack or local buttons.',
  triggers:[{event:TRIGGER_EVENT}], recording:true,
}, async ({event,approve,step}) => {
  const title=(event.data as {title?:unknown})?.title;
  if (typeof title !== 'string' || !title.trim() || title.length > 500) throw new NonRetryableError('title must contain 1–500 characters');
  const draft=await step.run('prepare-draft',async()=>({title,summary:`Proposed action: ${title}`}));
  const decision=await approve(GATE_EVENT,{ttl:'24h',payload:draft});
  return {title,approved:decision.approved,action:decision.approved ? 'simulated action accepted' : 'skipped'};
});
