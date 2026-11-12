// ============================================
// app.js - 进销存主逻辑
// ============================================

import state, { getState, setState } from './store.js';
import * as DB from './supabase.js?v=24';
import { parseQuickEntry, resolveProducts, parseExcelData, findProduct, findCustomer, matchingProducts, matchingCustomers, suggestedCustomers, searchProducts } from './parser.js?v=26';
import { initSync, getPendingCount } from './sync.js';
import { initOpeningImport } from './opening-ui.js';
import { isOpeningRecord } from './opening-stock.js';
import { parseCustomerExcel, planCustomerImport, saveCustomerImport } from './customer-import.js?v=26';
import { createSaveIntents } from './save-intent.js?v=23';
import { initBackup } from './backup.js';
import { createWorkspaceStore } from './workspace.js?v=23';
const workspaceStore = createWorkspaceStore(() => window.localStorage);
const recoveredWorkspace = workspaceStore.read();
const batchDrafts = [
  ['inboundQuickText','inboundParsePreview'], ['outboundQuickText','outboundParsePreview'],
  ['inboundExcelFile','inboundExcelPreview'], ['outboundExcelFile','outboundExcelPreview']
];
const batchScopes = batchDrafts.map(([source])=>source);
const savedIntents = Array.isArray(recoveredWorkspace?.intents)
  ? recoveredWorkspace.intents.filter(entry=>Array.isArray(entry) && batchScopes.includes(entry[0])) : [];
const saveIntents = createSaveIntents(savedIntents);
let workspaceReady = false;
let workspaceWarningShown = false;

// 全局暴露
window._showToast = showToast;
window._refreshCurrentTab = refreshCurrentTab;

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => { initApp(); });

async function initApp() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // 标签切换
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  bindEvents();
  initEntryPreviewGuards();
  initInstallButton();
  initBackup({ api: DB, getPendingCount });
  initOpeningImport({ api: DB, onChanged: async () => { setState('products', []); await renderStock(); await renderDashboard(); } });

  const initialTab = restoreWorkspace();
  workspaceReady = true;
  initWorkspacePersistence();
  // Restore navigation before the first asynchronous lookup can finish.
  const initialView = switchTab(initialTab);

  initSync({
    createInbound: (p) => DB.createInbound(p),
    createOutbound: (p) => DB.createOutbound(p),
    batchCreateInbound: (p) => DB.batchCreateInbound(p),
    batchCreateOutbound: (p) => DB.batchCreateOutbound(p)
  });

  const pendingCount = await getPendingCount().catch(()=>0);
  setState('pendingSyncCount', pendingCount);

  // 实时订阅：数据库变化时自动刷新当前页面
  DB.subscribeStockChanges(() => {
    setState('products',[]);setState('customers',null);
    const tab = getState('currentTab');
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
    if (tab === 'dashboard') renderDashboard();
    else if (tab === 'stock') renderStock();
    else if (tab === 'records') renderRecords();
  });

  // 切回页面/标签时自动刷新（补充实时订阅）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshCurrentTab();
    }
  });

  await initialView;
  persistWorkspace();
  if (recoveredWorkspace && batchDrafts.some(([source, preview])=>
    (source.endsWith('QuickText') && document.getElementById(source).value.trim()) ||
    document.getElementById(preview).querySelector('tbody tr'))) {
    showToast('已恢复上次未提交的录入，请核对后保存', 'info');
  }
}

// ==================== 本机录入草稿 ====================

function captureWorkspaceDraft(sourceId, previewId) {
  const source = document.getElementById(sourceId);
  let resolved = [];
  try { resolved = JSON.parse(source.dataset.resolved || '[]'); } catch {}
  const table = document.getElementById(previewId).querySelector('tbody');
  return {
    text: sourceId.endsWith('QuickText') ? source.value : '',
    rows: table ? [...table.querySelectorAll('tr')].map(row => {
      const select = row.querySelector('.ep-product');
      const option = select.selectedOptions[0];
      const customer = row.querySelector('.ep-customer').value;
      const choice = row.querySelector('.ep-customer-choice');
      return {
        product: select.value ? { id: select.value, name: option.dataset.name || '',
          unit: option.dataset.unit || '件', spec: option.dataset.spec || '' } : null,
        rawName: resolved?.[Number(row.dataset.idx)]?.parsed?.rawName || '',
        customer, customerChoice: choice?.value ? { id: choice.value, name: choice.selectedOptions[0]?.dataset.name || '' } : null,
        originalCustomer: row.dataset.originalCustomer || '',
        requiresCustomerChoice: row.dataset.customerNeedsChoice === 'true',
        quantity: row.querySelector('.ep-qty').value,
        unit: row.querySelector('.ep-unit').value,
        phone: findCustomer(customer,[{name:row.dataset.customer || ''}]) ? row.dataset.phone || '' : ''
      };
    }) : null
  };
}

function persistWorkspace() {
  if (!workspaceReady) return;
  const modes = Object.fromEntries(['inbound','outbound'].map(direction=>
    [direction, document.querySelector(`#page-${direction} .segmented-control .active`)?.id.replace(`${direction}Mode`,'').toLowerCase() || 'form']));
  const snapshot = {
    tab: getState('currentTab'), modes,
    drafts: Object.fromEntries(batchDrafts.map(([source,preview])=>[source,captureWorkspaceDraft(source,preview)])),
    intents: saveIntents.snapshot(batchScopes)
  };
  if (!workspaceStore.write(snapshot) && !workspaceWarningShown) {
    workspaceWarningShown = true;
    showToast('本机无法保存录入草稿，切换应用前请另留一份原文', 'warning');
  }
}

function restoreWorkspace() {
  const saved = recoveredWorkspace;
  if (!saved) return 'dashboard';
  for (const [sourceId, previewId] of batchDrafts) {
    const draft = saved.drafts?.[sourceId];
    if (!draft || typeof draft !== 'object') continue;
    const source = document.getElementById(sourceId);
    if (sourceId.endsWith('QuickText') && typeof draft.text === 'string') source.value = draft.text;
    if (!Array.isArray(draft.rows)) continue;
    const resolved = draft.rows.filter(row=>row && typeof row === 'object').map(row=>({
      parsed: { rawCustomer: String(row.customer || ''), originalCustomer: String(row.originalCustomer || ''), rawName: String(row.rawName || ''),
        quantity: String(row.quantity ?? ''), unit: String(row.unit || ''),
        customer: typeof row.customerChoice?.id === 'string'
          ? { id: row.customerChoice.id, name: String(row.customerChoice.name || ''), entry_match_pending: row.customerChoice.entry_match_pending === true, _phone:String(row.phone || '') }
          : { _phone:String(row.phone || '') },
        error: validDailyQuantity(Number(row.quantity)) ? null : '数量需更正' },
      product: typeof row.product?.id === 'string' ? { id: row.product.id,
        name: String(row.product.name || ''), spec: String(row.product.spec || ''), unit: String(row.product.unit || '件') } : null,
      requiresCustomerChoice: row.requiresCustomerChoice === true,
      needCreate: false
    }));
    source.dataset.resolved = JSON.stringify(resolved);
    const cachedProducts = [...new Map(resolved.filter(row=>row.product).map(row=>[row.product.id,row.product])).values()];
    renderParsePreview(previewId, resolved, cachedProducts);
    document.getElementById(previewId).querySelectorAll('tbody tr').forEach((row,index)=>{
      row.querySelector('.ep-unit').value = resolved[index].parsed.unit;
    });
  }
  const mode = direction => ['form','quick','excel'].includes(saved.modes?.[direction]) ? saved.modes[direction] : 'form';
  switchInboundMode(mode('inbound'));
  switchOutboundMode(mode('outbound'));
  return ['dashboard','stock','inbound','outbound','customers','records'].includes(saved.tab) ? saved.tab : 'dashboard';
}

function initWorkspacePersistence() {
  const belongsToDraft = element => batchDrafts.some(([source,preview])=>
    element.id === source || document.getElementById(preview).contains(element));
  for (const type of ['input','change']) {
    document.addEventListener(type, event => { if (belongsToDraft(event.target)) persistWorkspace(); });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistWorkspace();
  });
  window.addEventListener('pagehide', persistWorkspace);
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
  document.title = tabName === 'dashboard' ? '三胜达进销存' : `${titles[tabName] || '进销存'} · 三胜达进销存`;

  persistWorkspace();
  await refreshCurrentTab();
}

