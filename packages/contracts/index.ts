import { z } from "zod";
export type Good = "money" | "food" | "wood" | "equipment";
export type Stock = Record<Good, number>;
export type Job =
  | "farmer"
  | "woodworker"
  | "artisan"
  | "trader"
  | "administrator";
export type Purpose = "defense" | "expedition" | "trade";
export type Response =
  | "support"
  | "comply"
  | "bargain"
  | "delay"
  | "refuse"
  | "flee";
export interface Person {
  id: string;
  name: string;
  age: number;
  alive: boolean;
  factionId: string;
  householdId: string;
  homeId: string;
  location: string;
  job: Job;
  roles: string[];
  culture: "hearth" | "honor" | "contract";
  values: { family: number; honor: number; wealth: number; safety: number };
  trust: Record<string, number>;
  health: number;
  hunger: number;
  fatigue: number;
  fear: number;
  morale: number;
  skill: number;
  military?: { unitId: string; dueAt: number };
  captiveBy?: string;
  taxCarry: number;
  knownTax: number;
  memories: string[];
  beliefs: Report[];
  reactions: Record<string, Response>;
}
export interface Household {
  id: string;
  factionId: string;
  homeId: string;
  memberIds: string[];
}
export interface Settlement {
  id: string;
  name: string;
  factionId: string;
  x: number;
  y: number;
  terrain: "plain" | "forest" | "highland";
}
export interface Faction {
  id: string;
  rulerId: string;
  capitalId: string;
  cap: number;
  tax: number;
  purpose: Purpose;
}
export interface Event {
  id: string;
  worldMinute: number;
  kind: string;
  actorIds: string[];
  causes: string[];
  text: string;
  data: Record<string, unknown>;
  witnesses: string[];
}
export interface Report {
  causes?: string[];
  eventId: string;
  observedAt: number;
  receivedAt: number;
  source: string;
  confidence: number;
  text: string;
  kind: string;
}
export interface Message {
  id: string;
  sender: string;
  recipient: string;
  sentAt: number;
  arriveAt: number;
  causes: string[];
  kind:
    | "report"
    | "tax"
    | "order"
    | "offer"
    | "reply"
    | "remittance"
    | "promise";
  data: Record<string, unknown>;
}
export interface PromiseContract {
  id: string;
  promisorId: string;
  beneficiarySnapshot: string[];
  witnessIds: string[];
  deliveredTo: string[];
  createdAt: number;
  dueAt: number;
  kind: "reward" | "family" | "loot" | "loan";
  trigger: "always" | "victory" | "passage";
  amount: number;
  fulfilledAmount: number;
  status: "proposed" | "active" | "fulfilled" | "breached" | "void";
  sourceEventIds: string[];
  escrow?: string;
  inherited: boolean;
}
export interface Unit {
  reportedFood?: number;
  id: string;
  factionId: string;
  commanderId: string;
  memberIds: string[];
  location: string;
  destination?: string;
  arriveAt?: number;
  intent: string;
  fallback: string;
  retreatFood: number;
  orderEvent?: string;
  readyAt: number;
  x: number;
  y: number;
}
export interface Shipment {
  id: string;
  from: string;
  to: string;
  destination: string;
  arriveAt: number;
  cause: string;
}
export interface Battle {
  id: string;
  location: string;
  startedAt: number;
  units: string[];
  terrain: string[];
  status: "active" | "ended";
  winner?: string;
  losses: Record<string, number>;
  cause: string;
}
export interface Offer {
  id: string;
  from: string;
  to: string;
  amount: number;
  dueAt: number;
  nonAggression: boolean;
  status: "sent" | "counter" | "accepted" | "rejected";
  cause: string;
}
export interface Treaty {
  id: string;
  offerId: string;
  from: string;
  to: string;
  route: string;
  commercial: boolean;
  military: boolean;
  expiresAt: number;
  notifiedAt: number;
}
const id = z.string().min(1).max(100),
  nat = z.number().int().nonnegative().max(1e9);
