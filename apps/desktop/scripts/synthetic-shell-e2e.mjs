import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { build as esbuild } from 'esbuild'
import { _electron as electron } from 'playwright'

const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), repo=path.resolve(desktop,'../..')
const source=path.join(desktop,'synthetic-shell-test'), output=path.join(repo,'results','synthetic-shell-e2e')
await mkdir(output,{recursive:true})
await viteBuild({configFile:false,root:source,base:'./',cacheDir:path.join(output,'vite-cache'),plugins:[react(),tailwindcss()],resolve:{alias:{'@':path.join(desktop,'src')},dedupe:['react','react-dom']},build:{outDir:path.join(output,'renderer'),emptyOutDir:false},logLevel:'warn'})
await esbuild({entryPoints:[path.join(source,'main.ts')],outfile:path.join(output,'main.cjs'),platform:'node',format:'cjs',bundle:true,external:['electron'],logLevel:'warning'})
await esbuild({entryPoints:[path.join(desktop,'electron','preload.ts')],outfile:path.join(output,'preload.cjs'),platform:'node',format:'cjs',bundle:true,external:['electron'],logLevel:'warning'})
const env=Object.fromEntries(['SystemRoot','WINDIR','SystemDrive','TEMP','TMP','COMSPEC','PATHEXT'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))
env.PATH=path.join(process.env.SystemRoot,'System32'); env.HERMES_SYNTHETIC_FIXTURES=path.join(repo,'results')
const binary=path.join(desktop,'node_modules','electron','dist','electron.exe')
let app,page,requests=0
const probe=http.createServer((_req,res)=>{requests++;res.end('unexpected')})
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve))
try {
  app=await electron.launch({executablePath:binary,args:[path.join(output,'main.cjs')],cwd:output,env,timeout:30000})
  const settings=await app.evaluate(({app,BrowserWindow})=>({disabled:app.commandLine.hasSwitch('no-sandbox'),prefs:BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()}))
  if(settings.disabled || !settings.prefs.sandbox || !settings.prefs.contextIsolation) throw new Error('Unsafe Electron renderer settings')
  page=await app.firstWindow()
  await page.getByText('合成测试 · 模拟登录与假店铺 · 不连接真实店铺 · 不发生真实付款').waitFor()
  await page.getByLabel('登录账号').fill('synthetic'); await page.getByLabel('登录密码').fill('synthetic')
  await page.screenshot({path:path.join(output,'01-login.png')})
  await page.getByRole('button',{name:'登录企业工作台'}).click()
  await page.getByTestId('enterprise-client-workbench').waitFor({timeout:20000})
  await page.screenshot({path:path.join(output,'02-workbench.png')})
  const nav=page.getByRole('navigation',{name:'企业客户端主导航'})
  await nav.getByRole('button',{name:'订单截图'}).click()
  await page.getByRole('option',{name:'合成店铺 (TEST-ONLY)'}).waitFor({state:'attached',timeout:15000})
  await page.getByRole('combobox',{name:'店铺'}).selectOption('b'.repeat(32))
  await page.getByRole('button',{name:'选择工作簿副本'}).click(); await page.getByText('review-synthetic.xlsx').waitFor()
  await page.getByRole('button',{name:'检查待回填表格'}).click(); await page.getByRole('button',{name:'确认截图并回填'}).waitFor({timeout:15000})
  await page.screenshot({path:path.join(output,'03-review-confirm.png')})
  await page.getByRole('button',{name:'确认截图并回填'}).click()
  await page.getByText('任务结束，请核对已保存与跳过记录',{exact:true}).waitFor({timeout:15000})
  await page.screenshot({path:path.join(output,'04-review-complete.png')})
  await nav.getByRole('button',{name:'小额打款'}).click()
  await page.getByRole('button',{name:'选择工作簿'}).click(); await page.getByText('synthetic.xlsx').waitFor()
  await page.getByLabel('金额',{exact:true}).fill('3.25'); await page.getByLabel('起始行',{exact:true}).fill('2')
  await page.getByRole('button',{name:'检查并准备'}).click()
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent?.includes('确认开始打款')&&!b.disabled),null,{timeout:15000})
  await page.screenshot({path:path.join(output,'05-payment-confirm.png')})
  await page.getByRole('button',{name:'确认开始打款'}).click(); await page.getByText('打款已暂停，需人工核验。',{exact:true}).waitFor({timeout:20000})
  await page.screenshot({path:path.join(output,'06-payment-paused.png')})
  const blocked=await page.evaluate(()=>window.hermesDesktop.enterprise.doudian({sessionId:'synthetic-session',action:'openPayment'}))
  if(blocked.error!=='SYNTHETIC_ACTION_BLOCKED') throw new Error('Original window was not blocked')
  await page.evaluate(async port=>{try{await fetch(`http://127.0.0.1:${port}/test`)}catch{}},probe.address().port)
  if(requests) throw new Error('Renderer network request escaped')
  const state=await app.evaluate(({BrowserWindow})=>({windows:BrowserWindow.getAllWindows().length,root:process.env.HERMES_SYNTHETIC_ROOT,reviewPid:process.env.SYNTHETIC_REVIEW_PID,paymentPid:process.env.SYNTHETIC_PAYMENT_PID}))
  if(state.windows!==1 || !state.reviewPid || !state.paymentPid) throw new Error(`Unexpected process state ${JSON.stringify(state)}`)
  const handles={}
  for(const [name,pid] of [['review',state.reviewPid],['payment',state.paymentPid]]) {
    if(!/^\d+$/.test(pid)) throw new Error('Invalid synthetic host PID')
    handles[name]=execFileSync(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${pid} -ErrorAction Stop).MainWindowHandle.ToInt64()`],{encoding:'utf8'}).trim()
    if(handles[name]!=='0') throw new Error(`Synthetic ${name} host has a main window`)
  }
  await writeFile(path.join(output,'window-check.json'),JSON.stringify({electronWindows:state.windows,hostMainWindowHandles:handles},null,2))
  const auditPath=path.join(state.root,'audit.jsonl'), audit=(await readFile(auditPath,'utf8')).trim().split(/\r?\n/).map(JSON.parse)
  const calls=(await readFile(path.join(state.root,'fixture','calls.txt'),'utf8')).trim().split(/\r?\n/), saved=JSON.parse(await readFile(path.join(state.root,'fixture','persisted.json'),'utf8'))
  if(audit.some(x=>x.channel==='host'&&['openPayment','openReview'].includes(x.method)) || audit.filter(x=>x.channel==='host'&&x.method==='startPayment').length!==1 || JSON.stringify(calls)!==JSON.stringify(['confirm','second-confirm']) || !saved['2']?.includes('需人工核验') || saved['3']!==undefined) throw new Error('Synthetic evidence mismatch')
  for(const [from,to] of [[auditPath,'audit.jsonl'],[path.join(state.root,'review-trace.jsonl'),'review-trace.jsonl'],[path.join(state.root,'fixture','calls.txt'),'payment-calls.txt'],[path.join(state.root,'fixture','persisted.json'),'payment-persisted.json']]) await copyFile(from,path.join(output,to))
  console.log(`PASS synthetic login + real enterprise shell + review + payment paused_review; output=${output}`)
} catch(error) {
  if(page) await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{})
  throw error
} finally {
  if(app) await app.close().catch(()=>{})
  await new Promise(resolve=>probe.close(resolve))
}
