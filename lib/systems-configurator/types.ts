export type SystemType =
  | "two_track_sliding_window"
  | "three_track_sliding_window"
  | "sliding_door"
  | "casement_window"
  | "fixed_window"
  | "top_hung_window"
  | "hinged_door"
  | "swing_door"
  | "partition"
  | "ventilator"
  | "combination"
  | "custom";

export type ComponentRole =
  | "outer_frame_top"
  | "outer_frame_bottom"
  | "outer_frame_left"
  | "outer_frame_right"
  | "frame_jamb"
  | "frame_head"
  | "sill"
  | "threshold"
  | "shutter_vertical"
  | "shutter_horizontal_top"
  | "shutter_horizontal_bottom"
  | "sash_vertical"
  | "sash_horizontal"
  | "interlock"
  | "meeting_stile"
  | "lock_stile"
  | "mullion"
  | "transom"
  | "coupler"
  | "add_on"
  | "adapter"
  | "reinforcement"
  | "support_profile"
  | "glazing_bead_vertical"
  | "glazing_bead_horizontal"
  | "mesh_frame_vertical"
  | "mesh_frame_horizontal"
  | "corner_profile"
  | "track_profile"
  | "cover_profile"
  | "custom";

export type HardwareCategory =
  | "lock"
  | "handle"
  | "roller"
  | "hinge"
  | "stay_arm"
  | "tower_bolt"
  | "fastener"
  | "screw"
  | "gasket"
  | "wool_pile"
  | "weather_strip"
  | "silicone"
  | "drainage_cap"
  | "corner_cleat"
  | "connector"
  | "accessory"
  | "other";

export type MessageSeverity = "info" | "warning" | "error";
export type WarningSeverity = MessageSeverity;

export type EngineMessage = {
  code: string;
  message: string;
  severity: MessageSeverity;
  field?: string;
};

export type ConfiguratorWarning = EngineMessage;

export type PanelLayoutPanel = {
  index: number;
  type: "fixed" | "sliding" | "casement" | "top_hung" | "mesh" | "door_leaf" | "dummy" | "custom";
  function: "glass" | "mesh" | "solid" | "louver" | "dummy" | "custom";
  widthRatio: number;
  heightRatio: number;
  openingDirection?: "left" | "right" | "top" | "bottom" | "sliding_left" | "sliding_right" | "fixed" | "custom";
};

export type PanelLayout = {
  panels: PanelLayoutPanel[];
  mullions?: Array<{ index: number; xRatio: number }>;
  transoms?: Array<{ index: number; yRatio: number }>;
  mesh?: { enabled: boolean; panelIndex?: number; panelCount?: number };
};

export type SystemProfileSelection = {
  id?: string;
  profileId?: string;
  profileCode: string;
  profileName: string;
  componentRole: ComponentRole;
  sectionWeightKgPerM: number;
  stockLengthMm: number;
  deductionMm?: number;
  additionMm?: number;
  quantityFormula?: string;
  lengthFormula?: string;
  isRequired?: boolean;
};

export type SystemHardwareSelection = {
  id?: string;
  itemCode: string;
  itemName: string;
  category: HardwareCategory;
  unit: string;
  rate: number;
  quantityFormula?: string;
};

export type SystemGlassSelection = {
  id?: string;
  glassCode: string;
  glassName: string;
  glassType: string;
  thicknessMm: number;
  ratePerSqft: number;
  ratePerSqm: number;
};

export type SystemFinishSelection = {
  id?: string;
  finishCode: string;
  finishName: string;
  finishType: string;
  rateType: "per_kg" | "per_sqft" | "per_sqm" | "per_meter" | "fixed";
  rate: number;
};

export type FormulaVariables = Record<string, number>;

export type FormulaComponentRule = {
  componentRole: ComponentRole;
  profileCode?: string;
  quantityFormula: string;
  lengthFormula: string;
  deductionMm?: number;
  additionMm?: number;
  angleLeft?: "45" | "90" | "custom";
  angleRight?: "45" | "90" | "custom";
  remarks?: string;
};

export type HardwareRule = {
  category: HardwareCategory;
  itemCode?: string;
  quantityFormula: string;
  remarks?: string;
};

export type GlassRule = {
  widthFormula: string;
  heightFormula: string;
  quantityFormula?: string;
  labelPrefix?: string;
  remarks?: string;
};

export type SystemTemplate = {
  id?: string;
  templateCode: string;
  templateName: string;
  systemType: SystemType;
  formulaVersion: number;
  requiredComponents: ComponentRole[];
  profileRules: FormulaComponentRule[];
  glassRules?: Record<string, string | number | boolean> | GlassRule;
  beadingRules?: Record<string, string | number | boolean>;
  hardwareRules?: Record<string, string | number | boolean | Record<string, string | number | boolean>> | HardwareRule[];
  wastageRules?: Record<string, string | number | boolean>;
  validationRules?: Record<string, string | number | boolean>;
};

