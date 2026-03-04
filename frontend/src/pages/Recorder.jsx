import { useState, useRef, useEffect, useCallback } from 'react'
import RecordButton from '../components/RecordButton'
import { uploadRecording, getProjects } from '../api'

const STATUS = {
  IDLE: 'idle',
  RECORDING: 'recording',
  UPLOADING: 'uploading',
  TRANSCRIBING: 'transcribing',
  DONE: 'done',
  ERROR: 'error',
}

const STATUS_LABELS = {
  [STATUS.IDLE]: '',
  [STATUS.RECORDING]: 'Gravando...',
  [STATUS.UPLOADING]: 'Enviando...',
  [STATUS.TRANSCRIBING]: 'Transcrevendo...',
  [STATUS.DONE]: 'Pronto!',
  [STATUS.ERROR]: 'Erro ao enviar',
}

export default function Recorder() {
  const [status, setStatus] = useState(STATUS.IDLE)
  const [mode, setMode] = useState('mic') // 'mic' or 'meeting'
  const [duration, setDuration] = useState(0)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [projects, setProjects] = useState([])
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  // Load projects
  useEffect(() => {
    getProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : data.projects || []))
      .catch(() => {})
  }, [])

  // Clear done status after delay
  useEffect(() => {
    if (status === STATUS.DONE || status === STATUS.ERROR) {
      const timeout = setTimeout(() => {
        setStatus(STATUS.IDLE)
        setResult(null)
        setErrorMsg('')
      }, 5000)
      return () => clearTimeout(timeout)
    }
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
      })

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = async () => {
        stopTimer()
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        await handleUpload(blob)
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

  const handleUpload = async (blob) => {
    setStatus(STATUS.UPLOADING)

    try {
      const file = new File([blob], `gravacao_${Date.now()}.webm`, {
        type: 'audio/webm',
      })

      setStatus(STATUS.TRANSCRIBING)
      const data = await uploadRecording(file, title || undefined, projectId || undefined)
      setResult(data)
      setStatus(STATUS.DONE)
      setTitle('')
    } catch (err) {
      console.error('[Recorder] Upload failed:', err)

      // Try offline queue via service worker
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        try {
          const arrayBuffer = await blob.arrayBuffer()
          navigator.serviceWorker.controller.postMessage({
            type: 'QUEUE_RECORDING',
            blob: arrayBuffer,
            title: title || undefined,
            projectId: projectId || undefined,
          })
          setStatus(STATUS.DONE)
          setResult({ offline: true })
          setTitle('')
          return
        } catch {
          // Fall through to error
        }
      }

      setStatus(STATUS.ERROR)
      setErrorMsg('Falha ao enviar. Tente novamente.')
    }
  }

  const handleToggle = () => {
    if (status === STATUS.RECORDING) {
      stopRecording()
    } else if (status === STATUS.IDLE) {
      startRecording()
    }
  }

  const isRecording = status === STATUS.RECORDING
  const isBusy = status === STATUS.UPLOADING || status === STATUS.TRANSCRIBING

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
          className={`text-sm font-medium mb-6 animate-fade-in ${
            status === STATUS.DONE
              ? 'text-primary'
              : status === STATUS.ERROR
              ? 'text-red-400'
              : 'text-zinc-400'
          }`}
        >
          {STATUS_LABELS[status]}
          {status === STATUS.ERROR && errorMsg && (
            <span className="block text-xs mt-1">{errorMsg}</span>
          )}
          {status === STATUS.DONE && result?.offline && (
            <span className="block text-xs text-zinc-500 mt-1">
              Salvo offline. Sera enviado quando houver conexao.
            </span>
          )}
        </div>
      )}

      {/* Loading spinner for uploading/transcribing */}
      {isBusy && (
        <div className="mb-6">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Result preview */}
      {status === STATUS.DONE && result && !result.offline && (
        <div className="card max-w-md w-full mb-6 animate-fade-in">
          {result.transcription && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Transcricao:</p>
              <p className="text-sm text-zinc-300 leading-relaxed">
                {result.transcription.length > 300
                  ? result.transcription.substring(0, 300) + '...'
                  : result.transcription}
              </p>
            </div>
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