async function refreshCurrentTab() {
  try {
  const tab = getState('currentTab');
  if (tab === 'dashboard') await renderDashboard();
  else if (tab === 'stock') await renderStock();
  else if (tab === 'inbound') await renderInboundForm();
  else if (tab === 'outbound') await renderOutboundForm();
  else if (tab === 'customers') await renderCustomers();
  else if (tab === 'records') await renderRecords();
  } catch(error) { setDatabaseStatus(false);showToast('加载失败，请检查网络后重试：'+error.message,'error'); }
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

  // 客户模式
  document.getElementById('customerModeForm').addEventListener('click', () => switchCustomerMode('form'));
  document.getElementById('customerModeQuick').addEventListener('click', () => switchCustomerMode('quick'));
  document.getElementById('customerModeExcel').addEventListener('click', () => switchCustomerMode('excel'));

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

  document.getElementById('customerQuickText').addEventListener('input',()=>{
    delete document.getElementById('customerQuickText').dataset.resolved;
    document.getElementById('customerParsePreview').innerHTML='';
    document.getElementById('customerQuickSubmit').style.display='none';
  });
  // 客户快捷 & Excel
  document.getElementById('customerQuickParse').addEventListener('click', handleCustomerQuickParse);
  document.getElementById('customerQuickSubmit').addEventListener('click', handleCustomerQuickSubmit);
  document.getElementById('customerExcelFile').addEventListener('change', handleCustomerExcelImport);
  document.getElementById('customerExcelSubmit').addEventListener('click', handleCustomerExcelSubmit);

  // 可编辑预览中的删除按钮（事件委托，所有预览容器）
  ['inboundParsePreview','outboundParsePreview','inboundExcelPreview','outboundExcelPreview'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
      if (e.target.classList.contains('ep-remove')) {
        e.target.closest('tr').remove();
        persistWorkspace();
      }
    });
  });

  // 记录筛选
  document.getElementById('recordTypeFilter').addEventListener('change', renderRecords);
  document.getElementById('recordFromDate').addEventListener('change', renderRecords);
  document.getElementById('recordToDate').addEventListener('change', renderRecords);
  document.getElementById('recordCustomerFilter').addEventListener('change', renderRecords);
  document.getElementById('recordProductFilter').addEventListener('change', renderRecords);
  document.getElementById('recordProductSearch').addEventListener('input', () => {
    // Invalidate any in-flight query immediately, including during the debounce.
    recordRenderVersion++;
    clearTimeout(recordSearchTimer);
    document.getElementById('recordProductFilter').value = '';
    document.getElementById('recordSummary').textContent = '正在查找…';
    document.getElementById('recordList').replaceChildren();
    document.getElementById('recordList').setAttribute('aria-busy', 'true');
    recordSearchTimer = setTimeout(renderRecords, 250);
  });
  document.getElementById('recordClearFilters').addEventListener('click', () => {
    for (const id of ['recordProductSearch','recordProductFilter','recordCustomerFilter','recordFromDate','recordToDate']) document.getElementById(id).value = '';
    document.getElementById('recordExtraFilters').open = false;
    renderRecords();
  });

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
  persistWorkspace();
}

function switchOutboundMode(mode) {
  document.getElementById('outboundFormMode').style.display = mode === 'form' ? 'block' : 'none';
  document.getElementById('outboundQuickMode').style.display = mode === 'quick' ? 'block' : 'none';
  document.getElementById('outboundExcelMode').style.display = mode === 'excel' ? 'block' : 'none';
  const ids = { form: 'outboundModeForm', quick: 'outboundModeQuick', excel: 'outboundModeExcel' };
  Object.entries(ids).forEach(([k, id]) => document.getElementById(id).classList.toggle('active', k === mode));
  persistWorkspace();
}

function switchCustomerMode(mode) {
  document.getElementById('customerFormMode').style.display = mode === 'form' ? 'block' : 'none';
  document.getElementById('customerQuickMode').style.display = mode === 'quick' ? 'block' : 'none';
  document.getElementById('customerExcelMode').style.display = mode === 'excel' ? 'block' : 'none';
  const ids = { form: 'customerModeForm', quick: 'customerModeQuick', excel: 'customerModeExcel' };
  Object.entries(ids).forEach(([k, id]) => document.getElementById(id).classList.toggle('active', k === mode));
}

// ==================== 📊 仪表盘 ====================

