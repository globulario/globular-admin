/**
 * proto_fix.ts — Fix Vite CJS→ESM proto namespace breakage.
 *
 * google-protobuf generated code uses closure-captured references like
 * `proto.resource.GetAccountsRqst.serializeBinaryToWriter(this, writer)`
 * inside serializeBinary(). Vite's CJS→ESM conversion can chunk modules
 * so that the closure's `proto` object doesn't have the classes populated.
 *
 * This fix injects the exported classes into `globalThis.proto.<pkg>` so
 * that ALL closure references resolve correctly — both serialization and
 * deserialization (method descriptors).
 *
 * Call once per proto package after importing:
 *   import * as resource from "globular-web-client/resource/resource_pb"
 *   fixProtoNamespace('resource', resource)
 */
export function fixProtoNamespace(packageName: string, exports: any): void {
  if (!exports || typeof exports !== 'object') return;

  const g = globalThis as any;
  if (!g.proto) g.proto = {};
  if (!g.proto[packageName]) g.proto[packageName] = {};

  // Copy all exported classes/functions into the global proto namespace.
  // This makes closure references like `proto.resource.Foo` resolve.
  for (const key of Object.keys(exports)) {
    if (g.proto[packageName][key] === undefined || g.proto[packageName][key] === null) {
      g.proto[packageName][key] = exports[key];
    }
  }
}
