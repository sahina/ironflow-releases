import { createClient, createSubscriptionClient, getServerUrl, IronflowError } from '@ironflow/node';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_RULES, Notifier } from './notifier.js';
import { jsonStore } from './store.js';

const serverUrl = getServerUrl();
const client = createClient({ serverUrl, environment: process.env.IRONFLOW_ENV });
const kv = client.kv();
const bucketName = process.env.NOTIFIER_BUCKET ?? 'example-notifier';
try { await kv.createBucket({ name: bucketName }); }
catch (error) { if (!(error instanceof IronflowError) || error.status !== 409) throw error; }
const bucket = kv.bucket(bucketName);
const store=jsonStore(bucket);
try { await bucket.create('rules', DEFAULT_RULES); }
catch (error) { if (!(error instanceof IronflowError) || error.status !== 412) throw error; }
const webhook = process.env.SLACK_WEBHOOK_URL;
if (webhook && (new URL(webhook).protocol !== 'https:' || new URL(webhook).hostname !== 'hooks.slack.com')) {
  throw Error('SLACK_WEBHOOK_URL must be an https://hooks.slack.com incoming webhook');
}
const notifier = new Notifier(store, async text => {
  if (!webhook) { console.log(`[alert] ${text}`); return; }
  // audit-ignore: side-effect-outside-step — this standalone subscriber checkpoints only after delivery.
  const response = await fetch(webhook, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({text}), signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw Error(`Slack delivery failed (${response.status})`);
});
const subscriptions = createSubscriptionClient({ serverUrl, apiKey: process.env.IRONFLOW_API_KEY, environment: process.env.IRONFLOW_ENV });
await subscriptions.connect();
for (const [stream,pattern] of [['runs','system.run.>'], ['health','system.projection_health.>']] as const) {
  let queue = Promise.resolve();
  await subscriptions.subscribe(pattern, {
    startAfterSequence: BigInt(await notifier.cursor(stream)), includeMetadata: true,
    onEvent: frame => {
      // SDK callbacks are not awaited. Serialize delivery and never advance past an unsent frame.
      queue = queue.then(async () => {
        for (;;) {
          try { await notifier.process(stream, frame); return; }
          catch (error) { console.error('Notification/checkpoint failed; retrying in 2s', error); await delay(2000); }
        }
      });
    },
    onError: error => { console.error('Subscription error', error); if (!error.retrying) process.exit(1); },
    onStateChange: state => console.log(`${stream} subscription ${state}`),
  });
}
console.log(`Notifier ready (${webhook ? 'Slack' : 'console'} delivery; bucket=${bucketName})`);
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal, () => { subscriptions.close(); process.exit(0); });