async function renderDashboard() {
  try {
    const [products, customers, stockData] = await Promise.all([
      DB.fetchProducts(),
      DB.fetchCustomers(),
      DB.fetchCurrentStock()
    ]);

    const day = today();
    const [inToday, outToday] = await Promise.all([
      DB.fetchInboundRecords({ from: day, to: day, excludeOpening: true }),
      DB.fetchOutboundRecords({ from: day, to: day, excludeOpening: true })
    ]);

    setDatabaseStatus(true);

    // 统计数据
    document.getElementById('statProductCount').textContent = products.length;
    document.getElementById('statCustomerCount').textContent = customers.length;
    document.getElementById('statTodayIn').textContent = inToday.filter(r => !isOpeningRecord(r)).reduce((s, r) => s + parseFloat(r.quantity), 0) + '件';
    document.getElementById('statTodayOut').textContent = outToday.filter(r => !isOpeningRecord(r)).reduce((s, r) => s + parseFloat(r.quantity), 0) + '件';

    // 低库存预警
    const lowStock = stockData.filter(s => parseFloat(s.stock_qty) <= 5);
    const lowDiv = document.getElementById('dashboardLowStock');
    if (lowStock.length === 0) {
      lowDiv.innerHTML = '<div class="stock-health"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg> 库存充足，无需补货</div>';
    } else {
      lowDiv.innerHTML = lowStock.map(s => `
        <div class="alert-item">
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-stock"></use></svg> ${escapeHtml(s.name)}
          <span class="alert-qty">仅剩 ${formatNum(s.stock_qty)} ${escapeHtml(s.unit)}</span>
        </div>
      `).join('');
    }

    // 最近操作
    const [recentIn, recentOut] = await Promise.all([
      DB.fetchInboundRecords({ excludeOpening: true, limit: 10 }),
      DB.fetchOutboundRecords({ excludeOpening: true, limit: 10 })
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
                  ${isOpeningRecord(r) ? '期初库存 · ' : ''}${r.customer_name ? '👤 ' + escapeHtml(r.customer_name) + ' · ' : ''}${r.recorded_at}
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
    setDatabaseStatus(false);
    console.error('仪表盘加载失败:', err);
    showToast('账本加载失败，请检查网络；页面原有数字可能不是最新库存。','error');
  }
}

// ==================== 📦 库存 ====================

async function renderStock() {
  const search = document.getElementById('stockSearch')?.value || '';
  const container = document.getElementById('stockList');
  try {
    const allStock = await DB.fetchCurrentStock();
    const stockData = allStock.filter(item => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    const totals = new Map();
    for (const item of allStock) {
      const unit = item.unit || '件';
      totals.set(unit, (totals.get(unit) || 0) + Number(item.stock_qty));
    }
    const totalText = [...totals].map(([unit, quantity]) =>
      `<strong>${formatNum(quantity)}</strong><span>${escapeHtml(unit)}</span>`).join('<span class="stock-summary-divider">·</span>');
    document.getElementById('stockSummary').innerHTML =
      `<span>总库存</span><span class="stock-summary-total">${totalText || '<strong>0</strong><span>件</span>'}</span><span class="stock-summary-count">共 ${allStock.length} 个商品${search.trim() ? `，找到 ${stockData.length} 个` : ''}</span>`;
    setDatabaseStatus(true);
    setState('stockCache', stockData);
    if (stockData.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>${search ? '没有找到匹配的商品' : '还没有商品，点右上角＋添加'}</p></div>`;
      return;
    }
    container.innerHTML = stockData.map(item => {
      const qtyClass = item.stock_qty > 0 ? 'qty-positive' : item.stock_qty < 0 ? 'qty-negative' : 'qty-zero';
      return `
        <div class="card stock-card" data-product-id="${item.id}">
          <div class="stock-card-summary">
          <div class="stock-card-emoji"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-stock"></use></svg></div>
          <div class="stock-card-info stock-edit-trigger" data-product-id="${item.id}">
            <div class="stock-card-name">${escapeHtml(item.name)}</div>
            ${item.spec ? `<div class="stock-card-spec">${escapeHtml(item.spec)}</div>` : ''}
          </div>
          <div class="stock-card-qty">
            <div class="qty-num ${qtyClass}">${formatNum(item.stock_qty)}</div>
            <div class="qty-unit">${escapeHtml(item.unit)}</div>
          </div>
          <button class="stock-toggle" type="button" aria-expanded="false" aria-controls="stock-actions-${item.id}" aria-label="库存操作：${escapeHtml(item.name)}，${formatNum(item.stock_qty)}${escapeHtml(item.unit)}" title="展开商品操作"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg></button>
          </div>
          <div class="stock-card-actions" id="stock-actions-${item.id}">
            <button class="btn btn-sm btn-success stock-quick-in" data-id="${item.id}" data-name="${escapeHtml(item.name)}" data-unit="${escapeHtml(item.unit)}" aria-label="入库：${escapeHtml(item.name)}" title="入库"><span class="stock-action-icon" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-inbound"></use></svg></span><span class="stock-action-label" aria-hidden="true">入库</span></button>
            <button class="btn btn-sm btn-danger stock-quick-out" data-id="${item.id}" data-name="${escapeHtml(item.name)}" data-unit="${escapeHtml(item.unit)}" aria-label="出库：${escapeHtml(item.name)}" title="出库"><span class="stock-action-icon" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-outbound"></use></svg></span><span class="stock-action-label" aria-hidden="true">出库</span></button>
            <button class="btn btn-sm btn-outline stock-edit" data-id="${item.id}" aria-label="编辑：${escapeHtml(item.name)}" title="编辑"><span class="stock-action-icon" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg></span><span class="stock-action-label" aria-hidden="true">编辑</span></button>
            <button class="btn btn-sm btn-danger stock-del" data-id="${item.id}" data-name="${escapeHtml(item.name)}" aria-label="删除：${escapeHtml(item.name)}" title="删除"><span class="stock-action-icon" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-delete"></use></svg></span><span class="stock-action-label" aria-hidden="true">删除</span></button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.stock-toggle').forEach(button => {
      button.addEventListener('click', () => {
        const card = button.closest('.stock-card');
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        for (const other of container.querySelectorAll('.stock-card.is-expanded')) {
          other.classList.remove('is-expanded');
          const toggle = other.querySelector('.stock-toggle');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.title = '展开商品操作';
        }
        card.classList.toggle('is-expanded', expanded);
        button.setAttribute('aria-expanded', String(expanded));
        button.title = expanded ? '收起商品操作' : '展开商品操作';
      });
    });

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
    // 点击名字区域或编辑按钮 → 编辑商品（含库存修正）
    container.querySelectorAll('.stock-edit-trigger').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(el.dataset.productId);
      });
    });
    container.querySelectorAll('.stock-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(btn.dataset.id);
      });
    });
    // 删除按钮
    container.querySelectorAll('.stock-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`确定删除「${btn.dataset.name}」？\n（有入库/出库记录的商品无法删除）`)) return;
        try {
          await DB.deleteProduct(btn.dataset.id);
          setState('products', []);
          showToast('已删除「' + btn.dataset.name + '」', 'success');
          await renderStock();
          await renderDashboard();
        } catch (err) {
          showToast('删除失败：' + (err.message || '该商品有出入库记录，无法删除'), 'error');
        }
      });
    });

  } catch (err) {
    document.getElementById('stockSummary').textContent = '总库存暂时无法读取，请刷新重试';
    setDatabaseStatus(false);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>加载失败，检查网络</p></div>`;
  }
}

// ==================== 快捷入库弹窗 ====================

async function openQuickInModal(productId, productName, unit) {
  document.getElementById('quickInTitle').textContent = `📥 快捷入库 - ${productName}`;
  document.getElementById('quickInQty').value = '';
  document.getElementById('quickInModalOverlay').dataset.productId = productId;
  const customers = await loadEntryCustomers();
  document.getElementById('quickInCustomer').innerHTML = '<option value="">选择客户</option>' +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('quickInModalOverlay').style.display = 'flex';
  document.getElementById('quickInQty').focus();
}

async function handleQuickInCore() {
  const productId = document.getElementById('quickInModalOverlay').dataset.productId;
  const qty = Number(document.getElementById('quickInQty').value);
  if (!validDailyQuantity(qty)) { showToast('请输入大于 0 的整数数量', 'warning'); return; }
  const customerId = document.getElementById('quickInCustomer').value || null;
  try {
    await saveDailyRecord('quickInModalOverlay','createInbound',{ product_id: productId, customer_id: customerId, quantity: qty, recorded_at: today() });
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
  const customers = await loadEntryCustomers();
  document.getElementById('quickOutCustomer').innerHTML = '<option value="">选择客户</option>' +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('quickOutModalOverlay').style.display = 'flex';
  document.getElementById('quickOutQty').focus();
}

async function handleQuickOutCore() {
  const productId = document.getElementById('quickOutModalOverlay').dataset.productId;
  const qty = Number(document.getElementById('quickOutQty').value);
  if (!validDailyQuantity(qty)) { showToast('请输入大于 0 的整数数量', 'warning'); return; }
  const customerId = document.getElementById('quickOutCustomer').value || null;
  try {
    await saveDailyRecord('quickOutModalOverlay','createOutbound',{ product_id: productId, customer_id: customerId, quantity: qty, recorded_at: today() });
    showToast('出库成功 ✅', 'success');
    document.getElementById('quickOutModalOverlay').style.display = 'none';
    await renderStock();
    await renderDashboard();
  } catch (err) { showToast('出库失败: ' + err.message, 'error'); }
}

// ==================== 📥 入库 ====================

async function renderInboundForm() {
  const previousProduct = document.getElementById('inboundProduct').value;
  const previousCustomer = document.getElementById('inboundCustomer').value;
  const [products, customers] = await Promise.all([loadProducts(), loadEntryCustomers()]);
  const pSel = document.getElementById('inboundProduct');
  pSel.innerHTML = '<option value="">请选择商品</option>' +
    products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} ${p.spec ? '(' + escapeHtml(p.spec) + ')' : ''}</option>`).join('');
  const cSel = document.getElementById('inboundCustomer');
  cSel.innerHTML = '<option value="">请选择客户（可选）</option>' +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)} ${c.phone ? '📱' + escapeHtml(c.phone) : ''}</option>`).join('');
  document.getElementById('inboundProduct').value = previousProduct;
  restoreFormCustomer(cSel, previousCustomer);
  if (!document.getElementById('inboundDate').value) document.getElementById('inboundDate').value = today();
}

async function handleInboundSubmitCore(e) {
  e.preventDefault();
  const product_id = document.getElementById('inboundProduct').value;
  if (!product_id) { showToast('请选择商品', 'warning'); return; }
  const qty = Number(document.getElementById('inboundQty').value);
  if (!validDailyQuantity(qty)) { showToast('请输入大于 0 的整数数量', 'warning'); return; }
  const customer_id = document.getElementById('inboundCustomer').value || null;
  try {
    await saveDailyRecord('inboundForm','createInbound',{
      product_id, customer_id, quantity: qty,
      unit_price: null,
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
  try {
  const customers = await loadEntryCustomers(true);
  const products = await loadProducts(true);
  const parsed = parseQuickEntry(text, customers, products);
  if (document.getElementById('inboundQuickText').value !== text) return;
  const resolved = resolveProducts(parsed, products);
  document.getElementById('inboundQuickText').dataset.resolved = JSON.stringify(resolved);
  renderParsePreview('inboundParsePreview', resolved);
  } catch(error) { showToast('解析未完成，原文已保留：'+error.message,'error'); }
}

async function handleInboundQuickSubmit() {
  await submitQuickData('inboundQuickText', 'batchCreateInbound');
}

async function handleInboundExcelImport(e) {
  await handleExcelFile(e, 'inboundExcelFile', 'inboundExcelPreview', 'inboundExcelSubmit');
}

async function handleInboundExcelSubmit() {
  await submitExcelData('inboundExcelFile', 'batchCreateInbound');
}

// ==================== 📤 出库 ====================

async function renderOutboundForm() {
  const previousProduct = document.getElementById('outboundProduct').value;
  const previousCustomer = document.getElementById('outboundCustomer').value;
  const [products, customers] = await Promise.all([loadProducts(), loadEntryCustomers()]);
  document.getElementById('outboundProduct').innerHTML = '<option value="">请选择商品</option>' +
    products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} ${p.spec ? '(' + escapeHtml(p.spec) + ')' : ''}</option>`).join('');
  document.getElementById('outboundCustomer').innerHTML = '<option value="">请选择客户（可选）</option>' +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)} ${c.phone ? '📱' + escapeHtml(c.phone) : ''}</option>`).join('');
  document.getElementById('outboundProduct').value = previousProduct;
  restoreFormCustomer(document.getElementById('outboundCustomer'), previousCustomer);
  if (!document.getElementById('outboundDate').value) document.getElementById('outboundDate').value = today();
}

async function handleOutboundSubmitCore(e) {
  e.preventDefault();
  const product_id = document.getElementById('outboundProduct').value;
  if (!product_id) { showToast('请选择商品', 'warning'); return; }
  const qty = Number(document.getElementById('outboundQty').value);
  if (!validDailyQuantity(qty)) { showToast('请输入大于 0 的整数数量', 'warning'); return; }
  const customer_id = document.getElementById('outboundCustomer').value || null;
  try {
    const stock = await DB.fetchProductStock(product_id);
    if (stock && qty > parseFloat(stock.stock_qty)) {
      if (!confirm(`库存不足！当前库存: ${formatNum(stock.stock_qty)} ${stock.unit}，是否继续出库？`)) return;
    }
  } catch (err) {}

  try {
    await saveDailyRecord('outboundForm','createOutbound',{
      product_id, customer_id, quantity: qty,
      unit_price: null,
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
  try {
  const customers = await loadEntryCustomers(true);
  const products = await loadProducts(true);
  const parsed = parseQuickEntry(text, customers, products);
  if (document.getElementById('outboundQuickText').value !== text) return;
  const resolved = resolveProducts(parsed, products);
  document.getElementById('outboundQuickText').dataset.resolved = JSON.stringify(resolved);
  renderParsePreview('outboundParsePreview', resolved);
  } catch(error) { showToast('解析未完成，原文已保留：'+error.message,'error'); }
}

async function handleOutboundQuickSubmit() {
  await submitQuickData('outboundQuickText', 'batchCreateOutbound');
}

async function handleOutboundExcelImport(e) {
  await handleExcelFile(e, 'outboundExcelFile', 'outboundExcelPreview', 'outboundExcelSubmit');
}

async function handleOutboundExcelSubmit() {
  await submitExcelData('outboundExcelFile', 'batchCreateOutbound');
}

/**
 * 从可编辑预览表格收集数据
 */
function collectEditablePreview(containerId) {
  const rows = [...document.getElementById(containerId).querySelectorAll('tbody tr')];
  const items = [];
  for (const [index, row] of rows.entries()) {
    const nameInput = row.querySelector('.ep-product');
    const qtyInput = row.querySelector('.ep-qty');
    const productId = nameInput.value;
    const rawName = nameInput.selectedOptions[0]?.dataset.name || '';
    const quantity = Number(qtyInput.value);
    if (!productId) {
      row.classList.add('row-error');
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      showToast(`第 ${index + 1} 行请选择已有商品；新商品请先在库存中添加`, 'warning');
      return null;
    }
    if (!validDailyQuantity(quantity)) {
      row.classList.add('row-error');
      qtyInput.setAttribute('aria-invalid', 'true');
      qtyInput.focus();
      showToast(`第 ${index + 1} 行请输入大于 0 的整数数量`, 'warning');
      return null;
    }
    const rawCustomer = row.querySelector('.ep-customer').value.trim();
    const choice = row.querySelector('.ep-customer-choice');
    if (rawCustomer !== row.dataset.customerLookup) syncPreviewCustomer(row);
    if (!choice.value && (rawCustomer || row.dataset.customerNeedsChoice === 'true')) {
      row.classList.add('row-error');
      const picker = row.querySelector('.ep-customer-picker');
      picker.focus();
      picker.setAttribute('aria-invalid', 'true');
      showToast(`第 ${index + 1} 行${rawCustomer ? '「' + rawCustomer + '」' : ''}请选择已有客户；新客户请先在客户页添加`, 'warning');
      return null;
    }
    items.push({ productId, customerId: choice.value || null, rawCustomer, rawName, quantity, unit: row.querySelector('.ep-unit').value.trim(), phone: row.dataset.customer === rawCustomer ? row.dataset.phone || '' : '' });
  }
  return items;
}

function initEntryPreviewGuards() {
  initEntryCustomerPicker();
  for (const direction of ['inbound', 'outbound']) {
    document.getElementById(`${direction}QuickText`).addEventListener('input', () => {
      delete document.getElementById(`${direction}QuickText`).dataset.resolved;
      document.getElementById(`${direction}ParsePreview`).innerHTML = '';
      document.getElementById(`${direction}QuickSubmit`).style.display = 'none';
    });
    for (const previewId of [`${direction}ParsePreview`, `${direction}ExcelPreview`]) {
      const preview = document.getElementById(previewId);
      preview.addEventListener('click', event => {
        const button = event.target.closest('.ep-customer-picker');
        if (button) openEntryCustomerPicker(button.closest('tr'));
      });
      const onEdit = event => {
        event.target.removeAttribute('aria-invalid');
        const row = event.target.closest('tr');
        if (!row) return;
        if (event.target.matches('.ep-customer')) syncPreviewCustomer(row);
        updateEntryPreviewRow(row, event.target.matches('.ep-product'));
      };
      preview.addEventListener('input', onEdit);
      preview.addEventListener('change', onEdit);
    }
  }
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  document.getElementById('installApp').hidden = false;
});

function initInstallButton() {
  const button = document.getElementById('installApp');
  button.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    button.hidden = true;
    await prompt.prompt();
  });
  window.addEventListener('appinstalled', () => { button.hidden = true; installPrompt = null; });
}

// ==================== Excel 通用 ====================

async function handleExcelFile(e, fileId, previewId, submitId) {
  const input=document.getElementById(fileId);
  const version=String((Number(input.dataset.readVersion)||0)+1);input.dataset.readVersion=version;
  document.getElementById(previewId).innerHTML = '';
  document.getElementById(submitId).style.display = 'none';
  persistWorkspace();
  const file = e.target.files[0];
  if (!file) return;
  try {
    const rows = await readExcelFile(file);
    const [customers, products] = await Promise.all([loadEntryCustomers(true), loadProducts()]);
    if(input.dataset.readVersion!==version)return;
    const { resolved } = parseExcelData(rows, customers, products);
    document.getElementById(fileId).dataset.resolved = JSON.stringify(resolved);
    renderExcelPreview(previewId, resolved);
    showToast(`已解析 ${resolved.length} 条记录`, 'info');
  } catch (err) { if(input.dataset.readVersion===version)showToast('Excel 解析失败: ' + err.message, 'error'); }
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
  // Excel 也使用可编辑预览
  renderParsePreview(containerId, resolved);
}

async function submitExcelData(fileId, opType) {
  const direction = fileId.startsWith('inbound') ? 'inbound' : 'outbound';
  return submitBatchPreview(`${direction}ExcelPreview`, fileId, `${direction}ExcelSubmit`, opType);
}

async function submitQuickData(textId, opType) {
  const direction = textId.startsWith('inbound') ? 'inbound' : 'outbound';
  return submitBatchPreview(`${direction}ParsePreview`, textId, `${direction}QuickSubmit`, opType);
}

async function submitBatchPreviewCore(previewId, inputId, buttonId, opType) {
  const button = document.getElementById(buttonId);
  const editedItems = collectEditablePreview(previewId);
  if (!editedItems) return false;
  if (!editedItems.length) { showToast('请先解析预览，检查商品和数量', 'warning'); return false; }
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '正在保存…';
  try {
    const [products, customers] = await Promise.all([loadProducts(true), loadEntryCustomers(true)]);
    const customersById = new Map(customers.map(customer => [customer.id, customer]));
    const unitKey = unit => ({ kg: '公斤', '千克': '公斤', g: '克' })[unit.toLowerCase()] || unit;
    for (const item of editedItems) {
      if ((item.customerId || item.rawCustomer) && !customersById.has(item.customerId)) {
        throw new Error(`请为「${item.rawCustomer || '该行'}」重新选择已有客户，这批记录尚未保存`);
      }
      const product = products.find(product=>product.id===item.productId);
      if (!product) throw new Error(`「${item.rawName}」已不在商品资料中，请重新解析并选择已有商品`);
      if (product && item.unit && unitKey(item.unit) !== unitKey(product.unit)) {
        throw new Error(`「${product.name}」的单位是「${product.unit}」，请核对数量并将单位改为「${product.unit}」`);
      }
    }
    const records = [];
    for (const item of editedItems) {
      const product = products.find(product=>product.id===item.productId);
      const customer = customersById.get(item.customerId);
      records.push({
        product_id: product.id, customer_id: customer?.id || null,
        customer_name: customer?.name || '', quantity: item.quantity,
        unit_price: null, note: '', recorded_at: today()
      });
    }
    const payloads = saveIntents.records(inputId,records,{preserveDate:true});
    persistWorkspace();
    await DB[opType](payloads);
    document.getElementById(inputId).value = '';
    delete document.getElementById(inputId).dataset.resolved;
    document.getElementById(previewId).innerHTML = '';
    button.style.display = 'none';
    saveIntents.complete(inputId);
    persistWorkspace();
    showToast(`保存成功，共 ${records.length} 条`, 'success');
    await renderDashboard();
    return true;
  } catch (err) {
    showToast('保存失败，内容已保留：' + err.message, 'error');
    return false;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// ==================== 📋 记录 ====================

let recordRenderVersion = 0;
let recordSearchTimer;
async function renderRecords() {
  clearTimeout(recordSearchTimer);
  const version = ++recordRenderVersion;
  const type = document.getElementById('recordTypeFilter').value;
  const from = document.getElementById('recordFromDate').value;
  const to = document.getElementById('recordToDate').value;
  const customerId = document.getElementById('recordCustomerFilter').value;
  const search = document.getElementById('recordProductSearch').value.trim();
  const selectedProduct = document.getElementById('recordProductFilter').value;
  document.getElementById('recordExtraSummary').textContent = `日期 / 客户筛选${from || to || customerId ? '（已设置）' : ''}`;
  const container = document.getElementById('recordList');
  const summary = document.getElementById('recordSummary');
  container.replaceChildren();
  container.setAttribute('aria-busy', 'true');
  summary.textContent = '正在查找…';
  try {
    if (from && to && from > to) {
      summary.textContent = '开始日期不能晚于结束日期，请调整日期';
      return;
    }
    const [customers, products] = await Promise.all([loadCustomers(), loadProducts()]);
    if (version !== recordRenderVersion) return;
    const cSel = document.getElementById('recordCustomerFilter');
    cSel.innerHTML = '<option value="">全部客户</option>' +
      customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    cSel.value = customerId;
    const candidates = searchProducts(search, products);
    const pSel = document.getElementById('recordProductFilter');
    const matchLabel = candidates.length === 1 ? candidates[0].name : `全部匹配商品（${candidates.length}种）`;
    pSel.innerHTML = `<option value="">${search ? escapeHtml(matchLabel) : '全部商品'}</option>` +
      candidates.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.spec ? `（${escapeHtml(p.spec)}）` : ''}</option>`).join('');
    pSel.value = candidates.some(p => p.id === selectedProduct) ? selectedProduct : '';
    const productIds = pSel.value ? [pSel.value] : search ? candidates.map(p => p.id) : undefined;
    if (productIds?.length === 0) {
      summary.textContent = '未找到匹配商品';
      container.innerHTML = '<div class="empty-state"><p>试试商品全名或其他简称，也可以清除筛选后选择商品。</p></div>';
      return;
    }
    const options = { from, to, customerId: customerId || undefined, productIds, excludeOpening: true };
    const records = type === 'inbound'
      ? await DB.fetchInboundRecords(options)
      : await DB.fetchOutboundRecords(options);
    if (version !== recordRenderVersion) return;
    const totals = new Map();
    for (const record of records) {
      const unit = record.products?.unit || '单位未设';
      totals.set(unit, (totals.get(unit) || 0) + Number(record.quantity));
    }
    const totalText = [...totals].map(([unit, quantity]) => `${formatNum(quantity)}${unit}`).join('、');
    summary.textContent = `${type === 'inbound' ? '入库' : '出库'} ${records.length} 条${totalText ? `，共 ${totalText}` : ''}`;

    if (records.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>当前条件下暂无记录，可切换出入库类型或调整筛选。</p></div>';
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
                  <span style="font-size:0.7rem;color:var(--color-text-muted);margin-left:8px;">${escapeHtml(r.note||'')}</span>
                </div>
                <div style="font-weight:700;text-align:right;min-width:50px;${isIn?'color:var(--color-success)':'color:var(--color-danger)'}">
                  ${isIn?'+':'-'}${formatNum(r.quantity)} ${escapeHtml(unit)}
                </div>
                ${isOpeningRecord(r) ? '<span class="opening-record-tag">期初</span>' : `<button class="btn btn-sm btn-danger record-del" data-id="${r.id}" data-type="${type}" title="删除记录" style="opacity:0.4;font-size:0.7rem;padding:3px 6px;">✕</button>`}
              </div>
            </div>`;
        }).join('')}
      `).join('');

    // 删除记录按钮
    container.querySelectorAll('.record-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const recordId = btn.dataset.id;
        const recordType = btn.dataset.type;
        if (!confirm(`确定删除这条${recordType === 'inbound' ? '入库' : '出库'}记录？\n库存数量会自动更新。`)) return;
        try {
          if (recordType === 'inbound') {
            await DB.deleteInboundRecord(recordId);
          } else {
            await DB.deleteOutboundRecord(recordId);
          }
          showToast('已删除 ✅', 'success');
          await renderRecords();
          await renderDashboard();
        } catch (err) {
          showToast('删除失败: ' + err.message, 'error');
        }
      });
    });

  } catch (err) {
    if (version !== recordRenderVersion) return;
    summary.textContent = '记录加载失败';
    container.innerHTML = '<div class="empty-state"><p>请检查网络后重试。</p><button type="button" class="btn btn-outline record-retry">重新加载</button></div>';
    container.querySelector('.record-retry').addEventListener('click', renderRecords);
  } finally {
    if (version === recordRenderVersion) container.setAttribute('aria-busy', 'false');
  }
}

