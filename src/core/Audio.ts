/** Slider 0..1 → gain on a -36 dB..0 dB curve (perceived loudness is logarithmic). */
export function sliderToGain(v: number): number {
  return v <= 0.001 ? 0 : Math.pow(10, ((v - 1) * 36) / 20);
}

/** Output profile: small/TV speakers get a bass guard + presence lift, headphones full range, mono sums L+R. */
export type SpeakerMode = 'stereo' | 'headphones' | 'mono';

const vary = (base: number, spread: number): number => base * (1 + (Math.random() * 2 - 1) * spread);
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/** A-minor pentatonic (A C D E G) across two octaves: every chime/pickup lands in the score's key. */
const SCALE = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91];
const scaleNote = (i: number): number => midi(SCALE[Math.max(0, Math.min(SCALE.length - 1, i))]);

/** Stereo impulse response: decaying noise with independent L/R tails for a soft, wide hall. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Soft-clip curve: warms the engine tone instead of a raw buzzy edge. */
function makeDrive(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

/**
 * Procedural WebAudio sound — engine, musical SFX and an adaptive score with zero audio assets.
 *   SFX voices → panner → SFX bus ─┐             ┌→ hall reverb (send) ─┐
 *   Music → Music bus → duck ──────┴→ Master ─→ speaker EQ → glue comp → limiter → out → speakers
 */
class AudioSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duck: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private lowGuard: BiquadFilterNode | null = null;
  private lowShelf: BiquadFilterNode | null = null;
  private presence: BiquadFilterNode | null = null;
  private air: BiquadFilterNode | null = null;
  private out: GainNode | null = null;
  private music: MusicEngine | null = null;
  private sfxVolume = 0.8;
  private musicVolume = 0.5;
  private speakers: SpeakerMode = 'stereo';
  private pendingIntensity = 0.5;
  private engine: { oscs: OscillatorNode[]; rumble: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlay = new Map<string, number>();
  muted = false;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      // Ask for a true stereo bus; devices with fewer channels clamp it.
      ctx.destination.channelCount = Math.min(2, ctx.destination.maxChannelCount || 2);
      ctx.destination.channelInterpretation = 'speakers';

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.lowGuard = ctx.createBiquadFilter();
      this.lowGuard.type = 'highpass';
      this.lowGuard.Q.value = 0.7;
      this.lowShelf = ctx.createBiquadFilter();
      this.lowShelf.type = 'lowshelf';
      this.lowShelf.frequency.value = 140;
      this.presence = ctx.createBiquadFilter();
      this.presence.type = 'peaking';
      this.presence.frequency.value = 3000;
      this.presence.Q.value = 0.8;
      this.air = ctx.createBiquadFilter();
      this.air.type = 'highshelf';
      this.air.frequency.value = 9000;
      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -20;
      glue.knee.value = 12;
      glue.ratio.value = 2;
      glue.attack.value = 0.02;
      glue.release.value = 0.25;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.1;
      this.out = ctx.createGain();
      this.master.connect(this.lowGuard).connect(this.lowShelf).connect(this.presence).connect(this.air).connect(glue).connect(limiter).connect(this.out);
      this.out.connect(ctx.destination);

      const reverb = ctx.createConvolver();
      reverb.buffer = makeImpulse(ctx, 2.6, 2.6);
      const reverbTone = ctx.createBiquadFilter();
      reverbTone.type = 'bandpass';
      reverbTone.frequency.value = 1400;
      reverbTone.Q.value = 0.4;
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.3;
      this.reverbSend.connect(reverbTone).connect(reverb).connect(this.master);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = sliderToGain(this.sfxVolume);
      this.sfxBus.connect(this.master);
      this.duck = ctx.createGain();
      this.duck.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = sliderToGain(this.musicVolume) * 0.6;
      this.musicBus.connect(this.duck);

      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.applySpeakers();

      // Browsers suspend (or on iOS "interrupt") audio when the tab hides or a call comes in.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.resume();
      });
      ctx.addEventListener('statechange', () => {
        if (document.visibilityState === 'visible') this.resume();
      });
    }
    this.resume();
    if (!this.music && this.ctx && this.musicBus && this.reverbSend && this.noiseBuf) {
      this.music = new MusicEngine(this.ctx, this.musicBus, this.reverbSend, this.noiseBuf);
      this.music.setIntensity(this.pendingIntensity);
      this.music.setWidth(this.width);
    }
  }

  private resume(): void {
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') void this.ctx.resume().catch(() => undefined);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Bus volumes from the settings sliders (0..1, mapped through a dB curve). */
  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (!this.ctx) return;
    this.musicBus?.gain.setTargetAtTime(sliderToGain(music) * 0.6, this.ctx.currentTime, 0.05);
    this.sfxBus?.gain.setTargetAtTime(sliderToGain(sfx), this.ctx.currentTime, 0.05);
  }

  setSpeakerMode(mode: SpeakerMode): void {
    this.speakers = mode;
    this.applySpeakers();
  }

  /** Stereo spread: full on headphones, a touch narrower on speakers (crosstalk), none in mono. */
  private get width(): number {
    return this.speakers === 'headphones' ? 1 : this.speakers === 'stereo' ? 0.75 : 0;
  }

  private applySpeakers(): void {
    if (!this.ctx || !this.lowGuard || !this.lowShelf || !this.presence || !this.air || !this.out) return;
    const t = this.ctx.currentTime;
    const small = this.speakers !== 'headphones';
    // Laptop/phone/TV drivers can't reproduce below ~70 Hz; cutting it frees headroom and stops rattle.
    this.lowGuard.frequency.setTargetAtTime(small ? 70 : 20, t, 0.05);
    this.lowShelf.gain.setTargetAtTime(small ? -1.5 : 1.5, t, 0.05);
    this.presence.gain.setTargetAtTime(small ? 1.5 : 0, t, 0.05);
    this.air.gain.setTargetAtTime(small ? 1 : 2, t, 0.05);
    // Mono: an explicit 1-channel node down-mixes L+R; the destination spreads it back to both speakers.
    this.out.channelCount = this.speakers === 'mono' ? 1 : 2;
    this.out.channelCountMode = this.speakers === 'mono' ? 'explicit' : 'max';
    this.music?.setWidth(this.width);
  }

  /** Adaptive score: 0 = silent, 0.5 = garage, 1..4 = Heat level layers. */
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
    if (!this.ctx || !this.sfxBus || !this.noiseBuf || this.engine) return;
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 1.2;
    const drive = ctx.createWaveShaper();
    drive.curve = makeDrive(1.8);
    drive.oversample = '2x';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // Two detuned saws + a sub-octave sine: a smooth, rounded hum that sits under the music.
    const oscs = [
      { type: 'sawtooth' as OscillatorType, detune: -8, level: 0.35 },
      { type: 'sawtooth' as OscillatorType, detune: 8, level: 0.35 },
      { type: 'sine' as OscillatorType, detune: -1200, level: 0.9 },
    ].map(({ type, detune, level }) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 50;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(drive);
      o.start();
      return o;
    });
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noiseBuf;
    rumble.loop = true;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 200;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.3;
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(filter);
    rumble.start();
    drive.connect(filter).connect(gain).connect(this.sfxBus);
    gain.gain.setTargetAtTime(0.06, ctx.currentTime, 0.4);
    this.engine = { oscs, rumble, gain, filter };
  }

  stopEngine(): void {
    if (!this.ctx || !this.engine) return;
    const { oscs, rumble, gain } = this.engine;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    const t = this.ctx.currentTime + 0.6;
    for (const o of oscs) o.stop(t);
    rumble.stop(t);
    this.engine = null;
  }

  setEngine(speedNorm: number, boost: boolean): void {
    if (!this.ctx || !this.engine) return;
    const f = 42 + speedNorm * 70 + (boost ? 25 : 0);
    const t = this.ctx.currentTime;
    for (const o of this.engine.oscs) o.frequency.setTargetAtTime(f, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(340 + speedNorm * 900 + (boost ? 700 : 0), t, 0.1);
  }

  private throttle(key: string, minGap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < minGap) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  /** Voice output: stereo position + reverb send, so SFX sit in the same room as the music. */
  private voiceOut(pan: number, wet: number): AudioNode | null {
    if (!this.ctx || !this.sfxBus) return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan * this.width));
    p.connect(this.sfxBus);
    if (wet > 0 && this.reverbSend) {
      const w = this.ctx.createGain();
      w.gain.value = wet;
      p.connect(w).connect(this.reverbSend);
    }
    return p;
  }

  private noise(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass', q = 1, opts: { pan?: number; wet?: number; attack?: number; delay?: number } = {}): void {
    if (!this.ctx || !this.noiseBuf) return;
    const out = this.voiceOut(opts.pan ?? (Math.random() - 0.5) * 0.3, opts.wet ?? 0.15);
    if (!out) return;
    // Repeated SFX get small random pitch/level offsets so they never sound robotic.
    freq = vary(freq, 0.1);
    gain = vary(gain, 0.12);
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const attack = opts.attack ?? 0.003;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.45), t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.playbackRate.value = vary(1, 0.08);
    src.connect(filter).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freqA: number, freqB: number, dur: number, gain: number, type: OscillatorType = 'sine', opts: { pan?: number; wet?: number; delay?: number; attack?: number } = {}): void {
    if (!this.ctx) return;
    const out = this.voiceOut(opts.pan ?? 0, opts.wet ?? 0.1);
    if (!out) return;
    gain = vary(gain, 0.1);
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const attack = opts.attack ?? 0.004;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqB), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Soft bell (sine + quiet inharmonic partial), always in key — replaces the old square beeps. */
  private chime(freq: number, dur: number, gain: number, opts: { pan?: number; delay?: number } = {}): void {
    this.tone(freq, freq, dur, gain, 'sine', { wet: 0.45, attack: 0.004, ...opts });
    this.tone(freq * 2, freq * 2, dur * 0.6, gain * 0.2, 'sine', { wet: 0.45, attack: 0.003, ...opts });
    this.tone(freq * 3.01, freq * 3.01, dur * 0.3, gain * 0.08, 'sine', { wet: 0.45, attack: 0.002, ...opts });
  }

  gun(): void {
    if (!this.throttle('gun', 0.045)) return;
    const pan = (Math.random() - 0.5) * 0.2;
    this.noise(0.05, 3200, 0.12, 'bandpass', 0.8, { pan, wet: 0.08 });
    this.tone(130, 55, 0.08, 0.18, 'sine', { pan, wet: 0 });
  }
  enemyGun(): void {
    if (!this.throttle('egun', 0.09)) return;
    const pan = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.4);
    this.noise(0.07, 1600, 0.06, 'bandpass', 1.1, { pan, wet: 0.3 });
  }
  rocket(): void {
    this.noise(0.6, 1000, 0.18, 'bandpass', 0.6, { attack: 0.04, wet: 0.3 });
    this.noise(0.4, 300, 0.15, 'lowpass', 0.7, { wet: 0.1 });
  }
  explosion(big = false): void {
    if (!this.throttle('boom', 0.06)) return;
    const pan = (Math.random() - 0.5) * 0.5;
    this.noise(big ? 1.6 : 0.9, big ? 800 : 1100, big ? 0.7 : 0.45, 'lowpass', 0.7, { pan, wet: big ? 0.5 : 0.35, attack: 0.006 });
    this.tone(big ? 70 : 90, 30, big ? 1.0 : 0.55, big ? 0.45 : 0.3, 'sine', { pan, wet: 0 });
  }
  hit(): void {
    if (!this.throttle('hit', 0.08)) return;
    this.noise(0.14, 800, 0.28, 'lowpass', 1, { wet: 0.15 });
    this.tone(110, 50, 0.14, 0.22, 'sine', { wet: 0 });
  }
  scrape(): void {
    if (!this.throttle('scrape', 0.12)) return;
    this.noise(0.18, 3800, 0.05, 'bandpass', 3, { attack: 0.02, pan: (Math.random() - 0.5) * 0.8 });
  }
  pickup(): void {
    if (!this.throttle('pickup', 0.05)) return;
    const i = 3 + Math.floor(Math.random() * 4);
    this.chime(scaleNote(i), 0.5, 0.09);
    this.chime(scaleNote(i + 2), 0.6, 0.07, { delay: 0.07 });
  }
  powerup(): void {
    [0, 2, 3, 5, 7].forEach((n, i) => this.chime(scaleNote(n), 0.8, 0.08, { delay: i * 0.07, pan: (i - 2) * 0.25 }));
  }
  boost(tier: number): void {
    this.noise(0.8, tier >= 2 ? 2200 : 1500, 0.22, 'bandpass', 0.6, { attack: 0.08, wet: 0.35 });
    this.tone(tier >= 2 ? 110 : 82, tier >= 2 ? 220 : 165, 0.5, 0.14, 'sine');
  }
  hop(): void {
    this.tone(220, 330, 0.12, 0.06, 'sine', { wet: 0.2 });
  }
  sparkTier(tier: number): void {
    this.chime(scaleNote(tier >= 2 ? 7 : 5), 0.4, 0.07);
  }
  drop(): void {
    this.noise(0.12, 600, 0.16, 'lowpass');
    this.tone(196, 98, 0.18, 0.12, 'sine');
  }
  lockOn(): void {
    if (!this.throttle('lock', 0.4)) return;
    this.chime(scaleNote(6), 0.25, 0.045);
  }
  warning(): void {
    if (!this.throttle('warn', 0.5)) return;
    this.chime(scaleNote(3), 0.35, 0.08);
    this.chime(scaleNote(1), 0.45, 0.08, { delay: 0.18 });
  }
  click(): void {
    this.chime(scaleNote(5), 0.15, 0.04);
  }
  buy(): void {
    this.chime(scaleNote(2), 0.6, 0.09);
    this.chime(scaleNote(4), 0.6, 0.08, { delay: 0.09 });
    this.chime(scaleNote(7), 0.9, 0.08, { delay: 0.18 });
  }
  /** Big splash: falling into a broken road, sinking, or transforming between car and boat. */
  splash(): void {
    this.noise(0.7, 900, 0.8, 'lowpass');
    this.noise(0.35, 2600, 0.3, 'bandpass', 2, { delay: 0.05 });
  }

  /** Metal crunch for being flattened by a road roller. */
  squash(): void {
    this.duckMusic(0.15, 1.6);
    this.noise(0.5, 260, 0.9, 'lowpass');
    this.noise(0.25, 1800, 0.35, 'bandpass', 2);
    this.tone(180, 45, 0.6, 0.35, 'square');
  }

  wreck(): void {
    this.duckMusic(0.15, 1.8);
    this.explosion(true);
    // A falling minor phrase instead of a buzzer: the run ends on a musical note.
    [5, 3, 1, 0].forEach((n, i) => this.chime(scaleNote(n) / 2, 1.2, 0.08, { delay: 0.35 + i * 0.22 }));
  }
}

