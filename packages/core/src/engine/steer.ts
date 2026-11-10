/** A point mass moved by steering (velocity in px/s). */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
}

/** Below this speed (px/s) the heading is kept, so resting cursors do not spin. */
const HEADING_MIN_SPEED = 8;

/**
 * Applies a desired velocity change (sx, sy), limited to `accel * h`, caps the speed and
 * integrates the position over `h` seconds (semi-implicit Euler).
 */
export function applySteer(b: Body, sx: number, sy: number, accel: number, maxSpeed: number, h: number): void {
  const limit = accel * h;
  const m = Math.hypot(sx, sy);
  if (m > limit && m > 0) {
    sx *= limit / m;
    sy *= limit / m;
  }
  b.vx += sx;
  b.vy += sy;
  const speed = Math.hypot(b.vx, b.vy);
  if (speed > maxSpeed) {
    b.vx *= maxSpeed / speed;
    b.vy *= maxSpeed / speed;
  }
  b.x += b.vx * h;
  b.y += b.vy * h;
  if (speed > HEADING_MIN_SPEED) b.heading = Math.atan2(b.vy, b.vx);
}

/** Arrive behaviour: full speed toward (tx, ty), slowing down linearly inside `slowRadius`. */
export function steerTo(
  b: Body,
  tx: number,
  ty: number,
  maxSpeed: number,
  accel: number,
  slowRadius: number,
  h: number,
): void {
  const dx = tx - b.x;
  const dy = ty - b.y;
  const d = Math.hypot(dx, dy);
  let wantX = 0;
  let wantY = 0;
  if (d > 1e-6) {
    const speed = d < slowRadius ? (maxSpeed * d) / slowRadius : maxSpeed;
    wantX = (dx / d) * speed;
    wantY = (dy / d) * speed;
  }
  applySteer(b, wantX - b.vx, wantY - b.vy, accel, maxSpeed, h);
}

/** Exponential velocity damping with a time constant in seconds, then integration. */
export function coast(b: Body, tau: number, h: number): void {
  const k = Math.exp(-h / tau);
  b.vx *= k;
  b.vy *= k;
  b.x += b.vx * h;
  b.y += b.vy * h;
}
