// packages/backend/src/dns/dns.ts
//
// gRPC-web wrapper for the DNS service.
// Follows the same pattern as cluster.ts — unary() + metadata().

import { unary } from '../core/rpc'
import { grpcWebHostUrl } from '../core/endpoints'
import { metadata } from '../core/auth'
import * as dnsGrpc from 'globular-web-client/dns/dns_grpc_web_pb'
import * as dns from 'globular-web-client/dns/dns_pb'

function dnsClient(): dnsGrpc.DnsServiceClient {
  const addr = grpcWebHostUrl()
  return new dnsGrpc.DnsServiceClient(addr, null, { withCredentials: true })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DnsRecord {
  name: string
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'NS' | 'MX' | 'SRV' | 'SOA'
  value: string
}

export interface SrvRecord {
  priority: number
  weight: number
  port: number
  target: string
}

export interface MxRecord {
  preference: number
  mx: string
}

export interface SoaRecord {
  ns: string
  mbox: string
  serial: number
  refresh: number
  retry: number
  expire: number
  minttl: number
}

// ─── Domain management ──────────────────────────────────────────────────────

export async function getDnsDomains(): Promise<string[]> {
  const md = metadata()
  const rq = new dns.GetDomainsRequest()
  const rsp = await unary<dns.GetDomainsRequest, dns.GetDomainsResponse>(
    dnsClient, 'getDomains', rq, undefined, md,
  )
  return rsp.getDomainsList?.() ?? []
}

export async function setDnsDomains(domains: string[]): Promise<void> {
  const md = metadata()
  const rq = new dns.SetDomainsRequest()
  rq.setDomainsList(domains)
  await unary<dns.SetDomainsRequest, dns.SetDomainsResponse>(
    dnsClient, 'setDomains', rq, undefined, md,
  )
}

// ─── Record queries ─────────────────────────────────────────────────────────

export async function getARecords(name: string): Promise<string[]> {
  const md = metadata()
  const rq = new dns.GetARequest()
  rq.setDomain(name)
  const rsp = await unary<dns.GetARequest, dns.GetAResponse>(
    dnsClient, 'getA', rq, undefined, md,
  )
  return rsp.getAList?.() ?? []
}

export async function getAAAARecords(name: string): Promise<string[]> {
  const md = metadata()
  const rq = new dns.GetAAAARequest()
  rq.setDomain(name)
  const rsp = await unary<dns.GetAAAARequest, dns.GetAAAAResponse>(
    dnsClient, 'getAAAA', rq, undefined, md,
  )
  return rsp.getAaaaList?.() ?? []
}

export async function getCNameRecord(name: string): Promise<string | null> {
  const md = metadata()
  const rq = new dns.GetCNameRequest()
  rq.setId(name)
  try {
    const rsp = await unary<dns.GetCNameRequest, dns.GetCNameResponse>(
      dnsClient, 'getCName', rq, undefined, md,
    )
    const v = rsp.getCname?.() ?? ''
    return v || null
  } catch {
    return null
  }
}

export async function getTxtRecords(name: string): Promise<string[]> {
  const md = metadata()
  const rq = new dns.GetTXTRequest()
  rq.setDomain(name)
  const rsp = await unary<dns.GetTXTRequest, dns.GetTXTResponse>(
    dnsClient, 'getTXT', rq, undefined, md,
  )
  return rsp.getTxtList?.() ?? []
}

export async function getNsRecords(name: string): Promise<string[]> {
  const md = metadata()
  const rq = new dns.GetNsRequest()
  rq.setId(name)
  const rsp = await unary<dns.GetNsRequest, dns.GetNsResponse>(
    dnsClient, 'getNs', rq, undefined, md,
  )
  return rsp.getNsList?.() ?? []
}

export async function getSrvRecords(name: string): Promise<SrvRecord[]> {
  const md = metadata()
  const rq = new dns.GetSrvRequest()
  rq.setId(name)
  const rsp = await unary<dns.GetSrvRequest, dns.GetSrvResponse>(
    dnsClient, 'getSrv', rq, undefined, md,
  )
  return (rsp.getResultList?.() ?? []).map((s: any) => ({
    priority: s.getPriority?.() ?? 0,
    weight:   s.getWeight?.()   ?? 0,
    port:     s.getPort?.()     ?? 0,
    target:   s.getTarget?.()   ?? '',
  }))
}

export async function getMxRecords(name: string): Promise<MxRecord[]> {
  const md = metadata()
  const rq = new dns.GetMxRequest()
  rq.setId(name)
  const rsp = await unary<dns.GetMxRequest, dns.GetMxResponse>(
    dnsClient, 'getMx', rq, undefined, md,
  )
  return (rsp.getResultList?.() ?? []).map((m: any) => ({
    preference: m.getPreference?.() ?? 0,
    mx:         m.getMx?.()         ?? '',
  }))
}

export async function getSoaRecords(name: string): Promise<SoaRecord[]> {
  const md = metadata()
  const rq = new dns.GetSoaRequest()
  rq.setId(name)
  const rsp = await unary<dns.GetSoaRequest, dns.GetSoaResponse>(
    dnsClient, 'getSoa', rq, undefined, md,
  )
  return (rsp.getResultList?.() ?? []).map((s: any) => ({
    ns:      s.getNs?.()      ?? '',
    mbox:    s.getMbox?.()    ?? '',
    serial:  s.getSerial?.()  ?? 0,
    refresh: s.getRefresh?.() ?? 0,
    retry:   s.getRetry?.()   ?? 0,
    expire:  s.getExpire?.()  ?? 0,
    minttl:  s.getMinttl?.()  ?? 0,
  }))
}

// ─── Composite: fetch all records for a zone ────────────────────────────────

/**
 * Query A/AAAA/CNAME/TXT for each name and flatten into a single DnsRecord[].
 * Errors on individual names are silently skipped (name may not have all types).
 */
export async function fetchZoneRecords(zone: string, names: string[]): Promise<DnsRecord[]> {
  const records: DnsRecord[] = []

  const jobs = names.map(async (name) => {
    const results = await Promise.allSettled([
      getARecords(name),
      getAAAARecords(name),
      getCNameRecord(name),
      getTxtRecords(name),
    ])
    const [aR, aaaaR, cnameR, txtR] = results

    if (aR.status === 'fulfilled') {
      for (const v of aR.value) records.push({ name, type: 'A', value: v })
    }
    if (aaaaR.status === 'fulfilled') {
      for (const v of aaaaR.value) records.push({ name, type: 'AAAA', value: v })
    }
    if (cnameR.status === 'fulfilled' && cnameR.value) {
      records.push({ name, type: 'CNAME', value: cnameR.value })
    }
    if (txtR.status === 'fulfilled') {
      for (const v of txtR.value) records.push({ name, type: 'TXT', value: v })
    }
  })

  // Also fetch NS and SOA for the zone root
  jobs.push((async () => {
    const [nsR, soaR] = await Promise.allSettled([
      getNsRecords(zone),
      getSoaRecords(zone),
    ])
    if (nsR.status === 'fulfilled') {
      for (const v of nsR.value) records.push({ name: zone, type: 'NS', value: v })
    }
    if (soaR.status === 'fulfilled') {
      for (const s of soaR.value) {
        records.push({ name: zone, type: 'SOA', value: `${s.ns} ${s.mbox} (serial ${s.serial})` })
      }
    }
  })())

  await Promise.allSettled(jobs)
  return records
}
