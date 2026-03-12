const CACHE_NAME = 'orquestra-v3';
const APP_SHELL = ['/', '/chat', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (!url.protocol.startsWith('http')) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('/index.html'))
      )
  );
});

self.addEventListener('push', (event) => {
  const payload = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Orquestra', {
      body: payload.body || 'Nova atualizacao no chat',
      data: payload.data || { url: '/chat' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/chat';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((client) => 'focus' in client);
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});

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

self.addEventListener('message', async (event) => {
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, data } = event.data;
    await self.registration.showNotification(title || 'Orquestra', {
      body: body || 'Nova mensagem',
      data: data || { url: '/chat' },
    });
  }

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
