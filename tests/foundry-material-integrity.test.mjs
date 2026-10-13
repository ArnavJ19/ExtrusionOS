import { describe, it } from 'node:test';
import { runFoundryMaterialIntegrityChecks } from '../scripts/test-foundry-material-integrity.mjs';

describe('foundry material integrity SQL migration', () => {
  it('applies the complete migration and accepts only coherent source, batch, and billet changes', async () => {
    const checks = await runFoundryMaterialIntegrityChecks();
    if (!checks.some((check) => check.startsWith('read-only preflight SQL executes'))) {
      throw new Error('The read-only foundry material preflight SQL is missing');
    }
  });
});
