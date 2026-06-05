// ============================================
// app.js - 进销存主逻辑
// ============================================

import state, { getState, setState } from './store.js';
import * as DB from './supabase.js';
import { parseQuickEntry, resolveProducts, parseExcelData } from './parser.js';
import { initSync, addToQueue, getPendingCount } from './sync.js';

// 全局暴露
window._showToast = showToast;
window._refreshCurrentTab = refreshCurrentTab;

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => { initApp(); });

async function initApp() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // 标签切换
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  bindEvents();

  initSync({
    createInbound: (p) => DB.createInbound(p),
    createOutbound: (p) => DB.createOutbound(p),
    batchCreateInbound: (p) => DB.batchCreateInbound(p),
    batchCreateOutbound: (p) => DB.batchCreateOutbound(p)
  });

  const pendingCount = await getPendingCount();
  setState('pendingSyncCount', pendingCount);

  await switchTab('dashboard');
}

// ==================== 标签切换 ====================

async function switchTab(tabName) {
  setState('currentTab', tabName);

  document.querySelectorAll('.tab-item').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-page').forEach(p =>
    p.classList.toggle('active', p.id === `page-${tabName}`));

  const titles = {
    dashboard: '进销存', stock: '库存', inbound: '入库',
    outbound: '出库', customers: '客户', records: '记录'
  };
  document.getElementById('headerTitle').textContent = titles[tabName] || '进销存';

  await refreshCurrentTab();
}

async function refreshCurrentTab() {
  const tab = getState('currentTab');
  if (tab === 'dashboard') await renderDashboard();
  else if (tab === 'stock') await renderStock();
  else if (tab === 'inbound') await renderInboundForm();
  else if (tab === 'outbound') await renderOutboundForm();
  else if (tab === 'customers') await renderCustomers();
  else if (tab === 'records') await renderRecords();
}

// ==================== Toast ====================

function showToast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ==================== 事件绑定 ====================

function bindEvents() {
  // 搜索
  document.getElementById('stockSearch').addEventListener('input', debounce(renderStock, 300));
  document.getElementById('customerSearch').addEventListener('input', debounce(renderCustomers, 300));

  // 入库模式
  document.getElementById('inboundModeForm').addEventListener('click', () => switchInboundMode('form'));
  document.getElementById('inboundModeQuick').addEventListener('click', () => switchInboundMode('quick'));
  document.getElementById('inboundModeExcel').addEventListener('click', () => switchInboundMode('excel'));

  // 出库模式
  document.getElementById('outboundModeForm').addEventListener('click', () => switchOutboundMode('form'));
  document.getElementById('outboundModeQuick').addEventListener('click', () => switchOutboundMode('quick'));
  document.getElementById('outboundModeExcel').addEventListener('click', () => switchOutboundMode('excel'));

  // 入库
  document.getElementById('inboundForm').addEventListener('submit', handleInboundSubmit);
  document.getElementById('inboundQuickParse').addEventListener('click', handleInboundQuickParse);
  document.getElementById('inboundQuickSubmit').addEventListener('click', handleInboundQuickSubmit);
  document.getElementById('inboundExcelFile').addEventListener('change', handleInboundExcelImport);
  document.getElementById('inboundExcelSubmit').addEventListener('click', handleInboundExcelSubmit);

  // 出库
  document.getElementById('outboundForm').addEventListener('submit', handleOutboundSubmit);
  document.getElementById('outboundQuickParse').addEventListener('click', handleOutboundQuickParse);
  document.getElementById('outboundQuickSubmit').addEventListener('click', handleOutboundQuickSubmit);
  document.getElementById('outboundExcelFile').addEventListener('change', handleOutboundExcelImport);
  document.getElementById('outboundExcelSubmit').addEventListener('click', handleOutboundExcelSubmit);

  // 记录筛选
  document.getElementById('recordTypeFilter').addEventListener('change', renderRecords);
  document.getElementById('recordFromDate').addEventListener('change', renderRecords);
  document.getElementById('recordToDate').addEventListener('change', renderRecords);
  document.getElementById('recordCustomerFilter').addEventListener('change', renderRecords);

  // 商品按钮
  document.getElementById('btnAddProduct').addEventListener('click', () => showProductModal());
  document.getElementById('productModalCancel').addEventListener('click', closeProductModal);
  document.getElementById('productModalSave').addEventListener('click', handleProductSave);
  document.getElementById('productModalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeProductModal();
  });

  // 客户按钮
  document.getElementById('btnAddCustomer').addEventListener('click', () => showCustomerModal());
  document.getElementById('customerModalCancel').addEventListener('click', closeCustomerModal);
  document.getElementById('customerModalSave').addEventListener('click', handleCustomerSave);
  document.getElementById('customerModalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCustomerModal();
  });

  // 快捷入库弹窗
  document.getElementById('quickInCancel').addEventListener('click', () => {
    document.getElementById('quickInModalOverlay').style.display = 'none';
  });
  document.getElementById('quickInSave').addEventListener('click', handleQuickIn);
  document.getElementById('quickInModalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('quickInModalOverlay').style.display = 'none';
  });

  // 快捷出库弹窗
  document.getElementById('quickOutCancel').addEventListener('click', () => {
    document.getElementById('quickOutModalOverlay').style.display = 'none';
  });
  document.getElementById('quickOutSave').addEventListener('click', handleQuickOut);
  document.getElementById('quickOutModalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('quickOutModalOverlay').style.display = 'none';
  });
}

