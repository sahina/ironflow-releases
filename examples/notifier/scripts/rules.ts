import { createClient } from '@ironflow/node';
const [runs,projections]=process.argv.slice(2);
if(!['true','false'].includes(runs) || !['true','false'].includes(projections)) throw Error('Usage: pnpm rules <runs:true|false> <projections:true|false>');
await createClient({}).kv().bucket(process.env.NOTIFIER_BUCKET ?? 'example-notifier').put('rules',{runs:runs==='true',projections:projections==='true'});
console.log('Rules saved. They apply to subsequent frames.');
