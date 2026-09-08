import dns from 'node:dns'

import axios, { type AddressFamily, type LookupAddress, type LookupAddressEntry } from 'axios'

import {
  isBlockedAddress,
  isBlockedHostname,
  isIpLiteral,
  unwrapIpLiteral
} from '../utils/network-address'
import { logger } from '../utils/logger'

/** The callback form of axios' `lookup` option, which mirrors Node's own. */
type LookupFunction = (
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: LookupAddress | LookupAddress[],
    family?: AddressFamily
  ) => void
) => void

// Node types `family` as a plain number; axios narrows it to 4 | 6.
const toLookupEntry = (entry: dns.LookupAddress): LookupAddressEntry => ({
  address: entry.address,
  family: entry.family === 6 ? 6 : 4
})

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024

// Read once: an unusable value should be reported at startup, not on every call.
function positiveIntFromEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    logger.warn(`${name}="${raw}" is not a positive integer - falling back to ${fallback}`)
    return fallback
  }

  return parsed
}

/** Total deadline for a backend call, not an idle timeout. */
const REQUEST_TIMEOUT_MS = positiveIntFromEnv('BACKEND_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS)
const MAX_RESPONSE_BYTES = positiveIntFromEnv(
  'BACKEND_MAX_RESPONSE_BYTES',
  DEFAULT_MAX_RESPONSE_BYTES
)

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
 * the DNS-rebinding window: the socket connects to exactly the addresses returned.
 *
 * Deliberately callback-style: axios only passes a `lookup` through untouched when
 * it is not an async function, and its wrapper for promise-returning lookups keeps
 * just the first address, which disables the IPv6-to-IPv4 fallback.
 */
const guardedLookup =
  (trusted: boolean): LookupFunction =>
  (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        callback(err, [])
        return
      }

      if (!trusted) {
        const blocked = addresses.find(entry => isBlockedAddress(entry.address))
        if (blocked) {
          callback(new Error(`refusing to connect to blocked address ${blocked.address}`), [])
          return
        }
      }

      // Node asks for every address when Happy Eyeballs is enabled, one otherwise.
      if (options.all) {
        callback(null, addresses.map(toLookupEntry))
        return
      }

      const first = toLookupEntry(addresses[0])
      callback(null, first.address, first.family)
    })
  }

export interface BackendResponse {
  ok: boolean
  status: number
  statusText: string
  body: string
}

/**
 * POSTs to a validated backend URL. Redirects are disabled so the guarded lookup
 * applies to the one connection that is made.
 */
export async function requestBackend(
  target: URL,
  options: { body: string; headers: Record<string, string>; trustedHost: boolean }
): Promise<BackendResponse> {
  const host = unwrapIpLiteral(target.hostname)

  // IP literals bypass DNS resolution and therefore `guardedLookup`.
  if (!options.trustedHost && isIpLiteral(host) && isBlockedAddress(host)) {
    throw new Error(`refusing to connect to blocked address ${host}`)
  }

  // Axios' own `timeout` only covers socket inactivity, so a backend that trickles
  // bytes can stay connected indefinitely. The signal makes the limit absolute; the
  // timeout still cuts an idle socket short.
  const deadline = new AbortController()
  const deadlineTimer = setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS)

  let response
  try {
    response = await axios.request<string>({
      url: target.href,
      method: 'POST',
      data: options.body,
      headers: options.headers,
      lookup: guardedLookup(options.trustedHost),
      // An environment proxy would make the socket connect to the proxy instead,
      // leaving the backend host resolved by it and never seen by `guardedLookup`.
      proxy: false,
      maxRedirects: 0,
      timeout: REQUEST_TIMEOUT_MS,
      signal: deadline.signal,
      maxContentLength: MAX_RESPONSE_BYTES,
      responseType: 'text',
      validateStatus: () => true
    })
  } catch (error) {
    if (deadline.signal.aborted) {
      throw new Error(`backend request exceeded the ${REQUEST_TIMEOUT_MS}ms deadline`)
    }
    throw error
  } finally {
    clearTimeout(deadlineTimer)
  }

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.statusText,
    body: response.data
  }
}
