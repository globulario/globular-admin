// backend/diskSpace.ts
// Thin adapter for disk-space RBAC calls using your grpc helpers.

import * as rbac from "globular-web-client/rbac/rbac_pb";

// 🔽 Use your auth + unary helpers
import { unary } from "../core/rpc";              // <- this is the file that exports the unary() helper you pasted
import * as rbacGrpc from "globular-web-client/rbac/rbac_grpc_web_pb";
import { grpcWebHostUrl } from "../core/endpoints";
// (You don't need serviceHost/serviceUrl here because we reuse the ready client instance on globule.)

function clientFactory(): rbacGrpc.RbacServiceClient {
  const base = grpcWebHostUrl()
  return new rbacGrpc.RbacServiceClient(base, null, { withCredentials: true })
}


async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem('__globular_token__')
    return t ? { token: t } : {}
  } catch {
    return {}
  }
}


/** Get allocated space (bytes) */
export async function getAllocatedSpace(
  subjectId: string,
  subjectType: rbac.SubjectType
): Promise<number> {
  const req = new rbac.GetSubjectAllocatedSpaceRqst();
  req.setSubject(subjectId);
  req.setType(subjectType);

  const resp = await unary<typeof req, any>(
    () => clientFactory(),
    "getSubjectAllocatedSpace",
    req,
    "rbac.RBACService",
    await meta()
  );

  return resp.getAllocatedSpace();
}

/** Get available space (bytes) */
export async function getAvailableSpace(
  subjectId: string,
  subjectType: rbac.SubjectType
): Promise<number> {
  const req = new rbac.GetSubjectAvailableSpaceRqst();
  req.setSubject(subjectId);
  req.setType(subjectType);

  try {
    const resp = await unary<typeof req, any>(
      () => clientFactory(),
      "getSubjectAvailableSpace",
      req,
      "rbac.RBACService",
      await meta()
    );
    return resp.getAvailableSpace();
  } catch (err: any) {
    // Normalize common “no space” case so UI can render a 0/allocated bar.
    const m = (err?.message || "").toLowerCase();
    if (m.includes("no space available for")) return 0;
    throw err;
  }
}

/** Set allocated space (bytes) */
export async function setAllocatedSpace(
  subjectId: string,
  subjectType: rbac.SubjectType,
  bytes: number
): Promise<void> {
  const req = new rbac.SetSubjectAllocatedSpaceRqst();
  req.setSubject(subjectId);
  req.setType(subjectType);
  req.setAllocatedSpace(bytes);

  await unary<typeof req, any>(
    () => clientFactory(),
    "setSubjectAllocatedSpace",
    req,
    "rbac.RBACService",
    await meta()
  );
}
