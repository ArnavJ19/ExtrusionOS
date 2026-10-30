import { createCommercialFixture, cid } from './commercial-upgrade-fixture.mjs';
import { configurationReleaseExample } from './configuration-release-example.mjs';

const fixtureIds = {
  series: cid(6100),
  template: cid(6101),
  glass: cid(6102),
  finish: cid(6103),
  hardware: cid(6104),
  project: cid(6105),
  rejectedProject: cid(6106),
  order: cid(6110),
  snapshotRequest: cid(6120),
  approvalRequest: cid(6121)
};

const formula = {
  requiredComponents: ['outer_frame_top'],
  profileRules: [
    { componentRole: 'outer_frame_top', quantityFormula: 'Q', lengthFormula: 'W' }
  ],
  glassRules: { widthFormula: 'W - 60', heightFormula: 'H - 60' },
  beadingRules: { version: 1, method: 'all_four_edges' },
  hardwareRules: [{ category: 'handle', itemCode: 'HANDLE-1', quantityFormula: 'Q' }],
  wastageRules: {},
  costingRules: {}
};

export async function createConfigurationReleaseFixture() {
  const base = await createCommercialFixture();
  const { db, ids } = base;
  await db.query("insert into system_series(id,company_id,series_code,series_name,system_type,stock_length_mm,wastage_percent_default,is_active) values($1,$2,'REL-2T','Release test series','two_track_sliding_window',6000,5,true)", [fixtureIds.series, ids.company]);
  await db.query("insert into system_templates(id,company_id,series_id,template_code,template_name,system_type,formula_version,formula_json,validation_rules_json,preview_config_json,is_active) values($1,$2,$3,'REL-2T-T','Release test template','two_track_sliding_window',1,$4,'{}','{}',true)", [fixtureIds.template, ids.company, fixtureIds.series, formula]);
  await db.query("insert into system_profiles(company_id,series_id,profile_id,component_role,display_name,is_required,default_quantity_formula,default_length_formula,applies_to_system_types,sort_order) values($1,$2,$3,'outer_frame_top','Top frame',true,'1 * Q','W',array['two_track_sliding_window'],1),($1,$2,$3,'glazing_bead_vertical','Vertical bead',false,'2 * Q','H',array['two_track_sliding_window'],2),($1,$2,$3,'glazing_bead_horizontal','Horizontal bead',false,'2 * Q','W',array['two_track_sliding_window'],3)", [ids.company, fixtureIds.series, ids.profile]);
  await db.query("insert into hardware_items(company_id,item_code,item_name,hardware_category,unit,default_rate,is_active) values($1,'HANDLE-1','Release handle','handle','pcs',125,true)", [ids.company]);
  await db.query("insert into glass_items(id,company_id,glass_code,glass_name,glass_type,thickness_mm,rate_per_sqft,rate_per_sqm,is_active) values($1,$2,'GL-CLR','Clear release glass','clear',5,120,1291.67,true)", [fixtureIds.glass, ids.company]);
  await db.query("insert into finish_options(id,company_id,finish_code,finish_name,finish_type,rate_type,rate,is_active) values($1,$2,'MF-1','Mill finish','mill_finish','per_kg',30,true)", [fixtureIds.finish, ids.company]);

  async function createProject(projectId = fixtureIds.project, { status = 'draft', customerId = ids.customer } = {}) {
    await db.query("insert into system_configurations(id,company_id,created_by,project_name,customer_id,series_id,template_id,system_type,design_reference,width_mm,height_mm,quantity,no_of_panels,measurement_type,view_direction,panel_layout_json,options_json,finish_id,glass_id,status,subtotal,gst_percent,gst_amount,grand_total,internal_cost,selling_price,margin_percent) values($1,$2,$3,'Release project',$4,$5,$6,'two_track_sliding_window','R-01',1000,1000,1,1,'frame_outer_size','inside_view',$7,$8,$9,$10,$11,1000,18,180,1180,500,1180,15)", [
      projectId, ids.company, ids.owner, customerId, fixtureIds.series, fixtureIds.template,
      { panels: [{ index: 1, type: 'fixed', function: 'glass', widthRatio: 1, heightRatio: 1 }] },
      { aluminium_rate_per_kg: 280, fabrication_labor_rate: 85, installation_rate: 45, transport_amount: 50, wastage_percent: 5, margin_percent: 15, gst_percent: 18 },
      fixtureIds.finish, fixtureIds.glass, status
    ]);
    return projectId;
  }

  async function addSavedOutputs(projectId = fixtureIds.project) {
    const hardwareId = (await db.query("select id from hardware_items where company_id=$1 and item_code='HANDLE-1'", [ids.company])).rows[0].id;
    const {result}=configurationReleaseExample();
    const rows={
      system_profile_cuts:result.profileCuts.map((x,i)=>({profile_id:ids.profile,component_role:x.componentRole,profile_code:x.profileCode,profile_name:x.profileName,cut_length_mm:x.cutLengthMm,quantity:x.quantity,total_length_m:x.totalLengthM,section_weight_kg_per_m:x.sectionWeightKgPerM,total_weight_kg:x.totalWeightKg,angle_left:x.angleLeft,angle_right:x.angleRight,deduction_mm:x.deductionMm,addition_mm:x.additionMm,stock_length_mm:x.stockLengthMm,wastage_percent:x.wastagePercent,sort_order:i})),
      system_glass_cuts:result.glassCuts.map(x=>({glass_id:fixtureIds.glass,panel_index:x.panelIndex,glass_label:x.glassLabel,width_mm:x.widthMm,height_mm:x.heightMm,quantity:x.quantity,area_sqft:x.areaSqft,area_sqm:x.areaSqm,glass_type:x.glassType,thickness_mm:x.thicknessMm,rate:x.rate,amount:x.amount,deduction_width_mm:x.deductionWidthMm,deduction_height_mm:x.deductionHeightMm})),
      system_beading_cuts:result.beadingCuts.map(x=>({profile_id:ids.profile,panel_index:x.panelIndex,bead_position:x.beadPosition,cut_length_mm:x.cutLengthMm,quantity:x.quantity,total_length_m:x.totalLengthM})),
      system_hardware_bom:result.hardwareBom.map(x=>({hardware_item_id:hardwareId,item_code:x.itemCode,item_name:x.itemName,hardware_category:x.hardwareCategory,quantity:x.quantity,unit:x.unit,rate:x.rate,amount:x.amount})),
      system_material_summary:result.materialSummary.map(x=>({material_type:x.materialType,item_id:x.materialType==='hardware'?hardwareId:x.itemId??null,item_code:x.itemCode??null,item_name:x.itemName,quantity:x.quantity,unit:x.unit,total_weight_kg:x.totalWeightKg,total_length_m:x.totalLengthM,total_area_sqft:x.totalAreaSqft,total_area_sqm:x.totalAreaSqm,rate:x.rate,amount:x.amount}))
    };
    const updatedAt=(await db.query('select updated_at from system_configurations where id=$1',[projectId])).rows[0].updated_at;
    const c=result.costingSummary;
    await db.query('select save_system_configuration_atomic($1,$2,$3,$4,$5)',[projectId,'calculation',updatedAt,
      {status:'calculated',subtotal:c.subtotalBeforeGst,gst_amount:c.gstAmount,grand_total:c.grandTotal,internal_cost:c.internalCost,selling_price:c.grandTotal,margin_percent:15,gst_percent:18},rows]);
  }

  async function capture(projectId = fixtureIds.project) {
    return base.command('configuration_release_command', 'source.capture', { configuration_id: projectId });
  }

  async function saveReadySnapshot(projectId = fixtureIds.project, requestId = fixtureIds.snapshotRequest) {
    const source = await capture(projectId);
    const rows = (await db.query('select private.configuration_release_saved_rows($1,$2) data', [projectId, ids.company])).rows[0].data;
    const outputSnapshot = {
      persisted_rows: rows,
      engine_result: configurationReleaseExample().result,
      reconciliation: configurationReleaseExample().assessment.reconciliation,
      configuration_totals: (await db.query('select subtotal::float8,gst_amount::float8,grand_total::float8,internal_cost::float8,selling_price::float8,margin_percent::float8,gst_percent::float8 from system_configurations where id=$1',[projectId])).rows[0],
      readiness: 'ready',
      unresolved_reasons: [],
      estimated_fields: []
    };
    const expectedOutputRevision = source.output_revision;
    const saved = await base.command('configuration_release_command', 'snapshot.create', {
      configuration_id: projectId,
      request_id: requestId,
      expected_input_fingerprint: source.input_fingerprint,
      expected_rules_fingerprint: source.rules_fingerprint,
      expected_rules_revision: source.rules_revision,
      expected_output_revision: expectedOutputRevision,
      readiness: 'ready',
      unresolved_reasons: [],
      estimated_fields: [],
      output_snapshot: outputSnapshot
    });
    return { source, outputSnapshot, saved };
  }

  return {
    ...base,
    fixtureIds,
    formula,
    createProject,
    addSavedOutputs,
    capture,
    saveReadySnapshot,
    release: (command, payload) => base.command('configuration_release_command', command, payload)
  };
}
