import { createClient } from '@ironflow/node';
const bucket=createClient({}).kv().bucket(process.env.NOTIFIER_BUCKET ?? 'example-notifier');
await bucket.put('cursor.runs',JSON.stringify('0'));
console.log('Reset run cursor. Restart the notifier to replay retained history; delivered identities remain.');
