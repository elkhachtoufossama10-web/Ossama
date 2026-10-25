import { useSyncExternalStore } from 'react';
import type { Provenance } from '../sources/provenance';

/** Last provenance record per data panel, listed on the Sources page ("what is on screen right now"). */
const reg = new Map<string, Provenance>();
let version = 0;
const subs = new Set<() => void>();
export function registerProvenance(id: string, p: Provenance) {
  reg.set(id, p);
  version++;
  subs.forEach((f) => f());
}
export function useProvenanceList() {
  useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => version);
  return [...reg.entries()];
}
