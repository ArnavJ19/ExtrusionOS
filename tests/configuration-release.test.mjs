import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationReleaseExample} from '../scripts/lib/configuration-release-example.mjs';
import {assessConfigurationRelease,configurationReleaseActionInputSchema,configurationReleaseResultSchema} from '../lib/workflow/configuration-release.ts';

test('100: explicit versioned rules reconcile profile, glass, BOM, material, costing and stock waste outputs',()=>{
  const f=configurationReleaseExample();
  assert.equal(f.result.errors.length,0);
  assert.equal(f.assessment.readiness,'ready',JSON.stringify(f.assessment));
  assert.ok(f.assessment.reconciliation.checks.length>10);
  assert.ok(f.assessment.reconciliation.checks.every(x=>x.status==='pass'));
  assert.ok(f.result.profileCuts[0].explanation);
  assert.equal(f.result.glassCuts[0].widthMm,940);
  assert.equal(f.result.hardwareBom[0].quantity,1);
});

test('100: missing rules, incompatible profiles, unsafe dimensions and unreconciled material cannot be fabrication-ready',()=>{
  for(const mutate of [
    f=>{f.template.formula_json.profileRules=[];},
    f=>{f.template.formula_json.beadingRules={};},
    f=>{f.systemProfiles[0].applies_to_system_types=['casement_window'];},
    f=>{f.configuration.width_mm=Infinity;},
    f=>{f.result.materialSummary.find(x=>x.materialType==='aluminium_profile').totalWeightKg+=2;},
    f=>{f.result.glassCuts[0].amount+=10;},
    f=>{f.result.optimizationSummary.totalWasteMm+=10000;}
  ]){const f=configurationReleaseExample();mutate(f);const a=assessConfigurationRelease(f);assert.equal(a.readiness,'blocked');assert.ok(a.unresolvedReasons.length);}
});

test('100: absent observed rates stay estimated and command schemas reject client scope and malformed fingerprints',()=>{
  const f=configurationReleaseExample();delete f.configuration.options_json.aluminium_rate_per_kg;
  assert.equal(assessConfigurationRelease(f).readiness,'estimated');
  const request={command:'release.approve',payload:{snapshot_id:f.configuration.id,output_fingerprint:'a'.repeat(64),request_id:f.configuration.customer_id,note:'Reviewed'}};
  assert.equal(configurationReleaseActionInputSchema.safeParse(request).success,true);
  assert.equal(configurationReleaseActionInputSchema.safeParse({...request,payload:{...request.payload,company_id:f.configuration.company_id}}).success,false);
  assert.equal(configurationReleaseActionInputSchema.safeParse({...request,payload:{...request.payload,output_fingerprint:'bad'}}).success,false);
  assert.equal(configurationReleaseResultSchema.safeParse({kind:'release_state',configuration_id:f.configuration.id,status:'not_calculated',
    current_rules_revision:0,current_output_revision:0,latest:null,unresolved_reasons:[]}).success,true);
});
