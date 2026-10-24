import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context'
import { CustomerConversationPanel } from './customer-conversation-panel'
import type { EnterpriseClientRuntime } from './runtime'

const customer = '1a092929-c3ac-42cd-9fc0-9c0918b70712'
const source = '45661688-357a-49b5-a042-a6fb5bc133d2'
const initial = {customer_id:customer, owner_id:'seat-owner', revision:2, can_grant:true,
  events:[{id:source,kind:'customer_statement',text:'工作日联系'}], memories:[], grants:[]}
const ownedChoice={backend_id:'codex' as const,configuration_id:'b'.repeat(32),configuration_version:1,
  model:'gpt-6-luna',runtime_protocol:'codex_responses',reasoning_effort:'medium',availability:'available' as const}
const original='22222222-2222-2222-2222-222222222222'
const ownedReceipt=(requestId:string)=>({state:'completed' as const,requestId,text:'服务端已接纳的共享草稿',answer_text:'服务端已接纳的共享草稿',
  reasoning_summary:'共享草稿核对说明',customer_reply_options:[{kind:'follow_up' as const,text:'可审核的后续提问'}],knowledge_grounded:null,
  source:'client_provided' as const,model_origin:'unverified' as const,delivery_state:'not_sent' as const,result_kind:'draft' as const,
  result_id:'33333333-3333-3333-3333-333333333333',backend_choice:ownedChoice,historical:true})

function mount(post: ReturnType<typeof vi.fn>, props: Partial<React.ComponentProps<typeof CustomerConversationPanel>> = {}) {
  return render(<I18nProvider initialLocale="zh" configClient={null}>
    <CustomerConversationPanel customerId={customer} disabled={false} refreshToken=""
      configurationId="model-one" runtime={{post} as unknown as EnterpriseClientRuntime} {...props} />
  </I18nProvider>)
}

function open() {
  const details = screen.getByText('客户历史与记忆', {selector:'summary'}).closest('details')!
  details.open = true
  fireEvent(details,new Event('toggle'))
}

