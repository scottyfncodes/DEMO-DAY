/**
 * Procedural sound effects on the Web Audio API. No audio files: every cue is
 * synthesised, so the game stays a single small bundle and works offline.
 *
 * Mobile Safari only allows audio after a user gesture, so `unlock()` is
 * called from the first pointer event.
 */
export type Cue =
  | 'tap'
  | 'select'
  | 'inspect'
  | 'place'
  | 'remove'
  | 'error'
  | 'arm'
  | 'tick'
  | 'tickFinal'
  | 'detonate'
  | 'crumble'
  | 'impact'
  | 'topple'
  | 'settle'
  | 'reveal'
  | 'countTick'
  | 'bonus'
  | 'total'
  | 'fail'
  | 'unlock'
  | 'purchase';

export class AudioEngine {
  enabled = true;
  private ctx?: AudioContext;
  private master?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private lastCue = new Map<Cue, number>();

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      const seconds = 2;
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = undefined;
    }
  }

  private get ready(): boolean {
    return this.enabled && !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  play(cue: Cue, strength = 1): void {
    if (!this.ready) return;
    const ctx = this.ctx as AudioContext;
    const now = ctx.currentTime;
    // Rate-limit noisy cues so a big collapse does not clip.
    const last = this.lastCue.get(cue) ?? -1;
    const minGap = cue === 'impact' || cue === 'crumble' ? 0.06 : 0.02;
    if (now - last < minGap) return;
    this.lastCue.set(cue, now);
    switch (cue) {
      case 'tap':
        this.blip(880, 0.04, 0.12);
        break;
      case 'select':
        this.blip(660, 0.06, 0.16);
        this.blip(990, 0.06, 0.12, 0.05);
        break;
      case 'inspect':
        this.blip(520, 0.08, 0.14);
        break;
      case 'place':
        this.thud(140, 0.18, 0.5);
        this.blip(1320, 0.05, 0.1, 0.02);
        break;
      case 'remove':
        this.blip(440, 0.08, 0.12);
        this.blip(330, 0.1, 0.1, 0.06);
        break;
      case 'error':
        this.blip(220, 0.12, 0.18, 0, 'square');
        this.blip(180, 0.16, 0.14, 0.1, 'square');
        break;
      case 'arm':
        this.blip(440, 0.12, 0.2);
        this.blip(660, 0.12, 0.2, 0.12);
        this.blip(880, 0.3, 0.22, 0.24);
        break;
      case 'tick':
        this.blip(1100, 0.07, 0.24, 0, 'square');
        break;
      case 'tickFinal':
        this.blip(1500, 0.14, 0.3, 0, 'square');
        this.blip(2000, 0.12, 0.2, 0.05, 'square');
        break;
      case 'detonate':
        this.boom(strength);
        break;
      case 'crumble':
        this.noise(0.5 + strength * 0.4, 0.18 + strength * 0.25, 900, 'lowpass');
        break;
      case 'impact':
        this.thud(60 + strength * 30, 0.35 + strength * 0.3, 0.5 + strength * 0.6);
        this.noise(0.3 + strength * 0.3, 0.1 + strength * 0.2, 1400, 'lowpass');
        break;
      case 'topple':
        this.noise(1.2, 0.12, 400, 'lowpass');
        this.thud(50, 0.6, 0.35);
        break;
      case 'settle':
        this.noise(2.5, 0.16, 500, 'lowpass');
        break;
      case 'reveal':
        this.blip(740, 0.08, 0.16);
        this.blip(1110, 0.1, 0.12, 0.06);
        break;
      case 'countTick':
        this.blip(1400 + strength * 900, 0.03, 0.08, 0, 'square');
        break;
      case 'bonus':
        this.blip(880, 0.1, 0.2);
        this.blip(1174, 0.12, 0.2, 0.08);
        this.blip(1568, 0.2, 0.22, 0.16);
        break;
      case 'total':
        this.chord([523, 659, 784, 1046], 0.9, 0.24);
        this.thud(80, 0.5, 0.6);
        break;
      case 'fail':
        this.blip(392, 0.25, 0.2, 0, 'sawtooth');
        this.blip(311, 0.35, 0.2, 0.22, 'sawtooth');
        this.blip(233, 0.5, 0.2, 0.44, 'sawtooth');
        break;
      case 'unlock':
        this.chord([659, 880, 1318], 0.6, 0.2);
        break;
      case 'purchase':
        this.blip(988, 0.08, 0.18);
        this.blip(1318, 0.16, 0.18, 0.09);
        break;
    }
  }

  private blip(freq: number, duration: number, volume: number, delay = 0, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx as AudioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master as GainNode);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private chord(freqs: number[], duration: number, volume: number): void {
    freqs.forEach((f, i) => this.blip(f, duration, volume / freqs.length, i * 0.04, 'triangle'));
  }

  private thud(freq: number, duration: number, volume: number): void {
    const ctx = this.ctx as AudioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(freq * 2, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.5), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.min(1, volume), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master as GainNode);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private noise(duration: number, volume: number, cutoff: number, type: BiquadFilterType): void {
    const ctx = this.ctx as AudioContext;
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.min(1, volume), t0 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master as GainNode);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  private boom(strength: number): void {
    const ctx = this.ctx as AudioContext;
    // Sub thump + crack + long rumble.
    this.thud(45, 1.4, 1);
    this.noise(0.12, 0.9, 6000, 'highpass');
    this.noise(1.8 + strength * 0.6, 0.6, 700, 'lowpass');
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(30, t0 + 0.8);
    gain.gain.setValueAtTime(0.5, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    osc.connect(gain);
    gain.connect(this.master as GainNode);
    osc.start(t0);
    osc.stop(t0 + 1);
  }
}

export const audio = new AudioEngine();