export type CompanySystemSettings = {
  stockLengthMm: number;
  sawKerfMm: number;
  minimumReusableLeftoverMm: number;
  defaultWastagePercent: number;
};

export type CostingSettingsInput = {
  aluminiumRatePerKg: number;
  fabricationLaborRate: number;
  installationRate: number;
  transportAmount: number;
  wastagePercent: number;
  marginPercent: number;
  gstPercent: number;
  discountAmount: number;
};

export type SystemConfigurationInput = {
  widthMm: number;
  heightMm: number;
  quantity: number;
  systemType: SystemType;
  seriesId?: string;
  template: SystemTemplate;
  panelLayout: PanelLayout;
  selectedProfiles: SystemProfileSelection[];
  selectedHardware: SystemHardwareSelection[];
  selectedGlass?: SystemGlassSelection;
  selectedFinish?: SystemFinishSelection;
  companySettings: CompanySystemSettings;
  costing: CostingSettingsInput;
  options?: Record<string, number | string | boolean | null>;
};

export type ProfileCut = {
  profileId?: string;
  componentRole: ComponentRole;
  profileCode: string;
  profileName: string;
  cutLengthMm: number;
  quantity: number;
  totalLengthM: number;
  sectionWeightKgPerM: number;
  totalWeightKg: number;
  angleLeft: "45" | "90" | "custom";
  angleRight: "45" | "90" | "custom";
  deductionMm: number;
  additionMm: number;
  stockLengthMm: number;
  wastagePercent: number;
  remarks?: string;
  explanation?: CalculationExplanation;
};

export type GlassCut = {
  glassId?: string;
  panelIndex: number;
  glassLabel: string;
  widthMm: number;
  heightMm: number;
  quantity: number;
  areaSqft: number;
  areaSqm: number;
  glassType?: string;
  thicknessMm?: number;
  rate: number;
  amount: number;
  deductionWidthMm: number;
  deductionHeightMm: number;
  remarks?: string;
  explanation?: CalculationExplanation;
};

export type BeadingCut = {
  profileId?: string;
  profileCode?: string;
  profileName?: string;
  panelIndex: number;
  beadPosition: "top" | "bottom" | "left" | "right";
  cutLengthMm: number;
  quantity: number;
  totalLengthM: number;
  sectionWeightKgPerM: number;
  totalWeightKg: number;
  remarks?: string;
};

export type HardwareBomItem = {
  hardwareItemId?: string;
  itemCode: string;
  itemName: string;
  hardwareCategory: HardwareCategory;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  remarks?: string;
  explanation?: CalculationExplanation;
};

export type CalculationExplanation = {
  quantityFormula?: string;
  lengthFormula?: string;
  widthFormula?: string;
  heightFormula?: string;
  variables?: Record<string, number>;
  rawLengthMm?: number;
  deductionMm?: number;
  additionMm?: number;
  resultMm?: number;
  resultQuantity?: number;
  note?: string;
};

export type MaterialSummary = {
  materialType: "aluminium_profile" | "glass" | "hardware" | "gasket" | "mesh" | "finish" | "labor" | "installation" | "packing" | "transport" | "other";
  itemId?: string;
  itemCode?: string;
  itemName: string;
  quantity: number;
  unit: string;
  totalWeightKg: number;
  totalLengthM: number;
  totalAreaSqft: number;
  totalAreaSqm: number;
  rate: number;
  amount: number;
};

export type CostingSummary = {
  aluminiumCost: number;
  finishCost: number;
  glassCost: number;
  hardwareCost: number;
  gasketCost: number;
  fabricationCost: number;
  installationCost: number;
  transportCost: number;
  wastageAmount: number;
  internalCost: number;
  marginAmount: number;
  discountAmount: number;
  subtotalBeforeGst: number;
  gstAmount: number;
  grandTotal: number;
  pricePerSqft: number;
  pricePerSqm: number;
  pricePerUnit: number;
  profitPercent: number;
};

export type OptimizationSummary = {
  stockLengthMm: number;
  sawKerfMm: number;
  minimumReusableLeftoverMm: number;
  totalStockBars: number;
  totalUsedLengthMm: number;
  totalWasteMm: number;
  wastePercent: number;
  warnings: string[];
  profiles?: unknown[];
};

export type ConfiguratorResult = {
  profileCuts: ProfileCut[];
  glassCuts: GlassCut[];
  beadingCuts: BeadingCut[];
  hardwareBom: HardwareBomItem[];
  materialSummary: MaterialSummary[];
  costingSummary: CostingSummary;
  optimizationSummary: OptimizationSummary;
  warnings: ConfiguratorWarning[];
  errors: EngineMessage[];
};

export function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function optionNumber(input: SystemConfigurationInput, key: string, fallback: number) {
  const value = input.options?.[key];
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  return Number.isFinite(number) ? number : fallback;
}
