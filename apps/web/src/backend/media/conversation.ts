// src/backend/conversation.ts
import { getBaseUrl } from "../core/endpoints";
import { unary, stream } from "../core/rpc";

// ---- stubs (adjust paths if needed) ----
import { ConversationServiceClient } from "globular-web-client/conversation/conversation_grpc_web_pb";
import * as convpb from "globular-web-client/conversation/conversation_pb";

/* =====================================================================================
 * Client + metadata
 * ===================================================================================== */

function clientFactory(): ConversationServiceClient {
  const base = getBaseUrl() ?? "";
  return new ConversationServiceClient(base, null, { withCredentials: true });
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__");
    return t ? { token: t } : {};
  } catch {
    return {};
  }
}

/* =====================================================================================
 * Small helpers: tolerant getters/setters for codegen variants
 * ===================================================================================== */

function g<T>(obj: any, names: string[], fallback?: T): T | undefined {
  for (const n of names) {
    const fn = obj?.[n];
    if (typeof fn === "function") {
      try { return fn.call(obj) as T; } catch {}
    }
  }
  return fallback;
}
function s(obj: any, names: string[], v: any) {
  for (const n of names) {
    const fn = obj?.[n];
    if (typeof fn === "function") { try { fn.call(obj, v); return; } catch {} }
  }
}

/* =====================================================================================
 * VM (View-Model) types + mappers (optional, convenient in UI)
 * ===================================================================================== */

export type ConversationVM = {
  uuid: string;
  name?: string;
  messages?: string[];
  keywords?: string[];
  creationTime?: number;
  lastMessageTime?: number;
  language?: string;
  participants?: string[];
  mac?: string;
};

export type MessageVM = {
  uuid: string;
  conversation: string;
  creationTime: number;
  author: string;
  text: string;
  inReplyTo?: string;
  language?: string;
  likes?: string[];
  dislikes?: string[];
  readers?: string[];
};

export function toConversationVM(c: convpb.Conversation): ConversationVM {
  return {
    uuid:            g(c, ["getUuid"], "")!,
    name:            g(c, ["getName"]),
    messages:        g(c, ["getMessagesList"]) ?? [],
    keywords:        g(c, ["getKeywordsList"]) ?? [],
    creationTime:    g(c, ["getCreationtime", "getCreationTime"]) ?? 0,
    lastMessageTime: g(c, ["getLastMessageTime", "getLastmessageTime", "getLastmessagetime"]) ?? 0,
    language:        g(c, ["getLanguage"]),
    participants:    g(c, ["getParticipantsList"]) ?? [],
    mac:             g(c, ["getMac"]),
  };
}

export function fromConversationVM(vm: ConversationVM): convpb.Conversation {
  const c = new convpb.Conversation();
  s(c, ["setUuid"], vm.uuid ?? "");
  if (vm.name != null) s(c, ["setName"], vm.name);
  if (vm.messages != null) s(c, ["setMessagesList"], vm.messages);
  if (vm.keywords != null) s(c, ["setKeywordsList"], vm.keywords);
  if (vm.creationTime != null) s(c, ["setCreationtime", "setCreationTime"], vm.creationTime);
  if (vm.lastMessageTime != null) s(c, ["setLastMessageTime", "setLastmessagetime"], vm.lastMessageTime);
  if (vm.language != null) s(c, ["setLanguage"], vm.language);
  if (vm.participants != null) s(c, ["setParticipantsList"], vm.participants);
  if (vm.mac != null) s(c, ["setMac"], vm.mac);
  return c;
}

export function toMessageVM(m: convpb.Message): MessageVM {
  return {
    uuid:          g(m, ["getUuid"], "")!,
    conversation:  g(m, ["getConversation"], "")!,
    creationTime:  g(m, ["getCreationtime", "getCreationTime"], 0)!,
    author:        g(m, ["getAuthor"], "")!,
    text:          g(m, ["getText"], "")!,
    inReplyTo:     g(m, ["getInReplyTo", "getInreplyTo", "getInreplyto"]),
    language:      g(m, ["getLanguage"]),
    likes:         g(m, ["getLikesList"]) ?? [],
    dislikes:      g(m, ["getDislikesList"]) ?? [],
    readers:       g(m, ["getReadersList"]) ?? [],
  };
}

/* =====================================================================================
 * Caches
 * ===================================================================================== */

const conversationsCache = new Map<string, convpb.Conversation>();

export function cacheSetConversation(c: convpb.Conversation) {
  const id = g(c, ["getUuid"], "");
  if (id) conversationsCache.set(id, c);
}
export function cacheGetConversation(uuid: string) {
  return conversationsCache.get(uuid);
}
export function clearConversationCaches() {
  conversationsCache.clear();
}

