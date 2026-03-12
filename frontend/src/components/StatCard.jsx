export default function StatCard({ label, value, footnote, accent = 'lime', href, onClick }) {
  const content = (
    <div className={`metric-card metric-${accent}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="metric-label">{label}</p>
          <p className="metric-value">{value}</p>
        </div>
        <span className="metric-chip" />
      </div>
      {footnote && <p className="metric-footnote">{footnote}</p>}
    </div>
  )

  if (href) {
    return (
      <a href={href} className="block">
        {content}
      </a>
    )
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="w-full text-left">
        {content}
      </button>
    )
  }

  return content
}
