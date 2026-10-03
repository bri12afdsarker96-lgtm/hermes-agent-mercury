import reminderSound from './assets/reminder-cue.mp3?url'

/** One local clip per batch; never overlaps itself or sends task content to TTS. */
export class ReminderSound {
  private audio: HTMLAudioElement | null = null
  async play(volume = 1): Promise<boolean> {
    if (this.audio) {return true}
    const audio = new Audio(reminderSound)
    audio.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1
    this.audio = audio
    const finish = () => {if (this.audio === audio) {this.audio = null}}
    audio.onended = finish
    audio.onerror = finish
    try {await audio.play(); return true} catch {finish(); return false}
  }
  stop(): void {
    if (this.audio) {
      this.audio.onended = null
      this.audio.onerror = null
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
    }
    this.audio = null
  }
}
