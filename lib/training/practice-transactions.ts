export type PracticeOperation = "quotation" | "inspection" | "dispatch";
type Values = Record<string, number>;
export type PracticeProposal = {
  sandboxId: string; revision: number; requestId: string; operation: PracticeOperation;
  values: Values; totals: Values; explanation: string;
};
export type PracticeEvent = PracticeProposal & { number: string };
export type PracticeLedger = {
  sandboxId: string; revision: number; events: PracticeEvent[];
  remaining: { pieces: number; metres: number; kg: number };
};

export function newPracticeLedger(sandboxId: string): PracticeLedger {
  return { sandboxId, revision: 0, events: [], remaining: { pieces: 80, metres: 480, kg: 384 } };
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
function positive(values: Values, names: string[], allowZero: string[] = []) {
  for (const name of names) {
    const value = values[name];
    if (!Number.isFinite(value) || value < 0 || (!allowZero.includes(name) && value === 0)) throw new Error(`Enter a valid sample ${name.replaceAll("_", " ")}.`);
  }
}

export function reviewPracticeTransaction(state: PracticeLedger, operation: PracticeOperation, values: Values, requestId: string): PracticeProposal {
  if (!requestId || state.events.length >= 100) throw new Error("Reset the sample desk before starting more transactions.");
  const input = { ...values };
  let totals: Values;
  let explanation: string;
  if (operation === "quotation") {
    positive(input, ["pieces", "length_m", "rate_inr_per_kg", "gst_percent"], ["gst_percent"]);
    if (!Number.isInteger(input.pieces) || input.pieces > 10000 || input.length_m > 12 || input.rate_inr_per_kg > 100000 || input.gst_percent > 28) throw new Error("Sample quotation dimensions, quantity or rates are outside this scenario.");
    const kg = Math.round(input.pieces * input.length_m * 0.8 * 1000) / 1000;
    const subtotal = money(kg * input.rate_inr_per_kg), gst = money(subtotal * input.gst_percent / 100);
    totals = { kg, subtotal, gst, total: money(subtotal + gst) };
    explanation = `${input.pieces} pieces x ${input.length_m} m x 0.8 kg/m = ${kg} kg. GST is calculated on the reviewed material value.`;
  } else if (operation === "inspection") {
    const names = ["accepted_pieces", "rejected_pieces", "held_pieces", "accepted_kg", "rejected_kg", "held_kg"];
    positive(input, names, names);
    if (names.slice(0, 3).some(name => !Number.isInteger(input[name])) || input.accepted_pieces + input.rejected_pieces + input.held_pieces !== 100
      || Math.abs(input.accepted_kg + input.rejected_kg + input.held_kg - 480) > 0.000001) throw new Error("Reconcile all 100 observed pieces and all 480.000 measured kg into accepted, rejected and held portions.");
    for (const disposition of ["accepted", "rejected", "held"]) {
      if ((input[`${disposition}_pieces`] === 0) !== (input[`${disposition}_kg`] === 0)) throw new Error("Each nonempty observed portion needs its own pieces and measured weight.");
    }
    totals = { accepted_pieces: input.accepted_pieces, accepted_kg: input.accepted_kg, blocked_pieces: input.rejected_pieces + input.held_pieces, blocked_kg: input.rejected_kg + input.held_kg };
    explanation = "Each portion retains its observed pieces and kg. Rejected and held material is excluded from accepted stock.";
  } else {
    positive(input, ["pieces", "metres", "actual_kg"]);
    if (!Number.isInteger(input.pieces) || input.pieces > state.remaining.pieces || input.metres > state.remaining.metres || input.actual_kg > state.remaining.kg
      || Math.abs(input.metres - input.pieces * 6) > 0.000001) throw new Error("This intact sample bundle must retain 6 m per piece and fit the remaining pieces, metres and measured kg.");
    totals = { remaining_pieces: state.remaining.pieces - input.pieces, remaining_metres: state.remaining.metres - input.metres, remaining_kg: Math.round((state.remaining.kg - input.actual_kg) * 1000) / 1000 };
    explanation = "The sample order started with 200 pieces / 1,200 m / 960 kg. Its prior shipment used 120 pieces / 720 m / 576 kg; only the remaining source can be dispatched.";
  }
  return { sandboxId: state.sandboxId, revision: state.revision, requestId, operation, values: input, totals, explanation };
}

export function confirmPracticeTransaction(state: PracticeLedger, proposal: PracticeProposal): { state: PracticeLedger; event: PracticeEvent; replayed: boolean } {
  if (state.sandboxId !== proposal.sandboxId) throw new Error("This sample review belongs to an earlier reset. Review the new sample again.");
  const previous = state.events.find(event => event.requestId === proposal.requestId);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify({ ...proposal, number: previous.number })) throw new Error("This sample request identity already has different reviewed facts.");
    return { state, event: previous, replayed: true };
  }
  if (proposal.revision !== state.revision) throw new Error("Another sample transaction changed the source. Review the current sample again.");
  const verified = reviewPracticeTransaction(state, proposal.operation, proposal.values, proposal.requestId);
  if (JSON.stringify(verified) !== JSON.stringify(proposal)) throw new Error("Sample review totals changed. Review the sample again.");
  const event = { ...verified, number: `SAMPLE-${String(state.events.length + 1).padStart(3, "0")}` };
  return { replayed: false, event, state: {
    ...state, revision: state.revision + 1, events: [...state.events, event],
    remaining: proposal.operation === "dispatch" ? { pieces: verified.totals.remaining_pieces, metres: verified.totals.remaining_metres, kg: verified.totals.remaining_kg } : { ...state.remaining }
  } };
}
