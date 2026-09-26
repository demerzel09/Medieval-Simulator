import { ordinaryMarketModel, type MarketContext, type MarketModel, type MarketAttempt } from "../ai/individual-market";
import { hash } from "./core";
import { checkPhysical, contentsQuantity, physicalTransaction, siteOf, type PhysicalObject, type PhysicalState } from "./physical";

type MarketEvent = { id: string; hour: number; day: number; kind: string; actors: string[]; causes: string[];
  data: Record<string, string | number> };
type Offer = { id: string; day: number; quantity: number; price: number; carrierFee: number; salePrice: number;
  eventId: string; status: "posted" | "accepted" | "purchased" | "delivered" | "failed" };
export type MarketWorld = { schemaVersion: 1; mode: "individual_market"; seed: number; day: number; hour: number; nextId: number;
  physical: PhysicalState; resource: { available: number; capacity: number; dailyGrowth: number };
  seller: { price: number; bid: number; carrierFee: number; soldYesterday: number; unsoldYesterday: number; fundedUnmetYesterday: number };
  offer?: Offer; events: MarketEvent[]; harvested: number; grown: number; initialResource: number;
  initialMoney: number; initialSellerCash: number; sellerCosts: number; sellerRevenue: number };
const ids = ["F", "C", "S", "B1", "B2"] as const;
const wallet = (id: string) => `wallet_${id}`;
const bag = (id: string) => `bag_${id}`;
const uid = (w: MarketWorld, prefix: string) => `${prefix}_${String(w.nextId++).padStart(6, "0")}`;
const objectsOf = (w: MarketWorld, parent: string, type: string, owner?: string) => Object.values(w.physical.objects)
  .filter((o) => o.parentId === parent && o.typeId === type && (!owner || o.ownerId === owner));