export const audio = new AudioSynth();

/** Am9 – Fmaj7 – Cmaj7 – G6: warm open voicings (root for bass, upper notes for keys/pad). */
const CHORDS: { root: number; voicing: number[] }[] = [
  { root: 45, voicing: [60, 64, 67, 71] }, // Am9   (C E G B over A)
  { root: 41, voicing: [57, 60, 64, 67] }, // Fmaj7 (A C E G over F)
  { root: 48, voicing: [55, 59, 64, 67] }, // Cmaj7 (G B E G over C)
  { root: 43, voicing: [55, 59, 62, 64] }, // G6    (G B D E over G)
];

/** Four-bar melody: [16th step in bar, midi note, length in 16ths]. */
const MELODY: [number, number, number][][] = [
  [[0, 76, 3], [3, 79, 3], [6, 81, 5], [12, 79, 2], [14, 76, 2]],
  [[0, 72, 4], [4, 76, 2], [6, 74, 5], [12, 72, 4]],
  [[0, 79, 3], [3, 76, 3], [6, 74, 2], [8, 76, 6], [14, 79, 2]],
  [[0, 81, 4], [4, 79, 2], [6, 76, 2], [8, 74, 8]],
];

type Layer = 'keys' | 'pad' | 'bass' | 'drums' | 'hats' | 'arp' | 'lead';

