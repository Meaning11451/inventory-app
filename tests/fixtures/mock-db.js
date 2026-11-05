// Synthetic data for browser checks. The production app never imports this file.
const date = new Date().toLocaleDateString('en-CA');
const products = [
  { id: 'plain', name: '后腿卷', unit: '件', spec: '' },
  { id: 'one', name: '合胜源一号', unit: '件', spec: '' },
  { id: 'brick', name: '合胜源后腿砖', unit: '件', spec: '' }
];
const customers = [ { id: 'c1', name: '小寨，田志强', phone: '', note: '' }, { id: 'c2', name: '济南，武', phone: '', note: '' } ];
window.__mockData = { products, customers, records: [], attempts: 0, failNext: false };
export async function fetchProducts() { return products.map(p => ({ ...p })); }
export async function fetchCustomers() { return customers.map(c => ({ ...c })); }
export async function fetchCurrentStock() { return products.map(p => ({ ...p, stock_qty: 100, total_inbound: 100, total_outbound: 0 })); }
export async function fetchProductStock(id) { return (await fetchCurrentStock()).find(p => p.id === id); }
export async function fetchInboundRecords() { return []; }
export async function fetchOutboundRecords() { return window.__mockData.records.map(r => ({ ...r, products: products.find(p => p.id === r.product_id), created_at: `${date}T09:00:00Z` })); }
export async function createProduct(item) { const product = { ...item, id: `p${products.length + 1}`, spec: '' }; products.push(product); return { ...product }; }
export async function createCustomer(item) { const customer = { ...item, id: `c${customers.length + 1}` }; customers.push(customer); return { ...customer }; }
export function subscribeStockChanges() { return { unsubscribe() {} }; }
export async function batchCreateOutbound(items) {
  window.__mockData.attempts++;
  await new Promise(resolve => setTimeout(resolve, 150));
  if (window.__mockData.failNext) { window.__mockData.failNext = false; throw new Error('模拟保存失败'); }
  window.__mockData.records.push(...items);
  return items;
}
export const batchCreateInbound = batchCreateOutbound;
