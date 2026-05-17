import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react'

interface AlertItemProps {
  tone: 'danger' | 'warning' | 'info'
  title: string
  text: string
}

export default function AlertItem({ tone, title, text }: AlertItemProps) {
  const Icon = tone === 'danger' ? TrendingDown : tone === 'warning' ? AlertTriangle : TrendingUp
  return (
    <div className={`alert-item ${tone}`}>
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  )
}