/**
 * Adaptive score by vertical layering (audio-design skill): every layer plays in sync all the time
 * and fades in/out with intensity, so Heat changes never break the phrase.
 *   0.5 garage: electric piano + pad + soft bass · 1: + kick & snare · 2: + hats/shaker
 *   3: + plucked arpeggio (with echo) · 4: + melody
 */
class MusicEngine {
  private layers: Record<Layer, GainNode>;
  private pans: Partial<Record<Layer, StereoPannerNode>> = {};
  private echo: GainNode;
  private step = 0;
  private nextTime = 0;
  private bpm = 100;
  private timer = 0;
  private intensity = 0;
  private width = 0.75;

  constructor(private ctx: AudioContext, out: AudioNode, reverb: AudioNode, private noiseBuf: AudioBuffer) {
    // Dotted-eighth ping-pong echo for arp and melody.
    this.echo = ctx.createGain();
    const merger = ctx.createChannelMerger(2);
    const dl = ctx.createDelay(2);
    const dr = ctx.createDelay(2);
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3000;
    this.echo.connect(tone).connect(dl);
    dl.connect(dr);
    dr.connect(fb).connect(dl);
    dl.connect(merger, 0, 0);
    dr.connect(merger, 0, 1);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.4;
    merger.connect(echoOut).connect(out);
    this.setDelayTime = (sec: number): void => {
      dl.delayTime.setTargetAtTime(sec, ctx.currentTime, 0.1);
      dr.delayTime.setTargetAtTime(sec, ctx.currentTime, 0.1);
    };

    const wet: Record<Layer, number> = { keys: 0.35, pad: 0.5, bass: 0, drums: 0.12, hats: 0.2, arp: 0.3, lead: 0.45 };
    const pan: Partial<Record<Layer, number>> = { keys: -0.25, hats: 0.35, arp: 0.3, lead: -0.1 };
    const mk = (k: Layer): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      let tail: AudioNode = g;
      if (pan[k] !== undefined) {
        const p = ctx.createStereoPanner();
        this.pans[k] = p;
        tail = g.connect(p);
      }
      tail.connect(out);
      if (wet[k] > 0) {
        const w = ctx.createGain();
        w.gain.value = wet[k];
        tail.connect(w).connect(reverb);
      }
      if (k === 'arp' || k === 'lead') tail.connect(this.echo);
      return g;
    };
    this.layers = { keys: mk('keys'), pad: mk('pad'), bass: mk('bass'), drums: mk('drums'), hats: mk('hats'), arp: mk('arp'), lead: mk('lead') };
    this.panBase = pan;
    this.setDelayTime((60 / this.bpm) * 0.75);
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private setDelayTime: (sec: number) => void;
  private panBase: Partial<Record<Layer, number>>;

