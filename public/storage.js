const DB_NAME = 'spotlight-rank';
let connection;
export async function database() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('浏览器未允许本地缓存，请检查隐私模式或网站存储设置。'));
    request.onblocked = () => reject(new Error('浏览器缓存被另一个窗口占用，请关闭其他窗口后重试。'));
  });
  return connection;
}
export async function read(key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('kv').objectStore('kv').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function write(key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('kv', 'readwrite');
    transaction.objectStore('kv').put(value, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error('无法保存浏览器缓存，可能是可用空间不足。'));
    transaction.onabort = () => reject(new Error('缓存保存未完成，旧数据已保留。'));
  });
}
export async function commitSnapshot(key, snapshot) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('kv', 'readwrite');
    const store = transaction.objectStore('kv');
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result) store.put(request.result, `${key}:previous`);
      store.put(snapshot, key);
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error('新数据未能写入浏览器缓存，旧缓存已保留。'));
    transaction.onabort = () => reject(new Error('缓存保存未完成，旧数据已保留。'));
  });
}
export async function clearSnapshots(key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('kv', 'readwrite');
    transaction.objectStore('kv').delete(key);
    transaction.objectStore('kv').delete(`${key}:previous`);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error('缓存未能清除，请稍后重试。'));
  });
}