/* =====================================================================================
 * Control (Stop)
 * ===================================================================================== */

export async function stop(): Promise<void> {
  const md = await meta();
  const rq = new convpb.StopRequest();
  await unary(clientFactory, "stop", rq, undefined, md);
}

/* =====================================================================================
 * Connections (server push)
 * ===================================================================================== */

export async function connect(
  connectionUuid: string,
  onMessage: (r: convpb.ConnectResponse) => void
): Promise<void> {
  const md = await meta();
  const rq = new convpb.ConnectRequest();
  rq.setUuid(connectionUuid);
  await stream(clientFactory, "connect", rq, onMessage, "conversation.ConversationService", md);
}

export async function disconnect(connectionUuid: string): Promise<boolean> {
  const md = await meta();
  const rq = new convpb.DisconnectRequest();
  rq.setUuid(connectionUuid);
  const rsp = await unary(clientFactory, "disconnect", rq, undefined, md) as convpb.DisconnectResponse;
  return (rsp as any)?.getResult?.() ?? true;
}

/* =====================================================================================
 * Conversations
 * ===================================================================================== */

export async function createConversation(params: {
  name: string;
  keywords?: string[];
  language?: string;
}): Promise<convpb.Conversation> {
  const md = await meta();
  const rq = new convpb.CreateConversationRequest();
  rq.setName(params.name);
  if (params.keywords?.length) rq.setKeywordsList(params.keywords);
  if (params.language) rq.setLanguage(params.language);

  const rsp = await unary(clientFactory, "createConversation", rq, undefined, md) as convpb.CreateConversationResponse;
  const conv = (rsp as any)?.getConversation?.();
  if (!conv) throw new Error("CreateConversation returned no conversation");
  cacheSetConversation(conv);
  return conv;
}

export async function deleteConversation(conversation_uuid: string): Promise<void> {
  const md = await meta();
  const rq = new convpb.DeleteConversationRequest();
  rq.setConversationUuid(conversation_uuid);
  await unary(clientFactory, "deleteConversation", rq, undefined, md);
  conversationsCache.delete(conversation_uuid);
}

export async function getConversation(id: string): Promise<convpb.Conversation | undefined> {
  // cache-hit first
  const cached = conversationsCache.get(id);
  if (cached) return cached;

  const md = await meta();
  const rq = new convpb.GetConversationRequest();
  rq.setId(id);
  const rsp = await unary(clientFactory, "getConversation", rq, undefined, md) as convpb.GetConversationResponse;
  const conv = (rsp as any)?.getConversation?.();
  if (conv) cacheSetConversation(conv);
  return conv;
}

export async function getConversations(creator: string): Promise<convpb.Conversation[]> {
  const md = await meta();
  const rq = new convpb.GetConversationsRequest();
  rq.setCreator(creator);
  const rsp = await unary(clientFactory, "getConversations", rq, undefined, md) as convpb.GetConversationsResponse;
  const list = (rsp as any)?.getConversations?.()?.getConversationsList?.() ?? [];
  list.forEach(cacheSetConversation);
  return list;
}

export async function findConversations(params: {
  query: string;
  language?: string;
  offset?: number;
  pageSize?: number;
  snippetSize?: number;
}): Promise<convpb.Conversation[]> {
  const md = await meta();
  const rq = new convpb.FindConversationsRequest();
  rq.setQuery(params.query ?? "");
  if (params.language) rq.setLanguage(params.language);
  rq.setOffset(params.offset ?? 0);
  rq.setPagesize(params.pageSize ?? 25);
  rq.setSnippetsize(params.snippetSize ?? 0);

  const rsp = await unary(clientFactory, "findConversations", rq, undefined, md) as convpb.FindConversationsResponse;
  const list: convpb.Conversation[] = (rsp as any)?.getConversationsList?.() ?? [];
  list.forEach(cacheSetConversation);
  return list;
}

/** Join is server-streaming; deliver each JoinConversationResponse to onMsg. */
export async function joinConversation(
  conversation_uuid: string,
  connection_uuid: string,
  onMsg: (m: convpb.JoinConversationResponse) => void
): Promise<void> {
  const md = await meta();
  const rq = new convpb.JoinConversationRequest();
  rq.setConversationUuid(conversation_uuid);
  rq.setConnectionUuid(connection_uuid);

  await stream(clientFactory, "joinConversation", rq, onMsg, "conversation.ConversationService", md);
}

export async function leaveConversation(
  conversation_uuid: string,
  connection_uuid: string
): Promise<convpb.Conversation | undefined> {
  const md = await meta();
  const rq = new convpb.LeaveConversationRequest();
  rq.setConversationUuid(conversation_uuid);
  rq.setConnectionUuid(connection_uuid);

  const rsp = await unary(clientFactory, "leaveConversation", rq, undefined, md) as convpb.LeaveConversationResponse;
  const conv = (rsp as any)?.getConversation?.();
  if (conv) cacheSetConversation(conv);
  return conv;
}

