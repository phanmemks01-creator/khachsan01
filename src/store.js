import { createInitialState, validateState } from './model.js';

const STORAGE_KEY = 'hotel-manager-pro-state-v4';
const ACCESS_KEY = 'hotel-manager-pro-access-key';

function localLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const state = JSON.parse(raw); validateState(state); return state;
  } catch {
    return createInitialState();
  }
}

function localSave(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function request(path, options = {}) {
  const accessKey = sessionStorage.getItem(ACCESS_KEY) || '';
  const timeoutSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15000) : undefined;
  const response = await fetch(path, {
    ...options,
    signal: options.signal || timeoutSignal,
    headers: {
      'Content-Type': 'application/json',
      ...(accessKey ? { Authorization: `Bearer ${accessKey}` } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

export class HotelStore {
  constructor() {
    this.state = null;
    this.version = 0;
    this.mode = 'local';
    this.lastError = '';
  }

  setAccessKey(value) {
    if (value) sessionStorage.setItem(ACCESS_KEY, value);
    else sessionStorage.removeItem(ACCESS_KEY);
  }

  hasAccessKey() { return Boolean(sessionStorage.getItem(ACCESS_KEY)); }

  async load() {
    const local = localLoad();
    try {
      const { response, body } = await request('/api/state');
      if (response.status === 401) return { requiresLogin: true, state: local };
      if (!response.ok) throw new Error(body.message || body.error || 'Không kết nối được máy chủ.');
      this.mode = 'supabase';
      if (body.state) {
        validateState(body.state);
        this.state = body.state; this.version = Number(body.version || 0);
      } else {
        this.state = local; this.version = 0;
        await this.save(this.state);
      }
      this.lastError = ''; localSave(this.state);
      return { requiresLogin: false, state: this.state };
    } catch (error) {
      this.state = local; this.version = Number(local.meta?.serverVersion || 0); this.mode = 'local'; this.lastError = error.message;
      return { requiresLogin: false, state: this.state, warning: error.message };
    }
  }

  async login(accessKey) {
    this.setAccessKey(accessKey);
    const result = await this.load();
    if (result.requiresLogin) { this.setAccessKey(''); throw new Error('Mã truy cập không đúng.'); }
    return result;
  }

  async save(state, options = {}) {
    validateState(state);
    if (this.mode !== 'supabase') {
      this.state = state;
      localSave(state);
      return { local: true };
    }
    const { response, body } = await request('/api/state', {
      method: 'POST', body: JSON.stringify({ state, expectedVersion: this.version, ...(options.newAccessKey ? { newAccessKey: options.newAccessKey } : {}) })
    });
    if (response.status === 409) {
      const error = new Error('Dữ liệu đã thay đổi ở thiết bị khác. Hệ thống đang tải lại để tránh ghi đè.');
      error.code = 'VERSION_CONFLICT'; throw error;
    }
    if (!response.ok) throw new Error(body.message || body.error || 'Không lưu được dữ liệu lên Supabase.');
    this.version = Number(body.version || this.version + 1);
    state.meta.serverVersion = this.version;
    this.state = state;
    localSave(state);
    this.lastError = '';
    return { local: false, version: this.version };
  }

  async changeAccessKey(newAccessKey) {
    const value = String(newAccessKey || '').trim();
    if (value.length < 12) throw new Error('Mã truy cập phải có ít nhất 12 ký tự.');
    if (this.mode !== 'supabase') throw new Error('Đổi mã truy cập cần kết nối Supabase trên Vercel.');
    const result = await this.save(this.state, { newAccessKey: value });
    this.setAccessKey(value);
    return result;
  }

  exportJson() {
    return JSON.stringify(this.state, null, 2);
  }

  async importJson(text) {
    const state = JSON.parse(text); validateState(state); state.meta.updatedAt = new Date().toISOString();
    await this.save(state); return state;
  }
}
