import { type ChildProcess, spawn } from 'node:child_process'
import path from 'node:path'

const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name.StartsWith('zh') })
  if ($payload.operation -eq 'status') {
    @{ available = ($voices.Count -gt 0); voices = @($voices | ForEach-Object { $_.VoiceInfo.Name }) } | ConvertTo-Json -Compress
  } elseif ($payload.operation -eq 'speak' -and $voices.Count -gt 0) {
    $synth.SelectVoice($voices[0].VoiceInfo.Name)
    $synth.Speak([string]$payload.text)
    '{"ok":true}'
  } else { '{"ok":false}' }
} finally { $synth.Dispose() }
`

interface ActiveSpeech {
  child: ChildProcess
  requestId: string
}

/** Narrow Windows SAPI adapter. Text is stdin JSON, never PowerShell code or
 * command arguments. Each authenticated renderer owns its own playback. */
export class EnterpriseSpeech {
  private active = new Map<string, ActiveSpeech>()
  private generations = new Map<string, number>()

  private run(operation: 'status' | 'speak', text = '', onChild?: (child: ChildProcess) => void): Promise<Record<string, unknown>> {
    if (process.platform !== 'win32') {return Promise.resolve({ available: false, ok: false })}

    return new Promise(resolve => {
      const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

      const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']
      })

      onChild?.(child)
      let output = ''
      let settled = false
      const timeout = setTimeout(() => { child.kill(); done({ ok: false, available: false }) }, operation === 'status' ? 10_000 : 120_000)

      const done = (result: Record<string, unknown>) => {
        if (settled) {return}
        settled = true
        clearTimeout(timeout)
        resolve(result)
      }

      child.stdout.on('data', chunk => {
        output += chunk.toString('utf8')

        if (output.length > 16_384) { child.kill(); done({ ok: false, available: false }) }
      })
      child.once('error', () => done({ ok: false, available: false }))
      child.once('close', code => {
        try { done(code === 0 ? JSON.parse(output.replace(/^\uFEFF/, '').trim()) : { ok: false, available: false }) }
        catch { done({ ok: false, available: false }) }
      })
      child.stdin.on('error', () => done({ ok: false, available: false }))
      child.stdin.end(JSON.stringify({ operation, text }), 'utf8')
    })
  }

  async status(): Promise<{ available: boolean }> {
    const result = await this.run('status')

    return { available: result.available === true }
  }

  async speak(owner: string, requestId: unknown, text: unknown): Promise<{ ok: boolean }> {
    if (typeof requestId !== 'string' || !/^[\w-]{1,96}$/.test(requestId) || typeof text !== 'string' || !text.trim() || text.length > 600) {
      return { ok: false }
    }

    const stopping = this.stop(owner)
    const generation = this.generations.get(owner)
    await stopping

    if (this.generations.get(owner) !== generation) {return { ok: false }}
    const result = await this.run('speak', text, child => this.active.set(owner, { child, requestId }))

    if (this.active.get(owner)?.requestId === requestId) {this.active.delete(owner)}

    return { ok: result.ok === true }
  }

  async stop(owner: string, requestId?: string): Promise<{ ok: boolean }> {
    const current = this.active.get(owner)

    if (requestId && current && current.requestId !== requestId) {return { ok: true }}
    this.generations.set(owner, (this.generations.get(owner) ?? 0) + 1)

    if (current && (!requestId || current.requestId === requestId)) {
      this.active.delete(owner)
      await new Promise<void>(resolve => {
        if (current.child.exitCode !== null || current.child.signalCode !== null) { resolve();

 return }

        const timer = setTimeout(resolve, 3_000)
        current.child.once('close', () => { clearTimeout(timer); resolve() })
        current.child.kill()
      })
    }

    return { ok: true }
  }

  stopAll(): void {
    for (const owner of this.active.keys()) {void this.stop(owner)}
  }
}
