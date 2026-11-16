import './native-business-admin.css'

import type { ReactNode } from 'react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { nativeBusinessAdminCopy } from '@/i18n/native-business-admin'

export function NativeAdminDialog({
  title,
  description,
  className = '',
  children,
  open,
  busy = false,
  onClose,
  compact = false
}: {
  title: string
  description: string
  className?: string
  children: ReactNode
  open: boolean
  busy?: boolean
  compact?: boolean
  onClose(): void
}) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]

  return (
    <Dialog
      onOpenChange={value => {
        if (!value && !busy) {
          onClose()
        }
      }}
      open={open}
    >
      <DialogContent
        bodyClassName="cs-admin-dialog-body"
        className={`cs-native-dialog cs-admin-dialog ${compact ? 'cs-admin-compact' : ''} ${className}`}
        showCloseButton={false}
      >
        <header className="cs-admin-header">
          <DialogTitle>{title}</DialogTitle>
          {!compact ? (
            <Button
              aria-label={copy.close}
              className="cs-admin-close"
              disabled={busy}
              onClick={onClose}
              variant="ghost"
            >
              ✕
            </Button>
          ) : null}
        </header>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export function NativeAdminPassword({
  value,
  onChange,
  disabled,
  saved = false,
  label
}: {
  value: string
  onChange(value: string): void
  disabled?: boolean
  saved?: boolean
  label: string
}) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]
  const [visible, setVisible] = useState(false)

  return (
    <div className="cs-admin-password">
      <Input
        aria-label={label}
        autoComplete="new-password"
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        placeholder={saved ? copy.keepPassword : undefined}
        type={visible ? 'text' : 'password'}
        value={value}
      />
      <Button
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible(current => !current)}
        type="button"
        variant="ghost"
      >
        {visible ? copy.hide : copy.show}
      </Button>
    </div>
  )
}
