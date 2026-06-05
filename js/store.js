// ============================================
// store.js - 客户端状态管理
// ============================================

const CACHE_TTL = 30_000; // 缓存 30 秒

const state = {
  currentTab: 'dashboard',
  products: [],
  customers: null,
  stockCache: [],
  stockCacheTime: 0,
  inboundCache: [],
  inboundCacheTime: 0,
  outboundCache: [],
  outboundCacheTime: 0,
  isOnline: navigator.onLine,
  pendingSyncCount: 0
};

const listeners = {};

/**
 * 订阅状态变化
 * @param {string} key - 状态 key
 * @param {Function} fn - 回调
 */
export function on(key, fn) {
  if (!listeners[key]) listeners[key] = [];
  listeners[key].push(fn);
  return () => {
    listeners[key] = listeners[key].filter(f => f !== fn);
  };
}

function emit(key, value) {
  if (listeners[key]) {
    listeners[key].forEach(fn => fn(value));
  }
}

export function getState(key) {
  return key ? state[key] : state;
}

export function setState(key, value) {
  state[key] = value;
  emit(key, value);
}

export function isCacheValid(cacheTime) {
  return Date.now() - cacheTime < CACHE_TTL;
}

export default state;