const purpose = z.enum(["defense", "expedition", "trade"]);
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("WAIT"), minutes: nat }),
  z.object({
    kind: z.literal("SET_TAX"),
    rate: z.number().min(0).max(0.5),
    amount: nat,
    purpose,
  }),
  z.object({
    kind: z.literal("TRANSFER_RESOURCE"),
    from: id,
    to: id,
    good: z.enum(["money", "food", "wood", "equipment"]),
    amount: nat,
  }),
  z.object({
    kind: z.literal("ASSIGN_JOB"),
    personId: id,
    job: z.enum(["farmer", "woodworker", "artisan", "trader", "administrator"]),
  }),
  z.object({
    kind: z.literal("RECRUIT"),
    count: nat.max(120),
    purpose,
    termDays: nat.min(1).max(90),
    reward: nat,
  }),
  z.object({ kind: z.literal("DEMOBILIZE"), unitId: id }),
  z.object({
    kind: z.literal("PROPOSE_PROMISE"),
    beneficiaries: z.array(id).min(1).max(200),
    amount: nat,
    dueDay: nat.max(180),
    trigger: z.enum(["always", "victory", "passage"]),
    promiseKind: z.enum(["reward", "family", "loot", "loan"]),
    escrow: z.boolean(),
    inherited: z.boolean(),
  }),
  z.object({ kind: z.literal("ACCEPT_PROMISE"), promiseId: id }),
  z.object({
    kind: z.literal("SEND_MESSAGE"),
    recipient: id,
    text: z.string().min(1).max(500),
  }),
  z.object({ kind: z.literal("ASSIGN_COMMANDER"), unitId: id, personId: id }),
  z.object({
    kind: z.literal("ISSUE_ORDER"),
    unitId: id,
    intent: z.enum(["defend", "attack", "retreat", "scout", "rest"]),
    destination: id,
    fallback: id,
    retreatFood: nat.max(30),
  }),
  z.object({ kind: z.literal("MOVE_UNIT"), unitId: id, destination: id }),
  z.object({
    kind: z.literal("DISPATCH_SUPPLY"),
    unitId: id,
    amount: nat.max(10000),
  }),
  z.object({ kind: z.literal("SURRENDER"), unitId: id }),
  z.object({ kind: z.literal("REQUEST_AUDIENCE"), personId: id }),
  z.object({
    kind: z.literal("ASSIGN_ROLE"),
    personId: id,
    role: z.enum(["general", "steward"]),
  }),
  z.object({
    kind: z.literal("NEGOTIATE"),
    amount: nat,
    nonAggression: z.boolean(),
    durationDays: nat.min(1).max(180),
  }),
]);
export type Action = z.infer<typeof actionSchema>;
export interface Command {
  id: string;
  actorId: string;
  issuedAt: number;
  executeAt: number;
  sequence: number;
  action: Action;
  origin: "player" | "ordinary_ai" | "deliberative_ai" | "system";
}
export interface World {
  schemaVersion: 1;
  engineVersion: string;
  contentHash: string;
  seed: number;
  rng: Record<string, number>;
  minute: number;
  nextId: number;
  population: number;
  people: Record<string, Person>;
  households: Record<string, Household>;
  settlements: Record<string, Settlement>;
  factions: Record<string, Faction>;
  accounts: Record<string, Stock>;
  baseline: Stock;
  produced: Stock;
  consumed: Stock;
  queue: Command[];
  commands: Command[];
  applied: string[];
  events: Event[];
  messages: Message[];
  promises: PromiseContract[];
  units: Record<string, Unit>;
  shipments: Shipment[];
  battles: Battle[];
  offers: Offer[];
  treaties: Treaty[];
  busyUntil: Record<string, number>;
  victoryEvents: string[];
  outcome?: "victory" | "defeat";
  occupationSince?: number;
}
export interface Contact {
  unitId: string;
  factionId: string;
  location: string;
  x: number;
  y: number;
  min: number;
  max: number;
  observedAt: number;
}
export interface ActorObservation {
  location: string;
  contacts: Contact[];
  actorId: string;
  minute: number;
  day: number;
  people: Pick<
    Person,
    "id" | "name" | "roles" | "homeId" | "householdId" | "job"
  >[];
  settlements: Settlement[];
  reports: Report[];
  promises: PromiseContract[];
  units: Unit[];
  treasury: Stock;
  pending: { id: string; kind: string; arriveAt: number }[];
  offers: Offer[];
  passage: boolean;
  outcome?: string;
  summary: {
    dead: number;
    hungry: number;
    fulfilled: number;
    breached: number;
  };
  battles: Battle[];
}
export interface Planner {
  plan(observation: ActorObservation): Action[];
}