function switchInboundMode(mode) {
  document.getElementById('inboundFormMode').style.display = mode === 'form' ? 'block' : 'none';
  document.getElementById('inboundQuickMode').style.display = mode === 'quick' ? 'block' : 'none';
  document.getElementById('inboundExcelMode').style.display = mode === 'excel' ? 'block' : 'none';
  ['inboundModeForm','inboundModeQuick','inboundModeExcel'].forEach(id =>
    document.getElementById(id).classList.toggle('active', id === `inboundMode${mode.charAt(0).toUpperCase()+mode.slice(1)}`));
  // 修正 ID 映射
  const ids = { form: 'inboundModeForm', quick: 'inboundModeQuick', excel: 'inboundModeExcel' };
  Object.entries(ids).forEach(([k, id]) => document.getElementById(id).classList.toggle('active', k === mode));
}

function switchOutboundMode(mode) {
  document.getElementById('outboundFormMode').style.display = mode === 'form' ? 'block' : 'none';
  document.getElementById('outboundQuickMode').style.display = mode === 'quick' ? 'block' : 'none';
  document.getElementById('outboundExcelMode').style.display = mode === 'excel' ? 'block' : 'none';
  const ids = { form: 'outboundModeForm', quick: 'outboundModeQuick', excel: 'outboundModeExcel' };
  Object.entries(ids).forEach(([k, id]) => document.getElementById(id).classList.toggle('active', k === mode));
}

// ==================== 📊 仪表盘 ====================

