/**
 * Transport-level wire caps shared by both directions of the direct-route
 * surface. B5 enforcement (network ruling, 2026-08-27): an oversized payload
 * is REJECTED, never truncated — rejection is structured on the inbound half
 * (HTTP 413 + a JSON wire error code) and fail-fast on the outbound half
 * (no bytes leave the process, no doomed upload burns the 15s HTTP budget).
 * @module @nelsonlongxiang/dsh-open-a2a-net/transport-caps
 */

/** Hard ceiling on one `/a2a/direct` request body, in UTF-8 bytes (512 KiB). */
export const MAX_ROUTE_BODY_BYTES = 512 * 1024

/**
 * Hard ceiling on one control-route layout save (`POST
 * /__dsh_a2a/canvas-layout`), in UTF-8 bytes (64 KiB). Sized from the
 * legitimate document envelope: LayoutStore clamps to 256 nodes (keys
 * ≤ 128 chars) + 96 frames (names ≤ 40 chars), whose worst case is
 * ≈50 KiB — the historical shared 10 KiB control cap rejected real
 * full-fleet documents (256 nodes ≈ 23 KiB) outright, so the layout
 * route overrides with this cap while every other control route keeps
 * the 10 KiB default.
 */
export const MAX_LAYOUT_BODY_BYTES = 64 * 1024

/**
 * Wire error code for a body above {@link MAX_ROUTE_BODY_BYTES}. First member
 * of the transport rejection family (the enum registry lives in
 * docs/protocol/delivery-origin-auth.md until it earns its own module).
 */
export const WIRE_ERROR_PAYLOAD_TOO_LARGE = -32001

/** Whether a body of this byte length may cross the wire. */
export function withinRouteBodyCap(byteLength: number): boolean {
  return byteLength <= MAX_ROUTE_BODY_BYTES
}
