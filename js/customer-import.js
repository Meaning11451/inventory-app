const key = value => String(value ?? '').normalize('NFKC').replace(/[\s,，]/g, '').toLowerCase();
const aliases = {
  name: ['客户名','客户名称','客户','姓名','单位名称','往来单位名称'],
  phone: ['电话','联系电话','手机号','手机','电话号码'],
  note: ['备注','说明']
};
export function parseCustomerExcel(rows) {
  const header = rows.findIndex(row => row.some(cell => aliases.name.includes(String(cell ?? '').trim())));
  const columns = {name:0,phone:1,note:2};
  if (header >= 0) for (const [field,names] of Object.entries(aliases)) columns[field] = rows[header].findIndex(cell => names.includes(String(cell ?? '').trim()));
  if (header < 0 && rows.some(row => row.some(cell => /^(商品名称|库存数量|单据编号|经营历程)$/.test(String(cell ?? '').trim())))) throw new Error('请选择客户资料表，不要选择库存状况或经营历程');
  return rows.slice(header + 1).filter(row => row.some(cell => String(cell ?? '').trim())).map(row => Object.fromEntries(Object.entries(columns).map(([field,col]) => [field,col < 0 ? '' : String(row[col] ?? '').trim()]))).filter(row => row.name && !aliases.name.includes(row.name));
}
export function planCustomerImport(rows, existing = []) {
  const seen = new Set(existing.map(row => key(row.name)));
  return rows.map(row => {
    const name = row.name.trim();
    const identity = key(name);
    const exists = seen.has(identity);
    seen.add(identity);
    return {...row,name,exists};
  });
}
export async function saveCustomerImport(rows, api) {
  const existing = await api.fetchCustomers();
  const plan = planCustomerImport(rows, existing);
  const failed = [];
  let saved = 0;
  for (const row of plan) {
    if (row.exists) continue;
    try { await api.createCustomer({name:row.name,phone:row.phone || '',note:row.note || ''}); saved++; }
    catch (error) { failed.push({...row,error:error.message}); }
  }
  return {saved,failed,skipped:plan.filter(row=>row.exists).length};
}
