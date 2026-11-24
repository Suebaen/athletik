// Minimal promise wrapper around IndexedDB.
//
// Stores:
//   sets  – one record per logged set, key "yyyy-MM-dd|exerciseId|setNo"
//   tests – one record per test result, key "yyyy-MM-dd|testId"
//   meta  – misc key/value records ({ key, value })

const DB_NAME = 'athletik';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sets')) {
        const sets = db.createObjectStore('sets', { keyPath: 'key' });
        sets.createIndex('exerciseId', 'exerciseId');
        sets.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('tests')) {
        const tests = db.createObjectStore('tests', { keyPath: 'key' });
        tests.createIndex('testId', 'testId');
        tests.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded the schema: close so it can proceed.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Runs `fn(stores)` in one transaction and resolves when it has committed. */
async function write(storeNames, fn) {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    let result;
    try {
      result = fn(stores);
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

async function readStore(name) {
  const db = await openDB();
  return db.transaction(name, 'readonly').objectStore(name);
}

export async function get(storeName, key) {
  return promisify((await readStore(storeName)).get(key));
}

export async function getAll(storeName) {
  return promisify((await readStore(storeName)).getAll());
}

export async function getAllByIndex(storeName, indexName, value) {
  return promisify((await readStore(storeName)).index(indexName).getAll(value));
}

export function put(storeName, value) {
  return write(storeName, (s) => { s[storeName].put(value); });
}

export function putMany(storeName, values) {
  return write(storeName, (s) => { for (const v of values) s[storeName].put(v); });
}

export function del(storeName, key) {
  return write(storeName, (s) => { s[storeName].delete(key); });
}

export function clear(storeName) {
  return write(storeName, (s) => { s[storeName].clear(); });
}

/** Clears the stores and writes the given records, atomically. records: { storeName: [...] } */
export function replaceAll(records) {
  const names = Object.keys(records);
  return write(names, (s) => {
    for (const n of names) {
      s[n].clear();
      for (const v of records[n]) s[n].put(v);
    }
  });
}

export async function getMeta(key) {
  const rec = await get('meta', key);
  return rec ? rec.value : undefined;
}

export function setMeta(key, value) {
  return put('meta', { key, value });
}

export function deleteMeta(key) {
  return del('meta', key);
}

/** Asks the browser not to evict our data. Resolves to true if storage is persistent. */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
