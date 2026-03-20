import type { PillBucket } from '../notify-pills'

export function NotifyPill({ pill }: { pill?: PillBucket }) {
  if (!pill || pill.count < 1) return null
  const mark =
    pill.level === 'alert' ? '!' : pill.level === 'attention' ? '?' : pill.level === 'activity' ? '·' : 'i'
  return (
    <span className={`notify-pill notify-pill--${pill.level}`} title={pill.lastTitle || 'Notification'}>
      <span className="notify-pill-mark">{mark}</span>
      {pill.count > 1 ? (
        <span className="notify-pill-count">{pill.count > 99 ? '99+' : pill.count}</span>
      ) : null}
    </span>
  )
}
