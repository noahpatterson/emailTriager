import "server-only";
export type SyncStatus = "running" | "bounded_incomplete" | "completed" | "partial_failure" | "failed";
export interface SyncService { start(ownerId: string): Promise<{ runId: string; status: SyncStatus }>; }
export interface ConnectionService { begin(ownerId: string): Promise<{ authorizationUrl: string }>; complete(ownerId: string, code: string, state: string): Promise<void>; disconnect(ownerId: string): Promise<void>; }
