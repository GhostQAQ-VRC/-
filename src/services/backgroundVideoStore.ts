const DB_NAME = 'hoshikuzu-background-videos';
const DB_VERSION = 1;
const STORE = 'videos';

interface StoredVideo {
  key: string;
  blob: Blob;
  mime: string;
  name?: string;
  savedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB，无法保存视频背景。'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开视频背景存储。'));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        let result: T | null = null;
        const request = action(transaction.objectStore(STORE));
        if (request) {
          request.onsuccess = () => {
            result = request.result as T;
          };
          request.onerror = () => reject(request.error);
        }
        transaction.oncomplete = () => {
          db.close();
          resolve(result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error('视频背景存储失败。'));
        };
      }),
  );
}

export async function putBackgroundVideo(
  key: string,
  blob: Blob,
  mime: string,
  name?: string,
): Promise<void> {
  await runTransaction('readwrite', (store) =>
    store.put({
      key,
      blob,
      mime,
      name,
      savedAt: new Date().toISOString(),
    } satisfies StoredVideo),
  );
}

export async function getBackgroundVideo(key: string): Promise<Blob | null> {
  const record = await runTransaction<StoredVideo>('readonly', (store) =>
    store.get(key) as IDBRequest<StoredVideo>,
  );
  return record?.blob ?? null;
}

export async function deleteBackgroundVideo(key: string): Promise<void> {
  if (!key) return;
  await runTransaction('readwrite', (store) => store.delete(key));
}

/** Drop blobs that no album setting points at any more. Best effort. */
export async function pruneBackgroundVideos(keepKeys: string[]): Promise<void> {
  try {
    const keys = await runTransaction<IDBValidKey[]>('readonly', (store) =>
      store.getAllKeys() as IDBRequest<IDBValidKey[]>,
    );
    const keep = new Set(keepKeys.filter(Boolean));
    for (const key of keys ?? []) {
      if (typeof key === 'string' && !keep.has(key)) {
        await deleteBackgroundVideo(key);
      }
    }
  } catch {
    // Storage pruning is a convenience; never break the picker over it.
  }
}
