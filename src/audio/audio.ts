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
  | 'purchase'
  | 'lock'
  | 'armClick'
  | 'fuse'
  | 'warning'
  | 'heartbeat'
  | 'crack'
  | 'failMajor'
  | 'rumble'
  | 'heavyLanding'
  | 'settled'
  | 'cash'
  | 'newBest';

/** Flavour for cues that vary: a charge type or a material. */
export type Variant = 'small' | 'heavy' | 'directional' | 'shaped' | 'wood' | 'brick' | 'concrete' | 'steel';

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

  play(cue: Cue, strength = 1, variant?: Variant): void {
    if (!this.ready) return;
    const ctx = this.ctx as AudioContext;
    const now = ctx.currentTime;
    // Rate-limit noisy cues so a big collapse does not clip.
    const last = this.lastCue.get(cue) ?? -1;
    const minGap = cue === 'impact' || cue === 'crumble' ? 0.06 : cue === 'crack' ? 0.05 : cue === 'failMajor' || cue === 'heavyLanding' ? 0.18 : 0.02;
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
        // Heavy body landing on the member, then the strap cinching.
        this.thud(variant === 'heavy' ? 95 : 140, 0.16, variant === 'heavy' ? 0.6 : 0.45);
        this.noise(0.05, 0.25, 2600, 'bandpass', 0.02);
        break;
      case 'lock':
        this.noise(0.03, 0.35, 5200, 'highpass');
        this.blip(1760, 0.04, 0.09, 0.01, 'square');
        this.blip(2350, 0.05, 0.06, 0.05, 'triangle');
        break;
      case 'remove':
        this.noise(0.04, 0.25, 3800, 'highpass');
        this.blip(620, 0.07, 0.12, 0.01, 'triangle');
        this.blip(380, 0.09, 0.1, 0.06, 'triangle');
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
      case 'armClick':
        // Each charge going live: relay clack plus a rising confirmation beep.
        this.noise(0.025, 0.4, 4000, 'highpass');
        this.blip(700 + strength * 500, 0.08, 0.14, 0.02, 'square');
        break;
      case 'fuse':
        this.noise(0.9, 0.08, 3200, 'bandpass');
        break;
      case 'warning':
        this.blip(880, 0.22, 0.14, 0, 'sawtooth');
        this.blip(660, 0.22, 0.14, 0.24, 'sawtooth');
        break;
      case 'heartbeat':
        this.thud(55, 0.16, 0.35 + strength * 0.35);
        this.thud(50, 0.14, 0.25 + strength * 0.3, 0.16);
        break;
      case 'tick':
        // Strength 0..1 is countdown tension: pitch climbs toward zero.
        this.blip(900 + strength * 500, 0.07, 0.2 + strength * 0.08, 0, 'square');
        break;
      case 'tickFinal':
        this.blip(1500, 0.14, 0.3, 0, 'square');
        this.blip(2000, 0.12, 0.2, 0.05, 'square');
        break;
      case 'detonate':
        this.boom(strength, variant);
        break;
      case 'crumble':
        this.noise(0.5 + strength * 0.4, 0.18 + strength * 0.25, 900, 'lowpass');
        break;
      case 'crack':
        this.crack(variant, strength);
        break;
      case 'failMajor':
        this.crack(variant, 1);
        this.thud(42, 0.9, 0.7);
        this.noise(1.1, 0.3, 380, 'lowpass', 0.05);
        break;
      case 'rumble':
        this.noise(1.6 + strength, 0.25 + strength * 0.25, 220, 'lowpass');
        this.thud(35, 1.2, 0.4 + strength * 0.4);
        break;
      case 'heavyLanding':
        this.thud(38, 1.3, 1);
        this.noise(0.08, 0.7, 2400, 'lowpass');
        this.noise(2.2, 0.45, 300, 'lowpass', 0.03);
        break;
      case 'settled':
        // Dust hiss, stray pebbles, then quiet.
        this.noise(2.8, 0.1, 1800, 'bandpass');
        this.blip(2400, 0.03, 0.05, 0.35, 'triangle');
        this.blip(1900, 0.03, 0.04, 0.8, 'triangle');
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
        // The last heavy piece finds the ground under a sheet of dust.
        this.thud(40, 0.9, 0.55);
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
      case 'cash':
        this.noise(0.05, 0.3, 5000, 'highpass');
        this.blip(1568, 0.09, 0.18, 0.03, 'triangle');
        this.blip(2093, 0.3, 0.2, 0.1, 'triangle');
        break;
      case 'newBest':
        this.chord([523, 659, 784], 0.4, 0.22);
        window.setTimeout(() => this.chord([698, 880, 1046, 1396], 0.9, 0.26), 180);
        break;
    }
  }

  /** Material-specific structural failure: timber snaps, concrete cracks, steel groans, brick crumbles. */
  private crack(variant: Variant | undefined, strength: number): void {
    const ctx = this.ctx as AudioContext;
    const v = 0.5 + strength * 0.5;
    switch (variant) {
      case 'wood': {
        this.noise(0.07, 0.5 * v, 2200, 'bandpass');
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        const t0 = ctx.currentTime;
        osc.frequency.setValueAtTime(180, t0);
        osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.25);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.12 * v, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
        osc.connect(gain);
        gain.connect(this.master as GainNode);
        osc.start(t0);
        osc.stop(t0 + 0.3);
        break;
      }
      case 'steel': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        const t0 = ctx.currentTime;
        osc.frequency.setValueAtTime(140, t0);
        osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.6);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.14 * v, t0 + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.65);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 700;
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.master as GainNode);
        osc.start(t0);
        osc.stop(t0 + 0.7);
        this.blip(2600, 0.25, 0.05 * v, 0.02, 'triangle');
        break;
      }
      case 'brick':
        this.noise(0.35, 0.3 * v, 1200, 'lowpass');
        this.noise(0.04, 0.3 * v, 3000, 'highpass');
        break;
      default:
        this.noise(0.05, 0.6 * v, 3500, 'highpass');
        this.thud(90, 0.18, 0.35 * v);
        this.noise(0.4, 0.2 * v, 900, 'lowpass', 0.03);
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

  private thud(freq: number, duration: number, volume: number, delay = 0): void {
    const ctx = this.ctx as AudioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const t0 = ctx.currentTime + delay;
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

  private noise(duration: number, volume: number, cutoff: number, type: BiquadFilterType, delay = 0): void {
    const ctx = this.ctx as AudioContext;
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.min(1, volume), t0 + Math.min(0.03, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master as GainNode);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  private boom(strength: number, variant?: Variant): void {
    const ctx = this.ctx as AudioContext;
    const t0 = ctx.currentTime;
    const sweep = (from: number, to: number, dur: number, vol: number, type: OscillatorType): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t0);
      osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.1);
      osc.connect(gain);
      gain.connect(this.master as GainNode);
      osc.start(t0);
      osc.stop(t0 + dur + 0.15);
    };
    switch (variant) {
      case 'small':
        // Short and punchy.
        this.thud(70, 0.6, 1);
        this.noise(0.08, 0.9, 5000, 'highpass');
        this.noise(0.9, 0.5, 1100, 'lowpass');
        break;
      case 'heavy':
        // Deep chest hit and a long rolling tail.
        this.thud(38, 1.9, 1);
        this.noise(0.14, 1, 4500, 'highpass');
        this.noise(2.8, 0.75, 500, 'lowpass');
        sweep(180, 25, 1.1, 0.6, 'triangle');
        this.noise(1.6, 0.25, 200, 'lowpass', 0.4);
        break;
      case 'directional':
        // A forced jet: whoosh into the bang.
        this.noise(0.35, 0.55, 2400, 'bandpass');
        this.thud(55, 1.1, 0.95);
        this.noise(0.1, 0.8, 5500, 'highpass', 0.02);
        this.noise(1.5, 0.5, 800, 'lowpass', 0.03);
        break;
      case 'shaped':
        // A razor crack and a metallic zing, very little rumble.
        this.noise(0.05, 1, 7000, 'highpass');
        sweep(3200, 400, 0.25, 0.18, 'sawtooth');
        this.thud(90, 0.5, 0.8);
        this.noise(0.6, 0.3, 1400, 'lowpass', 0.02);
        break;
      default:
        this.thud(45, 1.4, 1);
        this.noise(0.12, 0.9, 6000, 'highpass');
        this.noise(1.8 + strength * 0.6, 0.6, 700, 'lowpass');
        sweep(220, 30, 0.8, 0.5, 'triangle');
    }
  }
}

export const audio = new AudioEngine();
