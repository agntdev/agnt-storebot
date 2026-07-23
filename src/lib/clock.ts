/** Injectable clock — every schedule / "now" decision goes through here. */
let _now: () => number = () => Date.now();

export function now(): number {
  return _now();
}

/** Test-only: override the clock. Pass `undefined` to restore wall clock. */
export function setNow(fn: (() => number) | undefined): void {
  _now = fn ?? (() => Date.now());
}
