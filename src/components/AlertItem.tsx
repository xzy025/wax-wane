import { Warning, TrendDown, TrendUp } from 'phosphor-react'

interface AlertItemProps {
  tone: 'danger' | 'warning' | 'info'
  title: string
  text: string
}

export default function AlertItem({ tone, title, text }: AlertItemProps) {
  const Icon = tone === 'danger' ? TrendDown : tone === 'warning' ? Warning : TrendUp
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
