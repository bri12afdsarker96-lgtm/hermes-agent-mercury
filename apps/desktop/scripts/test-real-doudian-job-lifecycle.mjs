import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

// This tests lifecycle and stdio only. It does not establish an OS security boundary.
const { values } = parseArgs({ options: Object.fromEntries(
  ['broker', 'broker-sha256', 'host', 'host-sha256'].map(name => [name, { type: 'string' }])) })
if (process.platform !== 'win32' || Object.keys(values).length !== 4) {
  throw new Error('Windows only: provide --broker, --broker-sha256, --host and --host-sha256')
}
for (const name of ['broker', 'host']) {
  const file = values[name]
  const expected = values[`${name}-sha256`]
  if (!path.isAbsolute(file) || !/^[a-f\d]{64}$/i.test(expected)) throw new Error(`Invalid ${name} path or hash`)
  const actual = createHash('sha256').update(await readFile(file)).digest('hex')
  if (actual !== expected.toLowerCase()) throw new Error(`${name} SHA256 mismatch`)
}

const child = spawn(values.broker, [values.host, '--hermes-review-host'], {
  stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false
})
let stdout = ''
let stderr = ''
child.stdout.setEncoding('utf8').on('data', data => { stdout += data })
child.stderr.setEncoding('utf8').on('data', data => { stderr += data })
child.on('error', error => { stderr += error.message })
child.stdin.on('error', error => { stderr += error.message })
function query(command) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`Process query failed: ${result.stderr}`)
  return result.stdout.trim()
}
async function wait(check, reason) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timeout waiting for ${reason}: ${stderr}`)
}
try {
  if (!child.pid) throw new Error('Broker launch failed')
  const requestId = randomBytes(16).toString('hex')
  child.stdin.write(JSON.stringify({ id: requestId, method: 'initialize', params: { scope: randomBytes(32).toString('hex') } }) + '\n')
  await wait(() => stdout.includes('\n'), 'initialization')
  const reply = JSON.parse(stdout.split('\n')[0])
  if (reply.id !== requestId || !reply.ok || reply.result?.integration !== 'hermes-review-v1') throw new Error('Invalid handshake')
  const tdPid = query(`Get-CimInstance Win32_Process -Filter 'ParentProcessId=${child.pid}' | Where-Object { $_.Name -eq '外呼订单自动化.exe' } | Select-Object -ExpandProperty ProcessId`)
  if (!/^\d+$/.test(tdPid)) throw new Error('Could not uniquely identify TD child process')
  console.log(`PASS real TD handshake broker_pid=${child.pid} td_pid=${tdPid}`)
  child.kill()
  await wait(() => query(`if (Get-Process -Id ${tdPid} -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }`) === 'gone', 'TD exit')
  console.log('PASS closing broker terminates real TD process')
  console.log('SCOPE: lifecycle and stdio only; no shop, workbook, payment, or filesystem/network isolation claim')
} finally {
  if (!child.killed) child.kill()
}
