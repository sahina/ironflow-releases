import { createClient, createFunction, createWorker, getServerUrl, NonRetryableError } from '@ironflow/node';
import { DEMO_EVENT, DEMO_FUNCTION, runFailureDemo } from '../src/demo.js';
const serverUrl=getServerUrl();
const environment=process.env.IRONFLOW_ENV;
const failure=createFunction({id:DEMO_FUNCTION,triggers:[{event:DEMO_EVENT}],recording:true},async()=>{throw new NonRetryableError('Intentional notifier example failure');});
const worker=createWorker({serverUrl,environment,functions:[failure]});
const client=createClient({serverUrl,environment,timeout:1000,retry:{maxAttempts:1}});
console.log(`Notifier demo worker starting (pid ${process.pid}); waiting for registration`);
console.log(`Failed demo run: ${await runFailureDemo(worker,client)}`);
