// AP-025: recognise a USB barcode/QR scanner in keyboard-wedge mode. A scanner "types" the whole label within a few
// milliseconds per character and ends with Enter; a person types far slower. Only bursts that start with the
// ExtrusionOS label prefix (EO) are treated as scans, so ordinary fast typing is never intercepted.

/** sessionStorage key the scan page reads when a scan with no field focused could not open a record directly. */
export const WEDGE_PENDING_KEY = "exos.wedge.pending";
/** Window event the scan page listens to for scans made while it is open. */
export const WEDGE_PAGE_EVENT = "exos:wedge-page";

export const WEDGE_MAX_GAP_MS = 40;
export const WEDGE_MIN_LENGTH = 10;

export type WedgeState = { buffer: string; last: number; fast: boolean; startedAt: number };
export const emptyWedge = (): WedgeState => ({ buffer: "", last: 0, fast: true, startedAt: 0 });

export type WedgeStep = { state: WedgeState; scan: string | null; inBurst: boolean };

/** Feeds one keydown (its `key` and a millisecond timestamp). Returns the completed scan when Enter ends a fast burst. */
export function feedWedge(state: WedgeState, key: string, at: number): WedgeStep {
  const gap = state.buffer ? at - state.last : 0;
  if (key === "Enter") {
    const scan = state.buffer.length >= WEDGE_MIN_LENGTH && state.fast && gap <= WEDGE_MAX_GAP_MS * 3 && isLabelPrefix(state.buffer) ? state.buffer : null;
    return { state: emptyWedge(), scan, inBurst: false };
  }
  if (key.length !== 1) return { state, scan: null, inBurst: false };
  if (!state.buffer || gap > WEDGE_MAX_GAP_MS * 3) {
    const next = { buffer: key, last: at, fast: true, startedAt: at };
    return { state: next, scan: null, inBurst: false };
  }
  const fast = state.fast && gap <= WEDGE_MAX_GAP_MS;
  const next = { buffer: (state.buffer + key).slice(0, 220), last: at, fast, startedAt: state.startedAt };
  return { state: next, scan: null, inBurst: fast && next.buffer.length >= 3 && isLabelPrefix(next.buffer) };
}

/** True while the characters so far could still be an ExtrusionOS label (EO:… or EO2:…). */
export function isLabelPrefix(text: string): boolean {
  return /^E(O(2?(:.*)?)?)?$/.test(text);
}

const FIELD_SCAN_TYPES: [RegExp, readonly string[]][] = [
  [/(^|_)die_id$/, ["die"]],
  [/(^|_)(billet_batch|billet_lot|foundry_billet|outsourced_billet_batch)_id$/, ["billet_batch"]],
  [/(^|_)(profile_stock_batch|inventory_batch|stock_batch|bundle)_id$/, ["inventory_batch", "dispatch_package"]],
  [/(^|_)production_job_id$/, ["production_job"]],
  [/(^|_)machine_id$/, ["machine"]],
  [/(^|_)profile_id$/, ["profile"]]
];

/** Which scanned labels a lookup field accepts, from its field name (die_id, profile_stock_batch_id, ...). */
export function scanTypesForField(name: string): readonly string[] | undefined {
  return FIELD_SCAN_TYPES.find(([pattern]) => pattern.test(name))?.[1];
}
