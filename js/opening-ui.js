import { parseOpeningStock, parseStockQuantity, openingRowErrors, loadOpeningPlan, importOpeningStock } from './opening-stock.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function initOpeningImport({ api, onChanged }) {
  const byId = id => document.getElementById(id);
  const fileInput = byId('openingStockFile');
  const preview = byId('openingStockPreview');
  const status = byId('openingImportStatus');
  const save = byId('openingStockSave');
  const review = byId('openingReviewAck');
  const negative = byId('openingNegativeAck');
  const dateInput = byId('openingStockDate');
  let rows = [];
  let sheets = [];
  let plan = [];
  let checked = false;
  let busy = false;
  let fileVersion = 0;
  dateInput.value = localDate();

  const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('opening-error', error); };
  const invalidate = () => { checked = false; plan = []; review.checked = false; negative.checked = false; };

  function readEditedRows() {
    return [...preview.querySelectorAll('tbody tr')].map((element, index) => ({
      ...rows[index], name: element.querySelector('[data-field="name"]').value.trim(),
      spec: element.querySelector('[data-field="spec"]').value.trim(),
      unit: element.querySelector('[data-field="unit"]').value.trim(),
      quantity: parseStockQuantity(element.querySelector('[data-field="quantity"]').value)
    }));
  }

  function refreshControls() {
    const edited = rows.length ? readEditedRows() : [];
    const invalidCount = edited.filter(row => openingRowErrors(row).length).length;
    const hasNegative = edited.some(row => row.quantity < 0);
    byId('openingNegativeLabel').hidden = !hasNegative;
    byId('openingStockChecks').hidden = !rows.length;
    byId('openingBlankUnitTools').hidden = !rows.length;
    save.disabled = busy || !checked || !rows.length || invalidCount > 0 || plan.some(item => item.errors.length) || !review.checked || (hasNegative && !negative.checked) || !dateInput.value;
    byId('openingStockCheck').disabled = busy || !rows.length || invalidCount > 0;
    byId('openingFillUnits').disabled = busy;
    byId('openingDefaultUnit').disabled = busy;
    review.disabled = busy;
    negative.disabled = busy;
    fileInput.disabled = busy;
    dateInput.disabled = busy;
    byId('openingStockSheet').disabled = busy;
    for (const input of preview.querySelectorAll('input')) input.disabled = busy;
  }

  function renderRows(parsed) {
    rows = parsed.items;
    invalidate();
    preview.innerHTML = `<div class="opening-table-wrap"><table class="opening-table">
      <thead><tr><th>原表行</th><th>商品编号</th><th>商品名称</th><th>规格</th><th>单位</th><th>期初库存</th><th>核对结果</th></tr></thead>
      <tbody>${rows.map((row, index) => `<tr>
        <td>${row.sourceRow}</td><td>${escape(row.code || '—')}</td>
        <td><input data-field="name" aria-label="期初第 ${index + 1} 行商品名称" value="${escape(row.name)}"></td>
        <td><input data-field="spec" aria-label="期初第 ${index + 1} 行规格" value="${escape(row.spec)}" placeholder="可选"></td>
        <td><input data-field="unit" aria-label="期初第 ${index + 1} 行单位" value="${escape(row.unit)}" placeholder="必填"></td>
        <td><input data-field="quantity" aria-label="期初第 ${index + 1} 行库存数量" type="number" step="1" inputmode="numeric" value="${row.quantity ?? ''}"></td>
        <td class="opening-row-status"></td></tr>`).join('')}</tbody></table></div>`;
    byId('openingFileSummary').textContent = `找到第 ${parsed.headerRow} 行表头，共 ${rows.length} 个商品${parsed.skippedSummaryRows ? `，已排除 ${parsed.skippedSummaryRows} 行合计` : ''}。读取“库存数量”，不读取旧账的“期初数量”、成本和售价。`;
    updateRowLabels();
    setStatus('请核对商品、单位、库存和结转日期，再点击“核验现有账本”。');
    refreshControls();
  }

  function updateRowLabels() {
    const edited = readEditedRows();
    [...preview.querySelectorAll('tbody tr')].forEach((element, index) => {
      const errors = openingRowErrors(edited[index]);
      if (checked && plan[index]) errors.push(...plan[index].errors.filter(error => !errors.includes(error)));
      const cell = element.querySelector('.opening-row-status');
      cell.textContent = errors.length ? errors.join('；') : checked && plan[index]?.status === 'skip' ? '已结转，将跳过' : edited[index].quantity < 0 ? '负库存，请确认' : edited[index].quantity === 0 ? '零库存，仅登记商品' : checked ? '可以结转' : '待核验';
      element.classList.toggle('opening-invalid', errors.length > 0);
      element.classList.toggle('opening-negative', !errors.length && edited[index].quantity < 0);
    });
  }

  async function checkBook() {
    if (busy || !rows.length) return;
    busy = true;
    checked = false;
    refreshControls();
    setStatus('正在核验同名商品、单位和已有进出库记录…');
    try {
      plan = await loadOpeningPlan(readEditedRows(), api);
      checked = true;
      const invalid = plan.filter(item => item.errors.length).length;
      const skipped = plan.filter(item => item.status === 'skip').length;
      setStatus(invalid ? `${invalid} 行需要处理，暂时不能导入。请查看每行核对结果。` : `核验通过：${plan.length - skipped} 个商品待结转，${skipped} 个已结转商品会跳过。确认下方选项后保存。`, invalid > 0);
      updateRowLabels();
    } catch (error) { setStatus(`核验失败，未导入任何数据：${error.message}`, true); }
    finally { busy = false; refreshControls(); }
  }

  fileInput.addEventListener('change', async () => {
    const version = ++fileVersion;
    rows = []; sheets = []; plan = []; checked = false;
    preview.innerHTML = '';
    byId('openingFileSummary').textContent = '';
    byId('openingSheetLabel').hidden = true;
    refreshControls();
    const file = fileInput.files[0];
    if (!file) { setStatus('请选择管家婆导出的库存状况表。'); return; }
    setStatus('正在读取文件，尚未保存到云端…');
    try {
      if (!window.XLSX) throw new Error('Excel 读取组件未加载，请联网刷新页面后重试');
      const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      if (version !== fileVersion) return;
      let firstError;
      for (const name of workbook.SheetNames) {
        try {
          const parsed = parseOpeningStock(XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: true }));
          sheets.push({ name, parsed });
        } catch (error) { firstError ||= error; }
      }
      if (!sheets.length) throw firstError || new Error('文件中没有可读取的库存工作表');
      byId('openingStockSheet').innerHTML = sheets.map((sheet, index) => `<option value="${index}">${escape(sheet.name)}</option>`).join('');
      byId('openingSheetLabel').hidden = sheets.length < 2;
      renderRows(sheets[0].parsed);
    } catch (error) { if (version === fileVersion) setStatus(`读取失败：${error.message}`, true); }
  });

  byId('openingStockSheet').addEventListener('change', () => renderRows(sheets[Number(byId('openingStockSheet').value)].parsed));
  preview.addEventListener('input', () => { invalidate(); updateRowLabels(); refreshControls(); setStatus('预览已修改，请重新核验现有账本。'); });
  dateInput.addEventListener('input', () => { review.checked = false; refreshControls(); });
  review.addEventListener('change', refreshControls);
  negative.addEventListener('change', refreshControls);
  byId('openingStockCheck').addEventListener('click', checkBook);
  byId('openingFillUnits').addEventListener('click', () => {
    const unit = byId('openingDefaultUnit').value.trim();
    if (!unit) { setStatus('请先填写要补充的单位，例如“件”。', true); return; }
    for (const input of preview.querySelectorAll('[data-field="unit"]')) if (!input.value.trim()) input.value = unit;
    invalidate(); updateRowLabels(); refreshControls(); setStatus('已补充空单位，请核对后重新核验现有账本。');
  });

  save.addEventListener('click', async () => {
    if (save.disabled || busy) return;
    busy = true;
    refreshControls();
    try {
      const result = await importOpeningStock(readEditedRows(), dateInput.value, { api, allowNegative: negative.checked, onProgress: message => setStatus(message) });
      checked = false;
      review.checked = false;
      negative.checked = false;
      setStatus(`导入完成：结转 ${result.imported} 个商品，跳过 ${result.skipped} 个已结转商品。期初库存不计入当天正常进出库。`);
      await onChanged();
    } catch (error) {
      checked = false;
      review.checked = false;
      setStatus(`未能完成全部结转，清单已保留：${error.message}。可重新核验后重试；已保存的商品会自动跳过，不会重复累计。`, true);
    } finally { busy = false; refreshControls(); }
  });
  refreshControls();
}
