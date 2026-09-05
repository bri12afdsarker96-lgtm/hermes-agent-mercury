import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

export interface BrandMarkProps extends React.ComponentProps<'span'> {
  /** `mark` renders only the wing mark; `lockup` appends the product wordmark. */
  variant?: 'mark' | 'lockup'
  wordmark?: string
}

// Product mark shared by root / welcome / About / enterprise surfaces. The
// source SVG remains in assets/ as the packaging master; public/ is the
// renderer-safe copy. Uses the Design System wing mark (hermes-mark.svg).
export function BrandMark({
  className,
  variant = 'mark',
  wordmark = 'Hermes-企业助手',
  ...props
}: BrandMarkProps) {
  if (variant === 'lockup') {
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-2', className)} {...props}>
        <img
          alt=""
          aria-hidden="true"
          className="h-6 w-auto shrink-0 object-contain"
          src={assetPath('brand/hermes-mark.svg')}
        />
        <span
          aria-hidden="true"
          className="truncate text-[13px] font-medium tracking-wide text-[--ui-text-primary]"
        >
          {wordmark}
        </span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md',
        className
      )}
      {...props}
    >
      <img alt="" className="size-full object-contain" src={assetPath('brand/hermes-mark.svg')} />
    </span>
  )
}
