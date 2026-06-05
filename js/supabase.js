// ============================================
// supabase.js - 数据层：Supabase 客户端 + 所有 CRUD
// ============================================

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
  const { data, error } = await getClient()
    .from('products')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
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
  const { data, error } = await getClient()
    .from('customers')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
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
  let query = getClient().from('current_stock').select('*');
  if (search) {
    query = query.ilike('name', `%${search}%`);
  }
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data;
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

export async function createInbound({ product_id, customer_id = null, customer_name = '', quantity, unit_price = null, note = '', recorded_at = null }) {
  const record = {
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
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function batchCreateInbound(items) {
  const records = items.map(item => ({
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
    .insert(records)
    .select();
  if (error) throw error;
  return data;
}

export async function fetchInboundRecords({ from, to, customerId, productId } = {}) {
  let query = getClient()
    .from('inbound_records')
    .select('*, products(name, unit)')
    .order('recorded_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (from) query = query.gte('recorded_at', from);
  if (to) query = query.lte('recorded_at', to);
  if (customerId) query = query.eq('customer_id', customerId);
  if (productId) query = query.eq('product_id', productId);

  const { data, error } = await query.limit(200);
  if (error) throw error;
  return data;
}

// ==================== 出库 ====================

export async function createOutbound({ product_id, customer_id = null, customer_name = '', quantity, unit_price = null, note = '', recorded_at = null }) {
  const record = {
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
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function batchCreateOutbound(items) {
  const records = items.map(item => ({
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
    .insert(records)
    .select();
  if (error) throw error;
  return data;
}

export async function fetchOutboundRecords({ from, to, customerId, productId } = {}) {
  let query = getClient()
    .from('outbound_records')
    .select('*, products(name, unit)')
    .order('recorded_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (from) query = query.gte('recorded_at', from);
  if (to) query = query.lte('recorded_at', to);
  if (customerId) query = query.eq('customer_id', customerId);
  if (productId) query = query.eq('product_id', productId);

  const { data, error } = await query.limit(200);
  if (error) throw error;
  return data;
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
