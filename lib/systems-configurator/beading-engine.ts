import type { BeadingCut, ConfiguratorWarning, GlassCut, SystemConfigurationInput } from "./types.ts";
import { round } from "./types.ts";

export function generateBeadingCuts(input: SystemConfigurationInput, glassCuts: GlassCut[], warnings: ConfiguratorWarning[]) {
  const verticalBead = input.selectedProfiles.find((profile) => profile.componentRole === "glazing_bead_vertical");
  const horizontalBead = input.selectedProfiles.find((profile) => profile.componentRole === "glazing_bead_horizontal") ?? verticalBead;
  const beadingCuts: BeadingCut[] = [];

  if (glassCuts.length && (!verticalBead || !horizontalBead)) {
    warnings.push({ code: "missing_beading_profile", message: "Glass exists but vertical/horizontal beading profiles are incomplete.", severity: "warning" });
  }

  for (const glass of glassCuts) {
    if (verticalBead) {
      for (const position of ["left", "right"] as const) {
        const totalLengthM = round((glass.heightMm * glass.quantity) / 1000);
        beadingCuts.push({ profileId: verticalBead.profileId, profileCode: verticalBead.profileCode, profileName: verticalBead.profileName, panelIndex: glass.panelIndex, beadPosition: position, cutLengthMm: glass.heightMm, quantity: glass.quantity, totalLengthM, sectionWeightKgPerM: verticalBead.sectionWeightKgPerM, totalWeightKg: round(totalLengthM * verticalBead.sectionWeightKgPerM) });
      }
    }
    if (horizontalBead) {
      for (const position of ["top", "bottom"] as const) {
        const totalLengthM = round((glass.widthMm * glass.quantity) / 1000);
        beadingCuts.push({ profileId: horizontalBead.profileId, profileCode: horizontalBead.profileCode, profileName: horizontalBead.profileName, panelIndex: glass.panelIndex, beadPosition: position, cutLengthMm: glass.widthMm, quantity: glass.quantity, totalLengthM, sectionWeightKgPerM: horizontalBead.sectionWeightKgPerM, totalWeightKg: round(totalLengthM * horizontalBead.sectionWeightKgPerM) });
      }
    }
  }

  return beadingCuts;
}
