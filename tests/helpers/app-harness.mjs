import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as parser from '../../js/parser.js';
import * as customerImport from '../../js/customer-import.js';
import { createSaveIntents } from '../../js/save-intent.js';
import { isOpeningRecord } from '../../js/opening-stock.js';
export async function harness(overrides = {}) {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://inventory.test/', runScripts: 'outside-only' });
  const win = dom.window;
  const state = { products: [], customers: null, currentTab: 'dashboard' };
  let counter = 0;
  const products = [{id:'p1',name:'后腿卷',unit:'件',spec:''}];
  const customers = [];
  const inbound = [], outbound = [];
  const recordRows = (rows, options = {}) => rows.filter(r => (!options.from || r.recorded_at >= options.from) && (!options.to || r.recorded_at <= options.to) && (!options.customerId || r.customer_id === options.customerId)).map(r=>({...r, products:products.find(p=>p.id===r.product_id)}));
  const api = {
    fetchProducts:async()=>structuredClone(products), fetchCustomers:async()=>structuredClone(customers),
    fetchCurrentStock:async(search='')=>products.filter(p=>p.name.includes(search)).map(p=>({...p,total_inbound:inbound.filter(r=>r.product_id===p.id).reduce((s,r)=>s+r.quantity,0),total_outbound:outbound.filter(r=>r.product_id===p.id).reduce((s,r)=>s+r.quantity,0),stock_qty:inbound.filter(r=>r.product_id===p.id).reduce((s,r)=>s+r.quantity,0)-outbound.filter(r=>r.product_id===p.id).reduce((s,r)=>s+r.quantity,0)})),
    fetchProductStock:async(id)=>(await api.fetchCurrentStock()).find(p=>p.id===id),
    createProduct:async data=>{const p={...data,id:data.id||`p${++counter+1}`};products.push(p);return p;},
    updateProduct:async(id,data)=>Object.assign(products.find(p=>p.id===id),data),
    deleteProduct:async id=>{if([...inbound,...outbound].some(r=>r.product_id===id))throw Error('有流水不可删除');products.splice(products.findIndex(p=>p.id===id),1);},
    createCustomer:async data=>{const c={...data,id:`c${++counter}`};customers.push(c);return c;},
    updateCustomer:async(id,data)=>Object.assign(customers.find(c=>c.id===id),data),
    deleteCustomer:async id=>customers.splice(customers.findIndex(c=>c.id===id),1),
    createInbound:async data=>{const r={...data,id:data.id||`r${++counter}`,created_at:new Date().toISOString()};if(!inbound.some(old=>old.id===r.id))inbound.push(r);return r;},
    createOutbound:async data=>{const r={...data,id:data.id||`r${++counter}`,created_at:new Date().toISOString()};if(!outbound.some(old=>old.id===r.id))outbound.push(r);return r;},
    batchCreateInbound:async rows=>{for(const row of rows)await api.createInbound(row);},
    batchCreateOutbound:async rows=>{for(const row of rows)await api.createOutbound(row);},
    fetchInboundRecords:async options=>recordRows(inbound,options),fetchOutboundRecords:async options=>recordRows(outbound,options),
    deleteInboundRecord:async id=>inbound.splice(inbound.findIndex(r=>r.id===id),1),
    deleteOutboundRecord:async id=>outbound.splice(outbound.findIndex(r=>r.id===id),1),
    subscribeStockChanges:()=>({unsubscribe(){}}), ...overrides
  };
  Object.assign(win,{ DB:api,getState:key=>key?state[key]:state,setState:(k,v)=>state[k]=v,...parser,...customerImport,createSaveIntents,isOpeningRecord,initSync(){},getPendingCount:async()=>0,initOpeningImport(){},confirm:()=>true });
  let source = await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
  source = source.replace(/^import .*;\r?$/gm,'').replace("document.addEventListener('DOMContentLoaded', () => { initApp(); });",'');
  vm.runInContext(source,dom.getInternalVMContext());
  return {win,dom,api,state,products,customers,inbound,outbound,byId:id=>win.document.getElementById(id),close:()=>dom.window.close()};
}
