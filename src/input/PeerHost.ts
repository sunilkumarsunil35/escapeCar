import Peer, { type DataConnection } from 'peerjs';
import type { ControllerPayload, RemoteSource } from './Input';

export const PEER_PREFIX = 'escapecar-room-';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeRoomId(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return s;
}

export type HostStatus = 'idle' | 'opening' | 'waiting' | 'connected' | 'error';

/** PC side of the QR pairing: hosts a PeerJS room and receives the phone's 60 FPS input stream. */
export class PeerHost implements RemoteSource {
  room = '';
  status: HostStatus = 'idle';
  error = '';
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private last: ControllerPayload | null = null;
  private lastAt = 0;
  private listeners = new Set<(s: HostStatus) => void>();

  get connected(): boolean {
    return this.status === 'connected' && this.conn !== null && this.conn.open;
  }

  get controllerUrl(): string {
    return `${location.origin}${location.pathname}?room=${this.room}`;
  }

  onStatus(cb: (s: HostStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setStatus(s: HostStatus): void {
    this.status = s;
    this.listeners.forEach((cb) => cb(s));
  }

  /** Opens (or re-opens) a room; retries with a new ID if the ID is taken. */
  open(attempt = 0): void {
    if (this.peer && !this.peer.destroyed && this.status !== 'error') return;
    this.room = makeRoomId();
    this.setStatus('opening');
    const peer = new Peer(PEER_PREFIX + this.room, { debug: 1 });
    this.peer = peer;
    peer.on('open', () => this.setStatus(this.connected ? 'connected' : 'waiting'));
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err: Error & { type?: string }) => {
      console.warn('[peer-host]', err.type, err.message);
      if (err.type === 'unavailable-id' && attempt < 4) {
        peer.destroy();
        this.peer = null;
        this.open(attempt + 1);
        return;
      }
      if (err.type === 'peer-unavailable' || err.type === 'network') return;
      this.error = err.message;
      this.setStatus('error');
    });
  }

  private accept(conn: DataConnection): void {
    if (this.conn && this.conn.open) this.conn.close();
    this.conn = conn;
    conn.on('open', () => {
      this.setStatus('connected');
      conn.send({ hello: 'escape-car', room: this.room });
    });
    conn.on('data', (data) => {
      const p = data as Partial<ControllerPayload> & { ping?: number };
      if (typeof p.steer === 'number') {
        this.last = {
          steer: Math.max(-1, Math.min(1, p.steer)),
          drift: Boolean(p.drift),
          shoot: Boolean(p.shoot),
          gadget: Boolean(p.gadget),
          reverse: Boolean(p.reverse),
          recenter: Boolean(p.recenter),
          nitro: Boolean(p.nitro),
        };
        this.lastAt = performance.now();
      }
      if (typeof p.ping === 'number') conn.send({ pong: p.ping });
    });
    const drop = (): void => {
      if (this.conn === conn) {
        this.conn = null;
        this.last = null;
        this.setStatus(this.peer && !this.peer.destroyed ? 'waiting' : 'idle');
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  latest(): ControllerPayload | null {
    if (!this.last || performance.now() - this.lastAt > 500) return null;
    return this.last;
  }

  vibrate(ms = 100): void {
    if (this.connected) this.conn?.send({ vibrate: ms });
  }

  sendState(state: Record<string, unknown>): void {
    if (this.connected) this.conn?.send({ state });
  }

  close(): void {
    this.conn?.close();
    this.peer?.destroy();
    this.peer = null;
    this.conn = null;
    this.setStatus('idle');
  }
}
