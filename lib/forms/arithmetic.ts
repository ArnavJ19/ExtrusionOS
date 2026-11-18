// AP-088: arithmetic inside numeric fields. A person types "=12*6.4" or "250+180" and the field keeps the result; the
// expression is shown as a hint only. This is a small recursive-descent parser for numbers, + - * / and brackets.
// Nothing is ever evaluated as code.

export type ArithmeticResult =
  | { ok: true; value: number; expression: string }
  | { ok: false; error: string };

const MAX_LENGTH = 80;
const MAX_DEPTH = 12;

/** True when the text is more than a plain number: it starts with "=" or contains an operator between operands. */
export function looksLikeArithmetic(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("=")) return true;
  // A leading sign alone ("-5") is a number, not arithmetic.
  // An operator after an operand makes it arithmetic even when unfinished ("12*"), so a half-typed calculation is
  // reported rather than kept as if it were a number.
  return /[0-9.)]\s*[+\-*/x×÷]/i.test(t) || /[()]/.test(t);
}

/** Characters a numeric field may hold while an expression is being typed. */
export function cleanArithmeticInput(text: string): string {
  return text.replace(/[^0-9.+\-*/()=x×÷\s]/gi, "").slice(0, MAX_LENGTH);
}

/**
 * Evaluates numbers with + - * / and brackets. Returns an error (never NaN or Infinity) for anything else:
 * letters, empty brackets, division by zero, a result that is not finite.
 */
export function evaluateArithmetic(input: string): ArithmeticResult {
  const raw = input.trim().replace(/^=/, "").trim();
  if (!raw) return { ok: false, error: "Enter a calculation" };
  if (raw.length > MAX_LENGTH) return { ok: false, error: "The calculation is too long" };
  // "x", "×" and "÷" are what people type on a phone; commas are thousands separators only between digits.
  const text = raw.replace(/[x×]/gi, "*").replace(/÷/g, "/").replace(/(\d),(?=\d{3}\b)/g, "$1");
  if (!/^[0-9.+\-*/()\s]+$/.test(text)) return { ok: false, error: "Use numbers with + - * / only" };
  let at = 0;
  const peek = () => { while (at < text.length && /\s/.test(text[at])) at++; return text[at]; };
  const fail = (error: string): never => { throw new Error(error); };

  function number(): number {
    peek();
    const match = /^(\d+(\.\d*)?|\.\d+)/.exec(text.slice(at));
    if (!match) return fail("Check the calculation");
    at += match[0].length;
    return Number(match[0]);
  }
  function factor(depth: number): number {
    if (depth > MAX_DEPTH) return fail("Too many brackets");
    const c = peek();
    if (c === "-") { at++; return -factor(depth + 1); }
    if (c === "+") { at++; return factor(depth + 1); }
    if (c === "(") {
      at++;
      const value = expression(depth + 1);
      if (peek() !== ")") return fail("A bracket is not closed");
      at++;
      return value;
    }
    return number();
  }
  function term(depth: number): number {
    let value = factor(depth);
    for (;;) {
      const c = peek();
      if (c === "*") { at++; value *= factor(depth); }
      else if (c === "/") {
        at++;
        const divisor = factor(depth);
        if (divisor === 0) return fail("Cannot divide by zero");
        value /= divisor;
      } else return value;
    }
  }
  function expression(depth: number): number {
    let value = term(depth);
    for (;;) {
      const c = peek();
      if (c === "+") { at++; value += term(depth); }
      else if (c === "-") { at++; value -= term(depth); }
      else return value;
    }
  }

  try {
    const value = expression(0);
    if (peek() !== undefined) return { ok: false, error: "Check the calculation" };
    if (!Number.isFinite(value) || Math.abs(value) > 1e12) return { ok: false, error: "The result is too large" };
    return { ok: true, value, expression: raw };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Check the calculation" };
  }
}

/** The result as field text: rounded to the field's decimals, without trailing zeros. */
export function formatArithmeticResult(value: number, maxDecimals = 3): string {
  const factor = 10 ** maxDecimals;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * What a field does when focus leaves it: a plain number is left alone; an expression becomes its result with the
 * expression kept as a hint; a broken expression is left as typed with the reason.
 */
export function resolveNumericEntry(text: string, options: { decimal?: boolean; maxDecimals?: number; allowNegative?: boolean } = {}):
  { value: string; hint: string | null; error: string | null } {
  const { decimal = true, maxDecimals = 3, allowNegative = false } = options;
  if (!looksLikeArithmetic(text)) return { value: text, hint: null, error: null };
  const result = evaluateArithmetic(text);
  if (!result.ok) return { value: text, hint: null, error: result.error };
  if (result.value < 0 && !allowNegative) return { value: text, hint: null, error: "The result is below zero" };
  const value = formatArithmeticResult(result.value, decimal ? maxDecimals : 0);
  if (!decimal && !Number.isInteger(result.value)) return { value, hint: `= ${result.expression} (rounded to a whole number)`, error: null };
  return { value, hint: `= ${result.expression}`, error: null };
}
