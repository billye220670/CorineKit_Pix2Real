// server/src/services/wsHub.ts
// WebSocket broadcast hub (decoupling layer).
// Route files can broadcast to all connected frontend clients without importing
// the concrete `wss` instance from index.ts. index.ts injects the real broadcast
// implementation via registerBroadcaster() at startup; routes just call broadcast().
// This preserves the existing one-way import relationship (routes -> services),
// avoiding a circular dependency on index.ts.

// Module-level holder for the injected broadcast implementation.
let broadcaster: ((event: object) => void) | null = null;

/** Register the broadcast implementation (called once by index.ts after wss is created). */
export function registerBroadcaster(fn: (event: object) => void): void {
  broadcaster = fn;
}

/** Broadcast an event to all clients. Safely ignored (with a warning) if not yet registered. */
export function broadcast(event: object): void {
  if (!broadcaster) {
    console.warn('[wsHub] broadcast called before a broadcaster was registered; event dropped');
    return;
  }
  broadcaster(event);
}
