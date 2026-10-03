import type { ActorInput, ActorResponse, PersonalityModel } from "./personality";

export type VillageId = "S" | "F" | "C" | "B1" | "B2";
export type VillageRole = "merchant" | "farmer" | "carrier" | "woodcutter";
export type TravelExecution = { phase: "started" | "completed" | "failed" | "redirected" | "rejected" | "superseded";
  predictionId?: string; processId?: string; attemptEventId: string; destinationId: string;
  startedAt?: number; elapsedHours?: number };
export type VillageStimulus = { id: string; kind: "result" | "order" | "body" | "observation";
  occurredAt: number; receivedAt: number; causeEventIds: string[];
  experience?: import("./action-learning").ActionExecution;
  offerChange?: { id: string; valid: boolean };
  trade?: { offerId?: string; offeredAt: number; soldAt: number; quantity: number; revenue: number };
  travel?: TravelExecution; saleRevenue?: number; action?: VillageAttempt["kind"]; actionDay?: number; success?: boolean; reason?: string;
  order?: { id: string; day: number; quantity: number; bid: number; carrierFee: number; salePrice: number } };
export type VillageMemory = { day: number; done: string[]; knownOrder?: VillageStimulus["order"];
  anticipation?: import("./anticipatory-needs").AnticipationMemory;
  beliefs: { foodBid: number; foodRetail: number; carrierFee: number; woodPrice: number } };
export type VillageContext = { day: number; hourOfDay: number; role: VillageRole; siteId: string;
  experienceLearning?: true;
  foodJourneys?: true;
  foodPlanning?: true;
  sleepRegulation?: true;
  offerIntegrity?: true;
  effortBody?: import("../sim/effort-body").ReturnEffortSensation;
  foodAcquisition?: true;
  knownLandmarks?: Record<string, { x: number; y: number }>;
  activeProgress?: { elapsed: number; remaining: number; destinationId?: string };
  ownGroundItems?: { id: string; kind: string; quantity: number; siteId: string; cell: { x: number; y: number } }[];
  visiblePlantWork?: { actorId: VillageId; plantId: string; quantity: number }[];
  carriedInventory?: { id: string; kind: string; quantity: number; mass: number; edible: boolean; expiresDay?: number }[];
  predictionLedger?: true;
  bulkTransport?: import("../sim/load-movement").LoadTransport & { bagFreeMass: number; plantingReserve: number; maxEnergy: number };
  fieldGrainStores?: { id: string; siteId: string; cell: { x: number; y: number }; grain: number; lots: { id: string; quantity: number }[] }[];
  homeStorage?: { freeMass?: number; cash: number; items: { id: string; kind: string; quantity: number; expiresDay?: number }[] };
  foodMarket?: { bakingSkill: number; grainBatchQuantity: number; grainBatchPrice: number; breadPrice: number };
  cell: { x: number; y: number }; ownFarm?: { id: string; ownerId: VillageId; siteId: string; plotIds: string[]; initialSeeds: number }; visiblePeople?: VillageId[];
  activeAction?: string; hunger: number; cold: number; energy: number; carriedMass: number; ownCash: number;
  ownFood: number; ownWood: number;
  needs?: { sleepDebt: number; mealHours: number; needClockHours?: number; temperature: number; sheltered: boolean;
    sleep?: Pick<import("../sim/sleep-body").SleepSignal, "deficitHours" | "effectiveHours" | "actualHours" | "sleepiness" | "mode" | "awakeHours"> &
      { minute: number; ownSleeps: { from: number; to: number }[] };
    home: { siteId: string; cell: { x: number; y: number } }; };
  breadEconomy?: true; grainCarried?: number; bakingHours?: number;
  grainStores?: { id: string; siteId: string; grain: number; capacity: number; lots: { id: string; quantity: number }[] }[];
  publicForaging?: true; spatialForaging?: true; edibleMeals?: number;
  ownFoodLots?: { id: string; quantity: number; species: string; product?: "grain" | "bread"; mealQuantity: number; offered: boolean; expiresDay?: number }[];
  visibleFoodOffers?: { id: string; sellerId: VillageId; quantity: number; price: number; species: string; product?: "grain" | "bread"; expiresDay?: number }[];
  woodEnabled?: false; foodResource?: number; woodResource?: number;
  visibleOrder?: { id: string; day: number; quantity: number; bid: number; carrierFee: number; salePrice: number;
    status: string }; fundedOrderId?: string; tenderedOrderId?: string;
  carriedFarmerFood: number; carriedSellerFood: number;
  visibleWoodBids: { buyerId: VillageId; price: number }[];
  visibleSale?: { price: number; stock: number };
  visiblePlants: { id: string; species: string; stage: string; available: number;
    ownerId?: string; farmId?: string; siteId?: string; cell?: { x: number; y: number } }[];
  farmingSkills: Record<string, number>; foragingSkill?: number };
