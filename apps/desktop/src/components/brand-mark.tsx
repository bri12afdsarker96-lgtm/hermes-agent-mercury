import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// Product mark shared by welcome/About surfaces. The source SVG remains in
// assets/ as the packaging master; public/ is the renderer-safe copy.
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md',
        className
      )}
      {...props}
    >
      <img alt="" className="size-full object-contain" src={assetPath('hermes-agent-logo.svg')} />
    </span>
  )
}
