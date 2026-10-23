/**
 * City ambience, synthesised with the Web Audio API (no external sound files, so nothing to license).
 * Layers: distant traffic rumble, nearby car pass-bys, wind, rain, harbour water lapping,
 * unintelligible crowd murmur, birdsong (daytime) and footsteps on stone.
 * Nothing plays until start() is called from a user gesture.
 */
export class CityAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private beds: Record<string, GainNode> = {};
  private birdTimer = 0;
  private stepBuf: AudioBuffer | null = null;
  volume = 0.7;
  muted = false;

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  async start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.build();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.applyVolume();
  }

  suspend() {
    void this.ctx?.suspend();
  }

  setVolume(v: number, muted: boolean) {
    this.volume = v;
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.15);
  }

  private noise(seconds: number, type: 'white' | 'pink' | 'brown') {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'white') d[i] = w;
        else if (type === 'pink') {
          b0 = 0.99765 * b0 + w * 0.099;
          b1 = 0.963 * b1 + w * 0.2965;
          b2 = 0.57 * b2 + w * 1.0526;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
        } else {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.2;
        }
      }
    }
    return buf;
  }

  private bed(name: string, buf: AudioBuffer, filter: BiquadFilterType, freq: number, q = 0.7, lfo = 0) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    if (lfo) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.frequency.value = lfo;
      og.gain.value = freq * 0.35;
      o.connect(og).connect(f.frequency);
      o.start();
    }
    src.start(0, Math.random() * buf.duration);
    this.beds[name] = g;
  }

  private build() {
    const brown = this.noise(6, 'brown');
    const pink = this.noise(5, 'pink');
    const white = this.noise(3, 'white');
    this.bed('traffic', brown, 'lowpass', 320, 0.5, 0.05);
    this.bed('car', pink, 'bandpass', 700, 0.6);
    this.bed('wind', pink, 'bandpass', 520, 0.9, 0.11);
    this.bed('rain', white, 'highpass', 1800, 0.4);
    this.bed('harbour', brown, 'lowpass', 520, 1.2, 0.18);
    this.bed('crowd', pink, 'bandpass', 380, 3.5, 2.3); // formant-like wobble → murmur, never words
    // footstep: short filtered noise burst on stone
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * 0.09);
    this.stepBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.stepBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
  }

  private set(name: string, v: number) {
    const g = this.beds[name];
    if (g && this.ctx) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
  }

  /** Call every frame with the current environment state. */
  update(dt: number, s: { night: number; rain: boolean; snow: boolean; nearestCar: number; water: number; people: number; day: boolean; nearRoad: number }) {
    if (!this.running) return;
    const quiet = 1 - s.night * 0.45;
    this.set('traffic', (0.05 + 0.1 * Math.max(0, 1 - s.nearRoad / 80)) * quiet);
    this.set('car', 0.35 * Math.max(0, 1 - s.nearestCar / 30) ** 2);
    this.set('wind', s.snow ? 0.06 : 0.035);
    this.set('rain', s.rain ? 0.16 : 0);
    this.set('harbour', 0.22 * Math.max(0, 1 - s.water / 60) ** 1.5);
    this.set('crowd', Math.min(0.07, s.people * 0.004) * quiet);
    if (s.day && !s.rain && !s.snow) {
      this.birdTimer -= dt;
      if (this.birdTimer < 0) {
        this.birdTimer = 1.5 + Math.random() * 6;
        this.chirp();
      }
    }
  }

  private chirp() {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const notes = 2 + ((Math.random() * 4) | 0);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.master);
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = t0 + i * (0.08 + Math.random() * 0.05);
      const f = 2800 + Math.random() * 2200;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.6), t + 0.07);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.012, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  step(strength: number, wet: boolean, snow: boolean) {
    if (!this.running || !this.stepBuf) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.stepBuf;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = snow ? 'lowpass' : 'bandpass';
    f.frequency.value = snow ? 900 : wet ? 2400 : 1500;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.09 * strength * (wet ? 1.2 : 1);
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
