export function createTraceId(): string {
  return crypto.randomUUID();
}
