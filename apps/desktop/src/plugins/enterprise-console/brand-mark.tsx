/**
 * BrandMark — the enterprise console's own minimal brand lockup
 * (wing mark + `Hermes-企业助手` wordmark).
 *
 * The plugin SDK boundary (no-restricted-imports) prevents importing the
 * shell's shared BrandMark, so the enterprise console keeps this local one.
 * Shared by the console shell chrome and the Design-System Login surface.
 */

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

export interface BrandMarkProps {
  /** Marker height in rem (design: 20px titlebar mark, 28px sidebar, 52px login). */
  size?: 'default' | 'lg'
}

export function BrandMark({ size = 'default' }: BrandMarkProps) {
  const lg = size === 'lg'

  return (
    <div aria-label="Hermes-企业助手" className="flex min-w-0 items-center gap-2 px-1">
      <img
        alt=""
        aria-hidden="true"
        className={lg ? 'h-13 w-auto shrink-0' : 'h-6 w-auto shrink-0'}
        src={assetPath('brand/hermes-mark.svg')}
      />
      <span
        aria-hidden="true"
        className={
          lg
            ? 'truncate text-[1.375rem] font-semibold tracking-wide text-[--ui-text-primary]'
            : 'truncate text-[13px] font-medium tracking-wide text-[--ui-text-primary]'
        }
      >
        Hermes-企业助手
      </span>
    </div>
  )
}
