import { mortality90V1 } from "./land-economy-wide";
import type { VillageFixture } from "./autonomous-village";
/** Connection experiment only. Physical configuration is identical to the retained baseline. */
export const hierarchyV25: VillageFixture = {
  ...structuredClone(mortality90V1),
  hierarchyModel: { compositionVersion: "travel-body-prototype@1" },
};