  setWidth(w: number): void {
    this.width = w;
    for (const [k, p] of Object.entries(this.pans) as [Layer, StereoPannerNode][]) {
      p.pan.setTargetAtTime((this.panBase[k] ?? 0) * w, this.ctx.currentTime, 0.05);
    }
  }

  setIntensity(level: number): void {
    this.intensity = level;
    const on = (min: number): number => (level >= min ? 1 : 0);
    const target: Record<Layer, number> = {
      keys: level > 0 ? 1 : 0,
      pad: level > 0 ? (level < 1 ? 0.9 : 0.6) : 0,
      bass: level > 0 ? (level < 1 ? 0.6 : 1) : 0,
      drums: on(1),
      hats: on(2),
      arp: on(3),
      lead: on(4),
    };
    const t = this.ctx.currentTime;
    for (const k of Object.keys(target) as Layer[]) this.layers[k].gain.setTargetAtTime(target[k], t, 1.2);
    const bpm = level >= 3 ? 112 : level >= 1 ? 106 : 100;
    if (bpm !== this.bpm) {
      this.bpm = bpm;
      this.setDelayTime((60 / bpm) * 0.75);
    }
  }

  private schedule(): void {
    if (this.ctx.state !== 'running') return;
    if (this.intensity <= 0) {
      this.nextTime = this.ctx.currentTime + 0.05;
      return;
    }
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      // Light swing on the off-16ths gives the groove a human feel.
      const swing = this.step % 2 === 1 ? sixteenth * 0.12 : 0;
      this.playStep(this.step, this.nextTime + swing, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, len: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const { root, voicing } = CHORDS[bar % CHORDS.length];
    if (s === 0) this.pad(voicing, t, len * 16);
    if (s === 0 || s === 10) this.keys(voicing, t, s === 0 ? len * 9 : len * 5, s === 0 ? 1 : 0.7);
    if (s === 0 || s === 6 || s === 8 || s === 14) this.bass(midi(root - 12), t, len * (s === 0 || s === 8 ? 5 : 2), s === 0 ? 0.32 : 0.22);
    if (s === 0 || s === 7 || s === 10) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.05 : 0.025);
    const arpIdx = [0, 2, 1, 3, 2, 1, 3, 0][(s >> 1) % 8];
    if (s % 2 === 0) this.pluck(midi(voicing[arpIdx] + 12), t, len * 3, s % 4 === 0 ? 0.07 : 0.045);
    for (const [at, note, l] of MELODY[bar % MELODY.length]) if (at === s) this.lead(midi(note), t, len * l);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** Electric piano: sine fundamental + a short FM "tine" bell on the attack. */
  private keys(chord: number[], t: number, dur: number, vel: number): void {
    chord.forEach((n, i) => {
      const at = t + i * 0.012; // slight strum
      const f = midi(n);
      const car = this.ctx.createOscillator();
      car.frequency.value = f;
      const mod = this.ctx.createOscillator();
      mod.frequency.value = f * 14;
      const modGain = this.ctx.createGain();
      modGain.gain.setValueAtTime(f * 1.2, at);
      modGain.gain.exponentialRampToValueAtTime(1, at + 0.25);
      mod.connect(modGain).connect(car.frequency);
      const g = this.ctx.createGain();
      this.env(g, at, 0.05 * vel, 0.006, dur);
      car.connect(g).connect(this.layers.keys);
      car.start(at);
      mod.start(at);
      car.stop(at + dur + 0.1);
      mod.stop(at + dur + 0.1);
    });
  }

  /** Warm string-style pad: detuned saw pairs through a slow-opening lowpass. */
  private pad(chord: number[], t: number, dur: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.5;
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1400, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(700, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.018, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    f.connect(g).connect(this.layers.pad);
    for (const n of chord) {
      for (const detune of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = detune;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.4);
      }
    }
  }

  /** Round bass: sine body + filtered triangle an octave up so it still reads on small speakers. */
  private bass(freq: number, t: number, dur: number, peak: number): void {
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.01, dur);
    g.connect(this.layers.bass);
    const body = this.ctx.createOscillator();
    body.frequency.value = freq;
    body.connect(g);
    const top = this.ctx.createOscillator();
    top.type = 'triangle';
    top.frequency.value = freq * 2;
    const topGain = this.ctx.createGain();
    topGain.gain.value = 0.35;
    top.connect(topGain).connect(g);
    for (const o of [body, top]) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    const g = this.ctx.createGain();
    this.env(g, t, 0.4, 0.003, 0.25);
    o.connect(g).connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(out: GainNode, t: number, type: BiquadFilterType, freq: number, peak: number, dur: number, q = 0.7): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.003, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** Soft brushed snare: body tone + band-passed noise. */
  private snare(t: number): void {
    this.noiseHit(this.layers.drums, t, 'bandpass', 2200, 0.14, 0.18, 0.6);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const g = this.ctx.createGain();
    this.env(g, t, 0.08, 0.002, 0.1);
    o.connect(g).connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.15);
  }

