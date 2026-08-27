import * as T from './tokens'

export interface SessionRow {
  id: string; label: string; team: string;
  name?: string; description?: string; joined: boolean; live?: boolean;
}
export interface CanvasTeamRow { name: string; team: string; members: Array<{ id: string; team: string; joined: boolean; live: boolean }> }
export interface StateBody { sessions: SessionRow[]; canvas?: { teams: CanvasTeamRow[] }; peers: Array<{ url: string; score?: number }> }

export async function fetchState(): Promise<StateBody> {
  const r = await fetch('/__dsh_a2a/state', { cache: 'no-store' });
  if (!r.ok) throw new Error('state ' + r.status);
  return r.json();
}

export interface NexusLayout { viewport: { theta: number; phi: number; radius: number }; nodeOffsets: Record<string, [number, number, number]> }

export async function fetchLayout(): Promise<any | null> {
  const r = await fetch('/__dsh_a2a/canvas-layout', { cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json(); return j.layout ?? null;
}

export function defaultNodePos(i: number, total: number): [number, number, number] {
  const ring = Math.ceil((i + 1) / 8);
  const angle = (i % 8) * (Math.PI * 2 / 8) + ring * 0.35;
  const radius = 14 + ring * 10;
  return [Math.cos(angle) * radius, (Math.random() - 0.5) * 4, Math.sin(angle) * radius];
}