const money = (w: MarketWorld, id: string) => contentsQuantity(w.physical, wallet(id), "currency");
const food = (w: MarketWorld, parent: string) => contentsQuantity(w.physical, parent, "food");
function emit(w: MarketWorld, kind: string, actors: string[], causes: string[] = [], data: MarketEvent["data"] = {}) {
  if (causes.some((cause) => !w.events.some((event) => event.id === cause))) throw Error(`unknown market cause ${kind}`);
  const event: MarketEvent = { id: uid(w, "e"), hour: w.hour, day: w.day, kind, actors, causes, data };
  w.events.push(event); return event;
}
function tx(w: MarketWorld, actorId: string, ownerIds: string[], operation: Parameters<typeof physicalTransaction>[2]) {
  const result = physicalTransaction(w.physical, { actorId, ownerIds }, operation);
  if (!result.ok) throw Error(`market transaction: ${result.reason}`);
  w.physical = result.state;
}
export function newMarketWorld(seed = 240924, sellerCash = 10, buyerCash = 10): MarketWorld {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(sellerCash) || sellerCash < 0 ||
    !Number.isSafeInteger(buyerCash) || buyerCash < 0 || sellerCash + buyerCash * 2 > 200) throw Error("invalid market fixture");
  const types: PhysicalState["types"] = {
    world: { id: "world", tags: ["world"], unitMass: 0, stackable: false, ownable: false, container: { acceptsTags: ["site"] } },
    site: { id: "site", tags: ["site"], unitMass: 0, stackable: false, ownable: false,
      container: { acceptsTags: ["person", "resource"] } },
    ownedSite: { id: "ownedSite", tags: ["site"], unitMass: 0, stackable: false, ownable: true,
      container: { acceptsTags: ["person", "store"] } },
    person: { id: "person", tags: ["person"], unitMass: 0, stackable: false, ownable: false,
      container: { acceptsTags: ["wallet", "bag"], maxContentsMass: 200 } },
    wallet: { id: "wallet", tags: ["wallet"], unitMass: 0, stackable: false, ownable: true,
      container: { acceptsTags: ["currency"], maxContentsMass: 200 } },
    bag: { id: "bag", tags: ["bag"], unitMass: 0, stackable: false, ownable: true,
      container: { acceptsTags: ["food"], maxContentsMass: 24 } },
    store: { id: "store", tags: ["store"], unitMass: 0, stackable: false, ownable: true,
      container: { acceptsTags: ["food"], maxContentsMass: 24 } },
    resource: { id: "resource", tags: ["resource"], unitMass: 0, stackable: false, ownable: false },
    food: { id: "food", tags: ["food"], unitMass: 1, stackable: true, ownable: true },
    currency: { id: "currency", tags: ["currency"], unitMass: 1, stackable: true, ownable: true },
  };
  const objects: PhysicalState["objects"] = {};
  const add = (id: string, typeId: string, parentId: string | null, ownerId?: string) => {
    objects[id] = { id, typeId, parentId, ownerId, quantity: 1, causeEventId: "initial" };
  };
  add("world", "world", null); add("grove", "site", "world"); add("market", "ownedSite", "world", "S");
  add("berries", "resource", "grove"); add("stock_S", "store", "market", "S");
  for (const id of ids) { add(id, "person", id === "F" ? "grove" : "market");
    add(wallet(id), "wallet", id, id); add(bag(id), "bag", id, id); }
  for (const [id, n] of [["S", sellerCash], ["B1", buyerCash], ["B2", buyerCash]] as const)
    for (let i = 0; i < n; i++) add(`coin_${id}_${i}`, "currency", wallet(id), id);
  const w: MarketWorld = { schemaVersion: 1, mode: "individual_market", seed, day: 0, hour: 0, nextId: 1,
    physical: { types, objects, reservations: [] }, resource: { available: 3, capacity: 6, dailyGrowth: 3 },
    seller: { price: 4, bid: 1, carrierFee: 2, soldYesterday: 0, unsoldYesterday: 0, fundedUnmetYesterday: 0 },
    events: [], harvested: 0, grown: 0, initialResource: 3, initialMoney: sellerCash + buyerCash * 2, initialSellerCash: sellerCash,
    sellerCosts: 0, sellerRevenue: 0 };
  checkMarketWorld(w); return w;
}
function decide(w: MarketWorld, actorId: string, context: MarketContext, model: MarketModel,
  causes: string[] = []): { attempt?: MarketAttempt; eventId: string } {
  w.hour++;
  const response = model.decide({ actorId, at: w.hour,
    stimuli: causes.length ? [{ kind: "observed", causeEventIds: causes }] : [], subjectiveState: {}, knownContext: context });
  if (!Number.isSafeInteger(response.wait.at) || response.wait.at <= w.hour || response.attempts.length > 1)
    throw Error("invalid market response");
  const event = emit(w, "person_decided", [actorId], causes, { action: response.attempts[0]?.kind ?? "wait" });
  return { attempt: response.attempts[0], eventId: event.id };
}
function move(w: MarketWorld, personId: string, destination: "grove" | "market", causeEventId: string) {
  const from = siteOf(w.physical, personId), transit = uid(w, "transit");
  tx(w, personId, [], (t) => t.depart({ id: transit, typeId: "site", parentId: "world", quantity: 1, causeEventId }, [personId]));
  const departed = emit(w, "departed", [personId], [causeEventId], { from, to: destination });
  w.hour++;
  tx(w, personId, [], (t) => t.arrive(transit, destination, [personId]));
  emit(w, "arrived", [personId], [departed.id], { siteId: destination });
}
function transportAccepted(w: MarketWorld, offer: Offer, decisionId: string) {
  const budget = offer.price * offer.quantity;
  const sellerCoins = objectsOf(w, wallet("S"), "currency", "S").slice(0, budget + offer.carrierFee);
  if (sellerCoins.length !== budget + offer.carrierFee) throw Error("seller lacks working capital");
  tx(w, "S", ["S"], (t) => {
    for (const coin of sellerCoins.slice(0, budget)) t.move(coin.id, wallet("C"));
    for (const coin of sellerCoins.slice(budget)) { t.move(coin.id, wallet("C")); t.changeOwner(coin.id, "C"); }
  });
  w.sellerCosts += offer.carrierFee;
  const paid = emit(w, "carrier_paid", ["S", "C"], [offer.eventId, decisionId], { amount: offer.carrierFee });
  for (const coin of sellerCoins.slice(budget)) w.physical.objects[coin.id].causeEventId = paid.id;
  offer.status = "accepted";
  emit(w, "purchase_cash_entrusted", ["S", "C"], [paid.id], { amount: budget, offerId: offer.id });
}
function harvest(w: MarketWorld, quantity: number, decisionId: string) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > w.resource.available || siteOf(w.physical, "F") !== "grove") return false;
  const id = uid(w, "food");
  tx(w, "F", [], (t) => t.add({ id, typeId: "food", parentId: bag("F"), quantity, ownerId: "F", causeEventId: decisionId }));
  w.resource.available -= quantity; w.harvested += quantity;
  const e = emit(w, "foraged", ["F"], [decisionId], { quantity, resourceId: "berries" });
  w.physical.objects[id].causeEventId = e.id; return true;
}
function farmerSale(w: MarketWorld, offer: Offer, quantity: number, decisionId: string) {
  if (offer.status !== "accepted" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > offer.quantity ||
    food(w, bag("F")) < quantity || siteOf(w.physical, "C") !== "grove" ||
    objectsOf(w, wallet("C"), "currency", "S").length < quantity * offer.price) return false;
  const source = objectsOf(w, bag("F"), "food", "F")[0];
  if (!source || source.quantity < quantity) return false;
  const boughtId = source.quantity === quantity ? source.id : uid(w, "food");
  const coins = objectsOf(w, wallet("C"), "currency", "S").slice(0, quantity * offer.price);
  tx(w, "C", ["F", "S"], (t) => {
    if (boughtId !== source.id) t.split(source.id, boughtId, quantity, decisionId);
    t.changeOwner(boughtId, "S"); t.move(boughtId, bag("C"));
    for (const coin of coins) { t.changeOwner(coin.id, "F"); t.move(coin.id, wallet("F")); }
  });
  w.sellerCosts += coins.length;
  const e = emit(w, "crop_bought", ["F", "C"], [offer.eventId, decisionId, source.causeEventId],
    { offerId: offer.id, quantity, unitPrice: offer.price, cost: coins.length });
  w.physical.objects[boughtId].causeEventId = e.id;
  for (const coin of coins) w.physical.objects[coin.id].causeEventId = e.id;
  offer.quantity = quantity; offer.status = "purchased"; return true;
}
function deliver(w: MarketWorld, offer: Offer, decisionId: string) {
  const cargo = objectsOf(w, bag("C"), "food", "S");
  if (siteOf(w.physical, "C") !== "market" || !cargo.length) return false;
  const causes = cargo.map((lot) => lot.causeEventId);
  tx(w, "C", ["S"], (t) => { for (const lot of cargo) t.move(lot.id, "stock_S"); });
  const e = emit(w, "crop_delivered", ["C", "S"], [decisionId, ...causes], { offerId: offer.id, quantity: food(w, "stock_S") });
  for (const lot of cargo) w.physical.objects[lot.id].causeEventId = e.id;
  offer.status = "delivered"; return true;
}
function buy(w: MarketWorld, buyerId: "B1" | "B2", price: number, decisionId: string, quoteId: string) {
  if (siteOf(w.physical, buyerId) !== "market" || money(w, buyerId) < price || !food(w, "stock_S")) return false;
  const source = objectsOf(w, "stock_S", "food", "S")[0];
  const receivedId = source.quantity === 1 ? source.id : uid(w, "food");
  const coins = objectsOf(w, wallet(buyerId), "currency", buyerId).slice(0, price);
  tx(w, buyerId, ["S"], (t) => {
    if (receivedId !== source.id) t.split(source.id, receivedId, 1, decisionId);
    t.changeOwner(receivedId, buyerId); t.move(receivedId, bag(buyerId));
    for (const coin of coins) { t.changeOwner(coin.id, "S"); t.move(coin.id, wallet("S")); }
  });
  w.sellerRevenue += price;
  const e = emit(w, "food_sold", ["S", buyerId], [quoteId, decisionId, source.causeEventId], { quantity: 1, price });
  w.physical.objects[receivedId].causeEventId = e.id;
  for (const coin of coins) w.physical.objects[coin.id].causeEventId = e.id;
  return true;
}
export function advanceMarketDay(w: MarketWorld, model: MarketModel = ordinaryMarketModel) {
  if (w.day >= 90) throw Error("market fixture ends at day 90");
  w.day++; w.offer = undefined;
  if (w.day > 1) { const grown = Math.min(w.resource.dailyGrowth, w.resource.capacity - w.resource.available);
    if (grown) { w.resource.available += grown; w.grown += grown; emit(w, "resource_grew", [], [], { quantity: grown }); } }
  const farmer = decide(w, "F", { role: "farmer", phase: "harvest", available: w.resource.available,
    carriedFood: food(w, bag("F")), bagSpace: 24 - food(w, bag("F")) }, model);
  if (farmer.attempt?.kind === "harvest" && !harvest(w, farmer.attempt.quantity, farmer.eventId))
    emit(w, "attempt_failed", ["F"], [farmer.eventId], { action: "harvest" });
  const plan = decide(w, "S", { role: "seller", phase: "plan", cash: money(w, "S"), stock: food(w, "stock_S"),
    ...w.seller }, model, w.events.filter((e) => e.day === w.day - 1 && ["food_sold", "funded_request_unmet", "sale_price_posted"].includes(e.kind)).map((e) => e.id));
  let offer: Offer | undefined;
  if (plan.attempt?.kind === "post_buy") {
    const a = plan.attempt;
    if (!Number.isSafeInteger(a.salePrice) || a.salePrice < 1 || !Number.isSafeInteger(a.price) || a.price < 1 ||
      !Number.isSafeInteger(a.carrierFee) || a.carrierFee < 0 || !Number.isSafeInteger(a.quantity) || a.quantity < 0 || a.quantity > 2)
      throw Error("invalid merchant quote");
    w.seller.price = a.salePrice;
    if (a.quantity && money(w, "S") >= a.quantity * a.price + a.carrierFee) {
      const e = emit(w, "supply_requested", ["S"], [plan.eventId], { quantity: a.quantity, unitPrice: a.price, carrierFee: a.carrierFee });
      offer = { id: uid(w, "offer"), day: w.day, quantity: a.quantity, price: a.price,
        carrierFee: a.carrierFee, salePrice: a.salePrice, eventId: e.id, status: "posted" };
      w.offer = offer;
    }
  }
  if (offer) {
    const carrier = decide(w, "C", { role: "carrier", phase: "request", offeredFee: offer.carrierFee,
      requestedQuantity: offer.quantity }, model, [offer.eventId]);
    if (carrier.attempt?.kind === "accept_carriage") {
      transportAccepted(w, offer, carrier.eventId);
      move(w, "C", "grove", carrier.eventId);
      const farmerTrade = decide(w, "F", { role: "farmer", phase: "offer", offeredPrice: offer.price,
        requestedQuantity: offer.quantity, carriedFood: food(w, bag("F")) }, model, [offer.eventId]);
      if (farmerTrade.attempt?.kind === "sell_to_carrier" && farmerSale(w, offer, farmerTrade.attempt.quantity, farmerTrade.eventId)) {
        move(w, "C", "market", farmerTrade.eventId);
        const delivery = decide(w, "C", { role: "carrier", phase: "deliver", carriedForSeller: food(w, bag("C")) }, model);
        if (delivery.attempt?.kind === "deliver") deliver(w, offer, delivery.eventId);
      } else {
        offer.status = "failed"; emit(w, "purchase_failed", ["F", "C"], [farmerTrade.eventId], { offerId: offer.id });
        move(w, "C", "market", farmerTrade.eventId);
        const refund = objectsOf(w, wallet("C"), "currency", "S");
        tx(w, "C", ["S"], (t) => { for (const coin of refund) t.move(coin.id, wallet("S")); });
        emit(w, "purchase_cash_returned", ["C", "S"], [farmerTrade.eventId], { amount: refund.length });
      }
    } else { offer.status = "failed"; emit(w, "carriage_declined", ["C"], [carrier.eventId], { offerId: offer.id }); }
  }
  const quote = emit(w, "sale_price_posted", ["S"], [plan.eventId], { price: w.seller.price, stock: food(w, "stock_S") });
  let sold = 0, unmet = 0;
  for (const buyerId of ["B1", "B2"] as const) {
    const shop = decide(w, buyerId, { role: "buyer", phase: "shop", cash: money(w, buyerId),
      stock: food(w, "stock_S"), price: w.seller.price }, model, [quote.id]);
    if (shop.attempt?.kind === "buy" && shop.attempt.quantity === 1 && buy(w, buyerId, w.seller.price, shop.eventId, quote.id)) sold++;
    else if (shop.attempt?.kind === "request_food" && money(w, buyerId) >= w.seller.price && !food(w, "stock_S")) {
      unmet++; emit(w, "funded_request_unmet", [buyerId, "S"], [shop.eventId, quote.id], { price: w.seller.price }); }
  }
  w.seller.soldYesterday = sold; w.seller.unsoldYesterday = food(w, "stock_S"); w.seller.fundedUnmetYesterday = unmet;
  checkMarketWorld(w); return w;
}
export function checkMarketWorld(w: MarketWorld) {
  if (w.schemaVersion !== 1 || w.mode !== "individual_market" || !Number.isSafeInteger(w.day) || w.day < 0 || w.day > 90 ||
    !Number.isSafeInteger(w.hour) || w.hour < 0 || !Number.isSafeInteger(w.nextId) || w.nextId < 1) throw Error("invalid market world");
  checkPhysical(w.physical);
  if (w.physical.objects.market?.typeId !== "ownedSite" || w.physical.objects.market.ownerId !== "S" ||
    w.physical.objects.stock_S?.ownerId !== "S" || siteOf(w.physical, "stock_S") !== "market") throw Error("market property");
  const cash = Object.values(w.physical.objects).filter((o) => o.typeId === "currency");
  const goods = Object.values(w.physical.objects).filter((o) => o.typeId === "food");
  if (cash.reduce((n, o) => n + o.quantity, 0) !== w.initialMoney || cash.some((o) => o.quantity !== 1 || !ids.includes(o.ownerId as typeof ids[number])) ||
    cash.some((o) => o.parentId !== wallet(o.ownerId!) && !(o.ownerId === "S" && o.parentId === wallet("C") && w.offer?.status === "accepted")) ||
    goods.reduce((n, o) => n + o.quantity, 0) !== w.harvested ||
    w.resource.available !== w.initialResource + w.grown - w.harvested ||
    !Number.isSafeInteger(w.resource.available) || w.resource.available < 0 || w.resource.available > w.resource.capacity ||
    w.sellerRevenue - w.sellerCosts !== money(w, "S") - w.initialSellerCash +
      objectsOf(w, wallet("C"), "currency", "S").length) throw Error("market conservation");
  for (const o of goods) if (!ids.includes(o.ownerId as typeof ids[number]) ||
    !((o.ownerId === "F" && o.parentId === bag("F")) || (o.ownerId === "S" && [bag("C"), "stock_S"].includes(o.parentId!)) ||
      (["B1", "B2"].includes(o.ownerId!) && o.parentId === bag(o.ownerId!))))
    throw Error("market food ownership");
  const eventIds = new Set<string>();
  for (const e of w.events) { if (eventIds.has(e.id) || e.causes.some((cause) => !eventIds.has(cause)) || e.actors.some((id) => !ids.includes(id as typeof ids[number])))
    throw Error("market event graph"); eventIds.add(e.id); }
  if (w.offer && (!eventIds.has(w.offer.eventId) || w.offer.day !== w.day || w.offer.quantity < 1 || w.offer.quantity > 2)) throw Error("market offer");
}
export function marketSummary(w: MarketWorld) { return { day: w.day, price: w.seller.price, sellerCash: money(w, "S"),
  farmerCash: money(w, "F"), carrierCash: money(w, "C"), buyerCash: { B1: money(w, "B1"), B2: money(w, "B2") },
  stock: food(w, "stock_S"), resource: w.resource.available, harvested: w.harvested,
  sold: w.events.filter((e) => e.kind === "food_sold").length, sellerProfit: w.sellerRevenue - w.sellerCosts,
  unmetFundedYesterday: w.seller.fundedUnmetYesterday }; }
export function saveMarketWorld(w: MarketWorld) { checkMarketWorld(w); return JSON.stringify(w); }
export function loadMarketWorld(json: string) { const w = JSON.parse(json) as MarketWorld; checkMarketWorld(w); return w; }
export function replayMarketWorld(seed: number, days: number, sellerCash = 10, buyerCash = 10) {
  const w = newMarketWorld(seed, sellerCash, buyerCash); for (let day = 0; day < days; day++) advanceMarketDay(w); return w; }
export function marketHash(w: MarketWorld) { return hash(w); }
