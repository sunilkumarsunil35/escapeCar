/** Gyroscope steering shared by mobile direct play and the paired QR controller. */

export const STEER_DEADZONE_DEG = 2;
export const STEER_MAX_DEG = 30;

/** Doc §2.2: 2° deadzone, clamp to ±30°, normalized to -1..+1. */
export function computeSteer(currentAngleDeg: number, calibratedZeroDeg: number): number {
  let delta = currentAngleDeg - calibratedZeroDeg;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  if (Math.abs(delta) < STEER_DEADZONE_DEG) return 0;
  const clamped = Math.max(-STEER_MAX_DEG, Math.min(STEER_MAX_DEG, delta));
  return clamped / STEER_MAX_DEG;
}

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

function screenAngle(): number {
  const so = screen.orientation as ScreenOrientation | undefined;
  if (so && typeof so.angle === 'number') return so.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? (legacy + 360) % 360 : 0;
}

/**
 * Converts beta/gamma into a "steering wheel" rotation angle in the screen plane, independent of
 * whether the phone is held in landscape-left, landscape-right or portrait.
 */
export function wheelAngleDeg(beta: number, gamma: number): number {
  const b = (beta * Math.PI) / 180;
  const g = (gamma * Math.PI) / 180;
  // World "up" expressed in device coordinates (W3C Z-X'-Y'' Euler convention).
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  let sx: number;
  let sy: number;
  switch (screenAngle()) {
    case 90:
      sx = -uy;
      sy = ux;
      break;
    case 270:
    case -90:
      sx = uy;
      sy = -ux;
      break;
    case 180:
      sx = -ux;
      sy = -uy;
      break;
    default:
      sx = ux;
      sy = uy;
  }
  return (Math.atan2(-sx, sy) * 180) / Math.PI;
}

export class GyroSteer {
  angle = 0;
  zero = 0;
  active = false;
  supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  private gotEvent = false;
  private handler = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return;
    this.gotEvent = true;
    this.angle = wheelAngleDeg(e.beta, e.gamma);
  };

  get steer(): number {
    return this.active && this.gotEvent ? computeSteer(this.angle, this.zero) : 0;
  }

  get receiving(): boolean {
    return this.gotEvent;
  }

  /** Must run inside a user gesture on iOS (TAP TO CALIBRATE & START). Resolves true when listening. */
  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    const Ctor = window.DeviceOrientationEvent as OrientationCtor;
    if (typeof Ctor.requestPermission === 'function') {
      try {
        const res = await Ctor.requestPermission();
        if (res !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (!this.active) {
      window.addEventListener('deviceorientation', this.handler);
      this.active = true;
    }
    return true;
  }

  /** Sets the current hold angle as center (0). */
  calibrate(): void {
    this.zero = this.angle;
  }

  /** Waits briefly for the first sensor event so calibration captures a real angle. */
  async waitForData(timeoutMs = 600): Promise<boolean> {
    const start = performance.now();
    while (!this.gotEvent && performance.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 30));
    }
    return this.gotEvent;
  }
}