// ==================== 👥 客户 ====================

function directoryResults(search, customers) {
  if (!search) return customers.map(customer => ({ customer }));
  const key = value => String(value || '').normalize('NFKC').toLowerCase().trim();
  const query = key(search);
  const recognized = new Set(matchingCustomers(search, customers));
  const exactNames = [], recognizedNames = [], partial = [];
  for (const customer of customers) {
    const name = key(customer.name);
    const aliases = Array.isArray(customer.aliases) ? customer.aliases : [];
    const alias = aliases.find(value => key(value) === query) || aliases.find(value => key(value).includes(query));
    const row = { customer, detail: alias && !name.includes(query) ? `别名 · ${alias}` : '' };
    if (name === query) exactNames.push(row);
    else if (recognized.has(customer) || (alias && key(alias) === query)) recognizedNames.push(row);
    else if (name.includes(query) || alias || key(customer.phone).includes(query)) partial.push(row);
  }
  const results = [...exactNames, ...recognizedNames, ...partial];
  const visible = new Set(results.map(row => row.customer));
  for (const customer of suggestedCustomers(search, customers)) {
    if (!visible.has(customer)) results.push({ customer, detail: '可能匹配' });
  }
  return results;
}

let customerRenderVersion = 0;
async function renderCustomers() {
  const version = ++customerRenderVersion;
  const input = document.getElementById('customerSearch');
  const search = input.value.trim();
  const customers = await loadCustomers(true);
  if (version !== customerRenderVersion || search !== input.value.trim()) return;
  const results = directoryResults(search, customers);
  const container = document.getElementById('customerList');
  if (results.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>${search ? '没有匹配的客户' : '还没有客户，点右上角＋添加'}</p></div>`;
    return;
  }
  container.innerHTML = results.map(({ customer: c, detail }) => `
    <div class="card stock-card">
      <div class="stock-card-emoji"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-customers"></use></svg></div>
      <div class="stock-card-info">
        <div class="stock-card-name">${escapeHtml(c.name)}</div>
        ${detail ? `<div class="stock-card-spec">${escapeHtml(detail)}</div>` : ''}
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
  // 隐藏库存修正区域
  const stockSection = document.getElementById('productModalStockSection');
  if (stockSection) stockSection.style.display = 'none';
  document.getElementById('productModalOverlay').style.display = 'flex';
  document.getElementById('productModalName').focus();
}

async function openEditModal(productId) {
  const products = await loadProducts();
  const p = products.find(pr => pr.id === productId);
  if (!p) { showToast('商品信息未找到', 'error'); return; }

  document.getElementById('productModalTitle').textContent = '编辑商品';
  document.getElementById('productModalName').value = p.name || '';
  document.getElementById('productModalSpec').value = p.spec || '';
  document.getElementById('productModalUnit').value = p.unit || '件';
  document.getElementById('productModalOverlay').dataset.editId = p.id;

  // 显示库存修正区域
  const stockSection = document.getElementById('productModalStockSection');
  if (stockSection) {
    stockSection.style.display = 'block';
    try {
      const stock = await DB.fetchProductStock(productId);
      const currentQty = stock ? formatNum(stock.stock_qty) : '0';
      document.getElementById('productModalStockQty').textContent = currentQty;
      document.getElementById('productModalStockUnit').textContent = p.unit || '件';
      document.getElementById('productModalAdjustQty').value = '';
      document.getElementById('productModalAdjustNote').value = '';
    } catch (err) {
      stockSection.style.display = 'none';
    }
  }

  document.getElementById('productModalOverlay').style.display = 'flex';
  document.getElementById('productModalName').focus();
}

function closeProductModal() { document.getElementById('productModalOverlay').style.display = 'none'; }

async function handleProductSaveCore() {
  const name = document.getElementById('productModalName').value.trim();
  if (!name) { showToast('请输入商品名称', 'warning'); return; }
  const editId = document.getElementById('productModalOverlay').dataset.editId;
  const spec = document.getElementById('productModalSpec').value.trim();
  const unit = document.getElementById('productModalUnit').value.trim() || '件';
  const adjustment = document.getElementById('productModalAdjustQty');
  if (editId && adjustment && adjustment.value !== '' &&
      (!Number.isSafeInteger(Number(adjustment.value)) || Math.abs(Number(adjustment.value)) > 9999999999)) {
    showToast('库存修正请输入整数', 'warning');
    return;
  }

  try {
    // 保存商品信息
    editId
      ? await DB.updateProduct(editId, { name, spec, unit })
      : await DB.createProduct({ name, spec, unit });

    setState('products', []);

    // 库存修正（仅编辑时可用）
    const adjustInput = document.getElementById('productModalAdjustQty');
    if (editId && adjustInput && adjustInput.value !== '') {
      const targetQty = Number(adjustInput.value);
      if (Number.isSafeInteger(targetQty)) {
        const stock = await DB.fetchProductStock(editId);
        const currentQty = stock ? parseFloat(stock.stock_qty) : 0;
        const diff = targetQty - currentQty;

        if (Math.abs(diff) > 0.001) {
          const adjustNote = document.getElementById('productModalAdjustNote').value.trim() || '库存修正';
          if (diff > 0) {
            await DB.createInbound({
              product_id: editId,
              quantity: diff,
              unit_price: null,
              note: '🔧 ' + adjustNote,
              recorded_at: today()
            });
          } else {
            await DB.createOutbound({
              product_id: editId,
              quantity: Math.abs(diff),
              unit_price: null,
              note: '🔧 ' + adjustNote,
              recorded_at: today()
            });
          }
          showToast(`库存已从 ${formatNum(currentQty)} 修正为 ${formatNum(targetQty)}`, 'success');
        }
      }
    }

    showToast(editId ? '已更新' : '已添加', 'success');
    closeProductModal();
    await renderStock();
    await renderDashboard();
  } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
}

// ==================== 客户批量导入 ====================

function parseCustomerLines(text) {
  return text.split(/[\n;；]/).map(line => line.trim()).filter(Boolean).map((line, idx) => {
    const parts = line.split(/\s+/);
    const name = parts[0] || '';
    const phone = parts[1] && /[\d-]{7,}/.test(parts[1]) ? parts[1] : '';
    const note = parts.slice(phone ? 2 : 1).join(' ');
    return { name, phone, note, _raw: line };
  });
}

function renderCustomerImport(inputId, previewId, buttonId, parsed, existing) {
  const resolved = planCustomerImport(parsed, existing);
  const input = document.getElementById(inputId);
  const newCustomers = resolved.filter(row => !row.exists);
  input.dataset.resolved = JSON.stringify(resolved);
  document.getElementById(previewId).innerHTML = `<div class="parse-preview"><table><thead><tr><th>客户名</th><th>电话</th><th>备注</th><th>状态</th></tr></thead><tbody>${resolved.map(row=>`<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.phone)}</td><td>${escapeHtml(row.note)}</td><td>${row.exists ? '已存在或本批重复，跳过' : '待新增'}</td></tr>`).join('')}</tbody></table></div>`;
  const button = document.getElementById(buttonId);
  button.textContent = `确认新增 ${newCustomers.length} 位客户`;
  button.style.display = newCustomers.length ? 'block' : 'none';
}
async function handleCustomerQuickParse() {
  const text = document.getElementById('customerQuickText').value;
  if (!text.trim()) { showToast('请粘贴内容', 'warning'); return; }
  try { const existing=await loadCustomers(true);if(document.getElementById('customerQuickText').value!==text)return;renderCustomerImport('customerQuickText','customerParsePreview','customerQuickSubmit',parseCustomerLines(text),existing); }
  catch (error) { showToast('解析失败：' + error.message, 'error'); }
}
async function submitCustomers(inputId,previewId,buttonId,scopeId) {
  return withSaveLock(scopeId, async()=>{
    const input = document.getElementById(inputId);
    if (!input.dataset.resolved) return;
    const rows = JSON.parse(input.dataset.resolved);
    try {
      const result = await saveCustomerImport(rows, DB, pending => {
        const names = pending.slice(0, 8).map(row => row.name).join('、');
        const more = pending.length > 8 ? '等，完整名单见预览' : '';
        return confirm(`要在账本里新增 ${pending.length} 位客户吗？\n${names}${more}`);
      });
      if (result.cancelled) return;
      setState('customers',null);
      if (result.failed.length) {
        // Retain the complete source; fresh rechecking skips successful rows on retry.
        showToast(`已添加 ${result.saved} 个，${result.failed.length} 个未完成，内容已保留：${result.failed[0].error}`, 'error');
      } else {
        showToast(`已添加 ${result.saved} 个，跳过 ${result.skipped} 个已有或重复客户`, 'success');
        input.value='';delete input.dataset.resolved;
        document.getElementById(previewId).innerHTML='';document.getElementById(buttonId).style.display='none';
      }
      await renderCustomers();await renderDashboard();
    } catch (error) { showToast('导入未完成，内容已保留：'+error.message,'error'); }
  });
}
async function handleCustomerQuickSubmit() { return submitCustomers('customerQuickText','customerParsePreview','customerQuickSubmit','customerQuickMode'); }
async function handleCustomerExcelImport(event) {
  const input=document.getElementById('customerExcelFile');
  const version=String((Number(input.dataset.readVersion)||0)+1);input.dataset.readVersion=version;
  delete input.dataset.resolved;document.getElementById('customerExcelPreview').innerHTML='';document.getElementById('customerExcelSubmit').style.display='none';
  const file=event.target.files[0];if(!file)return;
  try {
    const rows=await readExcelFile(file);const existing=await loadCustomers(true);
    if(input.dataset.readVersion!==version)return;
    renderCustomerImport('customerExcelFile','customerExcelPreview','customerExcelSubmit',parseCustomerExcel(rows),existing);
  }
  catch(error) { if(input.dataset.readVersion===version)showToast('Excel 解析失败：'+error.message,'error'); }
}
async function handleCustomerExcelSubmit() { return submitCustomers('customerExcelFile','customerExcelPreview','customerExcelSubmit','customerExcelMode'); }

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

