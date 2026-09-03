import { useState, useRef, useEffect, useCallback } from 'react'
import RecordButton from '../components/RecordButton'
import { uploadRecording, getProjects } from '../api'
import { beginBackup, appendChunks, loadOrphan, clearBackup, markAttempt } from '../lib/recordingBackup'

const STATUS = {
  IDLE: 'idle',
  RECORDING: 'recording',
  UPLOADING: 'uploading',
  DONE: 'done',
  ERROR: 'error',
}

// Quantas vezes o app reenvia sozinho a gravacao recuperada antes de parar e
// devolver a decisao ao usuario. Sem esse teto o recovery virava loop: toda
// abertura do app tentava a mesma gravacao, falhava igual, e a tela ficava presa.
const MAX_AUTO_ATTEMPTS = 2

function mensagemDeErro(err) {
  if (err?.aborted) return 'Envio cancelado. O audio continua guardado aqui.'
  if (err?.status === 413) return 'Audio grande demais para o servidor. Baixe o arquivo e envie por outro caminho.'
  if (err?.status === 401 || err?.status === 403) return 'Sessao expirada. Entre de novo e reenvie — o audio esta guardado.'
  if (err?.timeout) return 'O envio demorou demais e foi interrompido. O audio continua guardado aqui.'
  if (err?.network) return 'Sem conexao com o servidor. O audio continua guardado aqui.'
  return 'Falha ao enviar. O audio continua guardado aqui.'
}

