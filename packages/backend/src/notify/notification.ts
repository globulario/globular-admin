// src/backend/notify/notification.ts
// Typed wrapper for notification RPCs (ResourceService)

import { getBaseUrl } from "../core/endpoints";
import { unary, stream } from "../core/rpc";

import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb";
import * as resource from "globular-web-client/resource/resource_pb";

const SERVICE_METHODS = {
  create: { method: ["createNotification"], rq: ["CreateNotificationRqst"] },
  delete: { method: ["deleteNotification"], rq: ["DeleteNotificationRqst"] },
  clearAll: { method: ["clearAllNotifications"], rq: ["ClearAllNotificationsRqst"] },
  clearByType: { method: ["clearNotificationsByType"], rq: ["ClearNotificationsByTypeRqst"] },
  get: { method: ["getNotifications"], rq: ["GetNotificationsRqst"] },
} as const;

function clientFactory(): ResourceServiceClient {
  const base = getBaseUrl() ?? "";
  return new ResourceServiceClient(base, null, { withCredentials: true });
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__");
    return t ? { token: t, authorization: "Bearer " + t } : {};
  } catch {
    return {};
  }
}

function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (resource as any)[n];
    if (typeof Ctor === "function") return new Ctor();
  }
  return {};
}

function pickMethod(client: any, names: readonly string[]): string {
  for (const n of names) if (typeof client[n] === "function") return n;
  return names[0];
}

export type NotificationVM = {
  id: string;
  sender: string;
  recipient: string;
  message: string;
  mac?: string;
  type: number;
  date: number; // unix seconds
};

function vmFromProto(n: any): NotificationVM {
  return {
    id: n?.getId?.() ?? n?.id ?? "",
    sender: n?.getSender?.() ?? n?.sender ?? "",
    recipient: n?.getRecipient?.() ?? n?.recipient ?? "",
    message: n?.getMessage?.() ?? n?.message ?? "",
    mac: n?.getMac?.() ?? n?.mac ?? "",
    type: Number(n?.getNotificationType?.() ?? n?.notificationType ?? n?.type ?? 0),
    date: Number(n?.getDate?.() ?? n?.date ?? 0),
  };
}

function protoFromVM(vm: NotificationVM): any {
  const n = new resource.Notification();
  if (vm.id) n.setId(vm.id);
  if (vm.sender) n.setSender(vm.sender);
  if (vm.recipient) n.setRecipient(vm.recipient);
  if (vm.message) n.setMessage(vm.message);
  if (vm.mac) n.setMac(vm.mac);
  if (vm.type !== undefined) n.setNotificationType(vm.type);
  if (vm.date) n.setDate(vm.date);
  return n;
}

export async function createNotification(input: NotificationVM): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.create.rq);
  rq.setNotification?.(protoFromVM(input));
  const method = pickMethod(clientFactory(), SERVICE_METHODS.create.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function deleteNotification(id: string, recipient: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.delete.rq);
  rq.setId?.(id); rq.id ??= id;
  rq.setRecipient?.(recipient); rq.recipient ??= recipient;
  const method = pickMethod(clientFactory(), SERVICE_METHODS.delete.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function clearAllNotifications(recipient: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.clearAll.rq);
  rq.setRecipient?.(recipient); rq.recipient ??= recipient;
  const method = pickMethod(clientFactory(), SERVICE_METHODS.clearAll.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function clearNotificationsByType(recipient: string, type: number): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.clearByType.rq);
  rq.setRecipient?.(recipient); rq.recipient ??= recipient;
  rq.setNotificationType?.(type); rq.notificationType ??= type;
  const method = pickMethod(clientFactory(), SERVICE_METHODS.clearByType.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function listNotifications(recipient: string, type?: number): Promise<NotificationVM[]> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.get.rq);
  rq.setRecipient?.(recipient); rq.recipient ??= recipient;
  if (type !== undefined) rq.setNotificationType?.(type);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.get.method);
  const client = clientFactory();
  const notifications: NotificationVM[] = [];

  await stream(
    () => client,
    method,
    rq,
    (rsp: any) => {
      const list =
        rsp?.getNotificationsList?.() ??
        rsp?.notificationsList ??
        rsp?.notifications ??
        [];
      if (Array.isArray(list)) {
        list.forEach((n) => notifications.push(vmFromProto(n)));
      }
    },
    "resource.ResourceService",
    md
  );

  return notifications;
}

export { resource as notificationpb };