async function handleCustomerSaveCore() {
  const name = document.getElementById('customerModalName').value.trim();
  if (!name) { showToast('请输入客户名称', 'warning'); return; }
  const editId = document.getElementById('customerModalOverlay').dataset.editId;
  const data = { name, phone: document.getElementById('customerModalPhone').value.trim(), note: document.getElementById('customerModalNote').value.trim() };
  try {
    if (editId) {
      await DB.updateCustomer(editId, data);
    } else {
      const customers = await loadCustomers(true);
      const closeNames = suggestedCustomers(name, customers).slice(0, 3).map(customer => customer.name);
      const hint = closeNames.length ? `\n账上有相近的客户：${closeNames.join('、')}。如果是同一位，请取消。` : '';
      if (!confirm(`要在账本里新增客户「${name}」吗？${hint}`)) return;
      await DB.createCustomer(data);
    }
    setState('customers',null);
    showToast(editId ? '已更新' : `已新增客户「${name}」`, 'success');
    closeCustomerModal();
    await renderCustomers();
    await renderDashboard();
    if (getState('currentTab') === 'inbound') await renderInboundForm();
    if (getState('currentTab') === 'outbound') await renderOutboundForm();
  } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
}

// ==================== 解析预览 ====================

let pickerRow = null;
let pickerLimit = 20;

