import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import type { LookupFunction } from 'node:net'

import {
  isBlockedAddress,
  isBlockedHostname,
  isIpLiteral,
  unwrapIpLiteral
} from '../utils/network-address'

const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 1024 * 1024

export interface BackendUrlPolicy {
  /** Explicitly trusted hosts. Empty means any public host. */
  allowedHosts: string[]
  allowHttp: boolean
}

/**
 * `BACKEND_ALLOWED_HOSTS`: comma-separated allow list, entries may start with `*.`
 * to match subdomains. When set, only these hosts are reachable and private
 * addresses are permitted for them. `BACKEND_ALLOW_HTTP`: permit `http://` backends.
 */
export function backendUrlPolicy(): BackendUrlPolicy {
  const allowHttp = /^(1|true|yes)$/i.test(process.env.BACKEND_ALLOW_HTTP?.trim() ?? '')

  const allowedHosts = (process.env.BACKEND_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(host => normalizeHost(host))
    .filter(Boolean)

  return { allowedHosts, allowHttp }
}

function normalizeHost(host: string) {
  return unwrapIpLiteral(host.trim().toLowerCase()).replace(/\.$/, '')
}

const matchesAllowedHost = (host: string, pattern: string) =>
  pattern.startsWith('*.')
    ? host === pattern.slice(2) || host.endsWith(pattern.slice(1))
    : host === pattern

export type BackendUrlCheck =
  | { ok: true; url: URL; hostAllowlisted: boolean }
  | { ok: false; reason: string }

/**
 * Validates a backend URL against the policy. Query strings and fragments are
 * rejected because `/<toolName>` is appended to the path.
 */
export function checkBackendUrl(
  raw: string,
  policy: BackendUrlPolicy = backendUrlPolicy()
): BackendUrlCheck {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, reason: 'backend URL is empty' }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'backend URL must be an absolute http(s) URL' }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `protocol "${url.protocol}" is not supported, use https` }
  }

  if (url.protocol === 'http:' && !policy.allowHttp) {
    return {
      ok: false,
      reason: 'backend URL must use https (set BACKEND_ALLOW_HTTP=true to permit http)'
    }
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'backend URL must not embed credentials' }
  }

  if (url.search || url.hash) {
    return { ok: false, reason: 'backend URL must not contain a query string or fragment' }
  }

  const host = normalizeHost(url.hostname)
  if (!host) return { ok: false, reason: 'backend URL has no host' }

  if (policy.allowedHosts.length > 0) {
    const allowed = policy.allowedHosts.some(pattern => matchesAllowedHost(host, pattern))
    if (!allowed) {
      return { ok: false, reason: `host "${host}" is not in BACKEND_ALLOWED_HOSTS` }
    }
    return { ok: true, url, hostAllowlisted: true }
  }

  // Host names are checked against their resolved addresses by `guardedLookup`.
  if (isIpLiteral(host)) {
    if (isBlockedAddress(host)) {
      return { ok: false, reason: `address "${host}" is not a permitted backend address` }
    }
  } else if (isBlockedHostname(host)) {
    return { ok: false, reason: `host "${host}" is not a permitted backend host` }
  }

  return { ok: true, url, hostAllowlisted: false }
}

/** Appends the encoded tool name to the backend path, refusing traversal segments. */
export function buildToolUrl(backendUrl: URL, toolName: string): URL {
  const segments = toolName.split('/')

  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`tool name "${toolName}" is not a valid URL path`)
  }

  const target = new URL(backendUrl.href)
  const base = target.pathname.replace(/\/+$/, '')
  target.pathname = `${base}/${segments.map(encodeURIComponent).join('/')}`
  return target
}

/**
 * DNS lookup that refuses blocked addresses. Checking inside the lookup closes
 * the DNS-rebinding window: the socket connects to exactly the address returned.
 */
function guardedLookup(trusted: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        callback(err, '', 0)
        return
      }

      if (!trusted) {
        const blocked = addresses.find(entry => isBlockedAddress(entry.address))
        if (blocked) {
          callback(
            new Error(
              `refusing to connect to blocked address ${blocked.address}`
            ) as NodeJS.ErrnoException,
            '',
            0
          )
          return
        }
      }

      if (options.all) {
        callback(null, addresses)
        return
      }

      callback(null, addresses[0].address, addresses[0].family)
    })
  }
}

export interface BackendResponse {
  ok: boolean
  status: number
  statusText: string
  body: string
}

/**
 * POSTs to a validated backend URL. Uses `node:http(s)` rather than `fetch` so the
 * guarded lookup can be installed and redirects are not followed.
 */
export function requestBackend(
  target: URL,
  options: { body: string; headers: Record<string, string>; trustedHost: boolean }
): Promise<BackendResponse> {
  const transport = target.protocol === 'https:' ? https : http
  const host = unwrapIpLiteral(target.hostname)

  // IP literals bypass DNS resolution and therefore `guardedLookup`.
  if (!options.trustedHost && isIpLiteral(host) && isBlockedAddress(host)) {
    return Promise.reject(new Error(`refusing to connect to blocked address ${host}`))
  }

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: 'POST',
        lookup: guardedLookup(options.trustedHost),
        headers: {
          ...options.headers,
          'Content-Length': Buffer.byteLength(options.body)
        }
      },
      response => {
        const chunks: Buffer[] = []
        let size = 0

        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy()
            reject(new Error(`backend response exceeded ${MAX_RESPONSE_BYTES} bytes`))
            return
          }
          chunks.push(chunk)
        })

        response.on('end', () => {
          const status = response.statusCode ?? 0
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: response.statusMessage ?? '',
            body: Buffer.concat(chunks).toString('utf8')
          })
        })

        response.on('error', reject)
      }
    )

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`backend request timed out after ${REQUEST_TIMEOUT_MS}ms`))
    })

    request.on('error', reject)
    request.end(options.body)
  })
}