  private hat(t: number, peak: number): void {
    this.noiseHit(this.layers.hats, t, 'highpass', 8000, peak, 0.05);
  }

  /** Plucked string: triangle through a fast-closing lowpass. */
  private pluck(freq: number, t: number, dur: number, peak: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(4000, t);
    f.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.003, dur);
    o.connect(f).connect(g).connect(this.layers.arp);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Singing lead: sine + soft triangle with delayed vibrato and a gentle swell. */
  private lead(freq: number, t: number, dur: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.04);
    g.gain.setTargetAtTime(0.05, t + 0.1, 0.2);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.12);
    g.connect(this.layers.lead);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibDepth = this.ctx.createGain();
    vibDepth.gain.setValueAtTime(0, t);
    vibDepth.gain.linearRampToValueAtTime(freq * 0.006, t + Math.min(0.4, dur));
    vib.connect(vibDepth);
    const oscs = (['sine', 'triangle'] as OscillatorType[]).map((type, i) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      vibDepth.connect(o.frequency);
      const lvl = this.ctx.createGain();
      lvl.gain.value = i === 0 ? 1 : 0.3;
      o.connect(lvl).connect(g);
      return o;
    });
    for (const o of [vib, ...oscs]) {
      o.start(t);
      o.stop(t + dur + 0.8);
    }
  }

  stop(): void {
    window.clearInterval(this.timer);
  }
}