function closeEntryCustomerPicker() {
  const dialog = document.getElementById('entryCustomerPicker');
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  const button = pickerRow?.querySelector('.ep-customer-picker');
  pickerRow = null;
  if (button?.isConnected) button.focus({ preventScroll: true });
}

function openEntryCustomerPicker(row) {
  pickerRow = row;
  pickerLimit = 20;
  const search = document.getElementById('entryCustomerSearch');
  search.value = '';
  const original = row.dataset.originalCustomer || row.querySelector('.ep-customer').value.trim();
  const caption = document.getElementById('entryCustomerOriginal');
  caption.textContent = original ? '原文 · ' + original : '';
  caption.hidden = !original;
  const dialog = document.getElementById('entryCustomerPicker');
  renderEntryCustomerOptions();
  if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  search.focus();
}

function renderEntryCustomerOptions() {
  if (!pickerRow?.isConnected) {
    if (pickerRow) closeEntryCustomerPicker();
    return;
  }
  const search = document.getElementById('entryCustomerSearch').value.trim();
  const catalog = (getState('customers') || []).filter(isEntryCustomer);
  const selectedId = pickerRow.querySelector('.ep-customer-choice').value;
  document.getElementById('entryCustomerClear').hidden = !search;
  document.getElementById('entryCustomerUnset').hidden = !selectedId;
  let results;
  if (search) {
    results = directoryResults(search, catalog);
  } else {
    const recommended = suggestedCustomers(pickerRow.querySelector('.ep-customer').value, catalog).slice(0, 6);
    const first = new Set(recommended);
    results = [
      ...recommended.map(customer => ({ customer, detail: '推荐' })),
      ...catalog.filter(customer => !first.has(customer)).map(customer => ({ customer }))
    ];
  }
  const counts = new Map();
  for (const customer of catalog) counts.set(customer.name, (counts.get(customer.name) || 0) + 1);
  const options = results.slice(0, pickerLimit).map(({ customer, detail }) => {
    const sameName = counts.get(customer.name) > 1;
    const info = [customer.id === selectedId ? '已选' : detail, customer.phone, sameName && customer.note,
      sameName && '#' + String(customer.id).slice(-6)].filter(Boolean).join(' · ');
    return `<button type="button" class="entry-customer-option" data-customer-id="${escapeHtml(customer.id)}">
      <strong>${escapeHtml(customer.name)}</strong>${info ? `<small>${escapeHtml(info)}</small>` : ''}</button>`;
  });
  if (results.length > pickerLimit) options.push('<button type="button" class="btn btn-outline" data-more>显示更多客户</button>');
  const empty = search ? '没有找到客户，可以换个名字或电话号码试试。' : '暂无可选客户，请检查客户名单。';
  document.getElementById('entryCustomerResults').innerHTML = options.join('') || `<p class="form-hint" role="status">${empty}</p>`;
}

