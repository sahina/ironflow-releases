import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export const FUNCTION_ID = 'slack-approvals-agent';
export const GATE_EVENT = 'agent.approve.slack-demo';
export const TRIGGER_EVENT = 'slack-demo.requested';
export interface Decision { runId: string; stepId: string; approved: boolean }
export interface Gate { runId: string; stepId: string; title: string }
type Run = { id: string; functionId: string; status: string };
type Step = { runId: string; stepId: string; status: string; stepType: string; waitEventName?: string; waitTimeout?: string; input?: unknown };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function pendingGate(run: Run, steps: Step[]): Gate | undefined {
  if (run.functionId !== FUNCTION_ID || run.status !== 'waiting') return;
  const step = steps.find(s => s.runId === run.id && s.status === 'waiting' && s.stepType === 'wait_for_event' && s.waitEventName === GATE_EVENT && s.stepId.includes(`:approve.${GATE_EVENT}:`));
  if (!step || (step.waitTimeout && Date.parse(step.waitTimeout) <= Date.now())) return;
  const {title} = object(step.input);
  if (typeof title !== 'string' || !title.trim() || title.length > 500) return;
  return {runId:run.id,stepId:step.stepId,title};
}

export function parseDecision(value: unknown): Decision {
  const v=object(value);
  if (Object.keys(v).sort().join(',') !== 'approved,runId,stepId' || typeof v.runId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(v.runId) || typeof v.stepId !== 'string' || v.stepId.length > 500 || typeof v.approved !== 'boolean') throw Error('Invalid decision');
  return {runId:v.runId,stepId:v.stepId,approved:v.approved};
}
interface Client {
  getRun(id:string): Promise<Run>;
  getRunSteps(id:string): Promise<{steps:Step[]}>;
  emit(event:string,data:unknown,options:{idempotencyKey:string}): Promise<{eventId:string}>;
  getEvent(id:string): Promise<{name:string;data:unknown}>;
}
export class DecisionConflictError extends Error {}
export class ApprovalInbox {
  private busy = new Set<string>();
  private decided = new Map<string, boolean>();
  constructor(private client: Client) {}
  async decide(decision: Decision, actor: string): Promise<'accepted' | 'duplicate'> {
    const key = `${decision.runId}:${decision.stepId}`;
    if (this.busy.has(key)) throw Error('Decision is in progress; retry');
    if (this.decided.has(key)) {
      if (this.decided.get(key) !== decision.approved) throw new DecisionConflictError('A different decision has already been accepted. Refresh the inbox.');
      return 'duplicate';
    }
    this.busy.add(key);
    try {
      const run = await this.client.getRun(decision.runId);
      const {steps}=await this.client.getRunSteps(decision.runId);
      const gate=pendingGate(run,steps);
      if (!gate || gate.stepId !== decision.stepId) throw Error('Gate is no longer pending');
      const {eventId} = await this.client.emit(GATE_EVENT,{runId:gate.runId,approved:decision.approved,approver:actor},{idempotencyKey:`slack-approval:${key}`});
      // An idempotent retry may return an earlier event whose response was lost.
      const event = await this.client.getEvent(eventId);
      const stored = object(event.data);
      if (event.name !== GATE_EVENT || stored.runId !== gate.runId || typeof stored.approved !== 'boolean') throw Error('Invalid stored approval decision');
      this.decided.set(key, stored.approved);
      if (stored.approved !== decision.approved) throw new DecisionConflictError('A different decision has already been accepted. Refresh the inbox.');
      return 'accepted';
    } finally { this.busy.delete(key); }
  }
}

export function verifySlack(body: Buffer, timestamp: string | undefined, signature: string | undefined, secret: string, now = Date.now()/1000): boolean {
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now-Number(timestamp)) > 300 || !signature || !/^v0=[a-f0-9]{64}$/.test(signature)) return false;
  const expected='v0='+createHmac('sha256',secret).update(`v0:${timestamp}:`).update(body).digest('hex');
  return timingSafeEqual(Buffer.from(expected),Buffer.from(signature));
}
export function parseSlackAction(body: Buffer, channel: string): {decision: Decision; actor:string} {
  const payload=object(JSON.parse(new URLSearchParams(body.toString('utf8')).get('payload') ?? 'null'));
  const actions=payload.actions;
  const user=object(payload.user).id;
  if (payload.type !== 'block_actions' || object(payload.channel).id !== channel || typeof user !== 'string' || !/^[A-Z0-9]+$/.test(user) || !Array.isArray(actions) || actions.length !== 1) throw Error('Invalid Slack action');
  const action=object(actions[0]);
  if (!['approval.approve','approval.reject'].includes(String(action.action_id)) || typeof action.value !== 'string') throw Error('Invalid Slack action');
  const decision=parseDecision(JSON.parse(action.value));
  if (decision.approved !== (action.action_id === 'approval.approve')) throw Error('Slack action and decision disagree');
  return {decision,actor:`slack:${user}`};
}
export function localRequestAllowed(headers: IncomingHttpHeaders, token:string, port:number, slackMode:boolean): boolean {
  return !slackMode && headers.host === `127.0.0.1:${port}` && headers.origin === `http://127.0.0.1:${port}` && headers['content-type'] === 'application/json' && headers['x-approval-token'] === token;
}
