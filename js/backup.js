const TABLES = ['products', 'customers', 'inbound_records', 'outbound_records', 'current_stock'];

function cents(value) {
  const number = value === null || value === '' ? NaN : Number(value);
  if (!Number.isFinite(number) || Math.abs(number * 100 - Math.round(number * 100)) > 0.0001) throw new Error('账本中存在无法核对的数量，请先检查数据');
  return Math.round(number * 100);
}

export function verifyInventoryBackup(backup) {
  if (backup?.format !== 'inventory-app-backup' || backup.version !== 1 || !Number.isFinite(Date.parse(backup.exported_at))) throw new Error('没有收到完整的账本备份，请重试');
  const tables = backup.tables;
  for (const table of TABLES) {
    if (!Array.isArray(tables?.[table]) || backup.counts?.[table] !== tables[table].length) throw new Error('备份记录数量不完整，请重试');
    const ids = new Set();
    for (const row of tables[table]) {
      if (typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error('备份中有重复或缺失的记录编号，请先检查账本');
      ids.add(row.id);
    }
  }
  const productIds = new Set(tables.products.map(row => row.id));
  const customerIds = new Set(tables.customers.map(row => row.id));
  const totals = new Map(tables.products.map(row => [row.id, { inbound: 0, outbound: 0 }]));
  for (const direction of ['inbound', 'outbound']) {
    for (const row of tables[`${direction}_records`]) {
      if (!productIds.has(row.product_id) || (row.customer_id && !customerIds.has(row.customer_id))) throw new Error('商品或客户与流水对不上，请先检查账本');
      const quantity = cents(row.quantity);
      if (quantity <= 0) throw new Error('流水数量有误，请先检查账本');
      totals.get(row.product_id)[direction] += quantity;
    }
  }
  if (tables.current_stock.length !== productIds.size) throw new Error('库存清单与商品清单不一致，请重试');
  for (const stock of tables.current_stock) {
    const sum = totals.get(stock.id);
    if (!sum || cents(stock.total_inbound) !== sum.inbound || cents(stock.total_outbound) !== sum.outbound || cents(stock.stock_qty) !== sum.inbound - sum.outbound) throw new Error('当前库存与流水不一致，暂未生成备份，请先核对账本');
  }
  return { ...backup.counts };
}

export function backupFilename(date = new Date()) {
  const part = value => String(value).padStart(2, '0');
  return `进销存账本备份-${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}.json`;
}

function downloadBackup(content, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function initBackup({ api, getPendingCount, download = downloadBackup }) {
  const button = document.getElementById('exportBackup');
  const status = document.getElementById('backupStatus');
  let busy = false;
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = '正在生成备份…';
    status.textContent = '正在读取并核对完整账本，请稍候。';
    status.classList.remove('backup-error');
    try {
      await checkPending();
      const backup = await api.exportInventoryBackup();
      const counts = verifyInventoryBackup(backup);
      await checkPending();
      const content = JSON.stringify(backup, null, 2);
      await download(content, backupFilename());
      status.textContent = `已生成备份：${counts.products} 个商品、${counts.customers} 个客户、${counts.inbound_records + counts.outbound_records} 条流水。请确认文件已保存；iPhone 上可选择“存储到文件”。`;
    } catch (error) {
      status.textContent = `未能生成完整备份：${error.message}。请检查网络后重试，云端账本没有修改。`;
      status.classList.add('backup-error');
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = '下载完整备份';
    }
  });

  async function checkPending() {
    let count;
    try { count = await getPendingCount(); }
    catch { throw new Error('无法核对本机待同步记录，请刷新页面后重试'); }
    if (!Number.isInteger(count) || count < 0) throw new Error('无法核对本机待同步记录，请刷新页面后重试');
    if (count > 0) throw new Error(`这台设备还有 ${count} 条待同步记录，请先联网完成同步再备份`);
  }
}
