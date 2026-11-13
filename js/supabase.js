// ============================================
// supabase.js - 数据层：Supabase 客户端 + 所有 CRUD
// ============================================

import { OPENING_NOTE } from './opening-stock.js';

// TODO: 替换为你的 Supabase 项目 URL 和 anon key
// 在 Supabase 项目 Settings > API 中可以找到
const SUPABASE_URL = 'https://ajgczecrgmozkhqfjofa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_UB12CPaewsJigfpIh9f8XA_y5zLXtAI';

let supabase = null;

function getClient() {
  if (!supabase) {
    if (typeof window.supabase === 'undefined') {
      throw new Error('Supabase SDK 未加载，请在 HTML 中引入 supabase-js');
    }
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

// ==================== 商品 ====================

export async function fetchProducts() {
  return (await fetchAllRows('products')).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

async function fetchAllRows(table, search = '') {
  const rows = [];
  const pageSize = 500;
  for (let start = 0; ; start += pageSize) {
    let query = getClient().from(table).select('*').order('id').range(start, start + pageSize - 1);
    if (search) query = query.ilike('name', `%${search}%`);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export async function createProduct({ name, spec = '', unit = '件' }) {
  const { data, error } = await getClient()
    .from('products')
    .insert({ name, spec, unit })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id, { name, spec, unit }) {
  const { data, error } = await getClient()
    .from('products')
    .update({ name, spec, unit, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  const { error } = await getClient()
    .from('products')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ==================== 客户 ====================

export async function fetchCustomers() {
  return (await fetchAllRows('customers')).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}

export async function createCustomer({ name, phone = '', note = '' }) {
  const { data, error } = await getClient()
    .from('customers')
    .insert({ name, phone, note })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(id, { name, phone, note }) {
  const { data, error } = await getClient()
    .from('customers')
    .update({ name, phone, note, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCustomer(id) {
  const { error } = await getClient()
    .from('customers')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ==================== 库存查询 ====================

export async function fetchCurrentStock(search = '') {
  const position = row => row.display_order == null ? Infinity : Number(row.display_order);
  return (await fetchAllRows('current_stock', search)).sort((a, b) =>
    position(a) - position(b) || a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
}

export async function exportInventoryBackup() {
  const { data, error } = await getClient().rpc('export_inventory_backup');
  if (error) throw error;
  return { ...data, source_project: new URL(SUPABASE_URL).hostname.split('.')[0] };
}

// ==================== 期初库存（仅由确认导入按钮调用） ====================

export async function fetchOpeningRecords(ids) {
  const result = [];
  const uniqueIds = [...new Set(ids)];
  for (let start = 0; start < uniqueIds.length; start += 100) {
    const chunk = uniqueIds.slice(start, start + 100);
    for (const direction of ['inbound', 'outbound']) {
      const { data, error } = await getClient().from(`${direction}_records`)
        .select('id,product_id,quantity,note,recorded_at').in('id', chunk);
      if (error) throw error;
      result.push(...data.map(record => ({ ...record, direction })));
    }
  }
  return result;
}

export async function ensureOpeningProducts(products) {
  for (let start = 0; start < products.length; start += 200) {
    const { error } = await getClient().from('products').upsert(products.slice(start, start + 200), { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }
}

export async function insertOpeningRecords(direction, records) {
  if (!['inbound', 'outbound'].includes(direction)) throw new Error('期初库存方向无效');
  for (let start = 0; start < records.length; start += 200) {
    const { error } = await getClient().from(`${direction}_records`).upsert(records.slice(start, start + 200), { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }
}

export async function fetchProductStock(productId) {
  const { data, error } = await getClient()
    .from('current_stock')
    .select('*')
    .eq('id', productId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// ==================== 入库 ====================

export async function createInbound({ id = crypto.randomUUID(), product_id, customer_id = null, customer_name = '', quantity, unit_price = null, note = '', recorded_at = null }) {
  const record = {
    id,
    product_id,
    customer_id,
    customer_name,
    quantity,
    unit_price,
    note,
    recorded_at: recorded_at || new Date().toISOString().split('T')[0]
  };
  const { data, error } = await getClient()
    .from('inbound_records')
    .upsert(record, { onConflict: 'id', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data?.[0] || record;
}

export async function batchCreateInbound(items) {
  const records = items.map(item => ({
    id: item.id || crypto.randomUUID(),
    product_id: item.product_id,
    customer_id: item.customer_id || null,
    customer_name: item.customer_name || '',
    quantity: item.quantity,
    unit_price: item.unit_price || null,
    note: item.note || '',
    recorded_at: item.recorded_at || new Date().toISOString().split('T')[0]
  }));
  const { data, error } = await getClient()
    .from('inbound_records')
    .upsert(records, { onConflict: 'id', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data;
}

export async function fetchInboundRecords(options = {}) { return fetchLedgerRecords('inbound',options); }

export async function deleteInboundRecord(id) {
  const { error } = await getClient()
    .from('inbound_records')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ==================== 出库 ====================

export async function createOutbound({ id = crypto.randomUUID(), product_id, customer_id = null, customer_name = '', quantity, unit_price = null, note = '', recorded_at = null }) {
  const record = {
    id,
    product_id,
    customer_id,
    customer_name,
    quantity,
    unit_price,
    note,
    recorded_at: recorded_at || new Date().toISOString().split('T')[0]
  };
  const { data, error } = await getClient()
    .from('outbound_records')
    .upsert(record, { onConflict: 'id', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data?.[0] || record;
}

export async function batchCreateOutbound(items) {
  const records = items.map(item => ({
    id: item.id || crypto.randomUUID(),
    product_id: item.product_id,
    customer_id: item.customer_id || null,
    customer_name: item.customer_name || '',
    quantity: item.quantity,
    unit_price: item.unit_price || null,
    note: item.note || '',
    recorded_at: item.recorded_at || new Date().toISOString().split('T')[0]
  }));
  const { data, error } = await getClient()
    .from('outbound_records')
    .upsert(records, { onConflict: 'id', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data;
}

export async function fetchOutboundRecords(options = {}) { return fetchLedgerRecords('outbound',options); }

export async function deleteOutboundRecord(id) {
  const { error } = await getClient()
    .from('outbound_records')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

function sameLedgerFields(row, target) {
  return row.product_id === target.product_id &&
    (row.customer_id ?? null) === target.customer_id &&
    (row.customer_name ?? null) === target.customer_name &&
    Number(row.quantity) === target.quantity;
}

export async function updateLedgerRecord(direction, original, changes) {
  if (!['inbound', 'outbound'].includes(direction) || !original?.id || !original.product_id) {
    throw new Error('无法确定要修改的进出库记录');
  }
  if (original.note === OPENING_NOTE || original.note?.startsWith('🔧')) {
    throw new Error('期初库存和盘点调整请到库存页处理');
  }
  const { product_id, customer_id, quantity } = changes;
  const customer_name = changes.customer_name ?? null;
  if (typeof product_id !== 'string' || !product_id) throw new Error('请选择已有商品');
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 9999999999) {
    throw new Error('数量必须为大于 0 的整数，最多 10 位');
  }
  const keepOriginalCustomer = customer_id === (original.customer_id ?? null) &&
    customer_name === (original.customer_name ?? null);
  const validNewCustomer = (typeof customer_id === 'string' && customer_id.length > 0 &&
    typeof customer_name === 'string' && customer_name.trim().length > 0) ||
    (customer_id === null && customer_name === '');
  if (!keepOriginalCustomer && !validNewCustomer) {
    throw new Error('请重新选择已有客户');
  }

  const update = { product_id, customer_id, customer_name, quantity };
  if (sameLedgerFields(original, update)) return original;
  const table = `${direction}_records`;
  let query = getClient().from(table).update(update).eq('id', original.id)
    .eq('product_id', original.product_id).eq('quantity', original.quantity);
  // Match both customer columns and the original note, including historical NULLs.
  // A reclassification as an opening balance or stock adjustment then fails this update.
  for (const field of ['customer_id', 'customer_name', 'note']) {
    query = original[field] == null ? query.is(field, null) : query.eq(field, original[field]);
  }
  if (original.created_at) query = query.eq('created_at', original.created_at);
  const { data, error } = await query.select('*');
  if (error) throw error;
  if (data?.length === 1) return data[0];

  // If a previous response was lost, retrying the original edit may find it already applied.
  const result = await getClient().from(table).select('*').eq('id', original.id);
  if (result.error) throw result.error;
  const current = result.data?.[0];
  if (current && current.note === original.note &&
      (!original.created_at || current.created_at === original.created_at) && sameLedgerFields(current, update)) {
    return current;
  }
  const conflict = new Error(current ? '这条记录已在其他设备上修改，请重新打开核对' : '这条记录已删除，请刷新记录列表');
  conflict.code = 'RECORD_CHANGED';
  throw conflict;
}

// ==================== 实时订阅 ====================

export function subscribeStockChanges(onUpdate) {
  return getClient()
    .channel('stock-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'inbound_records' },
      () => onUpdate()
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'outbound_records' },
      () => onUpdate()
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'products' },
      () => onUpdate()
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'customers' },
      () => onUpdate()
    )
    .subscribe();
}

// Fetch every matching business row so totals and history do not silently stop at 200.
async function fetchLedgerRecords(direction,{from,to,customerId,productId,productIds,excludeOpening=false,limit=Infinity}={}) {
  if (Array.isArray(productIds) && productIds.length === 0) return [];
  const rows=[];
  const maxRows=Number.isFinite(limit) ? Math.max(0,Math.floor(limit)) : Infinity;
  while(rows.length < maxRows) {
    const size=Math.min(500,maxRows-rows.length);
    let query=getClient().from(`${direction}_records`).select('*, products(name, unit)')
      .order('recorded_at',{ascending:false}).order('created_at',{ascending:false}).order('id')
      .range(rows.length,rows.length+size-1);
    if(from)query=query.gte('recorded_at',from);
    if(to)query=query.lte('recorded_at',to);
    if(customerId)query=query.eq('customer_id',customerId);
    if(productId)query=query.eq('product_id',productId);
    if(productIds)query=query.in('product_id',productIds);
    if(excludeOpening)query=query.or(`note.is.null,note.neq.${OPENING_NOTE}`);
    const {data,error}=await query;
    if(error)throw error;
    rows.push(...data);
    if(data.length < size)break;
  }
  return rows;
}
