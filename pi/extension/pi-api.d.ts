/**
 * The subset of @earendil-works/pi-coding-agent's extension API that a2a-seat.ts uses, as its docs/extensions.md
 * describes it (pi-coding-agent 1.5.x). Only for type-checking the extension in this repository: inside Pi the real
 * package is resolved.
 */
declare module '@earendil-works/pi-coding-agent' {
  export interface ExtensionUI { notify(message: string, level?: 'info' | 'warning' | 'error'): void }
  export interface ExtensionContext {
    readonly hasUI: boolean
    readonly ui: ExtensionUI
    isIdle(): boolean
  }
  export interface ExecResult { readonly stdout: string; readonly stderr: string; readonly code: number; readonly killed: boolean; readonly truncated?: boolean }
  export interface ExtensionEvents {
    session_start: Record<string, unknown>
    session_shutdown: { readonly reason?: string }
    agent_settled: { readonly aborted: boolean }
  }
  export interface ExtensionAPI {
    on<E extends keyof ExtensionEvents>(event: E, handler: (event: ExtensionEvents[E], ctx: ExtensionContext) => Promise<void> | void): void
    exec(command: string, args: string[], options?: { signal?: AbortSignal; timeout?: number; cwd?: string }): Promise<ExecResult>
    sendUserMessage(content: string, options?: { deliverAs?: 'steer' | 'followUp' }): void
  }
}