type VillageAction =
  | { kind: "load_grain"; lotId: string; quantity: number }
  | { kind: "store_home" | "take_home"; objectId: string; quantity: number }
  | { kind: "store_home_cash" | "take_home_cash"; quantity: number }
  | { kind: "post_food_order"; quantity: number; bid: number; carrierFee: number; salePrice: number }
  | { kind: "accept_carriage"; orderId: string } | { kind: "fund_carriage"; orderId: string }
  | { kind: "post_wood_bid"; price: number } | { kind: "post_sale_quote"; price: number }
  | { kind: "travel"; siteId: string; predictionId?: string } | { kind: "relay_order"; orderId: string }
  | { kind: "redirect_travel"; siteId: string }
  | { kind: "accept_food_order"; orderId: string }
  | { kind: "forage"; resource: "food" | "wood"; quantity: number }
  | { kind: "tender_food"; orderId: string; quantity: number }
  | { kind: "purchase_food"; orderId: string } | { kind: "deliver_food"; orderId: string }
  | { kind: "sell_wood"; buyerId: VillageId } | { kind: "buy_food" }
  | { kind: "store_grain"; lotId: string; storeId: string }
  | { kind: "bake_bread"; lotId: string }
  | { kind: "sleep"; wakeAtMinute?: number } | { kind: "wake_up" }
  | { kind: "eat" } | { kind: "burn_wood" } | { kind: "rest" }
  | { kind: "till_plot"; plantId: string } | { kind: "sow_plot"; plantId: string; lotId?: string }
  | { kind: "withdraw_surplus_offer"; offerId: string }
  | { kind: "interrupt_action" }
  | { kind: "set_down"; objectId: string; quantity: number }
  | { kind: "take_ground"; objectId: string; quantity: number }
  | { kind: "harvest_plot"; plantId: string }
  | { kind: "forage_route"; plantId: string; quantity?: number }
  | { kind: "post_surplus_offer"; lotId: string; quantity: number; price: number }
  | { kind: "buy_surplus"; offerId: string }
  | { kind: "gather_plant"; plantId: string; quantity: number };
export type VillageAttempt = VillageAction & { experienceId?: string };
export type VillageResponse = ActorResponse<VillageAttempt, VillageMemory, { at: number }>;
export type VillageModel = PersonalityModel<ActorInput<VillageContext, VillageMemory, VillageStimulus>, VillageResponse>;

