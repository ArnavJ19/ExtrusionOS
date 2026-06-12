import type { SystemTemplate } from "./types.ts";

export const twoTrackSlidingWindowTemplate: SystemTemplate = {
  templateCode: "2T-SLIDING-WINDOW-V1",
  templateName: "2 Track Aluminium Sliding Window",
  systemType: "two_track_sliding_window",
  formulaVersion: 1,
  requiredComponents: [
    "outer_frame_top",
    "outer_frame_bottom",
    "outer_frame_left",
    "outer_frame_right",
    "shutter_vertical",
    "shutter_horizontal_top",
    "shutter_horizontal_bottom",
    "interlock",
    "glazing_bead_vertical",
    "glazing_bead_horizontal"
  ],
  profileRules: [
    { componentRole: "outer_frame_top", quantityFormula: "1 * Q", lengthFormula: "W" },
    { componentRole: "outer_frame_bottom", quantityFormula: "1 * Q", lengthFormula: "W" },
    { componentRole: "outer_frame_left", quantityFormula: "1 * Q", lengthFormula: "H" },
    { componentRole: "outer_frame_right", quantityFormula: "1 * Q", lengthFormula: "H" },
    { componentRole: "shutter_vertical", quantityFormula: "2 * shutter_count * Q", lengthFormula: "shutter_height" },
    { componentRole: "shutter_horizontal_top", quantityFormula: "shutter_count * Q", lengthFormula: "shutter_width" },
    { componentRole: "shutter_horizontal_bottom", quantityFormula: "shutter_count * Q", lengthFormula: "shutter_width" },
    { componentRole: "interlock", quantityFormula: "1 * Q", lengthFormula: "shutter_height" }
  ],
  glassRules: {
    widthFormula: "glass_width",
    heightFormula: "glass_height",
    quantityFormula: "Q",
    labelPrefix: "Sliding Glass"
  },
  hardwareRules: {
    roller: { quantityFormula: "2 * shutter_count * Q", remarks: "2 rollers per shutter" },
    lock: { quantityFormula: "1 * Q", remarks: "1 lock per window" },
    handle: { quantityFormula: "1 * Q", remarks: "1 handle per window" },
    wool_pile: { quantityFormula: "((shutter_width + shutter_height) * 2 * shutter_count * Q) / 1000", remarks: "Shutter perimeter in meters" },
    gasket: { quantityFormula: "((glass_width + glass_height) * 2 * shutter_count * Q) / 1000", remarks: "Glass perimeter in meters" },
    screw: { quantityFormula: "screws_per_window * Q", remarks: "Configurable screws per window" }
  }
};
