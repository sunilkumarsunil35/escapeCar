/** Tiny procedural WebAudio synth — engine drone + punchy arcade SFX with zero audio assets. */
class AudioSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlay = new Map<string, number>();
  muted = false;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  startEngine(): void {
    if (!this.ctx || !this.master || this.engineOsc) return;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 50;
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 25;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();
    this.engineGain.gain.setTargetAtTime(0.09, this.ctx.currentTime, 0.3);
  }

  stopEngine(): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain) return;
    const osc = this.engineOsc;
    const osc2 = this.engineOsc2;
    this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    const t = this.ctx.currentTime + 0.6;
    osc.stop(t);
    osc2?.stop(t);
    this.engineOsc = null;
    this.engineOsc2 = null;
  }

  setEngine(speedNorm: number, boost: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineOsc2 || !this.engineFilter) return;
    const f = 45 + speedNorm * 70 + (boost ? 30 : 0);
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(400 + speedNorm * 900 + (boost ? 800 : 0), t, 0.1);
  }

  private throttle(key: string, minGap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < minGap) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private noise(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass', q = 1): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freqA: number, freqB: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqB), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  gun(): void {
    if (!this.throttle('gun', 0.045)) return;
    this.noise(0.07, 2400, 0.22, 'bandpass', 0.8);
    this.tone(220, 80, 0.05, 0.08, 'square');
  }
  enemyGun(): void {
    if (!this.throttle('egun', 0.09)) return;
    this.noise(0.05, 1500, 0.07, 'bandpass', 1.2);
  }
  rocket(): void {
    this.noise(0.5, 900, 0.25, 'bandpass', 0.6);
    this.tone(180, 60, 0.4, 0.1, 'sawtooth');
  }
  explosion(big = false): void {
    if (!this.throttle('boom', 0.06)) return;
    this.noise(big ? 1.4 : 0.8, big ? 380 : 520, big ? 0.9 : 0.6);
    this.tone(90, 30, big ? 0.9 : 0.5, 0.35, 'sine');
  }
  hit(): void {
    if (!this.throttle('hit', 0.08)) return;
    this.noise(0.12, 700, 0.35, 'lowpass');
    this.tone(160, 60, 0.12, 0.2, 'square');
  }
  scrape(): void {
    if (!this.throttle('scrape', 0.12)) return;
    this.noise(0.15, 3200, 0.08, 'highpass');
  }
  pickup(): void {
    if (!this.throttle('pickup', 0.05)) return;
    this.tone(880, 1760, 0.12, 0.12, 'triangle');
  }
  powerup(): void {
    this.tone(440, 1320, 0.35, 0.18, 'square');
    this.tone(660, 1980, 0.3, 0.1, 'triangle');
  }
  boost(tier: number): void {
    this.noise(0.6, tier >= 2 ? 1800 : 1200, 0.35, 'bandpass', 0.7);
    this.tone(tier >= 2 ? 300 : 240, tier >= 2 ? 900 : 600, 0.4, 0.12, 'sawtooth');
  }
  hop(): void {
    this.tone(300, 520, 0.08, 0.08, 'triangle');
  }
  sparkTier(tier: number): void {
    this.tone(tier >= 2 ? 1200 : 900, tier >= 2 ? 1800 : 1300, 0.12, 0.1, 'triangle');
  }
  drop(): void {
    this.tone(400, 160, 0.15, 0.15, 'square');
  }
  lockOn(): void {
    if (!this.throttle('lock', 0.4)) return;
    this.tone(1500, 1500, 0.06, 0.05, 'square');
  }
  warning(): void {
    if (!this.throttle('warn', 0.5)) return;
    this.tone(880, 880, 0.12, 0.1, 'square');
  }
  click(): void {
    this.tone(600, 900, 0.05, 0.08, 'triangle');
  }
  buy(): void {
    this.tone(523, 1046, 0.15, 0.14, 'triangle');
    setTimeout(() => this.tone(784, 1568, 0.2, 0.12, 'triangle'), 90);
  }
  wreck(): void {
    this.explosion(true);
    this.tone(200, 40, 1.6, 0.25, 'sawtooth');
  }
}

export const audio = new AudioSynth();
