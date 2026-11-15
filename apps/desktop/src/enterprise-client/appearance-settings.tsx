import { useStore } from '@nanostores/react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/i18n/context'
import { enterpriseAppearanceCopy } from '@/i18n/enterprise-appearance'
import { Check, Monitor, Moon, Palette, Settings, Sun } from '@/lib/icons'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { getBaseColors, useTheme } from '@/themes/context'

interface BackdropPreference {
  image: string
  opacity: number
}
const defaultBackdrop: BackdropPreference = { image: '', opacity: 96 }
const imagePattern = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

function readBackdrop(key: string): BackdropPreference {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as BackdropPreference | null

    if (
      value &&
      typeof value.image === 'string' &&
      (!value.image || imagePattern.test(value.image)) &&
      Number.isFinite(value.opacity) &&
      value.opacity >= 65 &&
      value.opacity <= 100
    ) {
      return value
    }
  } catch {
    /* Unavailable or old presentation preferences use the default. */
  }

  return defaultBackdrop
}

export function EnterpriseAppearanceSettings() {
  const { locale } = useI18n()
  const copy = enterpriseAppearanceCopy[locale]
  const theme = useTheme()
  const profile = normalizeProfileKey(useStore($activeGatewayProfile))
  const key = `hermes-enterprise-backdrop-v1:${profile}`
  const lifecycle = useMemo(() => ({ key, alive: true }), [key])
  const [open, setOpen] = useState(false)
  const [backdrop, setBackdrop] = useState(() => readBackdrop(key))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    lifecycle.alive = true
    setBackdrop(readBackdrop(key))
    setError('')
    setLoading(false)

    const update = (event: StorageEvent) => {
      if (event.key === key || event.key === null) {
        setBackdrop(readBackdrop(key))
      }
    }

    window.addEventListener('storage', update)

    return () => {
      lifecycle.alive = false
      window.removeEventListener('storage', update)
    }
  }, [key, lifecycle])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--enterprise-wallpaper', backdrop.image ? `url("${backdrop.image}")` : 'none')
    root.style.setProperty('--enterprise-surface-opacity', backdrop.image ? `${backdrop.opacity}%` : '100%')
    root.dataset.enterpriseWallpaper = String(!!backdrop.image)
  }, [backdrop])

  const saveBackdrop = (value: BackdropPreference) => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      setBackdrop(value)
      setError('')
    } catch {
      setError(copy.storageFailed)
    }
  }

  const chooseImage = async (file?: File) => {
    if (!file) {
      return
    }

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) {
      setError(copy.invalid)

      return
    }

    setLoading(true)

    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      if (!imagePattern.test(image)) {
        throw new Error('invalid image')
      }

      const decoded = new Image()
      decoded.src = image
      await decoded.decode()

      if (lifecycle.alive) {
        saveBackdrop({ ...readBackdrop(key), image })
      }
    } catch {
      if (lifecycle.alive) {
        setError(copy.invalid)
      }
    } finally {
      if (lifecycle.alive) {
        setLoading(false)
      }
    }
  }

  return (
    <>
      <button className="hesc-settings-trigger" onClick={() => setOpen(true)} type="button">
        <Settings aria-hidden="true" />
        <span>{copy.settings}</span>
      </button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent bodyClassName="hesc-appearance-body" className="hesc-appearance-dialog" showCloseButton={false}>
          <aside className="hesc-settings-navigation">
            <DialogTitle>{copy.settings}</DialogTitle>
            <span>
              <Palette aria-hidden="true" />
              {copy.appearance}
            </span>
          </aside>
          <div className="hesc-appearance-content">
            <header>
              <div>
                <h2>{copy.title}</h2>
                <DialogDescription>{copy.intro}</DialogDescription>
              </div>
            </header>
            <fieldset className="hesc-appearance-section">
              <legend>{copy.mode}</legend>
              <div className="hesc-mode-options">
                {(
                  [
                    ['light', Sun],
                    ['dark', Moon],
                    ['system', Monitor]
                  ] as const
                ).map(([mode, Icon]) => (
                  <button
                    aria-pressed={theme.mode === mode}
                    data-mode={mode}
                    key={mode}
                    onClick={() => theme.setMode(mode)}
                    type="button"
                  >
                    <span className="hesc-mode-preview">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      <Icon aria-hidden="true" />
                      {copy[mode]}
                    </span>
                    {theme.mode === mode ? <Check aria-hidden="true" className="hesc-mode-check" /> : null}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="hesc-appearance-section">
              <legend>{copy.skins}</legend>
              <div className="hesc-skin-grid">
                {theme.availableThemes.map(skin => {
                  const colors = getBaseColors(skin.name, theme.resolvedMode)

                  return (
                    <button
                      aria-pressed={theme.themeName === skin.name}
                      key={skin.name}
                      onClick={() => theme.setTheme(skin.name)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="hesc-skin-preview"
                        style={
                          {
                            '--skin-bg': colors.background,
                            '--skin-panel': colors.sidebarBackground ?? colors.muted,
                            '--skin-text': colors.foreground,
                            '--skin-accent': colors.primary
                          } as CSSProperties
                        }
                      >
                        <i />
                        <span>
                          <b />
                          <b />
                          <b />
                        </span>
                      </span>
                      <span>
                        {skin.label}
                        {theme.themeName === skin.name ? <Check aria-hidden="true" /> : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <section className="hesc-appearance-section hesc-backdrop-settings">
              <div>
                <h3>{copy.background}</h3>
                <p>{copy.backgroundHint}</p>
              </div>
              <div className="hesc-appearance-actions">
                <Button disabled={loading} onClick={() => input.current?.click()} variant="secondary">
                  {copy.upload}
                </Button>
                {backdrop.image ? (
                  <Button onClick={() => saveBackdrop(defaultBackdrop)} variant="ghost">
                    {copy.remove}
                  </Button>
                ) : null}
              </div>
              <input
                accept="image/png,image/jpeg,image/webp"
                aria-label={copy.upload}
                hidden
                onChange={event => {
                  void chooseImage(event.target.files?.[0])
                  event.target.value = ''
                }}
                ref={input}
                type="file"
              />
              {backdrop.image ? (
                <label className="hesc-opacity-control">
                  {copy.opacity}
                  <input
                    max="100"
                    min="65"
                    onChange={event => saveBackdrop({ ...backdrop, opacity: Number(event.target.value) })}
                    type="range"
                    value={backdrop.opacity}
                  />
                  <output>{backdrop.opacity}%</output>
                </label>
              ) : null}
              {error ? <p role="alert">{error}</p> : null}
            </section>
            <footer>
              <button
                onClick={() => {
                  theme.setTheme('codex')
                  theme.setMode('light')
                  saveBackdrop(defaultBackdrop)
                }}
                type="button"
              >
                {copy.reset}
              </button>
              <span>{copy.saved}</span>
              <Button onClick={() => setOpen(false)}>{copy.close}</Button>
            </footer>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
