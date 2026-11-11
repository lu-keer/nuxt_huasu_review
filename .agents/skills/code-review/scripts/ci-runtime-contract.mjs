// No model execution. Query the pinned CLI's effective config before drop-sudo.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLI_VERSION, digest } from './ci-runtime.mjs'
import { EVIDENCE_VERSION, WORKER_CAPACITY } from './ci-scheduling.mjs'

export function queryRuntimeContract(root, launch = spawn) {
  return new Promise(resolveResult => {
    const path = join(root, 'public/runtime-contract.json')
    const result = { evidenceVersion: EVIDENCE_VERSION, cli: CLI_VERSION, source: 'config/read', status: 'UNVERIFIED', reasons: ['CONFIG_READ_UNAVAILABLE'] }
    let child, buffer = '', finished = false, version
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      child?.stdin.end()
      child?.kill()
      child?.stdout.destroy()
      child?.stderr?.destroy()
      writeFileSync(path, JSON.stringify(result, null, 2) + '\n')
      resolveResult(result)
    }
    const timer = setTimeout(finish, 30000)
    try {
      // app-server needs a default when the Action's named permission profiles exist.
      // This read-only, model-free query does not change the Action's selected profile.
      child = launch('npx', ['--yes', `@openai/codex@${CLI_VERSION}`, 'app-server', '--stdio', '--strict-config', '-c', 'default_permissions=":read-only"'], {
        cwd: join(root, 'controller'), env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT,
          HOME: join(root, 'codex-home'), CODEX_HOME: join(root, 'codex-home') }, stdio: ['pipe', 'pipe', 'pipe'],
      })
      child.on('error', finish)
      child.on('exit', finish)
      child.stderr?.resume()
      child.stdin.on('error', finish)
      child.stdout.on('data', data => {
        buffer += data
        if (buffer.length > 4 * 1024 * 1024) { finish(); return }
        let end
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          let message
          try { message = JSON.parse(line) } catch { continue }
          if (message.error?.data?.reason === 'configLoad') { result.reasons = ['CONFIGURATION_REJECTED']; finish(); return }
          if (message.id === 1 && message.result) {
            version = message.result.userAgent
            child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
            child.stdin.write(JSON.stringify({ id: 2, method: 'config/read', params: { includeLayers: false } }) + '\n')
          }
          if (message.id === 2) {
            const agents = message.result?.config?.agents
            // Numeric effective value is returned by 0.167.1, not inferred from the requested TOML.
            if (typeof version === 'string' && version.includes(CLI_VERSION) && agents?.max_concurrent_threads_per_session === WORKER_CAPACITY &&
              agents.default_subagent_model == null && agents.default_subagent_reasoning_effort == null) {
              Object.assign(result, { status: 'PASS', reasons: [], workerCapacity: WORKER_CAPACITY, primaryIncluded: false,
                configHash: digest(readFileSync(join(root, 'codex-home/config.toml'))) })
            } else result.reasons = ['EFFECTIVE_CAPACITY_OR_DEFAULTS_UNVERIFIED']
            finish()
          }
        }
      })
      child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: {
        clientInfo: { name: 'ci-runtime-contract', version: '1' }, capabilities: { experimentalApi: true },
      } }) + '\n')
    } catch { finish() }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await queryRuntimeContract(resolve(process.argv[2]))
  console.log(JSON.stringify(result))
  if (result.status !== 'PASS') process.exitCode = 1
}
