import { describe, expect, it } from 'vitest'
import { selectLanIPv4 } from '../../src/lan-ip.ts'
const ipv4 = (address: string, internal = false) => ({ address, internal, family: 'IPv4' })
const pick = (...addresses: string[]) => selectLanIPv4({ adapter: addresses.map(address => ipv4(address)) })
describe('#311 LAN IPv4 selection', () => {
  it('ranks RFC1918 above public addresses above CGNAT, independent of adapter names', () => {
    for (const lan of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '10.20.30.10']) {
      expect(pick('100.64.0.10', '203.0.113.1', lan)).toBe(lan)
    }
    expect(pick('100.64.0.1', '203.0.113.1')).toBe('203.0.113.1')
    expect(pick('100.64.0.10')).toBe('100.64.0.10')
  })
  it('uses exact range boundaries, not prefixes or all of 172/8 or 100/8', () => {
    for (const other of ['172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1']) {
      expect(pick('100.64.0.1', other)).toBe(other)
      expect(pick(other, '10.0.0.1')).toBe('10.0.0.1')
    }
    expect(pick('100.127.255.254', '203.0.113.1')).toBe('203.0.113.1')
  })
  it('ignores internal/IPv6/malformed addresses and tolerates empty interfaces', () => {
    expect(selectLanIPv4({ absent: undefined, empty: [], mixed: [ipv4('127.0.0.1', true), { family: 'IPv6', address: '::1', internal: false }, ipv4('bad'), ipv4('10.20.30.10')] })).toBe('10.20.30.10')
    expect(selectLanIPv4({})).toBe('')
    expect(selectLanIPv4({ lo: [ipv4('127.0.0.1', true)] })).toBe('')
  })
  it('keeps stable enumeration order among equally preferred addresses (physical LAN before VMware here)', () => {
    expect(selectLanIPv4({ overlay: [ipv4('100.64.0.10')], ethernet: [ipv4('10.20.30.10')], vmware: [ipv4('192.168.251.1')] })).toBe('10.20.30.10')
    expect(pick('10.0.0.1', '10.20.30.10')).toBe('10.0.0.1')
  })
})
