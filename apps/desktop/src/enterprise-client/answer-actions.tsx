import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useDeliveryCopy } from './delivery-copy'

interface AnswerActionsProps {
  text: string
}

/** Copy only this answer, never metadata or the surrounding customer workspace. */
export function AnswerActions({ text }: AnswerActionsProps) {
  const labels = useDeliveryCopy()
  const [notice, setNotice] = useState('')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(labels.replyCopied)
    } catch {
      setNotice(labels.replyCopyFailed)
    }
  }

  return (
    <div className="hesc-answer-actions">
      <Button onClick={() => void copy()} type="button">
        {labels.copyReply}
      </Button>
      {notice ? <span role="status">{notice}</span> : null}
    </div>
  )
}
