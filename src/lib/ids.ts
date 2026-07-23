/** Monotonic ids — reset with durable store so dialog specs stay deterministic. */

let seq = 0;

export function resetIds(): void {
  seq = 0;
}

/** Short id for store records (not crypto-secure). */
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}${seq}`;
}

export function newOrderId(): string {
  return newId("o");
}

export function newNotifId(): string {
  return newId("n");
}
