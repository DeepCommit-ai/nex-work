/** Host-side access to the pinned local AionCore API. Never include request payloads in errors. */
export type BackendCall = <T>(method: string, route: string, body?: unknown) => Promise<T>;

export function createBackendCall(port: number, fetchImpl: typeof fetch = fetch): BackendCall {
  return async <T>(method: string, route: string, body?: unknown): Promise<T> => {
    const response = await fetchImpl(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Local API ${method} ${route.split('?')[0]} failed (${response.status})`);
    const result = (await response.json()) as { success?: boolean; data?: T };
    if (result.success !== true) throw new Error(`Local API ${route.split('?')[0]} rejected the operation`);
    return result.data as T;
  };
}