describe('customer history and sourced memory', () => {
  it('owned shared ambiguity survives an available choice change until current history is explicitly acknowledged',async()=>{
    let events:Array<Record<string,unknown>>=[...initial.events]
    let revision=initial.revision
    const post=vi.fn(async(_path:string,body:Record<string,unknown>)=>{
      if(body.action==='conversation_acknowledge') {
        events=events.map(event=>event.id===body.event_id ? {...event,acknowledged_at:1} : event)
        revision++
      }
      return {...initial,revision,can_grant:false,events}
    })
    const localText=vi.fn(async(payload:{action:string;requestId?:string})=>{
      if(payload.action==='submit') {
        events=[...events,{id:payload.requestId,kind:'model_request',state:'unknown',delivery_state:'not_sent'}]
        revision++
      }
      return {state:'unknown' as const}
    })
    const runtime={post,localText} as unknown as EnterpriseClientRuntime
    const view=mount(post,{runtime,backendChoice:ownedChoice});open()
    await screen.findByText('工作日联系',{selector:'p'})
    fireEvent.change(screen.getByRole('textbox',{name:'交接引用'}),{target:{value:JSON.stringify({owner_id:'seat-owner',customer_id:customer})}})
    fireEvent.click(screen.getByRole('button',{name:'打开交接记录'}))
    fireEvent.change(await screen.findByLabelText('接续提问'),{target:{value:'首个结果未确认的问题'}})
    fireEvent.click(screen.getByRole('button',{name:'生成未发送草稿'}))
    await waitFor(()=>expect((screen.getByRole('button',{name:'查询原请求（不重新生成）'}) as HTMLButtonElement).disabled).toBe(false))
    const firstId=localText.mock.calls.find(([payload])=>payload.action==='submit')![0].requestId
    const changedChoice={...ownedChoice,configuration_id:'c'.repeat(32),configuration_version:2}
    view.rerender(<I18nProvider initialLocale="zh" configClient={null}>
      <CustomerConversationPanel customerId={customer} disabled={false} refreshToken="" configurationId="model-one" runtime={runtime} backendChoice={changedChoice}/>
    </I18nProvider>)
    // Re-enter nonempty text after the choice effect clears the editor. An
    // empty editor would hide the lost-UNKNOWN bug behind input validation.
    fireEvent.change(screen.getByLabelText('接续提问'),{target:{value:'更换配置后仍不应发送的新问题'}})
    const generate=screen.getByRole('button',{name:'生成未发送草稿'}) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    fireEvent.click(generate)
    expect(localText.mock.calls.filter(([payload])=>payload.action==='submit')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button',{name:'查询原请求（不重新生成）'}))
    await waitFor(()=>expect(localText.mock.calls.filter(([payload])=>payload.action==='requestStatus')).toHaveLength(1))
    expect(localText.mock.calls.find(([payload])=>payload.action==='requestStatus')![0]).toMatchObject({requestId:firstId,customerOwnerId:'seat-owner'})
    await waitFor(()=>expect((screen.getByRole('button',{name:'刷新'}) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button',{name:'刷新'}))
    fireEvent.click(await screen.findByRole('button',{name:/已核对历史，保留未确认记录/}))
    await waitFor(()=>expect(generate.disabled).toBe(false))
    fireEvent.click(generate)
    await waitFor(()=>expect(localText.mock.calls.filter(([payload])=>payload.action==='submit')).toHaveLength(2))
    const secondId=localText.mock.calls.filter(([payload])=>payload.action==='submit')[1][0].requestId
    expect(secondId).not.toBe(firstId)
    expect(post.mock.calls.every(([path])=>path==='/api/customer-reply-workspace')).toBe(true)
  })
  it('owned shared customer consumer sends original owner and revision through localText without API fallback',async()=>{
    const post=vi.fn(async(_path:string)=>({...initial,can_grant:false}))
    const localText=vi.fn(async payload=>ownedReceipt(payload.requestId!))
    mount(post,{backendChoice:ownedChoice,runtime:{post,localText} as unknown as EnterpriseClientRuntime});open()
    await screen.findByText('工作日联系',{selector:'p'})
    fireEvent.change(screen.getByRole('textbox',{name:'交接引用'}),{target:{value:JSON.stringify({owner_id:'seat-owner',customer_id:customer})}})
    fireEvent.click(screen.getByRole('button',{name:'打开交接记录'}))
    fireEvent.change(await screen.findByLabelText('接续提问'),{target:{value:'接续共享客户原问题'}})
    fireEvent.click(screen.getByRole('button',{name:'生成未发送草稿'}))
    expect(await screen.findByText('服务端已接纳的共享草稿')).toBeTruthy()
    expect(localText).toHaveBeenCalledOnce()
    expect(localText.mock.calls[0][0]).toMatchObject({action:'submit',mode:'knowledge_answer',customerId:customer,conversationId:customer,
      customerOwnerId:'seat-owner',conversationRevision:2,content:'接续共享客户原问题',choice:ownedChoice})
    expect(post.mock.calls.every(([path])=>path==='/api/customer-reply-workspace')).toBe(true)
    expect(screen.getByText('客户端提供 · 模型来源未验证 · 未发送草稿')).toBeTruthy()
    expect(screen.getByText('共享草稿核对说明')).toBeTruthy()
    expect(screen.getByText('可审核的后续提问')).toBeTruthy()
  })

  it('owned ordinary history recovers the original ID without current model readiness and excludes legacy recovery',async()=>{
    const post=vi.fn(async()=>({...initial,events:[{id:original,kind:'model_request',state:'draft_ready'},
      {id:'draft',kind:'model_draft',in_reply_to:original,text:'历史的未验证草稿',knowledge_grounded:null,source:'client_provided',model_origin:'unverified',delivery_state:'not_sent'}]}))
    const localText=vi.fn(async()=>ownedReceipt(original)), recovered=vi.fn(), legacy=vi.fn()
    const first=mount(post,{unknownRequestId:original,onRecovered:legacy,onOwnedRecovered:recovered,runtime:{post,localText} as unknown as EnterpriseClientRuntime});open()
    await screen.findByText('历史的未验证草稿')
    expect(screen.queryByRole('button',{name:/恢复已有草稿/})).toBeNull()
    first.unmount()
    mount(post,{unknownRequestId:original,onRecovered:legacy,onOwnedRecovered:recovered,runtime:{post,localText} as unknown as EnterpriseClientRuntime});open()
    fireEvent.click(await screen.findByRole('button',{name:'查询原请求（不重新生成）'}))
    await waitFor(()=>expect(recovered).toHaveBeenCalledOnce())
    expect(localText).toHaveBeenCalledWith({action:'requestStatus',mode:'knowledge_answer',customerId:customer,conversationId:customer,requestId:original})
    expect(legacy).not.toHaveBeenCalled()
    expect(recovered.mock.calls[0][1]).toMatchObject({historical:true,modelOrigin:'unverified',deliveryState:'not_sent'})
  })

  it('owned shared history query uses the stored original ID after remount and does not submit again',async()=>{
    const post=vi.fn(async(_path:string)=>({...initial,can_grant:false,events:[{id:original,kind:'model_request',state:'unknown'}]}))
    const localText=vi.fn(async()=>({...ownedReceipt(original),state:'unknown' as const,text:undefined}))
    const runtime={post,localText} as unknown as EnterpriseClientRuntime
    const first=mount(post,{runtime,backendChoice:{...ownedChoice,availability:'unavailable'}});open();await screen.findByText('模型请求 · 结果不明')
    first.unmount()
    mount(post,{runtime,backendChoice:{...ownedChoice,availability:'unavailable'}});open();await screen.findByText('模型请求 · 结果不明')
    fireEvent.change(screen.getByRole('textbox',{name:'交接引用'}),{target:{value:JSON.stringify({owner_id:'seat-owner',customer_id:customer})}})
    fireEvent.click(screen.getByRole('button',{name:'打开交接记录'}))
    fireEvent.click(await screen.findByRole('button',{name:'查询原请求（不重新生成）'}))
    await waitFor(()=>expect(localText).toHaveBeenCalledOnce())
    expect(localText).toHaveBeenCalledWith({action:'requestStatus',mode:'knowledge_answer',customerId:customer,conversationId:customer,requestId:original,customerOwnerId:'seat-owner'})
    expect((screen.getByRole('button',{name:'生成未发送草稿'}) as HTMLButtonElement).disabled).toBe(true)
    expect(post.mock.calls.every(([path])=>path==='/api/customer-reply-workspace')).toBe(true)
  })

  it('owned history query ignores a late result after switching the handover target',async()=>{
    let finish!:(value:ReturnType<typeof ownedReceipt>)=>void
    const held=new Promise<ReturnType<typeof ownedReceipt>>(resolve=>{finish=resolve})
    const another='6f292c74-7165-49d6-9a98-92db192a95b9'
    const post=vi.fn(async(_path,body)=>({...initial,customer_id:body.customer_id,owner_id:body.owner_id || initial.owner_id,
      events:body.customer_id===customer ? [{id:original,kind:'model_request',state:'unknown'}] : []}))
    const localText=vi.fn(()=>held), recovered=vi.fn()
    const first=mount(post,{runtime:{post,localText} as unknown as EnterpriseClientRuntime,onOwnedRecovered:recovered});open()
    fireEvent.click(await screen.findByRole('button',{name:'查询原请求（不重新生成）'}))
    first.unmount()
    mount(post,{customerId:another,runtime:{post,localText} as unknown as EnterpriseClientRuntime,onOwnedRecovered:recovered});open()
    await waitFor(()=>expect(post.mock.calls.at(-1)?.[1].customer_id).toBe(another))
    finish(ownedReceipt(original))
    await waitFor(()=>expect(screen.queryByText('服务端已接纳的共享草稿')).toBeNull())
    expect(recovered).not.toHaveBeenCalled()
  })
  it('loads only on expansion and writes memory with current revision and a selected source', async () => {
    const post = vi.fn(async (_path, body) => body.action === 'conversation_read' ? initial : {...initial,revision:3})
    mount(post)
    expect(post).not.toHaveBeenCalled()
    open()
    await screen.findByText('工作日联系', {selector:'p'})
    const save = screen.getByRole('button',{name:'保存或纠正记忆'})
    fireEvent.change(screen.getByLabelText('记忆内容'),{target:{value:'偏好工作日联系'}})
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('依据记录'),{target:{value:source}})
    fireEvent.click(save)
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[1]).toEqual(['/api/customer-reply-workspace', {
      action:'conversation_memory',customer_id:customer,owner_id:'seat-owner',expected_revision:2,
      source_ids:[source],text:'偏好工作日联系',memory_id:undefined,kind:'fact'
    }])
  })

  it('shows only the finite error copy and requires rereading after a conflicting write', async () => {
    const post = vi.fn(async (_path, body) => {
      if(body.action === 'conversation_read') return initial
      throw Error('PRIVATE-model-or-storage-detail')
    })
    mount(post); open()
    await screen.findByText('工作日联系', {selector:'p'})
    fireEvent.change(screen.getByLabelText('客户原话（坐席录入）'),{target:{value:'新原话'}})
    fireEvent.click(screen.getByRole('button',{name:'保存来源记录'}))
    expect((await screen.findByRole('alert')).textContent).toContain('请检查权限并重新读取')
    expect(screen.queryByText(/PRIVATE/)).toBeNull()
    expect(screen.queryByRole('button',{name:'保存来源记录'})).toBeNull()
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('treats handover references as selectors and leaves authorization to the server', async () => {
    const post = vi.fn(async (_path, body) => {
      if(body.owner_id === 'unauthorized-seat') throw Error('denied')
      return initial
    })
    mount(post); open()
    await screen.findByText('工作日联系', {selector:'p'})
    fireEvent.change(screen.getByRole('textbox',{name:'交接引用'}), {
      target:{value:JSON.stringify({owner_id:'unauthorized-seat',customer_id:customer})}
    })
    fireEvent.click(screen.getByRole('button',{name:'打开交接记录'}))
    await screen.findByRole('alert')
    expect(post.mock.calls.at(-1)?.[1]).toEqual({action:'conversation_read',owner_id:'unauthorized-seat',customer_id:customer})
    expect(screen.queryByText('工作日联系',{selector:'p'})).toBeNull()
  })

  it('ignores a late read from the previous customer after opening a handover', async () => {
    let finish!: (value: typeof initial) => void
    const oldRead = new Promise<typeof initial>(resolve => {finish=resolve})
    const another = '6f292c74-7165-49d6-9a98-92db192a95b9'
    const post = vi.fn(async (_path, body) => body.customer_id === customer ? oldRead : {
      ...initial,customer_id:another,owner_id:'shared-owner',can_grant:false,
      events:[{id:'other-source',kind:'customer_statement',text:'另一客户当前原话'}]
    })
    mount(post); open()
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByRole('textbox',{name:'交接引用'}), {
      target:{value:JSON.stringify({owner_id:'shared-owner',customer_id:another})}
    })
    fireEvent.click(screen.getByRole('button',{name:'打开交接记录'}))
    await screen.findByText('另一客户当前原话',{selector:'p'})
    finish(initial)
    await waitFor(() => expect(screen.queryByText('工作日联系',{selector:'p'})).toBeNull())
    expect(screen.getByText('另一客户当前原话',{selector:'p'})).toBeTruthy()
  })

  it('does not resubmit an ambiguous shared generation and labels model output as unsent', async () => {
    const post = vi.fn(async (path, body) => {
      if(path === '/api/tenant-ai-assist') throw Error('timeout')
      return {...initial,can_grant:false,events:[...initial.events,
        {id:'draft-1',kind:'model_draft',text:'历史草稿',delivery_state:'not_sent'}]}
    })
    mount(post); open()
    await screen.findByText('模型草稿 · 未发送')
    fireEvent.change(screen.getByRole('textbox',{name:'交接引用'}), {
      target:{value:JSON.stringify({owner_id:'seat-owner',customer_id:customer})}
    })
    fireEvent.click(screen.getByRole('button',{name:'打开交接记录'}))
    const question = await screen.findByLabelText('接续提问')
    fireEvent.change(question,{target:{value:'继续核实需求'}})
    const generate = screen.getByRole('button',{name:'生成未发送草稿'})
    fireEvent.click(generate)
    expect(await screen.findByText('结果未确认，请读取历史，勿重复提交。')).toBeTruthy()
    fireEvent.click(generate)
    expect(post.mock.calls.filter(([path]) => path === '/api/tenant-ai-assist')).toHaveLength(1)
    expect(post.mock.calls.find(([path]) => path === '/api/tenant-ai-assist')?.[1]).toMatchObject({
      configuration_id:'model-one',customer_owner_id:'seat-owner',customer_id:customer,conversation_revision:2
    })
    expect(screen.queryByRole('button',{name:'授权接手'})).toBeNull()
  })

  it('restores the durable unknown fence after remount and permits new questions only after manual acknowledgement', async () => {
    let events: Array<Record<string,unknown>> = [{id:'original-request',kind:'model_request',text:'原问题',state:'unknown',delivery_state:'not_sent'}]
    const post = vi.fn(async (path,body) => {
      if(path === '/api/tenant-ai-assist') throw Error('must not replay')
      if(body.action === 'conversation_acknowledge') events = events.map(e=>({...e,acknowledged_at:1}))
      return {...initial,events}
    })
    const first = mount(post);open()
    await screen.findByText('模型请求 · 未发送 · 结果不明')
    first.unmount()
    mount(post);open()
    await screen.findByText('模型请求 · 未发送 · 结果不明')
    fireEvent.change(screen.getByRole('textbox',{name:'交接引用'}),{target:{value:JSON.stringify({owner_id:'seat-owner',customer_id:customer})}})
    fireEvent.click(screen.getByRole('button',{name:'打开交接记录'}))
    const question = await screen.findByLabelText('接续提问')
    await waitFor(()=>expect((question as HTMLTextAreaElement).disabled).toBe(true))
    fireEvent.click(screen.getByRole('button',{name:'生成未发送草稿'}))
    expect(post.mock.calls.some(([path])=>path === '/api/tenant-ai-assist')).toBe(false)
    fireEvent.click(screen.getByRole('button',{name:/已核对历史，保留未确认记录/}))
    await waitFor(()=>expect((question as HTMLTextAreaElement).disabled).toBe(false))
    expect(post.mock.calls.some(([path])=>path === '/api/tenant-ai-assist')).toBe(false)
    expect(screen.getByText('模型请求 · 未发送 · 结果不明')).toBeTruthy()
  })

  it('recovers a completed draft only by the original unknown request ID and explicit confirmation', async () => {
    const post = vi.fn(async(_path:string)=>({...initial,events:[
      {id:'original-request',kind:'model_request',state:'draft_ready'},
      {id:'original-draft',kind:'model_draft',in_reply_to:'original-request',text:'原请求已有的草稿',knowledge_grounded:true}
    ]}))
    const recovered = vi.fn()
    const first = mount(post,{unknownRequestId:'unrelated-request',onRecovered:recovered});open()
    await screen.findByText('原请求已有的草稿')
    expect(screen.queryByRole('button',{name:/恢复已有草稿/})).toBeNull()
    first.unmount()
    mount(post,{unknownRequestId:'original-request',onRecovered:recovered});open()
    const recover = await screen.findByRole('button',{name:/恢复已有草稿/})
    expect(recovered).not.toHaveBeenCalled()
    fireEvent.click(recover)
    expect(recovered).toHaveBeenCalledWith('原请求已有的草稿',true)
    expect(post.mock.calls.every(([path])=>path === '/api/customer-reply-workspace')).toBe(true)
  })
})
