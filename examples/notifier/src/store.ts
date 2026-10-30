import { IronflowError, type KVBucketHandle } from '@ironflow/node';
import type { Store } from './notifier.js';

export function jsonStore(bucket:Pick<KVBucketHandle,'getJSON'|'put'>):Store {
  return {
    get:async key=>{
      try {return (await bucket.getJSON(key)).value;}
      catch(error) {if(error instanceof IronflowError && error.status===404)return undefined;throw error;}
    },
    // SDK string puts are raw bytes. Encode JSON explicitly so string cursors round-trip as strings.
    put:async(key,value)=>{await bucket.put(key,JSON.stringify(value));},
  };
}