const formatMB = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export default function Recorder() {
  const [status, setStatus] = useState(STATUS.IDLE)
  const [mode, setMode] = useState('mic') // 'mic' or 'meeting'
  const [duration, setDuration] = useState(0)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [projects, setProjects] = useState([])
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [progress, setProgress] = useState(null)  // 0..1 do upload em curso
  const [pending, setPending] = useState(null)    // gravacao guardada que nao subiu

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const backupBufferRef = useRef([])   // pedacos ainda nao gravados em disco
  const backupSeqRef = useRef(0)       // quantos ja foram gravados
  const abortRef = useRef(null)        // cancela o upload em curso
  const recoveryRanRef = useRef(false) // StrictMode monta duas vezes em dev

  // Segura o fechamento da aba enquanto grava — foi assim que uma call de 2h
  // se perdeu: fechar a aba mata o array em memoria antes do onstop rodar.
  useEffect(() => {
    const aviso = (e) => {
      if (status === STATUS.RECORDING) {
        e.preventDefault()
        e.returnValue = 'Gravacao em andamento. Se sair agora ela nao sera enviada.'
        return e.returnValue
      }
    }
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [status])

  const startTimer = useCallback(() => {
    setDuration(0)
    timerRef.current = setInterval(() => {
      setDuration((d) => d + 1)
    }, 1000)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  /**
   * Sobe o audio. Nunca apaga o backup quando falha — o IndexedDB e a unica
   * copia da call ate o servidor confirmar o recebimento.
   */
  const handleUpload = async (blob, { recuperada = false, minutos = null } = {}) => {
    const controller = new AbortController()
    abortRef.current = controller
    setErrorMsg('')
    setProgress(0)
    setStatus(STATUS.UPLOADING)
    setPending({ blob, minutos, size: blob.size })
    if (recuperada) await markAttempt().catch(() => {})

    try {
      const file = new File([blob], `gravacao_${Date.now()}.webm`, {
        type: 'audio/webm',
      })

      const data = await uploadRecording(file, title || undefined, projectId || undefined, {
        signal: controller.signal,
        onProgress: setProgress,
      })

      // So agora o audio existe fora do navegador.
      await clearBackup().catch(() => {})
      setPending(null)
      setResult(data)
      setStatus(STATUS.DONE)
      setTitle('')
    } catch (err) {
      console.error('[Recorder] Upload failed:', err)
      setErrorMsg(mensagemDeErro(err))
      setStatus(STATUS.ERROR)
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  // Recupera gravacao que ficou pela metade (aba fechada, refresh, crash).
  // Depois de MAX_AUTO_ATTEMPTS falhas ele para de tentar sozinho e mostra o
  // cartao de recuperacao — antes disso reenviava para sempre, a cada abertura.
  useEffect(() => {
    if (recoveryRanRef.current) return
    recoveryRanRef.current = true
    loadOrphan()
      .then((orfa) => {
        if (!orfa || orfa.chunks < 5) return
        const minutos = Math.max(1, Math.round(orfa.chunks / 60))
        if (orfa.attempts >= MAX_AUTO_ATTEMPTS) {
          setPending({ blob: orfa.blob, minutos, size: orfa.blob.size })
          setErrorMsg(`Nao subiu em ${orfa.attempts} tentativas. Decida o que fazer com ela.`)
          return
        }
        return handleUpload(orfa.blob, { recuperada: true, minutos })
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load projects
  useEffect(() => {
    getProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : data.projects || []))
      .catch(() => {})
  }, [])

  // Volta ao repouso depois de mostrar o desfecho. O cartao de gravacao pendente
  // sobrevive a isso de proposito: o audio ainda esta aqui e precisa de decisao.
  useEffect(() => {
    if (status === STATUS.DONE || status === STATUS.ERROR) {
      const timeout = setTimeout(() => {
        setStatus(STATUS.IDLE)
        setResult(null)
        if (!pending) setErrorMsg('')
      }, 5000)
      return () => clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const startRecording = async () => {
    try {
      chunksRef.current = []
      let stream

      if (mode === 'meeting') {
        // Capture system audio (via screen share) + microphone
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        })

        // Get microphone separately
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })

        // Stop video track immediately - we only need audio
        displayStream.getVideoTracks().forEach((t) => t.stop())

        // Merge system audio + mic into one stream using AudioContext
        const audioCtx = new AudioContext()
        const destination = audioCtx.createMediaStreamDestination()

        // Add system audio (if available - user might not share audio)
        const systemTracks = displayStream.getAudioTracks()
        if (systemTracks.length > 0) {
          const systemSource = audioCtx.createMediaStreamSource(
            new MediaStream(systemTracks)
          )
          systemSource.connect(destination)
        }

        // Add microphone audio
        const micSource = audioCtx.createMediaStreamSource(micStream)
        micSource.connect(destination)

        // Combined stream
        stream = destination.stream

        // Store refs for cleanup
        streamRef.current = stream
        streamRef.current._displayStream = displayStream
        streamRef.current._micStream = micStream
        streamRef.current._audioCtx = audioCtx
      } else {
        // Microphone capture
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100,
          },
        })
      }

      if (!streamRef.current) streamRef.current = stream

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
        // Voz em opus fica limpa em 64kbps e o servidor recusa acima de 100MB:
        // no bitrate padrao do Chrome uma call de 2h estoura o limite e volta
        // 413 depois de minutos de upload.
        audioBitsPerSecond: 64000,
      })

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
          // Espelha em disco enquanto grava: se a aba morrer, o audio sobrevive.
          backupBufferRef.current.push(e.data)
          if (backupBufferRef.current.length >= 15) {
            const lote = backupBufferRef.current
            backupBufferRef.current = []
            const desde = backupSeqRef.current
            backupSeqRef.current += lote.length
            appendChunks(lote, desde).catch(() => {})
          }
        }
      }

      mediaRecorder.onstop = async () => {
        stopTimer()
        if (backupBufferRef.current.length) {
          const resto = backupBufferRef.current
          backupBufferRef.current = []
          await appendChunks(resto, backupSeqRef.current).catch(() => {})
          backupSeqRef.current += resto.length
        }
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        await handleUpload(blob, { minutos: Math.max(1, Math.round(duration / 60)) })
      }

      // If user stops screen share via browser UI, stop recording
      const allTracks = [
        ...stream.getTracks(),
        ...(streamRef.current._displayStream ? streamRef.current._displayStream.getTracks() : []),
      ]
      allTracks.forEach((track) => {
        track.onended = () => {
          if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop()
          }
        }
      })

      mediaRecorderRef.current = mediaRecorder
      backupBufferRef.current = []
      backupSeqRef.current = 0
      await beginBackup(Date.now(), { mode }).catch(() => {})
      mediaRecorder.start(1000) // Collect data every second
      setStatus(STATUS.RECORDING)
      startTimer()
    } catch (err) {
      console.error('[Recorder] Failed to start:', err)
      setStatus(STATUS.ERROR)
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Permissao negada. Habilite o acesso ao microfone.'
          : 'Erro ao iniciar gravacao.'
      )
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) {
      // Stop all tracks on main stream
      streamRef.current.getTracks().forEach((t) => t.stop())
      // Stop display + mic streams (meeting mode)
      if (streamRef.current._displayStream) {
        streamRef.current._displayStream.getTracks().forEach((t) => t.stop())
      }
      if (streamRef.current._micStream) {
        streamRef.current._micStream.getTracks().forEach((t) => t.stop())
      }
      if (streamRef.current._audioCtx) {
        streamRef.current._audioCtx.close()
      }
      streamRef.current = null
    }
  }

  const cancelarEnvio = () => {
    abortRef.current?.abort()
  }

  const baixarPendente = () => {
    if (!pending?.blob) return
    const url = URL.createObjectURL(pending.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gravacao_${Date.now()}.webm`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const descartarPendente = async () => {
    const aviso = pending?.minutos
      ? `Descartar a gravacao de ~${pending.minutos}min? Ela sera apagada e nao da para recuperar.`
      : 'Descartar a gravacao guardada? Ela sera apagada e nao da para recuperar.'
    if (!window.confirm(aviso)) return
    await clearBackup().catch(() => {})
    setPending(null)
    setErrorMsg('')
    setStatus(STATUS.IDLE)
  }

  const handleToggle = () => {
    if (status === STATUS.RECORDING) {
      stopRecording()
    } else if (status !== STATUS.UPLOADING) {
      startRecording()
    }
  }

  const isRecording = status === STATUS.RECORDING
  const isBusy = status === STATUS.UPLOADING
  const pct = progress === null ? null : Math.round(progress * 100)

  const statusLabel = {
    [STATUS.RECORDING]: 'Gravando...',
    [STATUS.UPLOADING]:
      pct === null || pct >= 100 ? 'Salvando no servidor...' : `Enviando audio... ${pct}%`,
    [STATUS.DONE]: 'Pronto! A transcricao roda no servidor.',
    [STATUS.ERROR]: 'Nao foi possivel enviar',
  }[status]

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] md:min-h-[calc(100vh-3rem)]">
      {/* Mode Toggle */}
      <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1 mb-10">
        <button
          onClick={() => !isRecording && setMode('mic')}
          disabled={isRecording}
          className={`px-4 py-2 rounded-md text-sm transition-colors ${
            mode === 'mic'
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-300'
          } ${isRecording ? 'cursor-not-allowed' : ''}`}
        >
          🎙️ Microfone
        </button>
        <button
          onClick={() => !isRecording && setMode('meeting')}
          disabled={isRecording}
          className={`px-4 py-2 rounded-md text-sm transition-colors ${
            mode === 'meeting'
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-300'
          } ${isRecording ? 'cursor-not-allowed' : ''}`}
        >
          🖥️ Reuniao
        </button>
      </div>

      {/* Record Button */}
      <div className="mb-8">
        <RecordButton
          isRecording={isRecording}
          onClick={handleToggle}
          mode={mode}
        />
      </div>

      {/* Timer */}
      {(isRecording || duration > 0) && (
        <div className="text-3xl font-mono text-zinc-300 mb-6 tabular-nums">
          {formatDuration(duration)}
        </div>
      )}

      {/* Status */}
      {status !== STATUS.IDLE && (
        <div
          className={`text-sm font-medium mb-6 animate-fade-in text-center ${
            status === STATUS.DONE
              ? 'text-primary'
              : status === STATUS.ERROR
              ? 'text-red-400'
              : 'text-zinc-400'
          }`}
        >
          {statusLabel}
          {status === STATUS.ERROR && errorMsg && (
            <span className="block text-xs mt-1">{errorMsg}</span>
          )}
        </div>
      )}

      {/* Upload em curso: progresso real e saida manual */}
      {isBusy && (
        <div className="w-full max-w-sm mb-6 flex flex-col items-center gap-3">
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            {pending?.size ? <span>{formatMB(pending.size)}</span> : null}
            <button onClick={cancelarEnvio} className="text-zinc-400 hover:text-red-400 underline">
              Cancelar envio
            </button>
          </div>
        </div>
      )}

      {/* Gravacao guardada que ainda nao chegou ao servidor */}
      {pending && !isBusy && (
        <div className="card max-w-sm w-full mb-6 animate-fade-in border-amber-900/60">
          <p className="text-sm text-zinc-300">
            Gravacao{pending.minutos ? ` de ~${pending.minutos}min` : ''} guardada neste navegador
            {pending.size ? ` (${formatMB(pending.size)})` : ''}.
          </p>
          {errorMsg && <p className="text-xs text-zinc-500 mt-1">{errorMsg}</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => handleUpload(pending.blob, { minutos: pending.minutos })}
              className="btn-primary text-sm"
            >
              Enviar de novo
            </button>
            <button onClick={baixarPendente} className="btn-secondary text-sm">
              Baixar .webm
            </button>
            <button
              onClick={descartarPendente}
              className="text-sm text-zinc-500 hover:text-red-400 px-2"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {/* Result preview */}
      {status === STATUS.DONE && result && (
        <div className="card max-w-md w-full mb-6 animate-fade-in">
          {result.transcription ? (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Transcricao:</p>
              <p className="text-sm text-zinc-300 leading-relaxed">
                {result.transcription.length > 300
                  ? result.transcription.substring(0, 300) + '...'
                  : result.transcription}
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">
              Audio salvo. A transcricao aparece em Gravacoes assim que o servidor terminar.
            </p>
          )}
        </div>
      )}

      {/* Optional fields */}
      <div className="w-full max-w-sm space-y-3">
        <input
          type="text"
          placeholder="Titulo (opcional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isBusy}
          className="input text-center"
        />

        {projects.length > 0 && (
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={isBusy}
            className="select text-center"
          >
            <option value="">Sem projeto</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}
