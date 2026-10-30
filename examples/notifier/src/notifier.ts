import { createHash } from 'node:crypto';

export interface Store {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}
interface Frame {
  topic: string;
  data: unknown;
  meta?: { sequence?: number; sequenceExact?: string };
}
export const DEFAULT_RULES = { runs: true, projections: true };
const key = (value: string) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

export class Notifier {
  // A live KV outage should retry the checkpoint without repeating a successful delivery.
  private pendingCheckpoints = new Set<string>();
  constructor(private store: Store, private send: (text: string) => Promise<void>) {}

  async cursor(stream: string): Promise<string> {
    const cursor = await this.store.get(`cursor.${stream}`) ?? '0';
    if (typeof cursor !== 'string' || !/^\d+$/.test(cursor)) throw Error('Invalid stored sequence cursor');
    return cursor;
  }

  async process(stream: string, frame: Frame): Promise<void> {
    const sequence = frame.meta?.sequenceExact ?? frame.meta?.sequence?.toString();
    if (!sequence || !/^\d+$/.test(sequence)) throw Error('Subscription frame is missing a valid sequence');
    if (BigInt(sequence) <= BigInt(await this.cursor(stream))) return;
    const rules = record(await this.store.get('rules') ?? DEFAULT_RULES);
    if (typeof rules.runs !== 'boolean' || typeof rules.projections !== 'boolean') throw Error('Invalid notifier rules: expected runs/projections booleans');
    const data = record(frame.data);
    if (/^system\.run\.[^.]+\.failed$/.test(frame.topic) && data.status === 'failed' && rules.runs) {
      const identity = key(JSON.stringify([data.id, data.attempt, data.updatedAt]));
      if (!await this.store.get(`sent.${identity}`)) {
        if (!this.pendingCheckpoints.has(identity)) {
          await this.send(`Run failed: ${data.functionId} run=${data.id} attempt=${data.attempt}\n${JSON.stringify(data.error ?? '')}`);
          this.pendingCheckpoints.add(identity);
        }
        await this.store.put(`sent.${identity}`, true);
      }
      this.pendingCheckpoints.delete(identity);
    }
    if (frame.topic.startsWith('system.projection_health.')) {
      const healthKey = `health.${key(frame.topic)}`;
      const previous = await this.store.get(healthKey);
      // Health timestamps change on every snapshot; cursor + error describe the ongoing failure.
      const failure = data.status === 'error' ? JSON.stringify([data.error_message, data.last_event_seq]) : null;
      if (failure && failure !== previous && rules.projections && !this.pendingCheckpoints.has(healthKey)) {
        await this.send(`Projection failed: ${data.name}\n${String(data.error_message ?? '')}`);
        this.pendingCheckpoints.add(healthKey);
      }
      await this.store.put(healthKey, failure);
      this.pendingCheckpoints.delete(healthKey);
    }
    await this.store.put(`cursor.${stream}`, sequence);
  }
}
