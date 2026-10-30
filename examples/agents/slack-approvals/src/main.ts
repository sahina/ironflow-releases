import { client } from './config.js';
import { ApprovalInbox } from './approvals.js';
import { createInboxServer } from './http.js';
import { listPending, postSlack } from './inbox.js';

const token=process.env.SLACK_BOT_TOKEN;
const channel=process.env.SLACK_CHANNEL_ID;
const secret=process.env.SLACK_SIGNING_SECRET;
if([token,channel,secret].some(Boolean) && ![token,channel,secret].every(Boolean)) throw Error('Slack mode requires SLACK_BOT_TOKEN, SLACK_CHANNEL_ID and SLACK_SIGNING_SECRET together');
const slack=token && channel && secret ? {token,channel,secret} : undefined;
const port=Number(process.env.APPROVAL_PORT ?? 9138);
if(!Number.isInteger(port) || port<1 || port>65535) throw Error('APPROVAL_PORT must be a port number');
const server=createInboxServer({port,inbox:new ApprovalInbox(client),pending:()=>listPending(client),slack});
// The simulator never binds beyond loopback. Slack mode exposes only signed callbacks.
server.listen(port,slack?'0.0.0.0':'127.0.0.1',()=>console.log(slack?`Slack callback ready on :${port}/slack/actions`:`Local inbox ready: http://127.0.0.1:${port}`));
server.requestTimeout=2000;
server.headersTimeout=2000;
if(slack) {
  const posted=new Set<string>();
  const poll=async()=>{
    try {
      for(const gate of await listPending(client)) {
        if(posted.has(gate.stepId)) continue;
        await postSlack(gate,slack.token,slack.channel);
        posted.add(gate.stepId);
      }
    } catch(error) {console.error('Slack polling failed; retrying',error);}
    setTimeout(poll,2000);
  };
  void poll();
}
