"use client";

import { useState } from "react";
import { checkPracticeAnswer, initialPracticeState, practiceScenarios, type PracticeTask } from "@/lib/training/practice";
import { PracticeTransactions } from "./practice-transactions";

export function PracticeWorkspace() {
  const [state, setState] = useState(initialPracticeState("quotation"));
  const [answer, setAnswer] = useState("");
  const [desk, setDesk] = useState(false);
  const scenario = practiceScenarios[state.task];
  function start(task: PracticeTask) { setState(initialPracticeState(task)); setAnswer(""); setDesk(false); }
  return <div className="mx-auto max-w-3xl space-y-6">
    <div className="rounded-xl border-2 border-amber-500 bg-amber-50 p-5 text-slate-900">
      <p className="text-sm font-bold uppercase tracking-widest">Practice only</p>
      <h1 className="mt-2 text-2xl font-semibold">Learn with sample transactions</h1>
      <p className="mt-2">All names, quantities and values here are samples. Your answers stay in this page and are cleared when you leave or reset. Completing a task does not create stock, invoices, files or messages.</p>
    </div>
    <nav aria-label="Practice tasks" className="flex flex-wrap gap-2">{(Object.keys(practiceScenarios) as PracticeTask[]).map(task => <button key={task} type="button" aria-pressed={state.task === task} onClick={() => start(task)} className="rounded-lg border px-4 py-3 capitalize aria-pressed:bg-slate-900 aria-pressed:text-white">{task}</button>)}</nav>
    <button type="button" className="rounded border px-4 py-3" onClick={() => setDesk(value => !value)}>{desk ? "Return to guided exercises" : "Open sample operations desk"}</button>
    {desk ? <PracticeTransactions /> : <form className="space-y-4 rounded-xl border bg-white p-5" onSubmit={event => { event.preventDefault(); setState(current => checkPracticeAnswer(current, answer)); }}>
      <h2 className="text-xl font-semibold">{scenario.title}</h2><p>{scenario.question}</p>
      <label className="block">Sample answer ({scenario.unit})<input className="mt-2 block w-full rounded-lg border p-3" type="number" inputMode="decimal" min="0" step="any" value={answer} onChange={event => setAnswer(event.target.value)} disabled={state.completed} required /></label>
      <div className="flex flex-wrap gap-3"><button className="rounded-lg bg-slate-900 px-4 py-3 text-white disabled:opacity-50" disabled={state.completed} type="submit">Check sample answer</button><button className="rounded-lg border px-4 py-3" type="button" onClick={() => start(state.task)}>Reset practice task</button></div>
      <p aria-live="polite" className="min-h-6">{state.completed ? "Sample task completed. " : ""}{state.feedback}</p><p className="text-sm text-slate-500">Reviewed attempts: {state.attempts}</p>
    </form>}
  </div>;
}
