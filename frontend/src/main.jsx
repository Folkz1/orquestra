import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Drena a fila de gravacoes que ficaram offline.
//
// Quando o upload falha, Recorder.jsx manda QUEUE_RECORDING e o service worker
// guarda o audio no IndexedDB, e a tela avisa "Sera enviado quando houver
// conexao". Só que nada no app mandava SYNC_RECORDINGS de volta: a fila era
// write-only e a promessa da tela nunca se cumpria. Uma call de 30min do Emilio
// (31MB) ficou presa assim, e so foi recuperada na marra dos blobs do Chrome.
// O token vai junto: o service worker nao enxerga o localStorage, entao subia
// sem Authorization, levava 401 e — como fetch nao rejeita em 4xx — apagava a
// gravacao achando que tinha entregue.
function drainPendingRecordings() {
  navigator.serviceWorker.controller?.postMessage({
    type: 'SYNC_RECORDINGS',
    token: localStorage.getItem('orquestra_token') || '',
  })
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(drainPendingRecordings)
      .catch(() => {})
  })
  // e de novo assim que a conexao voltar
  window.addEventListener('online', drainPendingRecordings)
}
