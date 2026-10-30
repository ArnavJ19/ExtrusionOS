export type PracticeTask = "quotation" | "inspection" | "dispatch";
export type PracticeState = { task: PracticeTask; completed: boolean; attempts: number; feedback: string };
export const practiceScenarios = {
  quotation: { title: "Prepare a sample quotation", question: "10 pieces, 6 m each, 0.8 kg/m, INR 250/kg. Enter the material value before tax.", answer: 12000, unit: "INR", explanation: "10 x 6 x 0.8 = 48 kg; 48 x 250 = INR 12,000 before tax." },
  inspection: { title: "Inspect a sample lot", question: "A sample lot has 100 pieces: 92 accepted, 5 rejected. Enter the pieces still on hold.", answer: 3, unit: "pieces", explanation: "100 - 92 - 5 = 3 pieces on hold. Held pieces cannot become accepted stock." },
  dispatch: { title: "Reconcile a sample dispatch", question: "A sample order has 1,000 kg eligible and 600 kg already dispatched. Enter the maximum remaining kg.", answer: 400, unit: "kg", explanation: "1,000 - 600 = 400 kg remaining. A retry must retain the same dispatch identity." },
} as const;

export function initialPracticeState(task: PracticeTask): PracticeState {
  return { task, completed: false, attempts: 0, feedback: "" };
}

export function checkPracticeAnswer(state: PracticeState, raw: string): PracticeState {
  if (state.completed) return state;
  const value = raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0) return { ...state, feedback: "Enter a finite, non-negative sample amount." };
  const scenario = practiceScenarios[state.task];
  const completed = Math.abs(value - scenario.answer) < 0.000001;
  return { ...state, attempts: state.attempts + 1, completed, feedback: completed ? scenario.explanation : `Review the quantities and try again. ${scenario.explanation}` };
}
