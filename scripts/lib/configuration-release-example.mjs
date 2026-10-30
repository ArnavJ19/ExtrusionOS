import { calculateSystemConfiguration } from '../../lib/systems-configurator/formula-engine.ts';
import { assessConfigurationRelease } from '../../lib/workflow/configuration-release.ts';

export function configurationReleaseExample() {
  const uuid = n => `bc000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const formula = {
    requiredComponents: ['outer_frame_top'],
    profileRules: [{componentRole:'outer_frame_top',quantityFormula:'Q',lengthFormula:'W'}],
    glassRules: {widthFormula:'W - 60',heightFormula:'H - 60'},
    beadingRules: {version:1,method:'all_four_edges'},
    hardwareRules: [{category:'handle',itemCode:'HANDLE-1',quantityFormula:'Q'}]
  };
  const configuration = {id:uuid(6105),company_id:uuid(1),customer_id:uuid(20),series_id:uuid(6100),template_id:uuid(6101),
    system_type:'two_track_sliding_window',width_mm:1000,height_mm:1000,quantity:1,no_of_panels:1,
    panel_layout_json:{panels:[{index:1,type:'fixed',function:'glass',widthRatio:1,heightRatio:1}]},
    glass_id:uuid(6102),finish_id:uuid(6103),options_json:{aluminium_rate_per_kg:280,fabrication_labor_rate:85,
      installation_rate:45,transport_amount:50,wastage_percent:5,margin_percent:15,gst_percent:18}};
  const systemProfiles = ['outer_frame_top','glazing_bead_vertical','glazing_bead_horizontal'].map((role,i)=>({
    id:uuid(6200+i),profile_id:uuid(30),component_role:role,is_active:true,applies_to_system_types:['two_track_sliding_window'],
    aluminium_profiles:{profile_code:'AL-COMM',profile_name:'Commercial section',section_weight_kg_per_m:0.8,is_active:true}}));
  const series={id:configuration.series_id,is_active:true,stock_length_mm:6000,wastage_percent_default:5};
  const template={id:configuration.template_id,system_type:configuration.system_type,formula_version:1,is_active:true,formula_json:formula};
  const hardwareItems=[{id:uuid(6104),item_code:'HANDLE-1',item_name:'Release handle',hardware_category:'handle',unit:'pcs',default_rate:125,is_active:true}];
  const glassItem={id:configuration.glass_id,is_active:true,rate_per_sqft:120,rate_per_sqm:1291.67};
  const finishOption={id:configuration.finish_id,is_active:true,rate:30};
  const result=calculateSystemConfiguration({widthMm:1000,heightMm:1000,quantity:1,systemType:configuration.system_type,
    template:{templateCode:'REL-2T',templateName:'Release example',systemType:configuration.system_type,formulaVersion:1,...formula},
    panelLayout:configuration.panel_layout_json,
    selectedProfiles:systemProfiles.map(p=>({id:p.id,profileId:p.profile_id,profileCode:p.aluminium_profiles.profile_code,
      profileName:p.aluminium_profiles.profile_name,componentRole:p.component_role,sectionWeightKgPerM:0.8,stockLengthMm:6000})),
    selectedHardware:[{id:hardwareItems[0].id,itemCode:'HANDLE-1',itemName:'Release handle',category:'handle',unit:'pcs',rate:125}],
    selectedGlass:{id:glassItem.id,glassCode:'GL-CLR',glassName:'Clear',glassType:'clear',thicknessMm:5,ratePerSqft:120,ratePerSqm:1291.67},
    selectedFinish:{id:finishOption.id,finishCode:'MF-1',finishName:'Mill finish',finishType:'mill_finish',rateType:'per_kg',rate:30},
    companySettings:{stockLengthMm:6000,sawKerfMm:3,minimumReusableLeftoverMm:300,defaultWastagePercent:5},
    costing:{aluminiumRatePerKg:280,fabricationLaborRate:85,installationRate:45,transportAmount:50,wastagePercent:5,marginPercent:15,gstPercent:18,discountAmount:0},
    options:configuration.options_json});
  const input={configuration,series,template,systemProfiles,hardwareItems,glassItem,finishOption,companySettings:{},result};
  return {...input,assessment:assessConfigurationRelease(input)};
}
