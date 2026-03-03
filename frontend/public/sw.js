const CACHE_NAME = 'orquestra-v1';
const APP_SHELL = [
  '/',
  '/index.html',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for app shell, network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API requests: network only
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell: cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});

// IndexedDB for offline audio queue
const DB_NAME = 'orquestra-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-uploads';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Listen for messages from the app to queue offline recordings
self.addEventListener('message', async (event) => {
  if (event.data.type === 'QUEUE_RECORDING') {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add({
        blob: event.data.blob,
        title: event.data.title,
        projectId: event.data.projectId,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('[SW] Failed to queue recording:', err);
    }
  }

  if (event.data.type === 'SYNC_RECORDINGS') {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const all = await new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
      });

      for (const item of all) {
        const formData = new FormData();
        formData.append('file', new Blob([item.blob], { type: 'audio/webm' }), 'recording.webm');
        if (item.title) formData.append('title', item.title);
        if (item.projectId) formData.append('project_id', item.projectId);

        try {
          await fetch('/api/recordings/upload', { method: 'POST', body: formData });
          const delTx = db.transaction(STORE_NAME, 'readwrite');
          delTx.objectStore(STORE_NAME).delete(item.id);
        } catch (err) {
          console.error('[SW] Failed to upload queued recording:', err);
        }
      }
    } catch (err) {
      console.error('[SW] Sync failed:', err);
    }
  }
});
