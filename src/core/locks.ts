import { type State, now, withState } from "./state.ts";

function purge(s: State) {
  for (const [k, l] of Object.entries(s.locks)) if (Date.parse(l.expiresAt) < Date.now()) delete s.locks[k];
}

export function acquireLock(dir: string, name: string, owner: string, ttlSec = 900, reason?: string) {
  return withState(dir, (s) => {
    purge(s);
    const held = s.locks[name];
    if (held && held.owner !== owner) {
      return { ok: false, message: `Lock "${name}" está com ${held.owner} até ${held.expiresAt}${held.reason ? ` (${held.reason})` : ""}.` };
    }
    s.locks[name] = { owner, reason, acquiredAt: now(), expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString() };
    return { ok: true, message: `Lock "${name}" adquirido por ${owner} por ${ttlSec}s.` };
  });
}

export function releaseLock(dir: string, name: string, owner: string, force = false) {
  return withState(dir, (s) => {
    purge(s);
    const held = s.locks[name];
    if (!held) return `Lock "${name}" já estava livre.`;
    if (held.owner !== owner && !force) return `Lock "${name}" pertence a ${held.owner}; não liberado.`;
    delete s.locks[name];
    return `Lock "${name}" liberado.`;
  });
}

export function listLocks(dir: string) {
  return withState(dir, (s) => {
    purge(s);
    return structuredClone(s.locks);
  });
}
