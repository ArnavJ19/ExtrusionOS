import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPracticeAnswer, initialPracticeState, practiceScenarios } from '../lib/training/practice.ts';

test('60: quotation, inspection and partial dispatch sample tasks use reconciled quantities', () => {
  for (const [task, scenario] of Object.entries(practiceScenarios)) {
    const original = initialPracticeState(task);
    const wrong = checkPracticeAnswer(original, '1');
    assert.equal(wrong.completed, false);
    assert.equal(wrong.attempts, 1);
    const completed = checkPracticeAnswer(wrong, String(scenario.answer));
    assert.equal(completed.completed, true);
    assert.equal(completed.attempts, 2);
    assert.equal(original.attempts, 0);
    assert.equal(checkPracticeAnswer(completed, '1'), completed);
    assert.deepEqual(initialPracticeState(task), original);
  }
});
test('60: missing, negative and nonfinite observations cannot complete a sample task', () => {
  for (const raw of ['', ' ', '-1', 'Infinity', 'NaN', '1e309']) {
    const result = checkPracticeAnswer(initialPracticeState('dispatch'), raw);
    assert.equal(result.completed, false);
    assert.equal(result.attempts, 0);
  }
});