function chooseEntryCustomer(customer) {
  if (!pickerRow?.isConnected) { closeEntryCustomerPicker(); return; }
  const row = pickerRow;
  const raw = row.querySelector('.ep-customer').value.trim();
  if (!customer) row.querySelector('.ep-customer-choice').value = '';
  row.dataset.customerNeedsChoice = String(!customer && Boolean(raw));
  syncPreviewCustomer(row, { trusted: customer });
  updateEntryPreviewRow(row);
  if (customer && raw) {
    for (const other of row.parentElement.rows) {
      if (other !== row && !other.querySelector('.ep-customer-choice').value && other.querySelector('.ep-customer').value.trim() === raw) {
        syncPreviewCustomer(other, { trusted: customer });
        updateEntryPreviewRow(other);
      }
    }
  }
  persistWorkspace();
  closeEntryCustomerPicker();
}

function initEntryCustomerPicker() {
  const dialog = document.getElementById('entryCustomerPicker');
  const search = document.getElementById('entryCustomerSearch');
  document.getElementById('entryCustomerClose').addEventListener('click', closeEntryCustomerPicker);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeEntryCustomerPicker(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeEntryCustomerPicker(); });
  search.addEventListener('input', () => { pickerLimit = 20; renderEntryCustomerOptions(); });
  document.getElementById('entryCustomerClear').addEventListener('click', () => {
    search.value = ''; pickerLimit = 20; renderEntryCustomerOptions(); search.focus();
  });
  document.getElementById('entryCustomerUnset').addEventListener('click', () => chooseEntryCustomer(null));
  document.getElementById('entryCustomerResults').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-more')) { pickerLimit += 20; renderEntryCustomerOptions(); return; }
    const customer = (getState('customers') || []).find(c => c.id === button.dataset.customerId && isEntryCustomer(c));
    if (customer) chooseEntryCustomer(customer);
    else renderEntryCustomerOptions();
  });
}

// Keep the typed label separate from the customer ID the user will actually book to.
function syncPreviewCustomer(row, { catalog = getState('customers')?.filter(isEntryCustomer), trusted } = {}) {
  const input = row.querySelector('.ep-customer');
  const choice = row.querySelector('.ep-customer-choice');
  const raw = input.value.trim();
  const edited = row.dataset.customerLookup !== undefined && row.dataset.customerLookup !== raw;
  const previous = choice.selectedOptions[0];
  const saved = trusted || (!edited && choice.value ? { id: choice.value, name: previous.dataset.name } : null);
  let customer = null;
  if (edited) row.dataset.customerNeedsChoice = 'false';
  if (saved?.id) {
    if (isEntryCustomer(saved)) customer = catalog == null ? saved : catalog.find(c => String(c.id) === String(saved.id));
    row.dataset.customerNeedsChoice = String(!customer);
  } else if (row.dataset.customerNeedsChoice !== 'true' && raw) {
    customer = findCustomer(raw, catalog || []);
  }
  row.dataset.customerLookup = raw;
  const unresolved = !customer && Boolean(raw || row.dataset.customerNeedsChoice === 'true');
  choice.innerHTML = customer ? `<option selected value="${escapeHtml(customer.id)}" data-name="${escapeHtml(customer.name)}">${escapeHtml(customer.name)}</option>` : '<option value=""></option>';
  const button = row.querySelector('.ep-customer-picker');
  button.textContent = customer?.name || (unresolved ? '请选择客户' : '选择客户（可选）');
  button.removeAttribute('aria-invalid');
  input.hidden = !unresolved && document.activeElement !== input;
  const source = row.querySelector('.ep-customer-source');
  const original = row.dataset.originalCustomer || raw;
  source.textContent = customer && original && customer.name !== original ? '原文：' + original : '';
  source.hidden = !source.textContent;
}

function refreshPreviewCustomers(customers) {
  const catalog = customers.filter(isEntryCustomer);
  for (const [, previewId] of batchDrafts) {
    for (const choice of document.getElementById(previewId).querySelectorAll('.ep-customer-choice')) {
      const row = choice.closest('tr');
      syncPreviewCustomer(row, { catalog });
      updateEntryPreviewRow(row);
    }
  }
  if (pickerRow) renderEntryCustomerOptions();
  persistWorkspace();
}

function updateEntryPreviewRow(row, productChanged = false, initial = false) {
  const select = row.querySelector('.ep-product');
  const unitInput = row.querySelector('.ep-unit');
  const selected = select.selectedOptions[0];
  if (productChanged && select.value) unitInput.value = selected.dataset.unit || '件';
  const missing = !select.value;
  const invalidQty = !validDailyQuantity(Number(row.querySelector('.ep-qty').value));
  const needsCustomer = !row.querySelector('.ep-customer-choice').value && (row.querySelector('.ep-customer').value.trim() || row.dataset.customerNeedsChoice === 'true');
  const unitKey = value => ({kg:'公斤','千克':'公斤',g:'克'})[value.toLowerCase()] || value;
  const invalidUnit = !missing && Boolean(unitInput.value.trim()) && unitKey(unitInput.value.trim()) !== unitKey(selected.dataset.unit || '件');
  const invalid = missing || invalidQty || needsCustomer || invalidUnit;
  row.classList.toggle('row-error', invalid);
  row.classList.toggle('row-matched', !invalid);
  row.classList.remove('row-new');
  const badge = row.querySelector('.ep-status');
  badge.className = `badge ep-status badge-${invalid ? 'danger' : 'success'}`;
  badge.textContent = missing ? '请选择商品' : invalidQty ? '数量需整数' : needsCustomer ? '请选择客户' : invalidUnit ? '单位需核对' : initial ? '已匹配' : '已选择';
  badge.title = '';
}

function previewProductOptions(products, selectedId) {
  return '<option value="">请选择已有商品</option>' + products.map(product =>
    `<option value="${escapeHtml(product.id)}" data-name="${escapeHtml(product.name)}" data-spec="${escapeHtml(product.spec || '')}" data-unit="${escapeHtml(product.unit || '件')}" ${product.id === selectedId ? 'selected' : ''}>${escapeHtml(product.name)}${product.spec ? ' · ' + escapeHtml(product.spec) : ''} · ${escapeHtml(product.unit || '件')}</option>`).join('');
}

