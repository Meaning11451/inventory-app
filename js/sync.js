// ============================================
// sync.js - 离线队列 + 自动同步
// ============================================

import { setState } from './store.js';

const DB_NAME = 'inventory_offline_queue';
const DB_VERSION = 1;
const STORE_NAME = 'pending_operations';

let db = null;

// ==================== IndexedDB 初始化 ====================

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });
      }
    };
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

// ==================== 队列操作 ====================

async function getQueueStore(mode = 'readonly') {
  const database = await openDB();
  const tx = database.transaction(STORE_NAME, mode);
  return tx.objectStore(STORE_NAME);
}

export async function addToQueue(operationType, payload) {
  const store = await getQueueStore('readwrite');
  return new Promise((resolve, reject) => {
    const request = store.add({
      operationType,
      payload,
      createdAt: Date.now(),
      synced: 0
    });
    request.onsuccess = () => {
      updatePendingCount();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingItems() {
  const store = await getQueueStore();
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      // 过滤未同步的，按创建时间排序
      const items = request.result
        .filter(item => !item.synced)
        .sort((a, b) => a.createdAt - b.createdAt);
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

async function markAsSynced(id) {
  const store = await getQueueStore('readwrite');
  return new Promise((resolve, reject) => {
    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const item = getRequest.result;
      if (item) {
        item.synced = 1;
        const putRequest = store.put(item);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        resolve();
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

async function clearSyncedItems() {
  const store = await getQueueStore('readwrite');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const toDelete = request.result.filter(item => item.synced);
      const tx = store.transaction;
      toDelete.forEach(item => store.delete(item.id));
      tx.oncomplete = () => {
        updatePendingCount();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingCount() {
  const items = await getPendingItems();
  return items.length;
}

async function updatePendingCount() {
  const count = await getPendingCount();
  setState('pendingSyncCount', count);
}

// ==================== 同步执行 ====================

/**
 * 处理离线队列中的所有待同步操作
 * 需要传入执行函数映射
 */
export async function processQueue(executors) {
  const items = await getPendingItems();
  if (items.length === 0) return { success: 0, fail: 0 };

  let success = 0;
  let fail = 0;

  for (const item of items) {
    try {
      const fn = executors[item.operationType];
      if (fn) {
        await fn(item.payload);
      }
      await markAsSynced(item.id);
      success++;
    } catch (err) {
      console.error('同步失败:', item.operationType, err);
      fail++;
    }
  }

  // 清理已同步的
  await clearSyncedItems();
  updatePendingCount();

  return { success, fail };
}

// ==================== 网络状态监听 ====================

export function initSync(executors) {
  const handleOnline = async () => {
    setState('isOnline', true);
    document.getElementById('offlineBanner')?.classList.remove('show');
    document.getElementById('syncStatus')?.classList.remove('offline');
    document.getElementById('syncStatus')?.classList.add('online');

    const result = await processQueue(executors);
    if (result.success > 0 || result.fail > 0) {
      const msg = result.fail === 0
        ? `已同步 ${result.success} 条离线记录`
        : `同步完成：${result.success} 成功，${result.fail} 失败`;
      window._showToast?.(msg, result.fail > 0 ? 'warning' : 'success');
    }

    // 触发页面刷新
    window._refreshCurrentTab?.();
  };

  const handleOffline = () => {
    setState('isOnline', false);
    document.getElementById('offlineBanner')?.classList.add('show');
    document.getElementById('syncStatus')?.classList.add('offline');
    document.getElementById('syncStatus')?.classList.remove('online');
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // 初始状态
  if (!navigator.onLine) {
    handleOffline();
  }

  updatePendingCount();
}