/** One transparent rule personality. Its routines use personal needs, delivered messages and local observation. */
export const ordinaryVillageModel: VillageModel = {
  decide(input) {
    const c = input.knownContext;
    const m: VillageMemory = structuredClone(input.subjectiveState);
    if (m.day !== c.day) { m.day = c.day; m.done = []; m.knownOrder = undefined; }
    for (const stimulus of input.stimuli) {
      if (stimulus.kind === "order" && stimulus.order?.day === c.day) m.knownOrder = stimulus.order;
      if (stimulus.kind === "result" && stimulus.success && stimulus.action && stimulus.actionDay === c.day &&
        !m.done.includes(stimulus.action))
        m.done.push(stimulus.action);
    }
    const done = (key: string) => key === "post_wood_bid" && c.woodEnabled === false || m.done.includes(key);
    let attempt: VillageAttempt | undefined;
    if (!c.activeAction) {
      if (c.hunger > 0 && c.ownFood > 0) attempt = { kind: "eat" };
      else if (c.cold > 0 && c.ownWood > 0 && (c.role !== "woodcutter" || done("forage")))
        attempt = { kind: "burn_wood" };
      else if (c.hourOfDay <= 4 && !done("rest") &&
        c.energy < (c.role === "woodcutter" ? c.ownCash < 2 ? 8 : 6 : c.role === "farmer" ? 6 :
          c.role === "carrier" ? 5 : 3)) attempt = { kind: "rest" };
      else if (c.role === "merchant") {
        if (!done("post_food_order")) attempt = { kind: "post_food_order", quantity: 4,
          bid: m.beliefs.foodBid, carrierFee: m.beliefs.carrierFee, salePrice: m.beliefs.foodRetail };
        else if (c.visibleOrder?.status === "carrier_accepted" && !done("fund_carriage"))
          attempt = { kind: "fund_carriage", orderId: c.visibleOrder.id };
        else if (!done("post_wood_bid")) attempt = { kind: "post_wood_bid", price: m.beliefs.woodPrice };
        else if (!done("post_sale_quote")) attempt = { kind: "post_sale_quote", price: m.beliefs.foodRetail };
      } else if (c.role === "farmer") {
        if (c.hunger > 0 && c.ownFood === 0 && c.foodResource && !done("forage"))
          attempt = { kind: "forage", resource: "food", quantity: 1 };
        else if (!done("post_wood_bid")) attempt = { kind: "post_wood_bid", price: m.beliefs.woodPrice };
        else if (m.knownOrder && !done("accept_food_order") && m.knownOrder.bid >= m.beliefs.foodBid)
          attempt = { kind: "accept_food_order", orderId: m.knownOrder.id };
        else if (done("accept_food_order") && !done("tender_food") && c.ownFood < 4 && c.foodResource && c.foodResource >= 4)
          attempt = { kind: "forage", resource: "food", quantity: 4 };
        else if (done("accept_food_order") && !done("tender_food") && c.ownFood >= 4 && m.knownOrder)
          attempt = { kind: "tender_food", orderId: m.knownOrder.id, quantity: 4 };
      } else if (c.role === "carrier") {
        if (!done("post_wood_bid")) attempt = { kind: "post_wood_bid", price: m.beliefs.woodPrice };
        else if (c.visibleOrder?.status === "posted" && !done("accept_carriage") &&
          c.visibleOrder.carrierFee >= m.beliefs.carrierFee)
          attempt = { kind: "accept_carriage", orderId: c.visibleOrder.id };
        else if (c.siteId === "market" && c.fundedOrderId && !done("relay_order") &&
          !done("purchase_food") && !done("deliver_food")) attempt = { kind: "travel", siteId: "grove" };
        else if (c.siteId === "grove" && c.fundedOrderId && !done("relay_order"))
          attempt = { kind: "relay_order", orderId: c.fundedOrderId };
        else if (c.siteId === "grove" && c.tenderedOrderId && c.carriedFarmerFood >= 4)
          attempt = { kind: "purchase_food", orderId: c.tenderedOrderId };
        else if (c.siteId === "grove" && c.carriedSellerFood >= 4) attempt = { kind: "travel", siteId: "market" };
        else if (c.siteId === "market" && c.carriedSellerFood >= 4 && c.fundedOrderId)
          attempt = { kind: "deliver_food", orderId: c.fundedOrderId };
        else if (c.siteId === "market" && c.hunger > 0 && c.visibleSale &&
          c.visibleSale.stock > 0 && c.ownCash >= c.visibleSale.price &&
          c.visibleSale.price <= m.beliefs.foodRetail) attempt = { kind: "buy_food" };
      } else if (c.woodEnabled === false) {
        // No forest work without a physical wood source. Savings alone cannot support this role.
        if (c.hunger > 0 && c.ownCash >= m.beliefs.foodRetail && c.siteId !== "market")
          attempt = { kind: "travel", siteId: "market" };
        else if (c.siteId === "market" && c.hunger > 0 && c.visibleSale &&
          c.visibleSale.stock > 0 && c.ownCash >= c.visibleSale.price &&
          c.visibleSale.price <= m.beliefs.foodRetail) attempt = { kind: "buy_food" };
        else if (c.siteId === "market" && c.hunger === 0)
          attempt = { kind: "travel", siteId: `home_${input.actorId}` };
      } else {
        if (c.siteId.startsWith("home_") && !done("forage")) attempt = { kind: "travel", siteId: "grove" };
        else if (c.siteId === "market" && !done("forage") && c.ownWood === 0)
          attempt = { kind: "travel", siteId: "grove" };
        else if (c.siteId === "grove" && !done("forage") && c.woodResource && c.woodResource >= 2)
          attempt = { kind: "forage", resource: "wood", quantity: c.ownCash < 2 ? 3 : 2 };
        else if (c.siteId === "grove" && done("forage") && c.ownWood === 1 &&
          c.visibleWoodBids.some((bid) => bid.buyerId === "F" && bid.price >= m.beliefs.woodPrice))
          attempt = { kind: "sell_wood", buyerId: "F" };
        else if (c.siteId === "grove" && done("forage") && (c.ownWood !== 1 || done("sell_wood")))
          attempt = { kind: "travel", siteId: "market" };
        else if (c.siteId === "market" && c.ownWood > 0) {
          const bid = c.visibleWoodBids.find((bid) => bid.buyerId === "S" && bid.price >= m.beliefs.woodPrice) ??
            c.visibleWoodBids.find((bid) => bid.buyerId === "C" && bid.price >= m.beliefs.woodPrice);
          if (bid) attempt = { kind: "sell_wood", buyerId: bid.buyerId };
        }
        if (!attempt && c.siteId === "market" && c.hunger > 0 && c.visibleSale &&
          c.visibleSale.stock > 0 && c.ownCash >= c.visibleSale.price &&
          c.visibleSale.price <= m.beliefs.foodRetail) attempt = { kind: "buy_food" };
        if (!attempt && c.siteId === "market" && c.hunger === 0 && c.cold === 0 && c.ownWood === 0)
          attempt = { kind: "travel", siteId: `home_${input.actorId}` };
      }
      if (!attempt && c.hunger === 0 && c.cold === 0 && !done("rest") &&
        (c.hourOfDay >= 17 || c.energy <= 2)) attempt = { kind: "rest" };
      if (attempt && attempt.kind !== "rest") {
        const effort = attempt.kind === "forage" ? attempt.quantity :
          attempt.kind === "travel" ? (1 + Math.floor(c.carriedMass / 20)) *
            (1 + Math.floor(c.carriedMass / 10)) :
          ["tender_food", "deliver_food", "sell_wood"].includes(attempt.kind) ? 1 : 0;
        if (effort > c.energy) attempt = done("rest") ? undefined : { kind: "rest" };
      }
    }
    return { attempts: attempt ? [attempt] : [], subjectiveUpdate: m,
      wait: { at: input.at + (attempt || c.activeAction ? 1 : 2) } };
  },
};
