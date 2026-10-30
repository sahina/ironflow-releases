import { createWorker } from '@ironflow/node';
import { approvalsAgent } from './agent.js';
import { serverUrl, environment } from './config.js';

const worker=createWorker({serverUrl, environment, functions:[approvalsAgent]});
console.log(`slack-approvals worker starting (pid ${process.pid}); wait for the SDK Connected log`);
// start() owns the polling lifetime and resolves only after the worker stops.
await worker.start();
