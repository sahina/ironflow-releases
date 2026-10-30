import { IronflowError } from '@ironflow/node';
import { setTimeout as delay } from 'node:timers/promises';

export const DEMO_FUNCTION='react.notifier-demo';
export const DEMO_EVENT='notifier-demo.requested';
interface DemoClient {
  getFunction(id:string):Promise<unknown>;
  emit(event:string,data:unknown):Promise<{runIds:string[]}>;
  getRun(id:string):Promise<{id:string;status:string}>;
}

export async function runFailureDemo(worker:{start():Promise<void>;stop():void},client:DemoClient):Promise<string> {
  const abort=new AbortController();
  const lifetime=worker.start();
  try {
    const run=async()=>{
      for(let i=0;;i++) {
        abort.signal.throwIfAborted();
        try {await client.getFunction(DEMO_FUNCTION);break;}
        catch(error) {
          if(!(error instanceof IronflowError) || error.status!==404)throw error;
          if(i===99)throw Error('Timed out waiting for demo function registration');
          await delay(100,undefined,{signal:abort.signal});
        }
      }
      abort.signal.throwIfAborted();
      const {runIds}=await client.emit(DEMO_EVENT,{});
      if(!runIds[0])throw Error('No run created');
      for(let i=0;i<60;i++) {
        abort.signal.throwIfAborted();
        const result=await client.getRun(runIds[0]);
        if(result.status==='failed')return result.id;
        await delay(500,undefined,{signal:abort.signal});
      }
      throw Error(`Timed out waiting for demo failure: ${runIds[0]}`);
    };
    return await Promise.race([run(),lifetime.then(()=>{throw Error('Demo worker stopped before failure was observed');})]);
  } finally {
    abort.abort();
    worker.stop();
    await lifetime;
  }
}
