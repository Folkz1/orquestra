export default function RecordButton({ isRecording, onClick, mode }) {
  return (
    <button
      onClick={onClick}
      className={`
        w-32 h-32 rounded-full flex items-center justify-center
        transition-all duration-300 select-none
        ${
          isRecording
            ? 'bg-red-600 animate-pulse-record scale-110'
            : 'bg-red-500 hover:bg-red-400 hover:scale-105 active:scale-95'
        }
      `}
      aria-label={isRecording ? 'Parar gravacao' : 'Iniciar gravacao'}
    >
      {isRecording ? (
        <div className="w-10 h-10 bg-white rounded-md" />
      ) : (
        <span className="text-4xl">
          {mode === 'meeting' ? '🖥️' : '🎙️'}
        </span>
      )}
    </button>
  )
}
