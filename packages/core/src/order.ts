import type { Frontier, MeshEvent } from "./types.js";

export function compareEvents(a: MeshEvent, b: MeshEvent): number {
  if (a.lamport !== b.lamport) {
    return a.lamport - b.lamport;
  }

  if (a.wallTime !== b.wallTime) {
    return a.wallTime.localeCompare(b.wallTime);
  }

  if (a.senderId !== b.senderId) {
    return a.senderId.localeCompare(b.senderId);
  }

  return a.id.localeCompare(b.id);
}

export function sortEvents(events: MeshEvent[]): MeshEvent[] {
  return [...events].sort(compareEvents);
}

export function advanceFrontier(frontier: Frontier, event: MeshEvent): Frontier {
  const next = { ...frontier };
  const previous = next[event.senderId] ?? 0;

  if (event.lamport > previous) {
    next[event.senderId] = event.lamport;
  }

  return next;
}