async function renderDashboard() {
  try {
    const [products, customers, stockData] = await Promise.all([
      DB.fetchProducts().catch(() => []),
      DB.fetchCustomers().catch(() => []),
      DB.fetchCurrentStock().catch(() => [])
    ]);

    const today = new Date().toISOString().split('T')[0];
    const [inToday, outToday] = await Promise.all([
      DB.fetchInboundRecords({ from: today, to: today }).catch(() => []),
      DB.fetchOutboundRecords({ from: today, to: today }).catch(() => [])
    ]);

    // 统计数据
    document.getElementById('statProductCount').textContent = products.length;
    document.getElementById('statCustomerCount').textContent = customers.length;
    document.getElementById('statTodayIn').textContent = inToday.reduce((s, r) => s + parseFloat(r.quantity), 0) + '件';
    document.getElementById('statTodayOut').textContent = outToday.reduce((s, r) => s + parseFloat(r.quantity), 0) + '件';

    // 低库存预警
    const lowStock = stockData.filter(s => parseFloat(s.stock_qty) <= 5 && parseFloat(s.stock_qty) >= 0);
    const lowDiv = document.getElementById('dashboardLowStock');
    if (lowStock.length === 0) {
      lowDiv.innerHTML = '<div style="color:var(--color-text-muted);font-size:0.85rem;padding:8px 0;">✅ 库存充足，无需补货</div>';
    } else {
      lowDiv.innerHTML = lowStock.map(s => `
        <div class="alert-item">
          📦 ${escapeHtml(s.name)}
          <span class="alert-qty">仅剩 ${formatNum(s.stock_qty)} ${escapeHtml(s.unit)}</span>
        </div>
      `).join('');
    }

    // 最近操作
    const [recentIn, recentOut] = await Promise.all([
      DB.fetchInboundRecords({}).catch(() => []),
      DB.fetchOutboundRecords({}).catch(() => [])
    ]);
    const recent = [...recentIn.map(r => ({ ...r, _type: 'in' })), ...recentOut.map(r => ({ ...r, _type: 'out' }))]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 8);

    const recentDiv = document.getElementById('dashboardRecent');
    if (recent.length === 0) {
      recentDiv.innerHTML = '<div style="color:var(--color-text-muted);font-size:0.85rem;padding:8px 0;">还没有操作记录</div>';
    } else {
      recentDiv.innerHTML = recent.map(r => {
        const productName = r.products?.name || '未知商品';
        const unit = r.products?.unit || '';
        const isIn = r._type === 'in';
        const sign = isIn ? '+' : '-';
        const qtyClass = isIn ? 'qty-in' : 'qty-out';
        return `
          <div class="card" style="margin-bottom:6px;padding:10px 14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:0.88rem;">${escapeHtml(productName)}</div>
                <div style="font-size:0.7rem;color:var(--color-text-muted);">
                  ${r.customer_name ? '👤 ' + escapeHtml(r.customer_name) + ' · ' : ''}${r.recorded_at}
                </div>
              </div>
              <div style="font-weight:700;font-size:1rem;${isIn?'color:var(--color-success)':'color:var(--color-danger)'}">
                ${sign}${formatNum(r.quantity)} ${escapeHtml(unit)}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('仪表盘加载失败:', err);
  }
}

// ==================== 📦 库存 ====================

async function renderStock() {
  const search = document.getElementById('stockSearch')?.value || '';
  const container = document.getElementById('stockList');
  try {
    const stockData = await DB.fetchCurrentStock(search);
    setState('stockCache', stockData);
    if (stockData.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>${search ? '没有找到匹配的商品' : '还没有商品，点右上角＋添加'}</p></div>`;
      return;
    }
    container.innerHTML = stockData.map(item => {
      const qtyClass = item.stock_qty > 0 ? 'qty-positive' : item.stock_qty < 0 ? 'qty-negative' : 'qty-zero';
      return `
        <div class="card stock-card" style="cursor:pointer;" data-product-id="${item.id}">
          <div class="stock-card-emoji">${getEmoji(item.name)}</div>
          <div class="stock-card-info">
            <div class="stock-card-name">${escapeHtml(item.name)}</div>
            ${item.spec ? `<div class="stock-card-spec">${escapeHtml(item.spec)}</div>` : ''}
          </div>
          <div class="stock-card-qty">
            <div class="qty-num ${qtyClass}">${formatNum(item.stock_qty)}</div>
            <div class="qty-unit">${escapeHtml(item.unit)}</div>
          </div>
          <div style="display:flex;gap:4px;margin-left:8px;">
            <button class="btn btn-sm btn-success stock-quick-in" data-id="${item.id}" data-name="${escapeHtml(item.name)}" data-unit="${escapeHtml(item.unit)}">📥</button>
            <button class="btn btn-sm btn-danger stock-quick-out" data-id="${item.id}" data-name="${escapeHtml(item.name)}" data-unit="${escapeHtml(item.unit)}">📤</button>
          </div>
        </div>
      `;
    }).join('');

    // 快捷入库/出库按钮事件
    container.querySelectorAll('.stock-quick-in').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openQuickInModal(btn.dataset.id, btn.dataset.name, btn.dataset.unit);
      });
    });
    container.querySelectorAll('.stock-quick-out').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openQuickOutModal(btn.dataset.id, btn.dataset.name, btn.dataset.unit);
      });
    });

    // 点击编辑
    container.querySelectorAll('.stock-card').forEach(card => {
      card.addEventListener('click', () => {
        const products = getState('products');
        const p = products.find(pr => pr.id === card.dataset.productId);
        if (p) showProductModal(p);
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>加载失败，检查网络</p></div>`;
  }
}

// ==================== 快捷入库弹窗 ====================

async function openQuickInModal(productId, productName, unit) {
  document.getElementById('quickInTitle').textContent = `📥 快捷入库 - ${productName}`;
  document.getElementById('quickInQty').value = '';
  document.getElementById('quickInModalOverlay').dataset.productId = productId;
  const customers = await loadCustomers();
  document.getElementById('quickInCustomer').innerHTML = '<option value="">选择客户</option>' +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('quickInModalOverlay').style.display = 'flex';
  document.getElementById('quickInQty').focus();
}

async function handleQuickIn() {
  const productId = document.getElementById('quickInModalOverlay').dataset.productId;
  const qty = parseFloat(document.getElementById('quickInQty').value);
  if (!qty || qty <= 0) { showToast('请输入数量', 'warning'); return; }
  const customerId = document.getElementById('quickInCustomer').value || null;
  const customers = await loadCustomers();
  const customer = customerId ? customers.find(c => c.id === customerId) : null;

  try {
    await DB.createInbound({ product_id: productId, customer_id: customerId, customer_name: customer?.name || '', quantity: qty, recorded_at: today() });
    showToast('入库成功 ✅', 'success');
    document.getElementById('quickInModalOverlay').style.display = 'none';
    await renderStock();
    await renderDashboard();
  } catch (err) { showToast('入库失败: ' + err.message, 'error'); }
}

// ==================== 快捷出库弹窗 ====================

async function openQuickOutModal(productId, productName, unit) {
  document.getElementById('quickOutTitle').textContent = `📤 快捷出库 - ${productName}`;
  document.getElementById('quickOutQty').value = '';
  document.getElementById('quickOutModalOverlay').dataset.productId = productId;
  const customers = await loadCustomers();
  document.getElementById('quickOutCustomer').innerHTML = '<option value="">选择客户</option>' +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('quickOutModalOverlay').style.display = 'flex';
  document.getElementById('quickOutQty').focus();
}

async function handleQuickOut() {
  const productId = document.getElementById('quickOutModalOverlay').dataset.productId;
  const qty = parseFloat(document.getElementById('quickOutQty').value);
  if (!qty || qty <= 0) { showToast('请输入数量', 'warning'); return; }
  const customerId = document.getElementById('quickOutCustomer').value || null;
  const customers = await loadCustomers();
  const customer = customerId ? customers.find(c => c.id === customerId) : null;

  try {
    await DB.createOutbound({ product_id: productId, customer_id: customerId, customer_name: customer?.name || '', quantity: qty, recorded_at: today() });
    showToast('出库成功 ✅', 'success');
    document.getElementById('quickOutModalOverlay').style.display = 'none';
    await renderStock();
    await renderDashboard();
  } catch (err) { showToast('出库失败: ' + err.message, 'error'); }
}

// ==================== 📥 入库 ====================

async function renderInboundForm() {
  const [products, customers] = await Promise.all([loadProducts(), loadCustomers()]);
  const pSel = document.getElementById('inboundProduct');
  pSel.innerHTML = '<option value="">请选择商品</option>' +
    products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} ${p.spec ? '(' + escapeHtml(p.spec) + ')' : ''}</option>`).join('');
  const cSel = document.getElementById('inboundCustomer');
  cSel.innerHTML = '<option value="">请选择客户（可选）</option>' +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)} ${c.phone ? '📱' + escapeHtml(c.phone) : ''}</option>`).join('');
  document.getElementById('inboundDate').value = today();
}

async function handleInboundSubmit(e) {
  e.preventDefault();
  const product_id = document.getElementById('inboundProduct').value;
  if (!product_id) { showToast('请选择商品', 'warning'); return; }
  const qty = parseFloat(document.getElementById('inboundQty').value);
  if (!qty || qty <= 0) { showToast('请输入有效数量', 'warning'); return; }
  const customer_id = document.getElementById('inboundCustomer').value || null;
  const customers = await loadCustomers();
  const customer = customer_id ? customers.find(c => c.id === customer_id) : null;

  try {
    await DB.createInbound({
      product_id, customer_id, customer_name: customer?.name || '', quantity: qty,
      unit_price: document.getElementById('inboundPrice').value ? parseFloat(document.getElementById('inboundPrice').value) : null,
      note: document.getElementById('inboundNote').value.trim(),
      recorded_at: document.getElementById('inboundDate').value
    });
    showToast('入库成功 ✅', 'success');
    document.getElementById('inboundForm').reset();
    document.getElementById('inboundDate').value = today();
    await renderInboundForm();
    await renderDashboard();
  } catch (err) { showToast('入库失败: ' + err.message, 'error'); }
}

async function handleInboundQuickParse() {
  const text = document.getElementById('inboundQuickText').value;
  if (!text.trim()) { showToast('请粘贴内容', 'warning'); return; }
  const customers = await loadCustomers();
  const parsed = parseQuickEntry(text, customers);
  const resolved = resolveProducts(parsed, await loadProducts());
  document.getElementById('inboundQuickText').dataset.resolved = JSON.stringify(resolved);
  renderParsePreview('inboundParsePreview', resolved);
  document.getElementById('inboundQuickSubmit').style.display = 'block';
}

async function handleInboundQuickSubmit() {
  await submitQuickData('inboundQuickText', 'batchCreateInbound');
  document.getElementById('inboundQuickText').value = '';
  document.getElementById('inboundParsePreview').innerHTML = '';
  document.getElementById('inboundQuickSubmit').style.display = 'none';
  await renderDashboard();
}

async function handleInboundExcelImport(e) {
  await handleExcelFile(e, 'inboundExcelFile', 'inboundExcelPreview', 'inboundExcelSubmit');
}

async function handleInboundExcelSubmit() {
  await submitExcelData('inboundExcelFile', 'batchCreateInbound');
  document.getElementById('inboundExcelPreview').innerHTML = '';
  document.getElementById('inboundExcelSubmit').style.display = 'none';
  document.getElementById('inboundExcelFile').value = '';
  await renderDashboard();
}

// ==================== 📤 出库 ====================

async function renderOutboundForm() {
  const [products, customers] = await Promise.all([loadProducts(), loadCustomers()]);
  document.getElementById('outboundProduct').innerHTML = '<option value="">请选择商品</option>' +
    products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} ${p.spec ? '(' + escapeHtml(p.spec) + ')' : ''}</option>`).join('');
  document.getElementById('outboundCustomer').innerHTML = '<option value="">请选择客户（可选）</option>' +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)} ${c.phone ? '📱' + escapeHtml(c.phone) : ''}</option>`).join('');
  document.getElementById('outboundDate').value = today();
}

async function handleOutboundSubmit(e) {
  e.preventDefault();
  const product_id = document.getElementById('outboundProduct').value;
  if (!product_id) { showToast('请选择商品', 'warning'); return; }
  const qty = parseFloat(document.getElementById('outboundQty').value);
  if (!qty || qty <= 0) { showToast('请输入有效数量', 'warning'); return; }
  const customer_id = document.getElementById('outboundCustomer').value || null;
  const customers = await loadCustomers();
  const customer = customer_id ? customers.find(c => c.id === customer_id) : null;

  try {
    const stock = await DB.fetchProductStock(product_id);
    if (stock && qty > parseFloat(stock.stock_qty)) {
      if (!confirm(`库存不足！当前库存: ${formatNum(stock.stock_qty)} ${stock.unit}，是否继续出库？`)) return;
    }
  } catch (err) {}

  try {
    await DB.createOutbound({
      product_id, customer_id, customer_name: customer?.name || '', quantity: qty,
      unit_price: document.getElementById('outboundPrice').value ? parseFloat(document.getElementById('outboundPrice').value) : null,
      note: document.getElementById('outboundNote').value.trim(),
      recorded_at: document.getElementById('outboundDate').value
    });
    showToast('出库成功 ✅', 'success');
    document.getElementById('outboundForm').reset();
    document.getElementById('outboundDate').value = today();
    await renderOutboundForm();
    await renderDashboard();
  } catch (err) { showToast('出库失败: ' + err.message, 'error'); }
}

async function handleOutboundQuickParse() {
  const text = document.getElementById('outboundQuickText').value;
  if (!text.trim()) { showToast('请粘贴内容', 'warning'); return; }
  const customers = await loadCustomers();
  const parsed = parseQuickEntry(text, customers);
  const resolved = resolveProducts(parsed, await loadProducts());
  document.getElementById('outboundQuickText').dataset.resolved = JSON.stringify(resolved);
  renderParsePreview('outboundParsePreview', resolved);
  document.getElementById('outboundQuickSubmit').style.display = 'block';
}

async function handleOutboundQuickSubmit() {
  await submitQuickData('outboundQuickText', 'batchCreateOutbound');
  document.getElementById('outboundQuickText').value = '';
  document.getElementById('outboundParsePreview').innerHTML = '';
  document.getElementById('outboundQuickSubmit').style.display = 'none';
  await renderDashboard();
}

async function handleOutboundExcelImport(e) {
  await handleExcelFile(e, 'outboundExcelFile', 'outboundExcelPreview', 'outboundExcelSubmit');
}

async function handleOutboundExcelSubmit() {
  await submitExcelData('outboundExcelFile', 'batchCreateOutbound');
  document.getElementById('outboundExcelPreview').innerHTML = '';
  document.getElementById('outboundExcelSubmit').style.display = 'none';
  document.getElementById('outboundExcelFile').value = '';
  await renderDashboard();
}

// ==================== Excel 通用 ====================

async function handleExcelFile(e, fileId, previewId, submitId) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const rows = await readExcelFile(file);
    const [customers, products] = await Promise.all([loadCustomers(), loadProducts()]);
    const { resolved } = parseExcelData(rows, customers, products);
    document.getElementById(fileId).dataset.resolved = JSON.stringify(resolved);
    renderExcelPreview(previewId, resolved);
    document.getElementById(submitId).style.display = 'block';
    showToast(`已解析 ${resolved.length} 条记录`, 'info');
  } catch (err) { showToast('Excel 解析失败: ' + err.message, 'error'); }
}

async function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        resolve(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function renderExcelPreview(containerId, resolved) {
  document.getElementById(containerId).innerHTML = `
    <div class="parse-preview"><table>
      <thead><tr><th>客户/商品</th><th>数量</th><th>单位</th><th>状态</th></tr></thead>
      <tbody>${resolved.map(item => {
        const b = item.parsed.error ? ['格式错误','danger','row-error'] : item.needCreate ? ['待新建','warning','row-new'] : ['已匹配','success','row-matched'];
        return `<tr class="${b[2]}"><td>${item.parsed.rawCustomer ? '👤'+escapeHtml(item.parsed.rawCustomer)+' ' : ''}${escapeHtml(item.parsed.rawName)}</td><td>${formatNum(item.parsed.quantity)}</td><td>${escapeHtml(item.parsed.unit||item.suggestedUnit)}</td><td><span class="badge badge-${b[1]}">${b[0]}</span></td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

async function submitExcelData(fileId, opType) {
  const json = document.getElementById(fileId).dataset.resolved;
  if (!json) return;
  const resolved = JSON.parse(json);
  const products = await loadProducts();
  const newMap = {};
  for (const item of resolved) {
    if (item.needCreate) {
      try { const np = await DB.createProduct({ name: item.parsed.rawName, unit: item.suggestedUnit }); newMap[item.parsed.rawName] = np.id; }
      catch (err) { showToast('创建商品失败: ' + item.parsed.rawName, 'error'); return; }
    }
  }
  const items = resolved.map(item => ({
    product_id: item.product?.id || newMap[item.parsed.rawName],
    customer_id: item.customer?.id || null,
    customer_name: item.parsed.rawCustomer || '',
    quantity: item.parsed.quantity,
    unit_price: item.unitPrice || null,
    note: '',
    recorded_at: today()
  }));
  try {
    await DB[opType](items);
    showToast(`导入成功 ✅ 共 ${items.length} 条`, 'success');
  } catch (err) { showToast('导入失败: ' + err.message, 'error'); }
}

// ==================== 快捷提交通用 ====================

async function submitQuickData(textId, opType) {
  const json = document.getElementById(textId).dataset.resolved;
  if (!json) return;
  const resolved = JSON.parse(json);
  const products = await loadProducts();
  const newMap = {};
  for (const item of resolved) {
    if (item.needCreate) {
      try { const np = await DB.createProduct({ name: item.parsed.rawName, unit: item.suggestedUnit }); newMap[item.parsed.rawName] = np.id; showToast('已创建新商品: ' + item.parsed.rawName, 'info'); }
      catch (err) { showToast('创建商品失败: ' + item.parsed.rawName, 'error'); return; }
    }
  }
  const items = resolved.map(item => ({
    product_id: item.product?.id || newMap[item.parsed.rawName],
    customer_id: item.parsed.customer?.id || null,
    customer_name: item.parsed.rawCustomer || '',
    quantity: item.parsed.quantity,
    unit_price: null, note: '',
    recorded_at: today()
  }));
  try {
    await DB[opType](items);
    showToast(`批量操作成功 ✅ 共 ${items.length} 条`, 'success');
  } catch (err) { showToast('操作失败: ' + err.message, 'error'); }
}

// ==================== 📋 记录 ====================

async function renderRecords() {
  const type = document.getElementById('recordTypeFilter').value;
  const from = document.getElementById('recordFromDate').value;
  const to = document.getElementById('recordToDate').value;
  const customerId = document.getElementById('recordCustomerFilter').value;

  const customers = await loadCustomers();
  const cSel = document.getElementById('recordCustomerFilter');
  const cur = cSel.value;
  cSel.innerHTML = '<option value="">全部客户</option>' +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  cSel.value = cur;

  try {
    const records = type === 'inbound'
      ? await DB.fetchInboundRecords({ from, to, customerId: customerId || undefined })
      : await DB.fetchOutboundRecords({ from, to, customerId: customerId || undefined });

    const container = document.getElementById('recordList');
    if (records.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>暂无记录</p></div>';
      return;
    }

    const grouped = groupBy(records, r => r.recorded_at);
    container.innerHTML = Object.entries(grouped)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, items]) => `
        <div class="date-header"><span class="date-dot"></span>${date}（${items.length}条）</div>
        ${items.map(r => {
          const pn = r.products?.name || '未知商品';
          const unit = r.products?.unit || '';
          const isIn = type === 'inbound';
          return `
            <div class="card" style="margin-bottom:6px;padding:10px 14px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <div class="record-badge ${isIn?'badge-in':'badge-out'}">${isIn?'📥':'📤'}</div>
                <div style="flex:1;min-width:0;">
                  ${r.customer_name ? `<span style="font-size:0.75rem;color:var(--color-primary);font-weight:600;">👤 ${escapeHtml(r.customer_name)}</span><br>` : ''}
                  <span style="font-weight:500;">${escapeHtml(pn)}</span>
                  <span style="font-size:0.7rem;color:var(--color-text-muted);margin-left:8px;">${r.unit_price ? '¥'+formatNum(r.unit_price)+' · ' : ''}${escapeHtml(r.note||'')}</span>
                </div>
                <div style="font-weight:700;${isIn?'color:var(--color-success)':'color:var(--color-danger)'}">
                  ${isIn?'+':'-'}${formatNum(r.quantity)} ${escapeHtml(unit)}
                </div>
              </div>
            </div>`;
        }).join('')}
      `).join('');
  } catch (err) { document.getElementById('recordList').innerHTML = '<div class="empty-state">⚠️<p>加载失败</p></div>'; }
}

// ==================== 👥 客户 ====================

async function renderCustomers() {
  const search = document.getElementById('customerSearch')?.value || '';
  const customers = (await loadCustomers(true)).filter(c =>
    !search || c.name.includes(search) || (c.phone && c.phone.includes(search))
  );
  const container = document.getElementById('customerList');
  if (customers.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>${search ? '没有匹配的客户' : '还没有客户，点右上角＋添加'}</p></div>`;
    return;
  }
  container.innerHTML = customers.map(c => `
    <div class="card stock-card">
      <div class="stock-card-emoji">👤</div>
      <div class="stock-card-info">
        <div class="stock-card-name">${escapeHtml(c.name)}</div>
        <div class="stock-card-spec">${c.phone ? '📱 ' + escapeHtml(c.phone) : ''}${c.note ? ' · ' + escapeHtml(c.note) : ''}</div>
      </div>
      <div>
        <button class="btn btn-sm btn-outline edit-cust" data-id="${c.id}">编辑</button>
        <button class="btn btn-sm btn-danger del-cust" data-id="${c.id}" data-name="${escapeHtml(c.name)}" style="margin-left:4px">删除</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.edit-cust').forEach(b => b.addEventListener('click', () => {
    const c = customers.find(x => x.id === b.dataset.id);
    if (c) showCustomerModal(c);
  }));
  container.querySelectorAll('.del-cust').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`确定删除客户「${b.dataset.name}」？`)) return;
    try {
      await DB.deleteCustomer(b.dataset.id);
      showToast('删除成功', 'success');
      await renderCustomers();
      await renderDashboard();
    } catch (err) { showToast('删除失败', 'error'); }
  }));
}

// ==================== 商品弹窗 ====================

function showProductModal(product = null) {
  document.getElementById('productModalTitle').textContent = product ? '编辑商品' : '添加商品';
  document.getElementById('productModalName').value = product?.name || '';
  document.getElementById('productModalSpec').value = product?.spec || '';
  document.getElementById('productModalUnit').value = product?.unit || '件';
  document.getElementById('productModalOverlay').dataset.editId = product?.id || '';
  document.getElementById('productModalOverlay').style.display = 'flex';
  document.getElementById('productModalName').focus();
}

function closeProductModal() { document.getElementById('productModalOverlay').style.display = 'none'; }

async function handleProductSave() {
  const name = document.getElementById('productModalName').value.trim();
  if (!name) { showToast('请输入商品名称', 'warning'); return; }
  const editId = document.getElementById('productModalOverlay').dataset.editId;
  try {
    editId
      ? await DB.updateProduct(editId, { name, spec: document.getElementById('productModalSpec').value.trim(), unit: document.getElementById('productModalUnit').value.trim() || '件' })
      : await DB.createProduct({ name, spec: document.getElementById('productModalSpec').value.trim(), unit: document.getElementById('productModalUnit').value.trim() || '件' });
    showToast(editId ? '已更新' : '已添加', 'success');
    closeProductModal();
    await renderStock();
    await renderDashboard();
  } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
}

// ==================== 客户弹窗 ====================

function showCustomerModal(customer = null) {
  document.getElementById('customerModalTitle').textContent = customer ? '编辑客户' : '添加客户';
  document.getElementById('customerModalName').value = customer?.name || '';
  document.getElementById('customerModalPhone').value = customer?.phone || '';
  document.getElementById('customerModalNote').value = customer?.note || '';
  document.getElementById('customerModalOverlay').dataset.editId = customer?.id || '';
  document.getElementById('customerModalOverlay').style.display = 'flex';
  document.getElementById('customerModalName').focus();
}

function closeCustomerModal() { document.getElementById('customerModalOverlay').style.display = 'none'; }

async function handleCustomerSave() {
  const name = document.getElementById('customerModalName').value.trim();
  if (!name) { showToast('请输入客户名称', 'warning'); return; }
  const editId = document.getElementById('customerModalOverlay').dataset.editId;
  const data = { name, phone: document.getElementById('customerModalPhone').value.trim(), note: document.getElementById('customerModalNote').value.trim() };
  try {
    editId ? await DB.updateCustomer(editId, data) : await DB.createCustomer(data);
    showToast(editId ? '已更新' : '已添加', 'success');
    closeCustomerModal();
    await renderCustomers();
    await renderDashboard();
    if (getState('currentTab') === 'inbound') await renderInboundForm();
    if (getState('currentTab') === 'outbound') await renderOutboundForm();
  } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
}

// ==================== 解析预览 ====================

function renderParsePreview(containerId, resolved) {
  document.getElementById(containerId).innerHTML = `
    <div class="parse-preview"><table>
      <thead><tr><th>商品</th><th>数量</th><th>单位</th><th>状态</th></tr></thead>
      <tbody>${resolved.map(item => {
        const b = item.parsed.error ? ['格式错误','danger','row-error'] : item.needCreate ? ['待新建','warning','row-new'] : ['已匹配','success','row-matched'];
        const cust = item.parsed.rawCustomer ? `<span style="color:var(--color-primary);font-weight:500;">👤 ${escapeHtml(item.parsed.rawCustomer)}</span> ` : '';
        return `<tr class="${b[2]}"><td>${cust}${escapeHtml(item.parsed.rawName)}</td><td>${formatNum(item.parsed.quantity)}</td><td>${escapeHtml(item.parsed.unit||(item.product?.unit)||'?')}</td><td><span class="badge badge-${b[1]}">${b[0]}</span></td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

// ==================== 工具函数 ====================

async function loadProducts(force = false) {
  let p = getState('products');
  if (force || p.length === 0) {
    try { p = await DB.fetchProducts(); setState('products', p); } catch (err) {}
  }
  return getState('products');
}

async function loadCustomers(force = false) {
  let c = getState('customers');
  if (force || !c) {
    try { c = await DB.fetchCustomers(); setState('customers', c); } catch (err) { c = []; }
  }
  return getState('customers') || [];
}

function today() { return new Date().toISOString().split('T')[0]; }
function escapeHtml(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function formatNum(n) { if (n === null || n === undefined) return '0'; return Number(n) === Math.floor(n) ? String(Math.floor(n)) : String(Number(n).toFixed(2)); }
function debounce(fn, d) { let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), d); }; }
function groupBy(arr, kfn) { const m = {}; arr.forEach(i => { const k = typeof kfn === 'function' ? kfn(i) : i[kfn]; if (!m[k]) m[k] = []; m[k].push(i); }); return m; }
function getEmoji(name) {
  const map = { '肉':'🥩','鸡':'🐔','鸭':'🦆','鱼':'🐟','虾':'🦐','猪':'🐷','牛':'🐮','羊':'🐑','蛋':'🥚','菜':'🥬','米':'🍚','面':'🍜','油':'🫗','酒':'🍺','水':'💧','卷':'🌀','号':'🔢','奶':'🥛','茶':'🍵','腿':'🍗','爪':'🐾' };
  for (const [k, e] of Object.entries(map)) { if (name.includes(k)) return e; }
  return '📦';
}
