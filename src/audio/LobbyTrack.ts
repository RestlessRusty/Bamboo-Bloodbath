/** Drop the file here (relative to public/). Use .mp3 if you can: a .wav is many times bigger to download. */
export const LOBBY_TRACK_URL = './music/lobby.mp3';

/**
 * A looping music file for the menus, streamed (not decoded into memory, so long songs are fine)
 * and routed through the music bus so the Music toggle and volume apply. If the file is missing or
 * can't be played, `onFail` runs and the synth tune takes over.
 */
export class LobbyTrack {
  private readonly audio: HTMLAudioElement;
  private failed = false;

  constructor(ctx: AudioContext, out: AudioNode, url: string, onFail: () => void) {
    const audio = new Audio(url);
    audio.loop = true;
    audio.preload = 'auto';
    audio.addEventListener('error', () => {
      this.failed = true;
      onFail();
    });
    ctx.createMediaElementSource(audio).connect(out);
    this.audio = audio;
  }

  get ok(): boolean {
    return !this.failed;
  }

  start(): void {
    if (this.failed || !this.audio.paused) return;
    void this.audio.play().catch(() => undefined);
  }

  /** Pauses and rewinds, so coming back to the menu starts the song from the top. */
  stop(): void {
    if (this.audio.paused) return;
    this.audio.pause();
    this.audio.currentTime = 0;
  }
}
