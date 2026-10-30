import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { ApprovalInbox, DecisionConflictError, localRequestAllowed, parseDecision, parseSlackAction, verifySlack, type Gate } from './approvals.js';

export const MAX_BODY_BYTES=64*1024;
export function readBody(request:IncomingMessage):Promise<Buffer> {
  return new Promise((resolve,reject)=>{
    const chunks:Buffer[]=[]; let length=0;
    request.on('data',(chunk:Buffer)=>{
      length+=chunk.length;
      if(length>MAX_BODY_BYTES) { chunks.length=0; reject(Error('Body too large')); }
      else chunks.push(chunk);
    });
    request.on('end',()=>resolve(Buffer.concat(chunks)));
    request.on('error',reject);
    request.on('aborted',()=>reject(Error('Request aborted')));
  });
}
interface Options {
  port:number;
  inbox:ApprovalInbox;
  pending:()=>Promise<Gate[]>;
  slack?:{secret:string;channel:string};
}
export function createInboxServer(options:Options) {
  const token=randomBytes(32).toString('hex');
  return createServer(async(request,response)=>{
    response.setHeader('cache-control','no-store');
    response.setHeader('x-content-type-options','nosniff');
    response.setHeader('content-security-policy',`default-src 'none'; script-src 'nonce-${token}'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'`);
    const reply=(status:number,text:string,type='text/plain')=>{response.writeHead(status,{'content-type':type});response.end(text);};
    try {
      if(!options.slack && request.headers.host !== `127.0.0.1:${options.port}`) return reply(403,'Invalid host');
      if(request.method==='GET' && request.url==='/' && !options.slack) return reply(200,page(token),'text/html; charset=utf-8');
      if(request.method==='GET' && request.url==='/pending' && !options.slack) return reply(200,JSON.stringify(await options.pending()),'application/json');
      if(request.method!=='POST') return reply(404,'Not found');
      if(request.url==='/decision') {
        if(!localRequestAllowed(request.headers,token,options.port,!!options.slack)) return reply(403,'Local decisions disabled or invalid origin/token');
        const decision=parseDecision(JSON.parse((await readBody(request)).toString('utf8')));
        return reply(200,await options.inbox.decide(decision,'local-simulator'));
      }
      if(request.url==='/slack/actions' && options.slack) {
        if(request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return reply(415,'Expected Slack form body');
        const raw=await readBody(request);
        const timestamp=request.headers['x-slack-request-timestamp'];
        const signature=request.headers['x-slack-signature'];
        if(typeof timestamp!=='string' || typeof signature!=='string' || !verifySlack(raw,timestamp,signature,options.slack.secret)) return reply(401,'Invalid Slack signature');
        const {decision,actor}=parseSlackAction(raw,options.slack.channel);
        // ACK only after Ironflow accepts the event. Short SDK deadlines leave room for Slack's 3s limit.
        await options.inbox.decide(decision,actor);
        return reply(200,'');
      }
      return reply(404,'Not found');
    } catch(error) {
      const message=error instanceof Error ? error.message : 'Request failed';
      console.error(message);
      if (error instanceof DecisionConflictError) return reply(409, message);
      return reply(message==='Body too large'?413:503,'Decision not confirmed; refresh to see whether the gate resolved');
    }
  });
}
function page(token:string):string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Approval inbox</title>
<style>body{font:18px system-ui;max-width:760px;margin:4rem auto;padding:0 1rem;color:#18212a}article{border-top:1px solid #ccc;padding:1rem 0}button{font:inherit;margin-right:1rem;padding:.5rem 1rem}small{display:block;overflow-wrap:anywhere}#status{min-height:1.5em}</style>
<h1>Approval inbox</h1><p>Local simulation. A decision resumes this example's durable gate.</p><p id="status" role="status"></p><main id="gates"></main>
<script nonce="${token}">
const token='${token}';
const status=document.getElementById('status');
async function refresh() {
  try {
    // audit-ignore: side-effect-outside-step — browser reads the standalone inbox, not a durable handler.
    const response=await fetch('/pending');
    if(!response.ok) throw Error('Cannot load pending gates');
    const gates=await response.json();
    const main=document.getElementById('gates');
    main.replaceChildren();
    for(const gate of gates) {
      const item=document.createElement('article');
      const title=document.createElement('h2');
      title.textContent=gate.title;
      item.append(title);
      const id=document.createElement('small');
      id.textContent='Run: '+gate.runId;
      item.append(id);
      for(const approved of [true,false]) {
        const button=document.createElement('button');
        button.textContent=approved?'Approve':'Reject';
        button.onclick=async()=>{
          button.disabled=true;
          try {
            // audit-ignore: side-effect-outside-step — browser sends a decision to the standalone adapter.
            const res=await fetch('/decision',{
              method:'POST',
              headers:{'content-type':'application/json','x-approval-token':token},
              body:JSON.stringify({runId:gate.runId,stepId:gate.stepId,approved}),
            });
            if(!res.ok) throw Error(await res.text());
            status.textContent=approved?'Approved.':'Rejected.';
            await refresh();
          } catch(e) {status.textContent=e.message;button.disabled=false;}
        };
        item.append(button);
      }
      main.append(item);
    }
    if(!gates.length) main.textContent='No pending approvals. Run pnpm trigger in another terminal.';
  } catch(e) {status.textContent=e.message;}
}
refresh();setInterval(refresh,3000);
</script></html>`;
}
