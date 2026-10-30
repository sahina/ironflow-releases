import { client } from '../src/config.js';
import { TRIGGER_EVENT } from '../src/approvals.js';
const title=process.argv.slice(2).join(' ') || 'Deploy the demo release';
if (title.length > 500) throw Error('title must be at most 500 characters');
const result=await client.emit(TRIGGER_EVENT,{title});
console.log(`eventId=${result.eventId} runId=${result.runIds[0] ?? '(worker not registered yet)'}`);
console.log('Open the inbox URL printed by pnpm start and choose Approve or Reject.');
