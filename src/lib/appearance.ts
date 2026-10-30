export type AppearanceImageKind = 'banner' | 'background';
export const appearanceDefaults = { bannerOpacity: 0, bannerFrost: 0, bannerBlur: 0, backgroundOpacity: 35, backgroundFrost: 42, backgroundBlur: 8 };
export function clampAppearance(value: unknown, fallback: number, max = 100): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : fallback;
}
export function bannerPeriod(date = new Date()): 'day' | 'sunset' | 'night' {
  const hour = date.getHours();
  return hour >= 6 && hour < 17 ? 'day' : hour >= 17 && hour < 19 ? 'sunset' : 'night';
}
export function imageStore(mode: 'get' | 'put' | 'delete', key: string, value?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('本设备不支持保存自定义图片'));
    const open = indexedDB.open('ccl-appearance', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('images');
    open.onerror = () => reject(open.error || new Error('无法打开图片存储'));
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('images', mode === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('images');
      const request = mode === 'get' ? store.get(key) : mode === 'put' ? store.put(value, key) : store.delete(key);
      let result: unknown;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('无法保存图片')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('图片保存已中止')); };
    };
  });
}
export function validateThemeImage(file: File): Promise<void> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return Promise.reject(new Error('请选择 PNG、JPEG 或 WebP 图片'));
  if (file.size > 20 * 1024 * 1024) return Promise.reject(new Error('图片不能超过 20 MB'));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); image.naturalWidth && image.naturalHeight ? resolve() : reject(new Error('图片无法读取')); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取')); };
    image.src = url;
  });
}
