// packages/sdk/src/ai_executor/aiexecutor_client.ts
import { metadata } from '../core/auth'
import { grpcWebHostUrl } from '../core/endpoints'
import { stream } from '../core/rpc'
import * as aeGrpc from 'globular-web-client/ai_executor/ai_executor_grpc_web_pb'
import * as ae from 'globular-web-client/ai_executor/ai_executor_pb'

export { ae as aiexecutorpb }

function aeClient(addr?: string): aeGrpc.AiExecutorServiceClient {
  const target = addr ?? grpcWebHostUrl()
  return new aeGrpc.AiExecutorServiceClient(target, null, { withCredentials: true })
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PromptResult {
  conversationId: string
  response: string
  respondingNode: string
  inputTokens: number
  outputTokens: number
  needsHumanReply: boolean
  questionForHuman: string
  status: number
}

export interface StatusInfo {
  uptimeSeconds: number
  incidentsProcessed: number
  diagnosesCompleted: number
  actionsExecuted: number
  actionsFailed: number
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | string
  content: string
  createdAtMs: number
  nodeHostname: string
  inputTokens: number
  outputTokens: number
}

export interface ConversationSummary {
  id: string
  title: string
  userId: string
  createdAtMs: number
  updatedAtMs: number
  messageCount: number
  lastMessagePreview: string
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Send a prompt to the cluster AI executor. Opens a server-streaming RPC and
 * accumulates all text chunks into a single string, resolving once the stream
 * completes.
 *
 * @param prompt          The question/instruction to send.
 * @param conversationId  Optional — continue an existing conversation.
 * @param targetNode      Optional — route to a specific node by hostname.
 * @param onChunk         Optional — progressive callback fired for each chunk.
 */
export async function sendPrompt(
  prompt: string,
  conversationId?: string,
  targetNode?: string,
  onChunk?: (text: string) => void,
  userId?: string,
): Promise<PromptResult> {
  const rq = new ae.SendPromptRequest()
  rq.setPrompt(prompt)
  if (conversationId) rq.setConversationId(conversationId)
  if (targetNode)     rq.setTargetNode(targetNode)
  if (userId)         rq.setUserId(userId)

  const result: PromptResult = {
    conversationId: '',
    response: '',
    respondingNode: '',
    inputTokens: 0,
    outputTokens: 0,
    needsHumanReply: false,
    questionForHuman: '',
    status: 0,
  }

  await stream<ae.SendPromptRequest, ae.SendPromptResponse>(
    (addr) => aeClient(addr),
    'sendPrompt',
    rq,
    (msg) => {
      // Prefer full_text when the server emits it (non-chunked responses);
      // otherwise append each text_chunk as it arrives.
      const full  = msg.getFullText?.()  ?? ''
      const chunk = msg.getTextChunk?.() ?? ''
      if (full) {
        result.response = full
      } else if (chunk) {
        result.response += chunk
        onChunk?.(chunk)
      }
      const convId = msg.getConversationId?.() ?? ''
      if (convId) result.conversationId = convId
      const node = msg.getRespondingNode?.() ?? ''
      if (node) result.respondingNode = node
      const inT = msg.getInputTokens?.()  ?? 0
      const ouT = msg.getOutputTokens?.() ?? 0
      if (inT) result.inputTokens  = inT
      if (ouT) result.outputTokens = ouT
      result.needsHumanReply  = msg.getNeedsHumanReply?.()  ?? result.needsHumanReply
      result.questionForHuman = msg.getQuestionForHuman?.() ?? result.questionForHuman
      result.status           = msg.getStatus?.()           ?? result.status
    },
    'ai_executor.AiExecutorService',
    { md: metadata() },
  )

  return result
}

/**
 * Get the local ai-executor's status (hostname, AI availability, uptime).
 * Does NOT aggregate across peers — returns only the node the request lands on.
 */
/** List all conversations (optionally scoped to a user). */
export async function listConversations(userId?: string, limit = 50): Promise<ConversationSummary[]> {
  const rq = new ae.ListConversationsRequest()
  if (userId) rq.setUserId(userId)
  rq.setLimit(limit)
  const client = aeClient()
  const md = metadata()
  return new Promise<ConversationSummary[]>((resolve, reject) => {
    (client as any).listConversations(rq, md, (err: any, rsp: ae.ListConversationsResponse) => {
      if (err) return reject(err)
      const list = rsp.getConversationsList?.() ?? []
      resolve(list.map((c: any) => ({
        id:                 c.getId?.()                 ?? '',
        title:              c.getTitle?.()              ?? '',
        userId:             c.getUserId?.()             ?? '',
        createdAtMs:        c.getCreatedAtMs?.()        ?? 0,
        updatedAtMs:        c.getUpdatedAtMs?.()        ?? 0,
        messageCount:       c.getMessageCount?.()       ?? 0,
        lastMessagePreview: c.getLastMessagePreview?.() ?? '',
      } satisfies ConversationSummary)))
    })
  })
}

/** Fetch full message history for a conversation. */
export async function getConversation(conversationId: string, limit = 0): Promise<ConversationMessage[]> {
  const rq = new ae.GetConversationRequest()
  rq.setConversationId(conversationId)
  rq.setLimit(limit)
  const client = aeClient()
  const md = metadata()
  return new Promise<ConversationMessage[]>((resolve, reject) => {
    (client as any).getConversation(rq, md, (err: any, rsp: ae.GetConversationResponse) => {
      if (err) return reject(err)
      const list = rsp.getMessagesList?.() ?? []
      resolve(list.map((m: any) => ({
        id:             m.getId?.()             ?? '',
        conversationId: m.getConversationId?.() ?? '',
        role:           m.getRole?.()           ?? '',
        content:        m.getContent?.()        ?? '',
        createdAtMs:    m.getCreatedAtMs?.()    ?? 0,
        nodeHostname:   m.getNodeHostname?.()   ?? '',
        inputTokens:    m.getInputTokens?.()    ?? 0,
        outputTokens:   m.getOutputTokens?.()   ?? 0,
      } satisfies ConversationMessage)))
    })
  })
}

/** Delete a conversation and all its messages. */
export async function deleteConversation(conversationId: string): Promise<void> {
  const rq = new ae.DeleteConversationRequest()
  rq.setConversationId(conversationId)
  const client = aeClient()
  const md = metadata()
  return new Promise<void>((resolve, reject) => {
    (client as any).deleteConversation(rq, md, (err: any) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

export async function getAiExecutorStatus(): Promise<StatusInfo> {
  const rq = new ae.GetStatusRequest()
  const client = aeClient()
  const md = metadata()

  return new Promise<StatusInfo>((resolve, reject) => {
    (client as any).getStatus(rq, md, (err: any, rsp: ae.GetStatusResponse) => {
      if (err) return reject(err)
      resolve({
        uptimeSeconds:      rsp.getUptimeSeconds?.()      ?? 0,
        incidentsProcessed: rsp.getIncidentsProcessed?.() ?? 0,
        diagnosesCompleted: rsp.getDiagnosesCompleted?.() ?? 0,
        actionsExecuted:    rsp.getActionsExecuted?.()    ?? 0,
        actionsFailed:      rsp.getActionsFailed?.()      ?? 0,
      })
    })
  })
}
