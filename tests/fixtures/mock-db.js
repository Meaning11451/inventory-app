// Synthetic browser-test database. Production imports js/supabase.js instead.
import { OPENING_NOTE } from '../../js/opening-stock.js';
const date = new Date().toLocaleDateString('en-CA');
const products = [
  { id: 'plain', name: '后腿卷', unit: '件', spec: '' },
  { id: 'one', name: '合胜源一号', unit: '件', spec: '' },
  { id: 'brick', name: '合胜源后腿砖', unit: '件', spec: '' }
];
const baseline = new Set(products.map(product => product.id));
const customers = [{ id: 'c1', name: '小寨，田志强', phone: '', note: '' }, { id: 'c2', name: '济南，武', phone: '', note: '' }];
const inbound = [], outbound = [];
const state = { products, customers, inbound, outbound, attempts: 0, failNext: false };
window.__mockData = state;
function updateCounter() { const output = document.getElementById('mockWriteCount'); if (output) output.textContent = `模拟账本：${products.length} 个商品，${inbound.length + outbound.length} 条库存流水`; }
export async function fetchProducts() { return structuredClone(products); }
export async function fetchCustomers() { return structuredClone(customers); }
export async function fetchCurrentStock(search = '') {
  return products.filter(product => product.name.includes(search)).map(product => {
    const total_inbound = (baseline.has(product.id) ? 100 : 0) + inbound.filter(row => row.product_id === product.id).reduce((sum, row) => sum + Number(row.quantity), 0);
    const total_outbound = outbound.filter(row => row.product_id === product.id).reduce((sum, row) => sum + Number(row.quantity), 0);
    return { ...product, total_inbound, total_outbound, stock_qty: total_inbound - total_outbound };
  });
}
export async function fetchProductStock(id) { return (await fetchCurrentStock()).find(product => product.id === id); }
function readRecords(records, options = {}) {
  return records.filter(record => (!options.excludeOpening || record.note !== OPENING_NOTE) && (!options.from || record.recorded_at >= options.from) && (!options.to || record.recorded_at <= options.to) && (!options.customerId || record.customer_id === options.customerId))
    .map(record => ({ ...record, products: products.find(product => product.id === record.product_id) }));
}
export async function fetchInboundRecords(options) { return readRecords(inbound, options); }
export async function fetchOutboundRecords(options) { return readRecords(outbound, options); }
export async function createProduct(item) { const product = { ...item, id: `p${products.length + 1}`, spec: item.spec || '' }; products.push(product); updateCounter(); return { ...product }; }
export async function createCustomer(item) { const customer = { ...item, id: `c${customers.length + 1}` }; customers.push(customer); return { ...customer }; }
export function subscribeStockChanges() { return { unsubscribe() {} }; }
async function write(records, table, dedupe = true) {
  state.attempts++;
  await new Promise(resolve => setTimeout(resolve, 100));
  if (state.failNext) { state.failNext = false; throw new Error('模拟保存失败'); }
  for (const row of records) if (!dedupe || !table.some(existing => existing.id === row.id)) table.push({ ...row, id: row.id || `record-${table.length}`, created_at: `${date}T09:00:00Z` });
  updateCounter();
}
export async function batchCreateOutbound(items) { return write(items, outbound); }
export async function batchCreateInbound(items) { return write(items, inbound); }
export async function fetchOpeningRecords(ids) { return [...inbound.filter(row => ids.includes(row.id)).map(row => ({ ...row, direction: 'inbound' })), ...outbound.filter(row => ids.includes(row.id)).map(row => ({ ...row, direction: 'outbound' }))]; }
export async function ensureOpeningProducts(rows) { for (const row of rows) if (!products.some(product => product.id === row.id)) products.push(structuredClone(row)); updateCounter(); }
export async function insertOpeningRecords(direction, records) { return write(records, direction === 'inbound' ? inbound : outbound, true); }

export async function createInbound(item) { await write([item],inbound,true);return item; }
export async function createOutbound(item) { await write([item],outbound,true);return item; }
export async function updateProduct(id,data) { Object.assign(products.find(row=>row.id===id),data); }
export async function updateCustomer(id,data) { Object.assign(customers.find(row=>row.id===id),data); }
export async function deleteProduct(id) {
  if(baseline.has(id)||[...inbound,...outbound].some(row=>row.product_id===id))throw new Error('该商品已有库存记录');
  const index=products.findIndex(row=>row.id===id);if(index>=0)products.splice(index,1);updateCounter();
}
export async function deleteCustomer(id) { const index=customers.findIndex(row=>row.id===id);if(index>=0)customers.splice(index,1); }
export async function deleteInboundRecord(id) { const index=inbound.findIndex(row=>row.id===id);if(index>=0)inbound.splice(index,1);updateCounter(); }
export async function deleteOutboundRecord(id) { const index=outbound.findIndex(row=>row.id===id);if(index>=0)outbound.splice(index,1);updateCounter(); }
