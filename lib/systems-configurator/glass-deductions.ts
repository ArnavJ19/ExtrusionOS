import { optionNumber, type SystemConfigurationInput } from "./types.ts";

export function glassDeductions(input: SystemConfigurationInput) {
  return {
    width: optionNumber(input, "glass_deduction_width_mm", optionNumber(input, "glass_deduction_width", 90)),
    height: optionNumber(input, "glass_deduction_height_mm", optionNumber(input, "glass_deduction_height", 90)),
  };
}
