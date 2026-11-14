import { spawn } from 'node:child_process'
import path from 'node:path'
import { DoudianHost } from './doudian-host'

/** Candidate adapter; caller must verify both binaries and establish the OS isolation boundary. */
export function createDoudianJobHost(executable: string, broker: string): DoudianHost {
  if (process.platform !== 'win32' || !path.isAbsolute(executable) || !path.isAbsolute(broker)) {
    throw new Error('DOUDIAN_JOB_BROKER_UNAVAILABLE')
  }
  const launch = ((target, args, options) => spawn(broker, [target, ...(args as string[])], options)) as typeof spawn
  return new DoudianHost(executable, launch)
}