function refreshPreviewProducts(products) {
  for (const [, previewId] of batchDrafts) {
    for (const select of document.getElementById(previewId).querySelectorAll('.ep-product')) {
      const selectedId = select.value;
      select.innerHTML = previewProductOptions(products,selectedId);
      updateEntryPreviewRow(select.closest('tr'));
    }
  }
  persistWorkspace();
}

function renderParsePreview(containerId, resolved, catalog = getState('products') || []) {
  const products = [...catalog].sort((a,b) =>
    (a.display_order == null ? Infinity : Number(a.display_order)) - (b.display_order == null ? Infinity : Number(b.display_order)) ||
    a.name.localeCompare(b.name,'zh-CN'));
  const direction = containerId.startsWith('inbound') ? 'inbound' : 'outbound';
  const isExcel = containerId.includes('Excel');
  const button = document.getElementById(`${direction}${isExcel ? 'Excel' : 'Quick'}Submit`);
  button.style.display = resolved.length ? 'block' : 'none';
  if (!resolved.length) {
    document.getElementById(containerId).innerHTML = '<p class="form-hint">没有识别到商品，请在客户名下面填写“商品名 数量 单位”。</p>';
    persistWorkspace();
    return;
  }
  document.getElementById(containerId).innerHTML = `
    <p class="preview-summary" role="status">识别到 ${resolved.length} 条商品记录。客户和商品都可以改选。客户没认准时，选一次就会填到同名的待选行。新客户请先在客户页添加，新商品请先在库存中添加。</p>
    <div class="editable-preview"><table>
      <thead><tr><th>客户</th><th>商品</th><th>数量</th><th>单位</th><th>状态</th><th></th></tr></thead>
      <tbody>${resolved.map((item, index) => {
        const parsed = item.parsed;
        const status = parsed.error ? ['需更正', 'danger', 'row-error'] : !item.product ? ['请选择商品', 'warning', 'row-new'] : ['已匹配', 'success', 'row-matched'];
        const options = previewProductOptions(products,item.product?.id);
        const original = !item.product || item.product.name !== parsed.rawName ? `<small class="ep-source">原文：${escapeHtml(parsed.rawName)}</small>` : '';
        return `<tr class="${status[2]}" data-idx="${index}" data-customer="${escapeHtml(parsed.rawCustomer)}" data-original-customer="${escapeHtml(parsed.originalCustomer || '')}" data-phone="${escapeHtml(parsed.customer?._phone || '')}">
          <td><input class="ep-input ep-customer" aria-label="第 ${index + 1} 行客户原文" value="${escapeHtml(parsed.rawCustomer)}" placeholder="客户原文（可选）"><button type="button" class="ep-input ep-customer-picker" aria-haspopup="dialog" aria-controls="entryCustomerPicker"></button><select class="ep-customer-choice" hidden></select><small class="ep-source ep-customer-source" hidden></small></td>
          <td><select class="ep-input ep-name ep-product" aria-label="第 ${index + 1} 行商品">${options}</select>${original}</td>
          <td><input class="ep-input ep-qty" aria-label="第 ${index + 1} 行数量" type="number" value="${parsed.quantity ?? ''}" step="1" inputmode="numeric" min="1"></td>
          <td><input class="ep-input ep-unit" aria-label="第 ${index + 1} 行单位" value="${escapeHtml(parsed.unit || item.suggestedUnit || '件')}"></td>
          <td><span class="badge ep-status badge-${status[1]}" title="${escapeHtml(parsed.error || '')}">${status[0]}</span></td>
          <td><button class="btn btn-sm btn-danger ep-remove" aria-label="移除第 ${index + 1} 行" title="移除这一行">✕</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  const rows = document.getElementById(containerId).querySelectorAll('tbody tr');
  const customerCatalog = getState('customers')?.filter(isEntryCustomer);
  rows.forEach((row, i) => {
    const item = resolved[i];
    row.dataset.customerNeedsChoice = String(Boolean(item.requiresCustomerChoice));
    syncPreviewCustomer(row, { catalog: customerCatalog, trusted: item.parsed.customer?.id ? item.parsed.customer : null });
    updateEntryPreviewRow(row, false, true);
  });
  persistWorkspace();
}

// ==================== 工具函数 ====================

async function loadProducts(force = false) {
  let p = getState('products');
  if (force || p.length === 0) {
    p = await DB.fetchProducts(); setState('products', p);
    if (workspaceReady) refreshPreviewProducts(p);
  }
  return getState('products');
}

async function loadCustomers(force = false) {
  let c = getState('customers');
  if (force || !c) {
    c = await DB.fetchCustomers(); setState('customers', c);
    if (workspaceReady) refreshPreviewCustomers(c);
  }
  return getState('customers') || [];
}

// Keep disputed customer cards in customer management and historical records only.
function isEntryCustomer(customer) { return customer.entry_match_pending !== true; }

async function loadEntryCustomers(force = false) {
  return (await loadCustomers(force)).filter(isEntryCustomer);
}

function restoreFormCustomer(select, previousId) {
  select.value = previousId;
  if (previousId && !select.value) {
    const unavailable = document.createElement('option');
    unavailable.value = previousId;
    unavailable.textContent = '原客户已不可用，请重选';
    unavailable.disabled = true;
    select.append(unavailable);
    select.value = previousId;
  }
}


function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function formatNum(n) { if (n === null || n === undefined) return '0'; return Number(n) === Math.floor(n) ? String(Math.floor(n)) : String(Number(n).toFixed(2)); }
function debounce(fn, d) { let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), d); }; }
function groupBy(arr, kfn) { const m = {}; arr.forEach(i => { const k = typeof kfn === 'function' ? kfn(i) : i[kfn]; if (!m[k]) m[k] = []; m[k].push(i); }); return m; }

// Lock a save action before any asynchronous lookup starts.
const savingScopes = new Set();
async function withSaveLock(scopeId, action) {
  if (savingScopes.has(scopeId)) return;
  const scope = document.getElementById(scopeId);
  const controls = [...scope.querySelectorAll('input,select,textarea,button')].map(element=>[element,element.disabled]);
  savingScopes.add(scopeId);
  controls.forEach(([element])=>{element.disabled=true;});
  try { return await action(); }
  catch (error) { showToast('操作未完成，输入已保留：' + error.message, 'error'); }
  finally { controls.forEach(([element,disabled])=>{element.disabled=disabled;});savingScopes.delete(scopeId); }
}
async function handleQuickIn(event) { event?.preventDefault?.(); return withSaveLock('quickInModalOverlay',()=>handleQuickInCore(event)); }
async function handleQuickOut(event) { event?.preventDefault?.(); return withSaveLock('quickOutModalOverlay',()=>handleQuickOutCore(event)); }
async function handleInboundSubmit(event) { event?.preventDefault?.(); return withSaveLock('inboundForm',()=>handleInboundSubmitCore(event)); }
async function handleOutboundSubmit(event) { event?.preventDefault?.(); return withSaveLock('outboundForm',()=>handleOutboundSubmitCore(event)); }
async function handleProductSave(event) { event?.preventDefault?.(); return withSaveLock('productModalOverlay',()=>handleProductSaveCore(event)); }
async function handleCustomerSave(event) { event?.preventDefault?.(); return withSaveLock('customerModalOverlay',()=>handleCustomerSaveCore(event)); }

function validDailyQuantity(value) { return Number.isSafeInteger(value) && value > 0 && value <= 9999999999; }

async function saveDailyRecord(scope,method,record) {
  let customerName = '';
  if (record.customer_id) {
    const customers = await loadEntryCustomers(true);
    const customer = customers.find(c => c.id === record.customer_id);
    if (!customer) throw new Error('所选客户已不可用于录单，请重新选择客户');
    customerName = customer.name;
  }
  const [payload]=saveIntents.records(scope,[{ ...record, customer_name: customerName }]);
  const saved=await DB[method](payload);
  saveIntents.complete(scope);
  return saved;
}

async function submitBatchPreview(previewId,inputId,buttonId,opType) {
  const direction=inputId.startsWith('inbound') ? 'inbound' : 'outbound';
  const mode=inputId.includes('Excel') ? 'Excel' : 'Quick';
  return withSaveLock(`${direction}${mode}Mode`,()=>submitBatchPreviewCore(previewId,inputId,buttonId,opType));
}

function setDatabaseStatus(connected) {
  const element=document.getElementById('syncStatus');
  if(!element)return;
  const online=navigator.onLine;
  element.textContent=online ? (connected ? '已连接' : '账本未连接') : '离线';
  element.classList.toggle('online',online&&connected);
  element.classList.toggle('offline',!online||!connected);
}
