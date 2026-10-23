import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { Collision } from '../world/Collision';

const EYE = 1.68; // metres above the pavement
const WALK = 1.4; // m/s comfortable walking pace
const RADIUS = 0.32;

export class Player {
  readonly controls: PointerLockControls;
  readonly position = new THREE.Vector3();
  private velocity = new THREE.Vector2();
  private keys = new Set<string>();
  private bobPhase = 0;
  private bobAmp = 0;
  private lastStep = 0;
  collision: Collision | null = null;
  speedMul = 1;
  reducedMotion = false;
  sensitivity = 1;
  enabled = false;
  onStep: (strength: number) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  /** external (touch joystick) input in -1..1 */
  stick = new THREE.Vector2();
  private touchLook: { id: number; x: number; y: number } | null = null;
  private dom: HTMLElement;

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.dom = dom;
    this.controls = new PointerLockControls(camera, dom);
    this.controls.pointerSpeed = 0.8;
    this.controls.addEventListener('lock', () => this.onLockChange(true));
    this.controls.addEventListener('unlock', () => this.onLockChange(false));
    addEventListener('keydown', this.kd);
    addEventListener('keyup', this.ku);
    addEventListener('blur', this.clear);
    dom.addEventListener('touchstart', this.ts, { passive: false });
    dom.addEventListener('touchmove', this.tm, { passive: false });
    dom.addEventListener('touchend', this.te);
    dom.addEventListener('touchcancel', this.te);
  }

  private kd = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    this.keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && this.enabled) e.preventDefault();
  };
  private ku = (e: KeyboardEvent) => this.keys.delete(e.code);
  private clear = () => this.keys.clear();

  private ts = (e: TouchEvent) => {
    if (!this.enabled) return;
    for (const t of Array.from(e.changedTouches)) {
      // right/top part of the screen = look; the joystick element handles its own touches
      if (!this.touchLook) this.touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
    e.preventDefault();
  };
  private tm = (e: TouchEvent) => {
    if (!this.touchLook) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.touchLook.id) continue;
      const dx = t.clientX - this.touchLook.x, dy = t.clientY - this.touchLook.y;
      this.touchLook.x = t.clientX;
      this.touchLook.y = t.clientY;
      this.rotate(-dx * 0.0045 * this.sensitivity, -dy * 0.0045 * this.sensitivity);
    }
    e.preventDefault();
  };
  private te = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (this.touchLook?.id === t.identifier) this.touchLook = null;
  };

  rotate(dYaw: number, dPitch: number) {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const pitch = THREE.MathUtils.clamp(e.x + dPitch, -1.4, 1.4);
    this.camera.quaternion.setFromEuler(new THREE.Euler(pitch, e.y + dYaw, 0, 'YXZ'));
  }

  setSensitivity(s: number) {
    this.sensitivity = s;
    this.controls.pointerSpeed = 0.8 * s;
  }

  spawn(x: number, z: number, yaw: number) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0);
    this.camera.position.set(x, EYE, z);
    this.camera.quaternion.setFromEuler(new THREE.Euler(-0.02, yaw, 0, 'YXZ'));
  }

  get heading() {
    return new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ').y;
  }

  update(dt: number) {
    const k = this.keys;
    let fx = 0, fz = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
      fx += this.stick.x;
      fz += this.stick.y;
    }
    const len = Math.hypot(fx, fz);
    if (len > 1) {
      fx /= len;
      fz /= len;
    }
    const run = k.has('ShiftLeft') || k.has('ShiftRight') ? 1.55 : 1;
    const target = WALK * this.speedMul * run * (fz < 0 ? 0.7 : 1);
    // camera-relative basis on the ground plane
    const yaw = this.heading;
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    const wantX = (fwdX * fz + rightX * fx) * target;
    const wantZ = (fwdZ * fz + rightZ * fx) * target;
    // smooth human acceleration / deceleration
    const accel = len > 0.01 ? 4.2 : 6.5;
    const a = 1 - Math.exp(-accel * dt);
    this.velocity.x += (wantX - this.velocity.x) * a;
    this.velocity.y += (wantZ - this.velocity.y) * a;

    const speed = this.velocity.length();
    if (speed > 0.001) {
      const dx = this.velocity.x * dt, dz = this.velocity.y * dt;
      if (this.collision) {
        const [nx, nz] = this.collision.move(this.position.x, this.position.z, dx, dz, RADIUS);
        // if blocked, bleed velocity so we don't "stick" against walls
        const moved = Math.hypot(nx - this.position.x, nz - this.position.z);
        if (moved < Math.hypot(dx, dz) * 0.5) this.velocity.multiplyScalar(0.6);
        this.position.x = nx;
        this.position.z = nz;
      } else {
        this.position.x += dx;
        this.position.z += dz;
      }
    }
    // head bob — tied to stride (≈ 1.9 steps/s at 1.4 m/s)
    const stride = speed / 0.74;
    this.bobPhase += stride * dt * Math.PI;
    const wantAmp = Math.min(1, speed / WALK) * (this.reducedMotion ? 0.12 : 1);
    this.bobAmp += (wantAmp - this.bobAmp) * (1 - Math.exp(-5 * dt));
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.028 * this.bobAmp - 0.014 * this.bobAmp;
    const bobX = Math.sin(this.bobPhase) * 0.012 * this.bobAmp;
    this.camera.position.set(this.position.x + rightX * bobX, EYE + bobY, this.position.z + rightZ * bobX);
    // footstep at each bob trough
    const stepIndex = Math.floor(this.bobPhase / Math.PI);
    if (stepIndex !== this.lastStep && speed > 0.35) this.onStep(Math.min(1, speed / WALK));
    this.lastStep = stepIndex;
    return speed;
  }

  dispose() {
    removeEventListener('keydown', this.kd);
    removeEventListener('keyup', this.ku);
    removeEventListener('blur', this.clear);
    this.dom.removeEventListener('touchstart', this.ts);
    this.dom.removeEventListener('touchmove', this.tm);
    this.dom.removeEventListener('touchend', this.te);
    this.dom.removeEventListener('touchcancel', this.te);
    this.controls.dispose();
  }
}
