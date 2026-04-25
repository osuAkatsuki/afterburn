const CLIENT_ID_KEY = "afterburn.sessionClientId";

export function getClientId(): string {
  const existing = window.sessionStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated = window.crypto?.randomUUID?.() ?? `client-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  persistClientId(generated);
  return generated;
}

export function persistClientId(clientId: string): void {
  window.sessionStorage.setItem(CLIENT_ID_KEY, clientId);
}
