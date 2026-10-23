import { mortality90V1 } from "./land-economy-wide";
import type { VillageFixture } from "./autonomous-village";
/** Connection experiment only. Physical configuration is identical to the retained baseline. */
export const hierarchyV25: VillageFixture = {
  ...structuredClone(mortality90V1),
  hierarchyModel: { compositionVersion: "travel-body-prototype@1" },
};
/** Preserve the original 24h connection fixture for reproducible comparisons. */
export const hierarchyRecoveryV25: VillageFixture = {
  ...structuredClone(hierarchyV25),
  hierarchyModel: { compositionVersion: "travel-body-recovery@2" },
};
