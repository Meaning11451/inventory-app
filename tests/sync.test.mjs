import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
globalThis.indexedDB=indexedDB;
globalThis.document={getElementById:()=>null};
globalThis.window={addEventListener(){}};
const sync=await import('../js/sync.js');
test('failed pending operations stay queued and recover when the network returns',async()=>{
 await sync.addToQueue('createInbound',{quantity:3});
 const result=await sync.processQueue({createInbound:async()=>{throw Error('offline');}});
 assert.equal(result.fail,1);assert.equal(await sync.getPendingCount(),1);
 await sync.processQueue({createInbound:async()=>{}});assert.equal(await sync.getPendingCount(),0);
});
test('an unknown queued operation must not be silently discarded',async()=>{
 await sync.addToQueue('futureType',{quantity:2});
 const result=await sync.processQueue({});assert.equal(result.fail,1);assert.equal(await sync.getPendingCount(),1);
 await sync.processQueue({futureType:async()=>{}});
});
test('overlapping reconnect events share one queue drain',async()=>{
 await sync.addToQueue('createOutbound',{quantity:1});let writes=0;
 const executors={createOutbound:async()=>{writes++;await new Promise(resolve=>setTimeout(resolve,10));}};
 await Promise.all([sync.processQueue(executors),sync.processQueue(executors)]);assert.equal(writes,1);assert.equal(await sync.getPendingCount(),0);
});
