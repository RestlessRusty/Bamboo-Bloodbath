import { Peer } from 'peerjs';

/** PeerJS error codes come as `err.type`. */
export function peerErrorType(err: unknown): string {
  return String((err as { type?: unknown })?.type ?? '');
}

/**
 * Opens a Peer on PeerJS's free public signalling server. Only the handshake goes through it;
 * game data then flows directly between phones (PeerJS's default STUN/TURN config included).
 */
export function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    const timer = window.setTimeout(() => {
      peer.destroy();
      reject(new Error('Could not reach the matchmaking server. Check your internet connection.'));
    }, 12000);
    const onError = (err: unknown) => {
      window.clearTimeout(timer);
      peer.destroy();
      reject(err);
    };
    peer.once('open', () => {
      window.clearTimeout(timer);
      // Only fail while connecting: later errors (e.g. a dropped signalling socket) are the caller's to handle.
      peer.off('error', onError);
      resolve(peer);
    });
    peer.once('error', onError);
  });
}