export async function kickoutFromConversation(conversation_uuid: string, account: string): Promise<void> {
  const md = await meta();
  const rq = new convpb.KickoutFromConversationRequest();
  rq.setConversationUuid(conversation_uuid);
  rq.setAccount(account);
  await unary(clientFactory, "kickoutFromConversation", rq, undefined, md);
}

/* =====================================================================================
 * Invitations
 * ===================================================================================== */

export async function sendInvitation(inv: convpb.Invitation): Promise<void> {
  const md = await meta();
  const rq = new convpb.SendInvitationRequest();
  rq.setInvitation(inv);
  await unary(clientFactory, "sendInvitation", rq, undefined, md);
}

export async function acceptInvitation(inv: convpb.Invitation): Promise<void> {
  const md = await meta();
  const rq = new convpb.AcceptInvitationRequest();
  rq.setInvitation(inv);
  await unary(clientFactory, "acceptInvitation", rq, undefined, md);
}

export async function declineInvitation(inv: convpb.Invitation): Promise<void> {
  const md = await meta();
  const rq = new convpb.DeclineInvitationRequest();
  rq.setInvitation(inv);
  await unary(clientFactory, "declineInvitation", rq, undefined, md);
}

export async function revokeInvitation(inv: convpb.Invitation): Promise<void> {
  const md = await meta();
  const rq = new convpb.RevokeInvitationRequest();
  rq.setInvitation(inv);
  await unary(clientFactory, "revokeInvitation", rq, undefined, md);
}

export async function getReceivedInvitations(account: string): Promise<convpb.Invitations | undefined> {
  const md = await meta();
  const rq = new convpb.GetReceivedInvitationsRequest();
  rq.setAccount(account);
  const rsp = await unary(clientFactory, "getReceivedInvitations", rq, undefined, md) as convpb.GetReceivedInvitationsResponse;
  return (rsp as any)?.getInvitations?.();
}

export async function getSentInvitations(account: string): Promise<convpb.Invitations | undefined> {
  const md = await meta();
  const rq = new convpb.GetSentInvitationsRequest();
  rq.setAccount(account);
  const rsp = await unary(clientFactory, "getSentInvitations", rq, undefined, md) as convpb.GetSentInvitationsResponse;
  return (rsp as any)?.getInvitations?.();
}

/* =====================================================================================
 * Messages
 * ===================================================================================== */

export async function sendMessage(msg: convpb.Message): Promise<void> {
  const md = await meta();
  const rq = new convpb.SendMessageRequest();
  rq.setMsg(msg);
  await unary(clientFactory, "sendMessage", rq, undefined, md);
}

export async function deleteMessage(conversation: string, uuid: string): Promise<void> {
  const md = await meta();
  const rq = new convpb.DeleteMessageRequest();
  rq.setConversation(conversation);
  rq.setUuid(uuid);
  await unary(clientFactory, "deleteMessage", rq, undefined, md);
}

/** FindMessages is streaming; each response holds one Message. */
export async function findMessages(
  keywords: string[],
  onMessage: (m: convpb.Message) => void
): Promise<void> {
  const md = await meta();
  const rq = new convpb.FindMessagesRequest();
  rq.setKeywordsList(keywords ?? []);

  await stream(clientFactory, "findMessages", rq, (res: any) => {
    const m = (res as convpb.FindMessagesResponse)?.getMessage?.();
    if (m) onMessage(m);
  }, "conversation.ConversationService", md);
}

export async function likeMessage(conversation: string, message: string, account: string): Promise<void> {
  const md = await meta();
  const rq = new convpb.LikeMessageRqst();
  rq.setConversation(conversation);
  rq.setMessage(message);
  rq.setAccount(account);
  await unary(clientFactory, "likeMessage", rq, undefined, md);
}

export async function dislikeMessage(conversation: string, message: string, account: string): Promise<void> {
  const md = await meta();
  const rq = new convpb.DislikeMessageRqst();
  rq.setConversation(conversation);
  rq.setMessage(message);
  rq.setAccount(account);
  await unary(clientFactory, "dislikeMessage", rq, undefined, md);
}

export async function setMessageRead(conversation: string, message: string, account: string): Promise<void> {
  const md = await meta();
  const rq = new convpb.SetMessageReadRqst();
  rq.setConversation(conversation);
  rq.setMessage(message);
  rq.setAccount(account);
  await unary(clientFactory, "setMessageRead", rq, undefined, md);
}
