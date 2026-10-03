/** Date/time controls on the web use the business clock, independent of device TZ. */
export function beijingReminderInput(seconds: number): string {
  return new Date(seconds * 1000 + 8 * 3600000).toISOString().slice(0, 16)
}
export function beijingReminderSeconds(value: string): number {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? Date.parse(`${value}:00+08:00`) / 1000 : NaN
}
