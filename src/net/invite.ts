import { CODE_LENGTH, normalizeCode } from './protocol';

const PARAM = 'room';

/** Link that opens the game and offers to join room `code`. */
export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?${PARAM}=${code}`;
}

/** Room code from an invite link we were opened with, or null; removes it from the address bar. */
export function takeInviteFromUrl(): string | null {
  const params = new URLSearchParams(location.search);
  const raw = params.get(PARAM);
  if (raw === null) return null;
  params.delete(PARAM);
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  const code = normalizeCode(raw);
  return code.length === CODE_LENGTH ? code : null;
}
