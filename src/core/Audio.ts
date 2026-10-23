/** Slider 0..1 → gain on a -36 dB..0 dB curve (perceived loudness is logarithmic). */
export function sliderToGain(v: number): number {
  return v <= 0.001 ? 0 : Math.pow(10, ((v - 1) * 36) / 20);
}

const vary = (base: number, spread: number): number => base * (1 + (Math.random() * 2 - 1) * spread);

/**
 * Tiny procedural WebAudio synth — engine drone, punchy arcade SFX and an adaptive music score
 * with zero audio assets. Mixed on buses (Master ← SFX, Music) with a limiter for headroom.
 */
class AudioSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duck: GainNode | null = null;
  private music: MusicEngine | null = null;
  private sfxVolume = 0.8;
  private musicVolume = 0.5;
  private pendingIntensity = 0.5;
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
      this.master.gain.value = this.muted ? 0 : 0.7;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = sliderToGain(this.sfxVolume);
      this.sfxBus.connect(this.master);
      this.duck = this.ctx.createGain();
      this.duck.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = sliderToGain(this.musicVolume) * 0.55;
      this.musicBus.connect(this.duck);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.music && this.ctx && this.musicBus && this.noiseBuf) {
      this.music = new MusicEngine(this.ctx, this.musicBus, this.noiseBuf);
      this.music.setIntensity(this.pendingIntensity);
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  /** Bus volumes from the settings sliders (0..1, mapped through a dB curve). */
  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (!this.ctx) return;
    this.musicBus?.gain.setTargetAtTime(sliderToGain(music) * 0.55, this.ctx.currentTime, 0.05);
    this.sfxBus?.gain.setTargetAtTime(sliderToGain(sfx), this.ctx.currentTime, 0.05);
  }

  /** Adaptive score: 0 = silent, 0.5 = garage groove, 1..4 = Heat level layers. */
  setMusicIntensity(level: number): void {
    this.pendingIntensity = level;
    this.music?.setIntensity(level);
  }

  /** Dip the music under a big moment (explosion, wreck), then recover. */
  duckMusic(depth = 0.35, seconds = 0.8): void {
    if (!this.ctx || !this.duck) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(depth, t, 0.03);
    this.duck.gain.setTargetAtTime(1, t + seconds, 0.4);
  }

  startEngine(): void {
    if (!this.ctx || !this.sfxBus || this.engineOsc) return;
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
    this.engineGain.connect(this.sfxBus);
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
    if (!this.ctx || !this.sfxBus || !this.noiseBuf) return;
    // Repeated SFX get small random pitch/level offsets so they never sound robotic.
    freq = vary(freq, 0.1);
    gain = vary(gain, 0.12);
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
    src.playbackRate.value = vary(1, 0.08);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freqA: number, freqB: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    if (!this.ctx || !this.sfxBus) return;
    const pitch = vary(1, 0.05);
    freqA *= pitch;
    freqB *= pitch;
    gain = vary(gain, 0.12);
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqB), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g);
    g.connect(this.sfxBus);
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
    this.duckMusic(0.15, 1.6);
    this.explosion(true);
    this.tone(200, 40, 1.6, 0.25, 'sawtooth');
  }
}

export const audio = new AudioSynth();

const CHORDS: number[][] = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/**
 * Adaptive music by vertical layering (audio-design skill): every layer plays in sync all the time
 * and fades in/out with intensity, so Heat changes never cut the groove.
 *   0.5 garage: pad + soft bass · 1: + drums · 2: + offbeat hats & claps · 3: + arpeggio · 4: + lead stabs
 */
class MusicEngine {
  private layers: Record<'pad' | 'bass' | 'drums' | 'hats' | 'arp' | 'lead', GainNode>;
  private step = 0;
  private nextTime = 0;
  private bpm = 122;
  private timer = 0;
  private intensity = 0;

  constructor(private ctx: AudioContext, out: AudioNode, private noiseBuf: AudioBuffer) {
    const mk = (): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(out);
      return g;
    };
    this.layers = { pad: mk(), bass: mk(), drums: mk(), hats: mk(), arp: mk(), lead: mk() };
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  setIntensity(level: number): void {
    this.intensity = level;
    const on = (min: number, max = 99): number => (level >= min && level <= max ? 1 : 0);
    const target: Record<keyof MusicEngine['layers'], number> = {
      pad: level > 0 ? (level < 1 ? 0.9 : 0.35) : 0,
      bass: level > 0 ? (level < 1 ? 0.5 : 0.9) : 0,
      drums: on(1),
      hats: on(2),
      arp: on(3),
      lead: on(4),
    };
    const t = this.ctx.currentTime;
    for (const k of Object.keys(target) as (keyof MusicEngine['layers'])[]) {
      this.layers[k].gain.setTargetAtTime(target[k], t, 0.8);
    }
    this.bpm = level >= 3 ? 128 : 122;
  }

  private schedule(): void {
    if (this.ctx.state !== 'running') return;
    if (this.intensity <= 0) {
      this.nextTime = this.ctx.currentTime + 0.05;
      return;
    }
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, len: number): void {
    const bar = Math.floor(step / 16);
    const s16 = step % 16;
    const chord = CHORDS[bar % CHORDS.length];
    if (s16 === 0) this.pad(chord, t, len * 16);
    if (s16 % 2 === 0) this.bass(midi(chord[0] - 24), t, len * 1.6, s16 % 4 === 0 ? 0.22 : 0.15);
    if (s16 % 4 === 0) this.kick(t);
    if (s16 % 4 === 2) this.hat(t, 0.06);
    if (s16 === 4 || s16 === 12) this.clap(t);
    const arpNote = chord[[0, 1, 2, 1][s16 % 4]] + (s16 >= 8 ? 12 : 0);
    this.blip(this.layers.arp, midi(arpNote + 12), t, len * 0.9, 'square', 0.05);
    if (s16 === 0 || s16 === 6 || s16 === 10) this.blip(this.layers.lead, midi(chord[2] + 12), t, len * 2.5, 'sawtooth', 0.07);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private blip(out: GainNode, freq: number, t: number, dur: number, type: OscillatorType, peak: number): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.005, dur);
    o.connect(f);
    f.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(chord: number[], t: number, dur: number): void {
    for (const n of chord) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midi(n);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.045, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.layers.pad);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private bass(freq: number, t: number, dur: number, peak: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.01, dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.layers.bass);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.ctx.createGain();
    this.env(g, t, 0.55, 0.002, 0.18);
    o.connect(g);
    g.connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.25);
  }

  private noiseHit(out: GainNode, t: number, type: BiquadFilterType, freq: number, peak: number, dur: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.002, dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private hat(t: number, peak: number): void {
    this.noiseHit(this.layers.hats, t, 'highpass', 7000, peak, 0.04);
  }

  private clap(t: number): void {
    this.noiseHit(this.layers.hats, t, 'bandpass', 1600, 0.18, 0.12);
  }

  stop(): void {
    window.clearInterval(this.timer);
  }
}
