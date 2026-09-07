import { BlockList, isIP } from 'node:net'

// Loopback, link-local (including cloud metadata), private and reserved ranges.
const BLOCKED_IPV4_SUBNETS: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local / cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4] // reserved, includes 255.255.255.255
]

const BLOCKED_IPV6_SUBNETS: ReadonlyArray<[string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64 well-known prefix, can reach blocked IPv4 space
  ['64:ff9b:1::', 48], // NAT64 local-use prefix (RFC 8215), same reach
  ['100::', 64], // discard-only
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local, includes the IPv6 metadata endpoint
  ['fe80::', 10], // link-local
  ['ff00::', 8] // multicast
]

const blockedAddresses = new BlockList()

for (const [network, prefix] of BLOCKED_IPV4_SUBNETS) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of BLOCKED_IPV6_SUBNETS) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6')
}

/** `URL.hostname` keeps the brackets around IPv6 literals. */
export const unwrapIpLiteral = (hostname: string) =>
  hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

// Names that always resolve inside the local network; rejected up front so the
// operator gets an actionable message instead of a connection-time failure.
const BLOCKED_HOST_SUFFIXES = ['localhost', '.localhost', '.local', '.internal']

export const isBlockedHostname = (host: string) =>
  BLOCKED_HOST_SUFFIXES.some(suffix =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix
  )

export const isIpLiteral = (host: string) => isIP(unwrapIpLiteral(host)) !== 0

/**
 * Unparseable input is treated as blocked. IPv4-mapped IPv6 addresses are matched
 * against the IPv4 blocks by `BlockList`.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return true
  return blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6')
}
