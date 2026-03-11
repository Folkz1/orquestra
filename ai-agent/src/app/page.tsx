export default function Home() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h1>Jarbas AI Agent</h1>
      <p>POST /api/chat - Streaming chat (Vercel AI SDK)</p>
      <p>POST /api/chat/generate - Non-streaming (WhatsApp)</p>
      <p>Status: Running</p>
    </div>
  );
}
