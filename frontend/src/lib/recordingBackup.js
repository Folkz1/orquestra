/**
 * Backup incremental da gravacao em andamento.
 *
 * O MediaRecorder entrega pedaços de 1s e o Recorder os acumulava só num array
 * em memoria, criando o arquivo apenas no onstop. Enquanto a gravacao corria nao
 * existia nada em disco — nem blob, nem fila, nem tmp. Fechar a aba, recarregar
 * ou o Chrome morrer por pressao de memoria levava a call inteira junto.
 *
 * Custou 2h01 de call em 18/08/2026, e antes disso outras duas.
 *
 * Aqui os pedaços vao para o IndexedDB enquanto a gravacao acontece. Se a sessao
 * morrer, eles sobrevivem e a proxima abertura do app os encontra.
 */
const DB_NAME = 'orquestra-recorder'
const DB_VERSION = 1
const STORE = 'chunks'
const META = 'meta'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'seq' })
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store)
}

/** Marca o inicio de uma gravacao, descartando restos de sessoes anteriores. */
export async function beginBackup(sessionId, meta = {}) {
  const db = await openDB()
  await new Promise((res) => {
    const t = db.transaction([STORE, META], 'readwrite')
    t.objectStore(STORE).clear()
    t.objectStore(META).put({ key: 'current', sessionId, startedAt: Date.now(), ...meta })
    t.oncomplete = res
    t.onerror = res
  })
  db.close()
}

/** Grava mais um lote de pedaços. Chamado periodicamente durante a gravacao. */
export async function appendChunks(chunks, fromSeq) {
  if (!chunks.length) return
  const db = await openDB()
  await new Promise((res) => {
    const t = db.transaction(STORE, 'readwrite')
    const store = t.objectStore(STORE)
    chunks.forEach((blob, i) => store.put({ seq: fromSeq + i, blob }))
    t.oncomplete = res
    t.onerror = res
  })
  db.close()
}

/** Devolve a gravacao interrompida, se houver, como um Blob unico. */
export async function loadOrphan() {
  const db = await openDB()
  const [rows, meta] = await Promise.all([
    new Promise((res) => {
      const r = tx(db, STORE, 'readonly').getAll()
      r.onsuccess = () => res(r.result || [])
      r.onerror = () => res([])
    }),
    new Promise((res) => {
      const r = tx(db, META, 'readonly').get('current')
      r.onsuccess = () => res(r.result || null)
      r.onerror = () => res(null)
    }),
  ])
  db.close()
  if (!rows.length) return null
  rows.sort((a, b) => a.seq - b.seq)
  return {
    blob: new Blob(rows.map((r) => r.blob), { type: 'audio/webm' }),
    chunks: rows.length,
    startedAt: meta?.startedAt || null,
    attempts: meta?.attempts || 0,
  }
}

/**
 * Registra mais uma tentativa de reenvio da gravacao orfa.
 *
 * Sem isso o recovery do Recorder era um loop: toda abertura do app reenviava a
 * mesma gravacao, falhava pelo mesmo motivo e deixava a tela presa em
 * "Transcrevendo..." — sem tentativa maxima, sem aviso e sem saida.
 */
export async function markAttempt() {
  const db = await openDB()
  const atual = await new Promise((res) => {
    const r = tx(db, META, 'readonly').get('current')
    r.onsuccess = () => res(r.result || {})
    r.onerror = () => res({})
  })
  const attempts = (atual.attempts || 0) + 1
  await new Promise((res) => {
    const t = db.transaction(META, 'readwrite')
    t.objectStore(META).put({ ...atual, key: 'current', attempts, lastAttemptAt: Date.now() })
    t.oncomplete = res
    t.onerror = res
  })
  db.close()
  return attempts
}

/** Limpa o backup — chamado quando a gravacao foi entregue com sucesso. */
export async function clearBackup() {
  const db = await openDB()
  await new Promise((res) => {
    const t = db.transaction([STORE, META], 'readwrite')
    t.objectStore(STORE).clear()
    t.objectStore(META).clear()
    t.oncomplete = res
    t.onerror = res
  })
  db.close()
}
