/**
 * Filtrovali cost-estimate model.
 *
 * All calculations in this module are deterministic and side-effect free so the
 * same draft can be recalculated in the browser and at the API boundary.
 * Percent fields use human-readable percentages (for example, `21` means 21%).
 * `burdenRateOverride` is the exception: it is a multiplier (`0.84` means 84%),
 * while values above 3 are accepted as percentages for import compatibility.
 */

import {
  getTechnicalServiceDefinition,
  type TechnicalServiceId,
} from "./technical-services.js";

export type CostRole = { role: string; salary: number; adjustment: number };
export type LecLaborRole = {
  role: string;
  salary: number;
  auxiliary: boolean;
  usesLoadedMonthlyCost?: boolean;
};
export type LecLaborRates = {
  role: string;
  condition: WorkCondition;
  baseSalary: number;
  payrollComponents: number;
  monthlyCost: number;
  normalHourlyCost: number;
  extra70HourlyCost: number;
  extra100HourlyCost: number;
};
export type LecLaborCostComponent = {
  id: string;
  label: string;
  value: number;
  group: "remuneration" | "payroll" | "benefit" | "shift";
};
export type LecLaborCostBreakdown = LecLaborRates & {
  usesLoadedMonthlyCost: boolean;
  benefits: number;
  shiftPremiumValue: number;
  extraBaseHourlyCost: number;
  components: LecLaborCostComponent[];
};
export type LegacyIndirectCost = { name: string; monthly: number; included: boolean };
export type CostLine = { role: string; quantity: number; months: number; salary?: number };

export type LaborShift = "day" | "night";
export type LaborScheduleTarget = "role" | "collaborator";
export type LaborScheduleDayType = "weekday" | "saturday" | "sunday_holiday";
export type LaborScheduleDay = {
  dayType: LaborScheduleDayType;
  days: number;
  normalHoursPerDay: number;
  extraHoursPerDay: number;
  overtimePercent: number;
};
export type LaborWorkSchedule = {
  name: string;
  targetType: LaborScheduleTarget;
  collaboratorName?: string;
  days: LaborScheduleDay[];
};
export type LaborPricingModel = "lec_v1_2" | "legacy_monthly_v1";
export type OvertimePolicy = "legacy_buckets_v1" | "union_monthly_30_v1";
export type WorkCondition = "headquarters" | "travel" | "offshore";
export type ExpenseBasis =
  | "fixed"
  | "per_person"
  | "per_person_day"
  | "per_person_calendar_day"
  | "per_person_workday"
  | "per_person_month"
  | "per_vehicle_calendar_day"
  | "per_vehicle_workday"
  | "per_vehicle_staffed_day"
  | "per_context_day"
  | "per_context_month"
  | "percent_labor";
export type MaterialCategory = "material" | "input";
export type SystemMaterial = "carbon_steel" | "stainless_steel" | "other";
export type ProductDoseMode = "percent_volume" | "liters_per_m3" | "kg_per_m3" | "manual";
export type ProductPriceBasis = "unit" | "package";
export type LogisticsDirection = "mobilization" | "demobilization";
export type LogisticsCategory = "personnel" | "equipment" | "freight" | "travel" | "lodging" | "other";
export type LogisticsBasis = "fixed" | "per_person" | "per_person_day" | "per_trip" | "per_km";
export type LogisticsCalculationMode =
  | ""
  | "legacy"
  | "company_crew_vehicle"
  | "rental_crew_vehicle"
  | "bus_crew_transport"
  | "air_crew_transport"
  | "external_freight"
  | "company_truck_driver";
export type BusOvernightMode = "" | "continuous" | "hotel_stop";
export type RentalUse = "" | "mobilization_only" | "mobilization_and_site";
export type LogisticsReturnSetup = "pending" | "mirrored" | "custom";
export type LogisticsAdditionalCostBasis = "fixed" | "per_vehicle" | "per_trip" | "per_vehicle_trip";
export type PricingMode = "calculated" | "labor" | "commercial_lines" | "fabrication" | "global";
export type PricingCalculationModel = "filtrovali_net_revenue_v1" | "legacy_lec";
export type VehicleType = "none" | "sedan" | "pickup" | "hr";
export type VehicleCountMode = "automatic" | "manual";
export const HOTEL_SITE_COMMUTE_EXPENSE_CODE = "hotel_site_commute";
export const LODGING_CALENDAR_DAY_EXPENSE_CODE = "lodging_calendar_day";
export const MEAL_CALENDAR_DAY_EXPENSE_CODE = "meal_calendar_day";
export const LAUNDRY_CALENDAR_DAY_EXPENSE_CODE = "laundry_calendar_day";
export const VEHICLE_RENTAL_CALENDAR_DAY_EXPENSE_CODE = "vehicle_rental_calendar_day";

export type CostEstimateAssumptions = {
  pricingModel: PricingCalculationModel;
  laborPricingModel: LaborPricingModel;
  overtimePolicy: OvertimePolicy;
  monthlyHours: number;
  workdaysPerMonth: number;
  defaultHoursPerDay: number;
  overheadPercent: number;
  taxPercent: number;
  desiredMarginPercent: number;
  commissionPercent: number;
  commercialPercent: number;
};

export type LaborAssignment = {
  id: string;
  role: string;
  quantity: number;
  monthlySalary: number;
  adjustment: number;
  burdenRateOverride?: number;
  allocationPercent: number;
  shift?: LaborShift;
  nightPremiumPercent?: number;
  /** Jornada específica; ausente preserva a jornada histórica do contexto. */
  workSchedule?: LaborWorkSchedule;
  notes?: string;
};

export type ContextExpense = {
  id: string;
  code?: string;
  name: string;
  basis: ExpenseBasis;
  quantity: number;
  unitValue: number;
  included: boolean;
};

export type IndirectCost = {
  id: string;
  name: string;
  basis: ExpenseBasis;
  quantity: number;
  unitValue: number;
  included: boolean;
  /**
   * Transitional mirror of `unitValue`, retained while the legacy flat UI is
   * being retired. V2 calculations never read this field.
   */
  monthly: number;
};

export type LaborContext = {
  id: string;
  name: string;
  description: string;
  startOffsetDays: number;
  durationDays: number;
  workingDays?: number;
  hoursPerDay: number;
  workCondition: WorkCondition | "";
  workConditionConfirmed: boolean;
  hotelSiteDistanceKmPerDay: number;
  weekdayExtra70HoursPerDay: number;
  saturdayCount: number;
  saturdayHoursPerDay: number;
  sundayCount: number;
  sundayHoursPerDay: number;
  vehicleType: VehicleType | "";
  vehicleCountMode: VehicleCountMode;
  vehicleCount: number;
  assignments: LaborAssignment[];
  expenses: ContextExpense[];
  enabled: boolean;
};

export type MaterialItem = {
  id: string;
  category: MaterialCategory;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  wastePercent: number;
  freightValue: number;
  included: boolean;
};

export type PipeSegment = {
  id: string;
  description: string;
  quantity: number;
  lengthM: number;
  lengthUnit?: "m" | "cm" | "mm";
  internalDiameterMm: number;
  diameterUnit?: "in" | "mm";
  nominalDiameterIn?: number;
  schedule?: string;
  fillPercent: number;
};

export type ManualVolumeItem = {
  id: string;
  description: string;
  quantity: number;
  volumeLiters: number;
};

export type EquipmentVolumeItem = {
  id: string;
  description: string;
  quantity: number;
  volumeLiters: number;
  included: boolean;
};

export type HoseSegment = {
  id: string;
  description: string;
  quantity: number;
  lengthM: number;
  internalDiameterMm: number;
  fillPercent: number;
};

export type VolumeSystem = {
  id: string;
  name: string;
  material: SystemMaterial;
  pipeSegments: PipeSegment[];
  hoseSegments: HoseSegment[];
  equipmentVolumes: EquipmentVolumeItem[];
  manualVolumes: ManualVolumeItem[];
  cycles: number;
  enabled: boolean;
};

/** Serviço contratado para um circuito dimensionado no levantamento. */
export type CircuitServiceAssignment = {
  id: string;
  systemId: string;
  /** Mantido como string para que rascunhos com uma seleção ainda vazia não sejam descartados. */
  serviceId: string;
};

export function technicalServiceRequiresFilters(serviceId: unknown): boolean {
  const id = String(serviceId || "");
  return id.startsWith("flushing_") || id.startsWith("filtragem_");
}

export function technicalServiceRequiresChemicalProducts(serviceId: unknown): boolean {
  return serviceId === "limpeza_quimica";
}

export type ProductRequirement = {
  id: string;
  systemId?: string;
  productName: string;
  unit: string;
  doseMode: ProductDoseMode;
  dose: number;
  densityKgPerL: number;
  wastePercent: number;
  packageSize: number;
  priceBasis: ProductPriceBasis;
  unitCost: number;
  manualQuantity: number;
  included: boolean;
};

export type FilterRequirement = {
  id: string;
  filterName: string;
  micronRating: string;
  unit: string;
  quantity: number;
  unitCost: number;
  included: boolean;
};

export type EffluentSettings = {
  multiplier: number;
  unitCostPerM3: number;
  includeDisposalCost: boolean;
  clientResponsible: boolean;
};

export type LogisticsAdditionalCost = {
  id: string;
  description: string;
  basis: LogisticsAdditionalCostBasis;
  quantity: number;
  unitCost: number;
  included: boolean;
};

export type LogisticsTravelerAssignment = {
  assignmentId: string;
  quantity: number;
};

export type LogisticsDestination = {
  id: string;
  nameSource: "labor_context" | "custom";
  laborContextId?: string;
  name: string;
  address: string;
  oneWayDistanceKm: number;
};

export type LogisticsSlotType = "crew" | "equipment" | "additional";

/** A tela e o salvamento devem oferecer/aceitar os mesmos modos por transporte. */
export function isLogisticsCalculationModeAllowed(
  mode: string,
  slotType: string,
  requiredSlot: boolean,
): boolean {
  if (!requiredSlot || (slotType !== "crew" && slotType !== "equipment")) return true;
  const allowed = slotType === "equipment"
    ? ["", "external_freight", "company_truck_driver", "legacy"]
    : ["", "company_crew_vehicle", "rental_crew_vehicle", "bus_crew_transport", "air_crew_transport", "legacy"];
  return allowed.includes(mode);
}

export type LogisticsItem = {
  id: string;
  destinationId?: string;
  slotType: LogisticsSlotType;
  requiredSlot: boolean;
  autoSyncedFromMobilization: boolean;
  /** Vínculo explícito para retornos de equipes adicionais, sem depender do slot obrigatório. */
  mobilizationSourceId?: string;
  direction: LogisticsDirection;
  category: LogisticsCategory;
  description: string;
  calculationMode: LogisticsCalculationMode;
  calculationModeConfirmed: boolean;
  contextId?: string;
  basis: LogisticsBasis;
  quantity: number;
  trips: number;
  travelerCountMode: VehicleCountMode;
  travelerCount: number;
  travelerAssignments: LogisticsTravelerAssignment[];
  travelerAssignmentsConfirmed: boolean;
  vehicleCountMode: VehicleCountMode;
  vehicleCount: number;
  passengersPerVehicle: number;
  distanceKmPerVehicle: number;
  dailyDistanceLimitKm: number;
  travelHoursPerDay: number;
  travelCalendarDaysPerTrip: number;
  travelSaturdayDays: number;
  travelSundayDays: number;
  ticketPerPersonPerTrip: number;
  busOvernightMode: BusOvernightMode;
  lodgingNightsPerTrip: number;
  lodgingPerPersonDay: number;
  mealPerPersonDay: number;
  rentalUse: RentalUse;
  rentalDailyRate: number;
  rentalSiteDays: number;
  fuelEfficiencyKmPerLiter: number;
  fuelPricePerLiter: number;
  tollPerVehicleKm: number;
  vehicleOperatingCostPerKm: number;
  additionalCosts: LogisticsAdditionalCost[];
  unitCost: number;
  taxPercent: number;
  marginPercent: number;
  contingencyPercent: number;
  returnSetup: LogisticsReturnSetup;
  included: boolean;
};

export type CostScopeConfirmations = {
  noLabor: boolean;
  noInputs: boolean;
  noLogistics: boolean;
  combinedCrewAndEquipmentTransport: boolean;
  mobilizationCrewAlreadyOnSite: boolean;
  demobilizationCrewAlreadyOnSite: boolean;
};

export type CommercialLine = {
  id: string;
  description: string;
  unit: string;
  quantity: number;
  unitValue: number;
};

export type RepresentativeCommissionBasis = "net_after_tax" | "gross_invoice";

export type RepresentativeCommissionSettings = {
  enabled: boolean;
  representativeName: string;
  percent: number;
  basis: RepresentativeCommissionBasis;
};

export type EmployeeReferralBonus = {
  id: string;
  employeeName: string;
  amount: number;
  included: boolean;
};

export type ProposalPresentationAdjustment = {
  id: string;
  sourceLineId: string;
  value: number;
};

export type CommercialSettings = {
  pricingMode: PricingMode;
  globalValue: number;
  lines: CommercialLine[];
  includeQqp: boolean;
  hiddenQqpIds: string[];
  representativeCommission: RepresentativeCommissionSettings;
  employeeReferralBonuses: EmployeeReferralBonus[];
  presentationAdjustments: ProposalPresentationAdjustment[];
};

export type CostEstimatePayloadV2 = {
  schemaVersion: 2;
  logisticsStructureVersion: 0 | 1;
  title: string;
  proposalCode?: string;
  /** Data-base ISO usada pela tela para apresentar os offsets das fases como datas. */
  scheduleStartDate?: string;
  assumptions: CostEstimateAssumptions;
  laborContexts: LaborContext[];
  indirectCosts: IndirectCost[];
  materials: MaterialItem[];
  volumeSystems: VolumeSystem[];
  /**
   * Ausente em levantamentos antigos. Quando presente, a lista passa a definir
   * quais insumos técnicos realmente se aplicam a cada circuito.
   */
  circuitServices?: CircuitServiceAssignment[];
  products: ProductRequirement[];
  /** Produtos removidos na tela e disponíveis para restauração no rascunho. */
  deletedProducts?: ProductRequirement[];
  filters: FilterRequirement[];
  effluent: EffluentSettings;
  logisticsDestinations: LogisticsDestination[];
  logistics: LogisticsItem[];
  scopeConfirmations: CostScopeConfirmations;
  commercial: CommercialSettings;
};

export type LaborAssignmentResult = LaborAssignment & {
  allocatedQuantity: number;
  employeeMonths: number;
  personDays: number;
  laborHours: number;
  normalHours: number;
  extra70Hours: number;
  extra100Hours: number;
  extra70ConvertedTo100Hours: number;
  effectiveMonthlySalary: number;
  normalHourlyCost: number;
  extra70HourlyCost: number;
  extra100HourlyCost: number;
  dailyNormalCost: number;
  monthlyLoadedCost: number;
  normalCost: number;
  extra70Cost: number;
  extra100Cost: number;
  /** Horas e custo de percentuais explícitos diferentes de 70% e 100%. */
  customExtraHours?: number;
  customExtraCost?: number;
  burdenRate: number;
  baseLaborCost: number;
  burdenCost: number;
  total: number;
};

export type ContextExpenseResult = ContextExpense & { basisQuantity: number; total: number };
export type IndirectCostResult = IndirectCost & { basisQuantity: number; total: number };

export type LaborContextResult = {
  id: string;
  name: string;
  startOffsetDays: number;
  durationDays: number;
  workingDays: number;
  months: number;
  headcount: number;
  workCondition: WorkCondition | "";
  vehicleType: VehicleType | "";
  vehicleCapacity: number;
  vehicleCount: number;
  hotelSiteDistanceKmPerDay: number;
  employeeMonths: number;
  personDays: number;
  laborHours: number;
  normalHours: number;
  extra70Hours: number;
  extra100Hours: number;
  extra70ConvertedTo100Hours: number;
  baseLaborCost: number;
  burdenCost: number;
  laborCost: number;
  expenseCost: number;
  total: number;
  assignments: LaborAssignmentResult[];
  expenses: ContextExpenseResult[];
};

export type MaterialResult = MaterialItem & {
  quantityWithWaste: number;
  itemCost: number;
  total: number;
};

export type PipeSegmentResult = PipeSegment & { volumeLiters: number };
export type HoseSegmentResult = HoseSegment & { volumeLiters: number };
export type EquipmentVolumeResult = EquipmentVolumeItem & { totalVolumeLiters: number };
export type ManualVolumeResult = ManualVolumeItem & { totalVolumeLiters: number };

export type VolumeSystemResult = {
  id: string;
  name: string;
  material: SystemMaterial;
  pipeVolumeLiters: number;
  hoseVolumeLiters: number;
  equipmentVolumeLiters: number;
  manualVolumeLiters: number;
  physicalVolumeLiters: number;
  cycles: number;
  totalVolumeLiters: number;
  pipeSegments: PipeSegmentResult[];
  hoseSegments: HoseSegmentResult[];
  equipmentVolumes: EquipmentVolumeResult[];
  manualVolumes: ManualVolumeResult[];
};

export type ProductResult = ProductRequirement & {
  sourceVolumeLiters: number;
  requiredQuantity: number;
  purchaseQuantity: number;
  packageCount: number;
  total: number;
};

export type FilterResult = FilterRequirement & {
  total: number;
};

export type LogisticsResult = LogisticsItem & {
  people: number;
  personDays: number;
  calculatedVehicleCount: number;
  vehicleCapacity: number;
  travelDays: number;
  travelWeekdays: number;
  fleetDistanceKm: number;
  travelLaborHours: number;
  averageNormalHourlyCost: number;
  averageExtra70HourlyCost: number;
  averageExtra100HourlyCost: number;
  travelLaborCost: number;
  ticketCost: number;
  lodgingNights: number;
  lodgingCost: number;
  mealCost: number;
  rentalDays: number;
  rentalCost: number;
  fuelLiters: number;
  fuelCost: number;
  tollCost: number;
  vehicleOperatingCost: number;
  additionalCostTotal: number;
  basisQuantity: number;
  baseCost: number;
  taxValue: number;
  costWithTax: number;
  chargeValue: number;
  total: number;
};

export type ProposalPriceLine = {
  id: string;
  sourceId?: string;
  category: string;
  description: string;
  unit: string;
  quantity: number;
  unitValue: number;
  value: number;
  costValue: number;
  calculatedValue: number;
  presentationAdjustment: number;
};

export type QqpLine = ProposalPriceLine & {
  costUnitValue: number;
  sharePercent: number;
  context?: string;
};

export type CostEstimateResultV2 = {
  schemaVersion: 2;
  contextResults: LaborContextResult[];
  indirectResults: IndirectCostResult[];
  materialResults: MaterialResult[];
  volumeResults: VolumeSystemResult[];
  productResults: ProductResult[];
  filterResults: FilterResult[];
  logisticsResults: LogisticsResult[];
  laborCost: number;
  indirectCost: number;
  materialCost: number;
  inputCost: number;
  filterCost: number;
  effluentVolumeLiters: number;
  effluentCost: number;
  mobilizationCost: number;
  demobilizationCost: number;
  directCost: number;
  totalCost: number;
  overheadValue: number;
  costWithOverhead: number;
  calculatedSalePrice: number;
  salePrice: number;
  taxValue: number;
  commissionValue: number;
  representativeCommissionValue: number;
  representativeCommissionGrossUpValue: number;
  employeeReferralBonusCost: number;
  presentationReallocationValue: number;
  commercialValue: number;
  netRevenue: number;
  profitValue: number;
  balance: number;
  margin: number;
  targetMarginPercent: number;
  suggestedMarginPercent: number;
  maximumMarginPercent: number;
  pricingDenominator: number;
  totalVolumeLiters: number;
  totalLaborHours: number;
  totalPersonDays: number;
  peakHeadcount: number;
  proposalPrices: ProposalPriceLine[];
  qqp: QqpLine[];
  validPricing: boolean;
};

export type CostEstimateValidationIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type CostEstimateValidation = {
  valid: boolean;
  errors: CostEstimateValidationIssue[];
  warnings: CostEstimateValidationIssue[];
};

export const MONTHLY_HOURS = 176;
export const LEC_MONTHLY_HOURS = 193.6;
export const DEFAULT_WORKDAYS_PER_MONTH = 22;
export const DEFAULT_HOURS_PER_DAY = 8.8;
export const FILTROVALI_PRICING_MODEL = "filtrovali_net_revenue_v1" as const;
export const LEGACY_PRICING_MODEL = "legacy_lec" as const;
export const LEC_LABOR_PRICING_MODEL = "lec_v1_2" as const;
export const LEGACY_LABOR_PRICING_MODEL = "legacy_monthly_v1" as const;
export const DEFAULT_OVERHEAD_PERCENT = 24;
export const DEFAULT_TAX_PERCENT = 17.54;
export const DEFAULT_COMMISSION_PERCENT = 9;
export const DEFAULT_COMMERCIAL_PERCENT = 5;
export const DEFAULT_MARGIN_PERCENT = 15;
export const MIN_PRICING_DENOMINATOR = 0.000001;
export const LEC_MINIMUM_SALARY = 1_621;
export const LEC_INSALUBRITY_PERCENT = 20;
export const LEC_NIGHT_PREMIUM_PERCENT = 35;
export const LEC_EXTRA_PAYROLL_FACTOR = 1.06;
export const LEC_EXTRA_RETENTION_PERCENT = 6.65;
export const LEC_EXTRA_70_MULTIPLIER = 1.7;
export const LEC_EXTRA_100_MULTIPLIER = 2;
export const LEC_MONTHLY_EXTRA_70_LIMIT_HOURS = 30;
export const LEC_FREIGHT_TAX_COMMISSION_PERCENT = 20;
export const LEC_FREIGHT_MARGIN_PERCENT = 30;
export const LOGISTICS_TRAVEL_DEFAULTS = {
  passengersPerCompanyCar: 4,
  dailyDistanceLimitKm: 750,
  travelHoursPerDay: 10,
  lodgingPerPersonDay: 200,
  mealPerPersonDay: 175,
  companyCarFuelEfficiencyKmPerLiter: 10,
  companyTruckFuelEfficiencyKmPerLiter: 3,
  gasolinePricePerLiter: 6.5,
  dieselPricePerLiter: 6.3,
  companyCarTollPerVehicleKm: 0.2,
  companyTruckTollPerVehicleKm: 0.2,
} as const;
export const LEC_MONTHLY_BENEFITS = {
  lifeInsurance: 50,
  mealAllowance: 600,
  healthPlan: 500,
  dentalPlan: 18,
  education: 300,
  housing: 1_000,
} as const;
export const LEC_CONTEXT_EXPENSES = {
  lodgingPerPersonCalendarDay: 200,
  mealPerPersonCalendarDay: 175,
  laundryPerPersonCalendarDay: 30,
  hotelSiteDistanceKmPerDay: 50,
  hotelSiteFuelPerVehicleStaffedDay: 50,
} as const;
export const LEC_CONTEXT_EXPENSE_PRESETS: ReadonlyArray<Omit<ContextExpense, "id">> = [
  {
    code: LODGING_CALENDAR_DAY_EXPENSE_CODE,
    name: "Hospedagem",
    basis: "per_person_calendar_day",
    quantity: 1,
    unitValue: LEC_CONTEXT_EXPENSES.lodgingPerPersonCalendarDay,
    included: true,
  },
  {
    code: MEAL_CALENDAR_DAY_EXPENSE_CODE,
    name: "Alimentação",
    basis: "per_person_calendar_day",
    quantity: 1,
    unitValue: LEC_CONTEXT_EXPENSES.mealPerPersonCalendarDay,
    included: true,
  },
  {
    code: LAUNDRY_CALENDAR_DAY_EXPENSE_CODE,
    name: "Lavagem de roupa",
    basis: "per_person_calendar_day",
    quantity: 1,
    unitValue: LEC_CONTEXT_EXPENSES.laundryPerPersonCalendarDay,
    included: true,
  },
  {
    code: HOTEL_SITE_COMMUTE_EXPENSE_CODE,
    name: "Deslocamento hotel ↔ obra (combustível)",
    basis: "per_vehicle_staffed_day",
    quantity: 1,
    unitValue: LEC_CONTEXT_EXPENSES.hotelSiteFuelPerVehicleStaffedDay,
    included: true,
  },
  {
    code: VEHICLE_RENTAL_CALENDAR_DAY_EXPENSE_CODE,
    name: "Locação de veículo",
    basis: "per_vehicle_calendar_day",
    quantity: 1,
    unitValue: 0,
    included: false,
  },
] as const;
export const VEHICLE_CAPACITIES: Record<VehicleType, number> = {
  none: 0,
  sedan: 3,
  pickup: 2,
  hr: 2,
};
export const EQUIPMENT_VOLUME_PRESETS = [
  { label: "Máquina / reservatório 120 L", volumeLiters: 120 },
  { label: "Máquina / reservatório 240 L", volumeLiters: 240 },
  { label: "Máquina / reservatório 1.000 L", volumeLiters: 1_000 },
  { label: "Máquina / reservatório 4.000 L", volumeLiters: 4_000 },
] as const;
export const LEC_FILTER_CATALOG: ReadonlyArray<
  Omit<FilterRequirement, "id" | "quantity" | "included">
> = [
  { filterName: "Filtro 18\" Hy-Pro", micronRating: "Referência até 2.500 L", unit: "un.", unitCost: 800 },
  { filterName: "Filtro 36\" Hy-Pro", micronRating: "Referência até 5.000 L", unit: "un.", unitCost: 1_270 },
  { filterName: "Filtro Parker", micronRating: "", unit: "un.", unitCost: 507 },
  { filterName: "Filtro Bag", micronRating: "50 micra", unit: "un.", unitCost: 24.19 },
  { filterName: "Filtro Bag", micronRating: "20 micra", unit: "un.", unitCost: 24.8 },
  { filterName: "Filtro Bag", micronRating: "10 micra", unit: "un.", unitCost: 29.34 },
  { filterName: "Filtro Bag", micronRating: "5 micra", unit: "un.", unitCost: 30.61 },
  { filterName: "Filtro Bag", micronRating: "1 micra", unit: "un.", unitCost: 38.21 },
] as const;

export type LecMarginBand = {
  minValue: number;
  maxValue?: number;
  marginPercent: number;
  label: string;
};

export const LEC_MARGIN_BANDS: LecMarginBand[] = [
  { minValue: 0, maxValue: 20_000, marginPercent: 40, label: "Até R$ 20 mil" },
  { minValue: 20_000.01, maxValue: 150_000, marginPercent: 37, label: "De R$ 20 mil a R$ 150 mil" },
  { minValue: 150_000.01, maxValue: 300_000, marginPercent: 35, label: "De R$ 150 mil a R$ 300 mil" },
  { minValue: 300_000.01, marginPercent: 30, label: "Acima de R$ 300 mil" },
];

export function lecSuggestedMarginPercent(proposalValue: number): number {
  const value = Math.max(0, finiteNumber(proposalValue));
  return (LEC_MARGIN_BANDS.find((band) =>
    value >= band.minValue && (band.maxValue === undefined || value <= band.maxValue))
    ?? LEC_MARGIN_BANDS[LEC_MARGIN_BANDS.length - 1]).marginPercent;
}

export const COST_ROLES: CostRole[] = [
  ["ADMINISTRATIVO DE OBRA", 5000, 350], ["AJUDANTE DE ACABAMENTO", 1989.79, 139.2853], ["AJUDANTE GERAL", 1978, 0],
  ["ALMOXARIFE", 2970, 207.9], ["ANALISTA ADMINISTRATIVO", 4500, 315], ["ANALISTA DE MEDIÇÃO", 4500, 315],
  ["ASSISTENTE ADMINISTRATIVO", 3150, 220.5], ["ASSISTENTE DE ALMOXARIFADO", 0, 0], ["ASSISTENTE DE PLANEJAMENTO", 0, 0],
  ["ASSISTENTE SOCIAL", 0, 0], ["AUXILIAR ADMINISTRATIVO", 2500, 175], ["CALDEIREIRO", 3603, 252.21],
  ["COORDENADOR", 5392.37, 0], ["DIRETOR OPERACIONAL", 0, 0], ["ELETRICISTA FC", 0, 0], ["ELETRICISTA MANUTENÇÃO", 3420, 239.4],
  ["ELETRICISTA MONTADOR", 0, 0], ["ENCANADOR", 3500, 0], ["ENCARREGADO", 4693.03, 0],
  ["ENCARREGADO DE ALMOXARIFADO", 5670, 396.9], ["ENCARREGADO DE CALDEIRARIA", 5670, 396.9], ["ENCARREGADO DE ELETRICA", 0, 0],
  ["ENCARREGADO DE MECANICA", 5670, 396.9], ["ENCARREGADO DE SOLDA", 5670, 396.9], ["ENCARREGADO DE TUBULAÇÃO", 5100, 0],
  ["ENFERMEIRO DO TRABALHO", 0, 0], ["ENGENHEIRO DE PRODUÇÃO", 0, 0], ["ENGENHEIRO DE SEGURANÇA", 0, 0],
  ["GERENTE DE CONTRATOS", 0, 0], ["LIXADOR", 2400, 0], ["MAÇARIQUEIRO", 3150, 220.5],
  ["MECANICO AJUSTADOR", 3603, 252.21], ["MECANICO MANUTENÇÃO", 0, 0], ["MECANICO MONTADOR", 0, 0],
  ["MEDICO DO TRABALHO", 0, 0], ["MOTORISTA", 2880, 201.6], ["OPERADOR", 4086.57, 0],
  ["SOLDADOR 6G", 4490, 314.3], ["SOLDADOR TIG/MIG", 3900, 0], ["SUPERVISOR", 4981.72, 0],
  ["SUPERVISOR ADMINISTRATIVO", 8200, 574], ["SUPERVISOR DE ELETRICA", 0, 0], ["SUPERVISOR DE MECANICA", 8200, 574],
  ["SUPERVISOR DE PRODUÇÃO", 8200, 574], ["SUPERVISOR DE SOLDA", 8200, 574], ["TECNICO DE SEGURANÇA DO TRABALHO", 4320, 302.4],
].map(([role, salary, adjustment]) => ({ role: String(role), salary: Number(salary), adjustment: Number(adjustment) }));

/**
 * Cargos-base da aba "Calculo Colaboradores" do LEC v1.2.
 * O administrativo reutiliza a composição do Auxiliar na planilha original.
 */
export const LEC_LABOR_ROLES: LecLaborRole[] = [
  { role: "GERENTE DE ENGENHARIA", salary: 35_000, auxiliary: false, usesLoadedMonthlyCost: true },
  { role: "ENGENHEIRO DE PRODUÇÃO", salary: 18_000, auxiliary: false, usesLoadedMonthlyCost: true },
  { role: "COORDENADOR", salary: 5_392.37, auxiliary: false },
  { role: "SUPERVISOR", salary: 4_981.72, auxiliary: false },
  { role: "ENCARREGADO", salary: 4_693.03, auxiliary: false },
  { role: "OPERADOR", salary: 4_086.57, auxiliary: false },
  { role: "AUXILIAR", salary: 2_395.37, auxiliary: true },
  { role: "ADMINISTRATIVO", salary: 2_395.37, auxiliary: true },
];

const LEGACY_INDIRECT_COST_ROWS: Array<[string, number, boolean]> = [
  ["ASSESSORIA CONTÁBIL", 17.5, true], ["ALOJAMENTO", 1125, true], ["AQUISIÇÃO DE BENS", 14.9516414125, true],
  ["CAIXINHA", 1000, true], ["CANTEIRO", 39.32705999, true], ["SEGURO VIDA", 19.48742389, true],
  ["TICKET ALIMENTAÇÃO", 1600, true], ["TRANSPORTE", 500, true], ["EPI's", 159.111219441, true],
  ["EXAMES MÉDICOS", 83.33, true], ["FERRAMENTAL", 223.322831267, true], ["IMPRODUTIVIDADE", 0, true],
  ["INFORMÁTICA", 55.55, true], ["MATERIAL DE CONSUMO", 0, true], ["MOB/DESMOB (PASSAGENS)", 800, true],
  ["PLANO DE SAÚDE", 0, true], ["QSMS", 6.452036735, true], ["RECRUTAMENTO", 0, true],
  ["REEMBOLSOS", 83.837553761, true], ["COMISSÃO VENDA", 0, true], ["DARF COMPLEMENTAR", 0, true],
  ["DARF IMPOSTOS - 12,42%", 0, true], ["DEVOLUÇÃO EMPRÉSTIMOS", 0, true], ["EMPRÉSTIMOS À SEDE", 0, true],
  ["ACERTO DE CONTAS - SEDE X OBRA", 0, true], ["DIRETORIA", 0, true], ["ENCARGO - FGTS 8% SOBRE FOLHA", 0, true],
  ["ENCARGO - INSS 20% SOBRE FOLHA", 0, true], ["PROVISÃO 13º SALÁRIO", 0, true], ["PROVISÃO FÉRIAS", 0, true],
  ["RESCISÃO", 1000, true], ["SALÁRIOS", 3609.64239162, false], ["ADM CONTRATO", 0, true],
  ["QUALIFICAÇÃO SOLDADORES", 0, true], ["DOAÇÃO A SEDE", 0, true],
];

export const INDIRECT_COSTS: IndirectCost[] = LEGACY_INDIRECT_COST_ROWS.map(([name, monthly, included], index) => ({
  id: `indirect-${index + 1}`,
  name,
  basis: "per_person_month",
  quantity: 1,
  unitValue: monthly,
  monthly,
  included,
}));

export const ONERATED_RATES = [
  1.0673010697, .9004288475, .8448047734, 1.1442677364, 1.0621255141, 1.0073640327, .9682486887, .9389121808,
  .9160948969, .8978410697, .8829061202, .870460329, .8599292748, .850902657, .8430795882, .836234403,
  .8301945337, .8248257611, .8200221223, .8156988475, .8117873131, .8082313727, .8049846446, .8020084771,
  .799270403, .79674295, .7944027158, .7922296411, .7902064337, .7883181067, .7865516073, .7848955141,
  .7833397902, .7818755795, .780495038, .7791911932, .7779578265, .7767893738, .7756808418, .7746277364,
  .7736260019, .7726719692, .77176231, .770893999, .7700642796, .7692706349, .7685107624, .7677825512,
  .7670840629, .7664135141, .7657692614, .7651497876, .7645536902, .7639796705, .7634265242, .7628931332,
  .7623784576, .7618815295, .7614014463, .760937366,
];

const DEFAULT_ASSUMPTIONS: CostEstimateAssumptions = {
  pricingModel: FILTROVALI_PRICING_MODEL,
  laborPricingModel: LEC_LABOR_PRICING_MODEL,
  overtimePolicy: "union_monthly_30_v1",
  monthlyHours: LEC_MONTHLY_HOURS,
  workdaysPerMonth: DEFAULT_WORKDAYS_PER_MONTH,
  defaultHoursPerDay: DEFAULT_HOURS_PER_DAY,
  overheadPercent: DEFAULT_OVERHEAD_PERCENT,
  taxPercent: DEFAULT_TAX_PERCENT,
  desiredMarginPercent: DEFAULT_MARGIN_PERCENT,
  commissionPercent: DEFAULT_COMMISSION_PERCENT,
  commercialPercent: DEFAULT_COMMERCIAL_PERCENT,
};

const LEGACY_DEFAULT_ASSUMPTIONS: CostEstimateAssumptions = {
  pricingModel: LEGACY_PRICING_MODEL,
  laborPricingModel: LEGACY_LABOR_PRICING_MODEL,
  overtimePolicy: "legacy_buckets_v1",
  monthlyHours: MONTHLY_HOURS,
  workdaysPerMonth: DEFAULT_WORKDAYS_PER_MONTH,
  defaultHoursPerDay: DEFAULT_HOURS_PER_DAY,
  overheadPercent: 6,
  taxPercent: 18,
  desiredMarginPercent: 30,
  commissionPercent: 2,
  commercialPercent: 0,
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
  return Math.max(0, finiteNumber(value, fallback));
}

function boundedPercent(value: unknown, fallback = 0, maximum = 100): number {
  return Math.max(0, Math.min(maximum, finiteNumber(value, fallback)));
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function isoDateValue(value: unknown): string | undefined {
  const text = textValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? text
    : undefined;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === "string" && choices.includes(value as T) ? value as T : fallback;
}

function importedId(value: unknown, prefix: string, index: number): string {
  const existing = textValue(value);
  if (existing) return existing;
  return `${prefix}-${index + 1}`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundMeasure(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function percentRate(value: number): number {
  return Math.max(0, value) / 100;
}

function normalizeBurdenOverride(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const rate = nonNegative(value);
  return rate > 3 ? rate / 100 : rate;
}

function normalizeAssumptions(value: unknown): CostEstimateAssumptions {
  const source = objectValue(value);
  const pricingModel = enumValue(
    source.pricingModel,
    [FILTROVALI_PRICING_MODEL, LEGACY_PRICING_MODEL] as const,
    LEGACY_PRICING_MODEL,
  );
  const laborPricingModel = enumValue(
    source.laborPricingModel,
    [LEC_LABOR_PRICING_MODEL, LEGACY_LABOR_PRICING_MODEL] as const,
    LEGACY_LABOR_PRICING_MODEL,
  );
  const defaults = pricingModel === FILTROVALI_PRICING_MODEL
    ? DEFAULT_ASSUMPTIONS
    : LEGACY_DEFAULT_ASSUMPTIONS;
  const defaultMonthlyHours = laborPricingModel === LEC_LABOR_PRICING_MODEL
    ? LEC_MONTHLY_HOURS
    : MONTHLY_HOURS;
  return {
    pricingModel,
    laborPricingModel,
    overtimePolicy: enumValue(
      source.overtimePolicy,
      ["legacy_buckets_v1", "union_monthly_30_v1"] as const,
      "legacy_buckets_v1",
    ),
    monthlyHours: Math.max(1, nonNegative(source.monthlyHours, defaultMonthlyHours)),
    workdaysPerMonth: Math.max(1, nonNegative(source.workdaysPerMonth, defaults.workdaysPerMonth)),
    defaultHoursPerDay: Math.max(.1, nonNegative(source.defaultHoursPerDay, defaults.defaultHoursPerDay)),
    overheadPercent: boundedPercent(source.overheadPercent, defaults.overheadPercent, 500),
    taxPercent: boundedPercent(source.taxPercent, defaults.taxPercent),
    desiredMarginPercent: boundedPercent(source.desiredMarginPercent, defaults.desiredMarginPercent),
    commissionPercent: boundedPercent(source.commissionPercent, defaults.commissionPercent),
    commercialPercent: boundedPercent(source.commercialPercent, defaults.commercialPercent),
  };
}

/**
 * Converte uma cópia do levantamento para a única base editável no app.
 * O motor legado permanece disponível apenas para leitura de históricos.
 */
export function upgradeLaborDraftToLec<T extends Record<string, unknown>>(
  value: T,
): T & { assumptions: Record<string, unknown> } {
  const assumptions = objectValue(value.assumptions);
  return {
    ...value,
    assumptions: {
      ...assumptions,
      laborPricingModel: LEC_LABOR_PRICING_MODEL,
      monthlyHours: LEC_MONTHLY_HOURS,
      workdaysPerMonth: DEFAULT_WORKDAYS_PER_MONTH,
      defaultHoursPerDay: DEFAULT_HOURS_PER_DAY,
    },
  };
}

function normalizeLaborWorkSchedule(value: unknown): LaborWorkSchedule | undefined {
  const source = objectValue(value);
  if (!Array.isArray(source.days)) return undefined;

  const targetType = enumValue(source.targetType, ["role", "collaborator"] as const, "role");
  const collaboratorName = textValue(source.collaboratorName).trim();
  return {
    name: textValue(source.name, "Jornada personalizada"),
    targetType,
    ...(targetType === "collaborator" && collaboratorName ? { collaboratorName } : {}),
    days: arrayValue(source.days).map((value) => {
      const day = objectValue(value);
      return {
        dayType: enumValue(
          day.dayType,
          ["weekday", "saturday", "sunday_holiday"] as const,
          "weekday",
        ),
        days: nonNegative(day.days),
        normalHoursPerDay: nonNegative(day.normalHoursPerDay),
        extraHoursPerDay: nonNegative(day.extraHoursPerDay),
        overtimePercent: boundedPercent(day.overtimePercent, 70, 300),
      };
    }),
  };
}

function normalizeAssignment(value: unknown, index: number): LaborAssignment {
  const source = objectValue(value);
  const role = textValue(source.role, "COLABORADOR");
  const lecRoleDefaults = LEC_LABOR_ROLES.find((item) => item.role === role);
  const legacyRoleDefaults = COST_ROLES.find((item) => item.role === role);
  return {
    id: importedId(source.id, "assignment", index),
    role,
    quantity: nonNegative(source.quantity),
    monthlySalary: nonNegative(
      source.monthlySalary ?? source.salary,
      lecRoleDefaults?.salary ?? legacyRoleDefaults?.salary ?? 0,
    ),
    adjustment: nonNegative(source.adjustment, legacyRoleDefaults?.adjustment ?? 0),
    burdenRateOverride: normalizeBurdenOverride(source.burdenRateOverride),
    allocationPercent: boundedPercent(source.allocationPercent, 100),
    shift: enumValue(source.shift, ["day", "night"] as const, "day"),
    nightPremiumPercent: boundedPercent(source.nightPremiumPercent, 35),
    ...(source.workSchedule === undefined
      ? {}
      : { workSchedule: normalizeLaborWorkSchedule(source.workSchedule) }),
    notes: textValue(source.notes) || undefined,
  };
}

function normalizeExpense(value: unknown, index: number): ContextExpense {
  const source = objectValue(value);
  const id = importedId(source.id, "expense", index);
  const name = textValue(source.name, `Despesa ${index + 1}`);
  const basis = enumValue(source.basis, [
    "fixed", "per_person", "per_person_day", "per_person_calendar_day", "per_person_workday", "per_person_month",
    "per_vehicle_calendar_day", "per_vehicle_workday", "per_vehicle_staffed_day",
    "per_context_day", "per_context_month", "percent_labor",
  ] as const, "fixed");
  const quantity = nonNegative(source.quantity, 1);
  const unitValue = nonNegative(source.unitValue);
  const normalizedName = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
  const legacyNames = new Set([
    "combustivel obra / hotel",
    "combustivel hotel / obra",
    "deslocamento hotel ↔ obra (combustivel)",
  ]);
  const isHotelSiteCommute = textValue(source.code) === HOTEL_SITE_COMMUTE_EXPENSE_CODE
    || basis === "per_vehicle_staffed_day"
    || legacyNames.has(normalizedName);
  if (isHotelSiteCommute) {
    const legacyDefault = basis === "per_vehicle_workday"
      && quantity === 1
      && unitValue === 100
      && legacyNames.has(normalizedName);
    return {
      id,
      code: HOTEL_SITE_COMMUTE_EXPENSE_CODE,
      name: "Deslocamento hotel ↔ obra (combustível)",
      basis: "per_vehicle_staffed_day",
      quantity: 1,
      unitValue: legacyDefault
        ? LEC_CONTEXT_EXPENSES.hotelSiteFuelPerVehicleStaffedDay
        : roundMoney(quantity * unitValue),
      included: true,
    };
  }
  /**
   * Os presets nascem por pessoa × dia corrido, mas a tela deixa a base
   * editável. Antes, reconhecer o código/nome do preset restaurava essa base
   * silenciosamente no cálculo: selecionar "Fixo / evento", quantidade 4 e
   * R$ 200 ainda produzia 4 × 200 × 30 dias = R$ 24.000.
   *
   * Só tratamos como preset canônico enquanto a base continuar sendo a do
   * preset. Ao escolher outra base, o item segue pelo normalizador genérico e
   * a opção que o usuário vê é exatamente a opção que o motor calcula.
   */
  const calendarDayCode = basis === "per_person_calendar_day"
    ? textValue(source.code) === LODGING_CALENDAR_DAY_EXPENSE_CODE
      || normalizedName === "hospedagem"
      ? LODGING_CALENDAR_DAY_EXPENSE_CODE
      : textValue(source.code) === MEAL_CALENDAR_DAY_EXPENSE_CODE
        || normalizedName === "alimentacao"
        ? MEAL_CALENDAR_DAY_EXPENSE_CODE
        : ""
    : "";
  if (calendarDayCode) {
    return {
      id,
      code: calendarDayCode,
      name: calendarDayCode === LODGING_CALENDAR_DAY_EXPENSE_CODE
        ? "Hospedagem"
        : "Alimentação",
      basis: "per_person_calendar_day",
      quantity,
      unitValue,
      included: booleanValue(source.included, true),
    };
  }
  const laundryCalendarDay = textValue(source.code) === LAUNDRY_CALENDAR_DAY_EXPENSE_CODE
    || (normalizedName === "lavagem de roupa"
      && (basis === "per_person_workday" || basis === "per_person_calendar_day"));
  if (laundryCalendarDay) {
    return {
      id,
      code: LAUNDRY_CALENDAR_DAY_EXPENSE_CODE,
      name: "Lavagem de roupa",
      basis: "per_person_calendar_day",
      quantity,
      unitValue,
      included: booleanValue(source.included, true),
    };
  }
  const vehicleRentalCalendarDay = textValue(source.code) === VEHICLE_RENTAL_CALENDAR_DAY_EXPENSE_CODE
    || (normalizedName === "locacao de veiculo"
      && (basis === "per_vehicle_workday" || basis === "per_vehicle_calendar_day"));
  if (vehicleRentalCalendarDay) {
    return {
      id,
      code: VEHICLE_RENTAL_CALENDAR_DAY_EXPENSE_CODE,
      name: "Locação de veículo",
      basis: "per_vehicle_calendar_day",
      quantity,
      unitValue,
      included: booleanValue(source.included, true),
    };
  }
  return {
    id,
    code: textValue(source.code) || undefined,
    name,
    basis,
    quantity,
    unitValue,
    included: booleanValue(source.included, true),
  };
}

function normalizeIndirectCost(value: unknown, index: number): IndirectCost {
  const source = objectValue(value);
  const importedMonthly = source.monthly === undefined ? undefined : nonNegative(source.monthly);
  const unitValue = nonNegative(source.unitValue, importedMonthly ?? 0);
  return {
    id: importedId(source.id, "indirect", index),
    name: textValue(source.name, `Custo indireto ${index + 1}`),
    basis: enumValue(source.basis, [
      "fixed", "per_person", "per_person_day", "per_person_calendar_day", "per_person_workday", "per_person_month",
      "per_vehicle_calendar_day", "per_vehicle_workday", "per_vehicle_staffed_day",
      "per_context_day", "per_context_month", "percent_labor",
    ] as const, importedMonthly === undefined ? "fixed" : "per_person_month"),
    quantity: nonNegative(source.quantity, 1),
    unitValue,
    monthly: importedMonthly ?? unitValue,
    included: booleanValue(source.included, true),
  };
}

function normalizeLaborContext(value: unknown, index: number, assumptions: CostEstimateAssumptions): LaborContext {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "context", index),
    name: textValue(source.name, `Etapa ${index + 1}`),
    description: textValue(source.description),
    startOffsetDays: nonNegative(source.startOffsetDays),
    durationDays: nonNegative(source.durationDays, assumptions.workdaysPerMonth),
    workingDays: source.workingDays === undefined ? undefined : nonNegative(source.workingDays),
    hoursPerDay: source.hoursPerDay === undefined
      ? assumptions.defaultHoursPerDay
      : nonNegative(source.hoursPerDay),
    workCondition: enumValue(
      source.workCondition,
      ["", "headquarters", "travel", "offshore"] as const,
      "",
    ),
    workConditionConfirmed: booleanValue(source.workConditionConfirmed, false),
    hotelSiteDistanceKmPerDay: nonNegative(
      source.hotelSiteDistanceKmPerDay,
      LEC_CONTEXT_EXPENSES.hotelSiteDistanceKmPerDay,
    ),
    weekdayExtra70HoursPerDay: nonNegative(source.weekdayExtra70HoursPerDay),
    saturdayCount: nonNegative(source.saturdayCount),
    saturdayHoursPerDay: nonNegative(source.saturdayHoursPerDay),
    sundayCount: nonNegative(source.sundayCount),
    sundayHoursPerDay: nonNegative(source.sundayHoursPerDay),
    vehicleType: enumValue(source.vehicleType, ["", "none", "sedan", "pickup", "hr"] as const, ""),
    vehicleCountMode: enumValue(
      source.vehicleCountMode,
      ["automatic", "manual"] as const,
      "automatic",
    ),
    vehicleCount: nonNegative(source.vehicleCount),
    assignments: arrayValue(source.assignments).map(normalizeAssignment),
    expenses: arrayValue(source.expenses).map(normalizeExpense),
    enabled: booleanValue(source.enabled, true),
  };
}

function normalizeMaterial(value: unknown, index: number): MaterialItem {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "material", index),
    category: enumValue(source.category, ["material", "input"] as const, "material"),
    description: textValue(source.description, `Item ${index + 1}`),
    unit: textValue(source.unit, "un"),
    quantity: nonNegative(source.quantity),
    unitCost: nonNegative(source.unitCost),
    wastePercent: boundedPercent(source.wastePercent, 0, 1000),
    freightValue: nonNegative(source.freightValue),
    included: booleanValue(source.included, true),
  };
}

function normalizePipeSegment(value: unknown, index: number): PipeSegment {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "pipe", index),
    description: textValue(source.description, `Trecho ${index + 1}`),
    quantity: nonNegative(source.quantity, 1),
    lengthM: nonNegative(source.lengthM),
    ...(source.lengthUnit === undefined
      ? {}
      : { lengthUnit: enumValue(source.lengthUnit, ["m", "cm", "mm"] as const, "m") }),
    internalDiameterMm: nonNegative(source.internalDiameterMm),
    ...(source.diameterUnit === undefined
      ? {}
      : { diameterUnit: enumValue(source.diameterUnit, ["in", "mm"] as const, "in") }),
    nominalDiameterIn: source.nominalDiameterIn === undefined ? undefined : nonNegative(source.nominalDiameterIn),
    schedule: textValue(source.schedule) || undefined,
    fillPercent: boundedPercent(source.fillPercent, 100),
  };
}

function normalizeManualVolume(value: unknown, index: number): ManualVolumeItem {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "volume", index),
    description: textValue(source.description, `Volume adicional ${index + 1}`),
    quantity: nonNegative(source.quantity, 1),
    volumeLiters: nonNegative(source.volumeLiters),
  };
}

function normalizeEquipmentVolume(value: unknown, index: number): EquipmentVolumeItem {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "equipment-volume", index),
    description: textValue(source.description, `Equipamento ${index + 1}`),
    quantity: nonNegative(source.quantity, 1),
    volumeLiters: nonNegative(source.volumeLiters),
    included: booleanValue(source.included, true),
  };
}

function normalizeHoseSegment(value: unknown, index: number): HoseSegment {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "hose", index),
    description: textValue(source.description, `Mangueira ${index + 1}`),
    quantity: nonNegative(source.quantity, 1),
    lengthM: nonNegative(source.lengthM),
    internalDiameterMm: nonNegative(source.internalDiameterMm),
    fillPercent: boundedPercent(source.fillPercent, 100),
  };
}

function normalizeVolumeSystem(value: unknown, index: number): VolumeSystem {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "system", index),
    name: textValue(source.name, `Sistema ${index + 1}`),
    material: enumValue(source.material, ["carbon_steel", "stainless_steel", "other"] as const, "carbon_steel"),
    pipeSegments: arrayValue(source.pipeSegments).map(normalizePipeSegment),
    hoseSegments: arrayValue(source.hoseSegments).map(normalizeHoseSegment),
    equipmentVolumes: arrayValue(source.equipmentVolumes).map(normalizeEquipmentVolume),
    manualVolumes: arrayValue(source.manualVolumes).map(normalizeManualVolume),
    cycles: Math.max(1, nonNegative(source.cycles, 1)),
    enabled: booleanValue(source.enabled, true),
  };
}

function normalizeCircuitService(value: unknown, index: number): CircuitServiceAssignment {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "circuit-service", index),
    systemId: textValue(source.systemId),
    serviceId: textValue(source.serviceId),
  };
}

function normalizeProduct(value: unknown, index: number): ProductRequirement {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "product", index),
    systemId: textValue(source.systemId) || undefined,
    productName: textValue(source.productName, `Produto ${index + 1}`),
    unit: textValue(source.unit, "kg"),
    doseMode: enumValue(source.doseMode, ["percent_volume", "liters_per_m3", "kg_per_m3", "manual"] as const, "manual"),
    dose: nonNegative(source.dose),
    densityKgPerL: Math.max(.000001, nonNegative(source.densityKgPerL, 1)),
    wastePercent: boundedPercent(source.wastePercent, 0, 1000),
    packageSize: nonNegative(source.packageSize),
    priceBasis: enumValue(source.priceBasis, ["unit", "package"] as const, "unit"),
    unitCost: nonNegative(source.unitCost),
    manualQuantity: nonNegative(source.manualQuantity),
    included: booleanValue(source.included, true),
  };
}

function normalizeFilter(value: unknown, index: number): FilterRequirement {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "filter", index),
    filterName: textValue(source.filterName, `Filtro ${index + 1}`),
    micronRating: textValue(source.micronRating),
    unit: textValue(source.unit, "un."),
    quantity: nonNegative(source.quantity),
    unitCost: nonNegative(source.unitCost),
    included: booleanValue(source.included, false),
  };
}

function normalizeEffluent(value: unknown): EffluentSettings {
  const source = objectValue(value);
  return {
    multiplier: nonNegative(source.multiplier, 4),
    unitCostPerM3: nonNegative(source.unitCostPerM3),
    includeDisposalCost: booleanValue(source.includeDisposalCost, false),
    clientResponsible: booleanValue(source.clientResponsible, true),
  };
}

function normalizeLogisticsAdditionalCost(
  value: unknown,
  index: number,
): LogisticsAdditionalCost {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "logistics-extra", index),
    description: textValue(source.description, `Complemento ${index + 1}`),
    basis: enumValue(
      source.basis,
      ["fixed", "per_vehicle", "per_trip", "per_vehicle_trip"] as const,
      "fixed",
    ),
    quantity: nonNegative(source.quantity, 1),
    unitCost: nonNegative(source.unitCost),
    included: booleanValue(source.included, true),
  };
}

function normalizeLogisticsTravelerAssignment(
  value: unknown,
): LogisticsTravelerAssignment | undefined {
  const source = objectValue(value);
  const assignmentId = textValue(source.assignmentId);
  if (!assignmentId) return undefined;
  return {
    assignmentId,
    quantity: nonNegative(source.quantity),
  };
}

function normalizeLogisticsDestination(
  value: unknown,
  index: number,
): LogisticsDestination {
  const source = objectValue(value);
  const laborContextId = textValue(source.laborContextId) || undefined;
  const nameSource = enumValue(
    source.nameSource,
    ["labor_context", "custom"] as const,
    laborContextId ? "labor_context" : "custom",
  );
  const fallbackName = index === 0 ? "Obra principal" : `Destino ${index + 1}`;
  return {
    id: importedId(source.id, "destination", index),
    nameSource,
    laborContextId: nameSource === "labor_context" ? laborContextId : undefined,
    name: source.name === undefined
      ? fallbackName
      : String(source.name ?? "").trim(),
    address: textValue(source.address),
    oneWayDistanceKm: nonNegative(source.oneWayDistanceKm ?? source.distanceKm),
  };
}

function normalizeLogistics(value: unknown, index: number): LogisticsItem {
  const source = objectValue(value);
  const isLegacyRecord = source.calculationMode === undefined;
  const calculationMode = enumValue(
    source.calculationMode,
    [
      "",
      "legacy",
      "company_crew_vehicle",
      "rental_crew_vehicle",
      "bus_crew_transport",
      "air_crew_transport",
      "external_freight",
      "company_truck_driver",
    ] as const,
    isLegacyRecord ? "legacy" : "",
  );
  const usesTruckDefaults = calculationMode === "company_truck_driver";
  const usesRoadVehicle = calculationMode === "company_crew_vehicle"
    || calculationMode === "rental_crew_vehicle"
    || calculationMode === "company_truck_driver";
  const direction = enumValue(
    source.direction,
    ["mobilization", "demobilization"] as const,
    "mobilization",
  );
  const slotType = enumValue(
    source.slotType,
    ["crew", "equipment", "additional"] as const,
    "additional",
  );
  const requiredSlot = booleanValue(source.requiredSlot, false);
  const travelCalendarDaysPerTrip = nonNegative(source.travelCalendarDaysPerTrip, 1);
  const busOvernightMode = enumValue(
    source.busOvernightMode,
    ["", "continuous", "hotel_stop"] as const,
    "",
  );
  const mobilizationSourceId = textValue(source.mobilizationSourceId);
  const returnSetup = direction === "demobilization" && (requiredSlot || mobilizationSourceId)
    ? enumValue(
        source.returnSetup,
        ["pending", "mirrored", "custom"] as const,
        booleanValue(source.autoSyncedFromMobilization, false) ? "mirrored" : "custom",
      )
    : "custom";
  const usesTravelers = usesRoadVehicle
    || calculationMode === "bus_crew_transport"
    || calculationMode === "air_crew_transport";
  const isPreAssignmentOwnedRecord = usesTravelers
    && source.travelerAssignments === undefined
    && source.travelerAssignmentsConfirmed === undefined;
  return {
    id: importedId(source.id, "logistics", index),
    destinationId: textValue(source.destinationId) || undefined,
    slotType,
    requiredSlot,
    ...(mobilizationSourceId ? { mobilizationSourceId } : {}),
    autoSyncedFromMobilization: booleanValue(
      source.autoSyncedFromMobilization,
      false,
    ),
    direction,
    category: enumValue(source.category, ["personnel", "equipment", "freight", "travel", "lodging", "other"] as const, "freight"),
    description: textValue(source.description, `Logística ${index + 1}`),
    calculationMode,
    calculationModeConfirmed: isLegacyRecord
      ? true
      : booleanValue(source.calculationModeConfirmed, calculationMode !== ""),
    contextId: textValue(source.contextId) || undefined,
    basis: enumValue(source.basis, ["fixed", "per_person", "per_person_day", "per_trip", "per_km"] as const, "fixed"),
    quantity: nonNegative(source.quantity, 1),
    trips: nonNegative(source.trips, 1),
    travelerCountMode: enumValue(
      source.travelerCountMode,
      ["automatic", "manual"] as const,
      "automatic",
    ),
    travelerCount: nonNegative(source.travelerCount),
    travelerAssignments: arrayValue(source.travelerAssignments)
      .map(normalizeLogisticsTravelerAssignment)
      .filter((item): item is LogisticsTravelerAssignment => Boolean(item)),
    travelerAssignmentsConfirmed: booleanValue(
      source.travelerAssignmentsConfirmed,
      !isPreAssignmentOwnedRecord,
    ),
    vehicleCountMode: enumValue(
      source.vehicleCountMode,
      ["automatic", "manual"] as const,
      "automatic",
    ),
    vehicleCount: nonNegative(source.vehicleCount),
    passengersPerVehicle: nonNegative(
      source.passengersPerVehicle,
      LOGISTICS_TRAVEL_DEFAULTS.passengersPerCompanyCar,
    ),
    distanceKmPerVehicle: nonNegative(source.distanceKmPerVehicle),
    dailyDistanceLimitKm: nonNegative(
      source.dailyDistanceLimitKm,
      LOGISTICS_TRAVEL_DEFAULTS.dailyDistanceLimitKm,
    ),
    travelHoursPerDay: nonNegative(
      source.travelHoursPerDay,
      LOGISTICS_TRAVEL_DEFAULTS.travelHoursPerDay,
    ),
    travelCalendarDaysPerTrip,
    travelSaturdayDays: nonNegative(source.travelSaturdayDays),
    travelSundayDays: nonNegative(source.travelSundayDays),
    ticketPerPersonPerTrip: nonNegative(source.ticketPerPersonPerTrip),
    busOvernightMode,
    lodgingNightsPerTrip: nonNegative(
      source.lodgingNightsPerTrip,
      calculationMode === "air_crew_transport"
        ? Math.max(0, travelCalendarDaysPerTrip - 1)
        : busOvernightMode === "hotel_stop" ? 1 : 0,
    ),
    lodgingPerPersonDay: nonNegative(
      source.lodgingPerPersonDay,
      LOGISTICS_TRAVEL_DEFAULTS.lodgingPerPersonDay,
    ),
    mealPerPersonDay: nonNegative(
      source.mealPerPersonDay,
      LOGISTICS_TRAVEL_DEFAULTS.mealPerPersonDay,
    ),
    rentalUse: enumValue(
      source.rentalUse,
      ["", "mobilization_only", "mobilization_and_site"] as const,
      "",
    ),
    rentalDailyRate: nonNegative(source.rentalDailyRate),
    rentalSiteDays: nonNegative(source.rentalSiteDays),
    fuelEfficiencyKmPerLiter: nonNegative(
      source.fuelEfficiencyKmPerLiter,
      usesTruckDefaults
        ? LOGISTICS_TRAVEL_DEFAULTS.companyTruckFuelEfficiencyKmPerLiter
        : LOGISTICS_TRAVEL_DEFAULTS.companyCarFuelEfficiencyKmPerLiter,
    ),
    fuelPricePerLiter: nonNegative(
      source.fuelPricePerLiter,
      usesTruckDefaults
        ? LOGISTICS_TRAVEL_DEFAULTS.dieselPricePerLiter
        : LOGISTICS_TRAVEL_DEFAULTS.gasolinePricePerLiter,
    ),
    tollPerVehicleKm: nonNegative(
      source.tollPerVehicleKm,
      usesTruckDefaults
        ? LOGISTICS_TRAVEL_DEFAULTS.companyTruckTollPerVehicleKm
        : LOGISTICS_TRAVEL_DEFAULTS.companyCarTollPerVehicleKm,
    ),
    vehicleOperatingCostPerKm: nonNegative(source.vehicleOperatingCostPerKm),
    additionalCosts: arrayValue(source.additionalCosts).map(normalizeLogisticsAdditionalCost),
    unitCost: nonNegative(source.unitCost),
    taxPercent: boundedPercent(source.taxPercent, 0),
    marginPercent: boundedPercent(source.marginPercent, LEC_FREIGHT_MARGIN_PERCENT),
    contingencyPercent: boundedPercent(source.contingencyPercent, 0, 1000),
    returnSetup,
    included: booleanValue(source.included, true),
  };
}

export const LOGISTICS_RETURN_MIRROR_FIELDS: ReadonlyArray<keyof LogisticsItem> = [
  "category",
  "calculationMode",
  "calculationModeConfirmed",
  "contextId",
  "basis",
  "quantity",
  "trips",
  "travelerCountMode",
  "travelerCount",
  "travelerAssignments",
  "travelerAssignmentsConfirmed",
  "vehicleCountMode",
  "vehicleCount",
  "passengersPerVehicle",
  "distanceKmPerVehicle",
  "dailyDistanceLimitKm",
  "travelHoursPerDay",
  "travelCalendarDaysPerTrip",
  "travelSaturdayDays",
  "travelSundayDays",
  "ticketPerPersonPerTrip",
  "busOvernightMode",
  "lodgingNightsPerTrip",
  "lodgingPerPersonDay",
  "mealPerPersonDay",
  "rentalUse",
  "rentalDailyRate",
  "rentalSiteDays",
  "fuelEfficiencyKmPerLiter",
  "fuelPricePerLiter",
  "tollPerVehicleKm",
  "vehicleOperatingCostPerKm",
  "additionalCosts",
  "unitCost",
  "taxPercent",
  "marginPercent",
  "contingencyPercent",
];

function copyMobilizationIntoDemobilization(
  mobilization: LogisticsItem,
  demobilization: LogisticsItem,
): LogisticsItem {
  const mirrored = { ...demobilization };
  LOGISTICS_RETURN_MIRROR_FIELDS.forEach((field) => {
    (mirrored as unknown as Record<string, unknown>)[field] =
      (mobilization as unknown as Record<string, unknown>)[field];
  });
  return {
    ...mirrored,
    travelerAssignments: mobilization.travelerAssignments.map((item) => ({ ...item })),
    additionalCosts: mobilization.additionalCosts.map((item) => ({ ...item })),
    autoSyncedFromMobilization: true,
    returnSetup: demobilization.returnSetup,
    included: true,
  };
}

function synchronizeLinkedDemobilizations(logistics: LogisticsItem[]): LogisticsItem[] {
  return logistics.map((item) => {
    if (
      item.direction !== "demobilization"
      || (!item.requiredSlot && !item.mobilizationSourceId)
      || !item.autoSyncedFromMobilization
      || item.returnSetup === "custom"
    ) return item;
    const mobilization = logistics.find((candidate) =>
      candidate.direction === "mobilization"
      && candidate.destinationId === item.destinationId
      && (item.mobilizationSourceId
        ? candidate.id === item.mobilizationSourceId
        : candidate.requiredSlot && candidate.slotType === item.slotType));
    return mobilization
      ? copyMobilizationIntoDemobilization(mobilization, item)
      : item;
  });
}

/**
 * A tela antiga permitia usar o slot de equipamentos para uma segunda equipe
 * e cadastrar o frete em itens adicionais. Corrige somente o par inequívoco:
 * dois slots de equipamentos usados para equipe e exatamente um transporte
 * separado de equipamentos por sentido/destino. Nunca usa a descrição como
 * critério, escolhe entre vários fretes, troca valores ou ativa transporte conjunto.
 */
function reclassifyLegacyLogisticsSlots(logistics: LogisticsItem[]): LogisticsItem[] {
  const replacements = new Map<string, LogisticsItem>();
  for (const destinationId of new Set(logistics.map((item) => item.destinationId))) {
    const pairs = (["mobilization", "demobilization"] as const).map((direction) => {
      const items = logistics.filter((item) => item.destinationId === destinationId && item.direction === direction);
      const equipment = items.filter((item) => item.requiredSlot && item.slotType === "equipment");
      const freight = items.filter((item) => !item.requiredSlot && item.slotType === "additional"
        && item.included && item.calculationModeConfirmed
        && ["external_freight", "company_truck_driver"].includes(item.calculationMode));
      const crew = equipment[0];
      if (equipment.length !== 1 || freight.length !== 1 || !crew.included || !crew.calculationModeConfirmed
        || !["company_crew_vehicle", "rental_crew_vehicle", "bus_crew_transport", "air_crew_transport"].includes(crew.calculationMode)) {
        return null;
      }
      return { crew, freight: freight[0] };
    });
    const [outbound, inbound] = pairs;
    if (!outbound || !inbound) continue;
    for (const pair of [outbound, inbound]) {
      replacements.set(pair.crew.id, {
        ...pair.crew,
        slotType: "crew",
        requiredSlot: false,
        category: "personnel",
        ...(pair === inbound ? { mobilizationSourceId: outbound.crew.id } : {}),
      });
      replacements.set(pair.freight.id, {
        ...pair.freight,
        slotType: "equipment",
        requiredSlot: true,
      });
    }
  }
  return logistics.map((item) => replacements.get(item.id) || item);
}

function normalizeCommercialLine(value: unknown, index: number): CommercialLine {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "commercial", index),
    description: textValue(source.description, `Item comercial ${index + 1}`),
    unit: textValue(source.unit, "serviço"),
    quantity: nonNegative(source.quantity, 1),
    unitValue: nonNegative(source.unitValue),
  };
}

function normalizeRepresentativeCommission(value: unknown): RepresentativeCommissionSettings {
  const source = objectValue(value);
  return {
    enabled: booleanValue(source.enabled, false),
    representativeName: textValue(source.representativeName ?? source.name),
    percent: boundedPercent(source.percent, 0),
    basis: enumValue(
      source.basis,
      ["net_after_tax", "gross_invoice"] as const,
      "net_after_tax",
    ),
  };
}

function normalizeEmployeeReferralBonus(value: unknown, index: number): EmployeeReferralBonus {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "employee-referral", index),
    employeeName: textValue(source.employeeName ?? source.name),
    amount: nonNegative(source.amount ?? source.value),
    included: booleanValue(source.included, true),
  };
}

function normalizePresentationAdjustment(
  value: unknown,
  index: number,
): ProposalPresentationAdjustment {
  const source = objectValue(value);
  return {
    id: importedId(source.id, "presentation-adjustment", index),
    sourceLineId: textValue(source.sourceLineId ?? source.lineId),
    value: nonNegative(source.value ?? source.amount),
  };
}

function normalizeCommercial(value: unknown, legacy: Record<string, unknown>): CommercialSettings {
  const source = objectValue(value);
  const modeValue = source.pricingMode ?? legacy.pricingMode;
  const legacyLines = source.lines ?? legacy.commercialLines;
  return {
    pricingMode: enumValue(modeValue, ["calculated", "labor", "commercial_lines", "fabrication", "global"] as const, "calculated"),
    globalValue: nonNegative(source.globalValue ?? legacy.globalValue),
    lines: arrayValue(legacyLines).map(normalizeCommercialLine),
    includeQqp: booleanValue(source.includeQqp ?? legacy.includeQqp, false),
    hiddenQqpIds: arrayValue(source.hiddenQqpIds ?? legacy.hiddenQqpIds ?? legacy.hiddenQqpIndirects)
      .map((item) => String(item)).filter(Boolean),
    representativeCommission: normalizeRepresentativeCommission(source.representativeCommission),
    employeeReferralBonuses: arrayValue(source.employeeReferralBonuses)
      .map(normalizeEmployeeReferralBonus),
    presentationAdjustments: arrayValue(source.presentationAdjustments)
      .map(normalizePresentationAdjustment)
      .filter((item) => item.sourceLineId && item.value > 0),
  };
}

function normalizeScopeConfirmations(
  value: unknown,
  legacy: {
    laborContexts: LaborContext[];
    materials: MaterialItem[];
    volumeSystems: VolumeSystem[];
    products: ProductRequirement[];
    filters: FilterRequirement[];
    effluent: EffluentSettings;
    logistics: LogisticsItem[];
  },
): CostScopeConfirmations {
  const source = objectValue(value);
  const isHistorical = value === undefined || value === null;
  const hasHistoricalLabor = legacy.laborContexts.length > 0;
  const hasHistoricalInputs = legacy.materials.length > 0
    || legacy.volumeSystems.some((system) =>
      system.pipeSegments.length > 0
      || system.hoseSegments.length > 0
      || system.equipmentVolumes.length > 0
      || system.manualVolumes.length > 0)
    || legacy.products.length > 0
    || legacy.filters.some((filter) => filter.included && filter.quantity > 0)
    || legacy.effluent.includeDisposalCost;
  const hasHistoricalLogistics = legacy.logistics.some((item) => item.included);
  return {
    noLabor: booleanValue(source.noLabor, isHistorical && !hasHistoricalLabor),
    noInputs: booleanValue(source.noInputs, isHistorical && !hasHistoricalInputs),
    noLogistics: booleanValue(source.noLogistics, isHistorical && !hasHistoricalLogistics),
    combinedCrewAndEquipmentTransport: booleanValue(
      source.combinedCrewAndEquipmentTransport,
      false,
    ),
    mobilizationCrewAlreadyOnSite: booleanValue(source.mobilizationCrewAlreadyOnSite, false),
    demobilizationCrewAlreadyOnSite: booleanValue(source.demobilizationCrewAlreadyOnSite, false),
  };
}

function migrateLegacyContexts(source: Record<string, unknown>, assumptions: CostEstimateAssumptions): LaborContext[] {
  const legacyLines = arrayValue(source.lines);
  if (!legacyLines.length) return [];
  const groups = new Map<number, unknown[]>();
  legacyLines.forEach((line) => {
    const months = Math.max(1 / assumptions.workdaysPerMonth, nonNegative(objectValue(line).months, 1));
    const key = roundMeasure(months);
    groups.set(key, [...(groups.get(key) || []), line]);
  });
  return [...groups.entries()].map(([months, lines], contextIndex) => ({
    id: `legacy-context-${contextIndex + 1}`,
    name: groups.size === 1 ? "Execução" : `Execução — ${months} mês${months === 1 ? "" : "es"}`,
    description: "Etapa migrada do levantamento de custos anterior.",
    startOffsetDays: 0,
    durationDays: roundMeasure(months * assumptions.workdaysPerMonth),
    workingDays: roundMeasure(months * assumptions.workdaysPerMonth),
    hoursPerDay: assumptions.monthlyHours / assumptions.workdaysPerMonth,
    workCondition: "",
    workConditionConfirmed: false,
    hotelSiteDistanceKmPerDay: LEC_CONTEXT_EXPENSES.hotelSiteDistanceKmPerDay,
    weekdayExtra70HoursPerDay: 0,
    saturdayCount: 0,
    saturdayHoursPerDay: 0,
    sundayCount: 0,
    sundayHoursPerDay: 0,
    vehicleType: "",
    vehicleCountMode: "automatic",
    vehicleCount: 0,
    assignments: lines.map((line, assignmentIndex) => normalizeAssignment({
      ...objectValue(line),
      id: `legacy-assignment-${contextIndex + 1}-${assignmentIndex + 1}`,
      monthlySalary: objectValue(line).salary,
      adjustment: objectValue(line).adjustment
        ?? (objectValue(line).salary === undefined ? undefined : 0),
      allocationPercent: 100,
    }, assignmentIndex)),
    expenses: [],
    enabled: true,
  }));
}

function createDefaultLogisticsSlot(
  id: string,
  destinationId: string,
  direction: LogisticsDirection,
  slotType: "crew" | "equipment",
): LogisticsItem {
  const isCrew = slotType === "crew";
  const directionLabel = direction === "mobilization" ? "Mobilização" : "Desmobilização";
  return {
    id,
    destinationId,
    slotType,
    requiredSlot: true,
    autoSyncedFromMobilization: direction === "demobilization",
    direction,
    category: isCrew ? "personnel" : "equipment",
    description: `${directionLabel} da ${isCrew ? "equipe" : "equipamento"}`,
    calculationMode: "",
    calculationModeConfirmed: false,
    basis: "fixed",
    quantity: 1,
    trips: 1,
    travelerCountMode: "automatic",
    travelerCount: 0,
    travelerAssignments: [],
    travelerAssignmentsConfirmed: true,
    vehicleCountMode: "automatic",
    vehicleCount: 0,
    passengersPerVehicle: LOGISTICS_TRAVEL_DEFAULTS.passengersPerCompanyCar,
    distanceKmPerVehicle: 0,
    dailyDistanceLimitKm: LOGISTICS_TRAVEL_DEFAULTS.dailyDistanceLimitKm,
    travelHoursPerDay: LOGISTICS_TRAVEL_DEFAULTS.travelHoursPerDay,
    travelCalendarDaysPerTrip: 1,
    travelSaturdayDays: 0,
    travelSundayDays: 0,
    ticketPerPersonPerTrip: 0,
    busOvernightMode: "",
    lodgingNightsPerTrip: 0,
    lodgingPerPersonDay: LOGISTICS_TRAVEL_DEFAULTS.lodgingPerPersonDay,
    mealPerPersonDay: LOGISTICS_TRAVEL_DEFAULTS.mealPerPersonDay,
    rentalUse: "",
    rentalDailyRate: 0,
    rentalSiteDays: 0,
    fuelEfficiencyKmPerLiter: isCrew
      ? LOGISTICS_TRAVEL_DEFAULTS.companyCarFuelEfficiencyKmPerLiter
      : LOGISTICS_TRAVEL_DEFAULTS.companyTruckFuelEfficiencyKmPerLiter,
    fuelPricePerLiter: isCrew
      ? LOGISTICS_TRAVEL_DEFAULTS.gasolinePricePerLiter
      : LOGISTICS_TRAVEL_DEFAULTS.dieselPricePerLiter,
    tollPerVehicleKm: isCrew
      ? LOGISTICS_TRAVEL_DEFAULTS.companyCarTollPerVehicleKm
      : LOGISTICS_TRAVEL_DEFAULTS.companyTruckTollPerVehicleKm,
    vehicleOperatingCostPerKm: 0,
    additionalCosts: [],
    unitCost: 0,
    taxPercent: LEC_FREIGHT_TAX_COMMISSION_PERCENT,
    marginPercent: LEC_FREIGHT_MARGIN_PERCENT,
    contingencyPercent: 0,
    returnSetup: direction === "demobilization" ? "pending" : "custom",
    included: true,
  };
}

export function createDefaultCostEstimatePayload(): CostEstimatePayloadV2 {
  return {
    schemaVersion: 2,
    logisticsStructureVersion: 1,
    title: "Levantamento de custos Filtrovali",
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    laborContexts: [{
      id: "pre-engenharia",
      name: "",
      description: "",
      startOffsetDays: 0,
      durationDays: 30,
      workingDays: 22,
      hoursPerDay: DEFAULT_HOURS_PER_DAY,
      workCondition: "",
      workConditionConfirmed: false,
      hotelSiteDistanceKmPerDay: LEC_CONTEXT_EXPENSES.hotelSiteDistanceKmPerDay,
      weekdayExtra70HoursPerDay: 0,
      saturdayCount: 0,
      saturdayHoursPerDay: 0,
      sundayCount: 0,
      sundayHoursPerDay: 0,
      vehicleType: "",
      vehicleCountMode: "automatic",
      vehicleCount: 0,
      assignments: [{
        id: "pre-engenharia-coordenador",
        role: "COORDENADOR",
        quantity: 1,
        monthlySalary: 5392.37,
        adjustment: 0,
        allocationPercent: 100,
        shift: "day",
        nightPremiumPercent: 35,
      }],
      expenses: LEC_CONTEXT_EXPENSE_PRESETS.map((item, index) => ({
        ...item,
        id: `pre-engenharia-expense-${index + 1}`,
        included: item.basis === "per_vehicle_staffed_day",
      })),
      enabled: true,
    }],
    indirectCosts: [],
    materials: [],
    volumeSystems: [
      {
        id: "carbono",
        name: "Sistema em aço carbono",
        material: "carbon_steel",
        pipeSegments: [],
        hoseSegments: [],
        equipmentVolumes: [],
        manualVolumes: [],
        cycles: 1,
        enabled: true,
      },
      {
        id: "inox",
        name: "Sistema em aço inox",
        material: "stainless_steel",
        pipeSegments: [],
        hoseSegments: [],
        equipmentVolumes: [],
        manualVolumes: [],
        cycles: 1,
        enabled: true,
      },
    ],
    circuitServices: [],
    products: [
      {
        id: "acido-citrico",
        systemId: "carbono",
        productName: "Ácido cítrico",
        unit: "kg",
        doseMode: "percent_volume",
        dose: 5,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 15.58,
        manualQuantity: 0,
        included: true,
      },
      {
        id: "barrilha-leve",
        systemId: "carbono",
        productName: "Barrilha leve",
        unit: "kg",
        doseMode: "percent_volume",
        dose: 7.5,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 3.14,
        manualQuantity: 0,
        included: true,
      },
      {
        id: "soda-caustica",
        systemId: "carbono",
        productName: "Soda cáustica",
        unit: "kg",
        doseMode: "percent_volume",
        dose: 1.5,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 7.36,
        manualQuantity: 0,
        included: true,
      },
      {
        id: "nitrito-sodio",
        systemId: "carbono",
        productName: "Nitrito de sódio",
        unit: "kg",
        doseMode: "percent_volume",
        dose: 1.5,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 8.34,
        manualQuantity: 0,
        included: true,
      },
      {
        id: "tripolifosfato-sodio",
        systemId: "carbono",
        productName: "Tripolifosfato de sódio",
        unit: "kg",
        doseMode: "percent_volume",
        dose: 0.75,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 12.75,
        manualQuantity: 0,
        included: true,
      },
      {
        id: "metassilicato-sodio",
        systemId: "carbono",
        productName: "Metassilicato de sódio",
        unit: "kg",
        doseMode: "percent_volume",
        dose: 0.75,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 3.63,
        manualQuantity: 0,
        included: true,
      },
      {
        id: "acido-fosforico",
        systemId: "carbono",
        productName: "Ácido fosfórico",
        unit: "kg",
        doseMode: "percent_volume",
        dose: 3,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 15.31,
        manualQuantity: 0,
        included: true,
      },
      {
        id: "acido-muriatico",
        systemId: "carbono",
        productName: "Ácido muriático",
        unit: "kg",
        doseMode: "manual",
        dose: 0,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 6.37,
        manualQuantity: 0,
        included: false,
      },
      {
        id: "bd-clinox",
        systemId: "inox",
        productName: "BD-Clinox",
        unit: "kg",
        doseMode: "percent_volume",
        dose: 10,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 20,
        manualQuantity: 0,
        included: false,
      },
      {
        id: "passivante-avesta-302",
        systemId: "inox",
        productName: "Passivante Avesta® 302",
        unit: "kg",
        doseMode: "manual",
        dose: 0,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 32.9,
        manualQuantity: 0,
        included: false,
      },
      {
        id: "quimipan",
        systemId: "carbono",
        productName: "Quimipan",
        unit: "kg",
        doseMode: "manual",
        dose: 0,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 4,
        manualQuantity: 0,
        included: false,
      },
      {
        id: "acido-nitrico",
        systemId: "inox",
        productName: "Ácido nítrico 53%",
        unit: "kg",
        doseMode: "percent_volume",
        dose: 10,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 3.89,
        manualQuantity: 0,
        included: true,
      },
      {
        id: "oleo-flushing",
        productName: "Óleo para flushing",
        unit: "L",
        doseMode: "manual",
        dose: 0,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 40,
        manualQuantity: 0,
        included: false,
      },
      {
        id: "acido-fluoridrico",
        systemId: "inox",
        productName: "Ácido fluorídrico 65%",
        unit: "kg",
        doseMode: "percent_volume",
        dose: 1,
        densityKgPerL: 1,
        wastePercent: 0,
        packageSize: 0,
        priceBasis: "unit",
        unitCost: 12.17,
        manualQuantity: 0,
        included: true,
      },
    ],
    filters: LEC_FILTER_CATALOG.map((item, index) => ({
      ...item,
      id: `lec-filter-${index + 1}`,
      quantity: 0,
      included: false,
    })),
    effluent: {
      multiplier: 4,
      unitCostPerM3: 0,
      includeDisposalCost: false,
      clientResponsible: true,
    },
    logisticsDestinations: [{
      id: "obra-principal",
      nameSource: "custom",
      name: "Obra principal",
      address: "",
      oneWayDistanceKm: 0,
    }],
    logistics: [
      createDefaultLogisticsSlot("mobilizacao-equipe", "obra-principal", "mobilization", "crew"),
      createDefaultLogisticsSlot("desmobilizacao-equipe", "obra-principal", "demobilization", "crew"),
      createDefaultLogisticsSlot("mobilizacao-equipamento", "obra-principal", "mobilization", "equipment"),
      createDefaultLogisticsSlot("desmobilizacao-equipamento", "obra-principal", "demobilization", "equipment"),
    ],
    scopeConfirmations: {
      noLabor: false,
      noInputs: false,
      noLogistics: false,
      combinedCrewAndEquipmentTransport: false,
      mobilizationCrewAlreadyOnSite: false,
      demobilizationCrewAlreadyOnSite: false,
    },
    commercial: {
      pricingMode: "calculated",
      globalValue: 0,
      lines: [],
      includeQqp: false,
      hiddenQqpIds: [],
      representativeCommission: {
        enabled: false,
        representativeName: "",
        percent: 0,
        basis: "net_after_tax",
      },
      employeeReferralBonuses: [],
      presentationAdjustments: [],
    },
  };
}

export function normalizeCostEstimatePayload(value: unknown): CostEstimatePayloadV2 {
  const source = objectValue(value);
  const assumptions = normalizeAssumptions(source.assumptions);
  const hasV2Contexts = Array.isArray(source.laborContexts);
  const contexts = hasV2Contexts
    ? arrayValue(source.laborContexts).map((item, index) => normalizeLaborContext(item, index, assumptions))
    : migrateLegacyContexts(source, assumptions);
  const legacyIndirects = source.indirectCosts ?? source.indirects;
  const importingLegacyIndirects = source.indirectCosts === undefined && source.indirects !== undefined;
  const materials = arrayValue(source.materials).map(normalizeMaterial);
  const volumeSystems = arrayValue(source.volumeSystems).map(normalizeVolumeSystem);
  const circuitServices = Array.isArray(source.circuitServices)
    ? source.circuitServices.map(normalizeCircuitService)
    : undefined;
  const products = arrayValue(source.products).map(normalizeProduct);
  const deletedProducts = source.deletedProducts === undefined
    ? undefined
    : arrayValue(source.deletedProducts).map(normalizeProduct);
  const filters = arrayValue(source.filters).map(normalizeFilter);
  const effluent = normalizeEffluent(source.effluent);
  const normalizedLogistics = arrayValue(source.logistics).map(normalizeLogistics);
  const importedDestinations = arrayValue(source.logisticsDestinations)
    .map(normalizeLogisticsDestination);
  const inferredDistances = [...new Set(
    normalizedLogistics.map((item) => item.distanceKmPerVehicle),
  )];
  const logisticsDestinations: LogisticsDestination[] = (
    importedDestinations.length
      ? importedDestinations
      : (inferredDistances.length ? inferredDistances : [0]).map((distance, index) => ({
          id: index === 0 ? "obra-principal" : `obra-rota-${index + 1}`,
          nameSource: "custom" as const,
          laborContextId: undefined,
          name: index === 0 ? "Obra principal" : `Destino migrado ${index + 1}`,
          address: "",
          oneWayDistanceKm: distance,
        }))
  ).map((destination) => {
    if (destination.nameSource !== "labor_context") return destination;
    const linkedContext = contexts.find((context) =>
      context.id === destination.laborContextId);
    return linkedContext
      ? {
          ...destination,
          laborContextId: linkedContext.id,
          name: linkedContext.name,
        }
      : {
          ...destination,
          nameSource: "custom",
          laborContextId: undefined,
        };
  });
  const destinationIds = new Set(logisticsDestinations.map((destination) => destination.id));
  const defaultDestination = logisticsDestinations[0];
  const destinationLogistics = normalizedLogistics.map((item) => {
    const inferredDestination = !importedDestinations.length
      ? logisticsDestinations.find((entry) =>
        entry.oneWayDistanceKm === item.distanceKmPerVehicle)
      : undefined;
    const destinationId = item.destinationId && destinationIds.has(item.destinationId)
      ? item.destinationId
      : inferredDestination?.id ?? defaultDestination.id;
    const destination = logisticsDestinations.find((entry) => entry.id === destinationId)
      ?? defaultDestination;
    return {
      ...item,
      destinationId,
      distanceKmPerVehicle: destination.oneWayDistanceKm,
    };
  });
  const synchronizedLogistics = synchronizeLinkedDemobilizations(destinationLogistics);
  const confirmationsSource = objectValue(source.scopeConfirmations);
  const logistics = confirmationsSource.combinedCrewAndEquipmentTransport === true
    || confirmationsSource.noLogistics === true
    ? synchronizedLogistics
    : reclassifyLegacyLogisticsSlots(synchronizedLogistics);
  const scopeConfirmations = normalizeScopeConfirmations(source.scopeConfirmations, {
    laborContexts: contexts,
    materials,
    volumeSystems,
    products,
    filters,
    effluent,
    logistics,
  });
  return {
    schemaVersion: 2,
    logisticsStructureVersion: nonNegative(source.logisticsStructureVersion) >= 1
      || normalizedLogistics.some((item) => item.requiredSlot)
      ? 1
      : 0,
    title: textValue(source.title, "Levantamento de custos Filtrovali"),
    proposalCode: textValue(source.proposalCode) || undefined,
    scheduleStartDate: isoDateValue(source.scheduleStartDate),
    assumptions,
    laborContexts: contexts,
    indirectCosts: arrayValue(legacyIndirects).map((item, index) => {
      if (!importingLegacyIndirects) return normalizeIndirectCost(item, index);
      const legacy = objectValue(item);
      return normalizeIndirectCost({
        ...legacy,
        basis: "per_person_month",
        quantity: 1,
        unitValue: legacy.monthly,
      }, index);
    }),
    materials,
    volumeSystems,
    ...(circuitServices === undefined ? {} : { circuitServices }),
    products,
    ...(deletedProducts === undefined ? {} : { deletedProducts }),
    filters,
    effluent,
    logisticsDestinations,
    logistics,
    scopeConfirmations,
    commercial: normalizeCommercial(source.commercial, source),
  };
}

/** Compatibility alias for server handlers that treat the persisted value as a draft. */
export const normalizeCostDraft = normalizeCostEstimatePayload;

export function roleTotal(role: string): number {
  const found = COST_ROLES.find((item) => item.role === role);
  return found ? found.salary + found.adjustment : 0;
}

export function roleSalary(role: string): number {
  return LEC_LABOR_ROLES.find((item) => item.role === role)?.salary
    ?? COST_ROLES.find((item) => item.role === role)?.salary
    ?? 0;
}

export function roleAdjustment(role: string): number {
  return COST_ROLES.find((item) => item.role === role)?.adjustment ?? 0;
}

function isAuxiliaryLecRole(role: string): boolean {
  const normalized = role.trim().toLocaleUpperCase("pt-BR");
  return LEC_LABOR_ROLES.find((item) => item.role === normalized)?.auxiliary
    ?? (normalized.includes("AUXILIAR") || normalized.includes("ADMINISTRATIVO"));
}

/**
 * Reproduz a composição das abas "Calculo Colaboradores" e
 * "CUSTO.Colaboradores" do LEC v1.2. O adicional de 100% é a extensão
 * solicitada para a mesma base de HE do arquivo, usando multiplicador 2,0.
 */
export function lecLaborCostBreakdown(
  role: string,
  condition: WorkCondition,
  monthlySalary = roleSalary(role),
  adjustment = 0,
  shift: LaborShift = "day",
  nightPremiumPercent = LEC_NIGHT_PREMIUM_PERCENT,
): LecLaborCostBreakdown {
  const baseSalary = nonNegative(monthlySalary) + nonNegative(adjustment);
  const roleDefinition = LEC_LABOR_ROLES.find(
    (item) => item.role === role.trim().toLocaleUpperCase("pt-BR"),
  );
  const shiftFactor = shift === "night" ? 1 + percentRate(nightPremiumPercent) : 1;
  const hourlyDivisor = LEC_MONTHLY_HOURS;

  if (roleDefinition?.usesLoadedMonthlyCost) {
    const normalHourlyCost = baseSalary / hourlyDivisor;
    const shiftPremiumValue = baseSalary * (shiftFactor - 1);
    return {
      role,
      condition,
      usesLoadedMonthlyCost: true,
      baseSalary: roundMoney(baseSalary),
      payrollComponents: roundMoney(baseSalary),
      monthlyCost: roundMoney(baseSalary * shiftFactor),
      normalHourlyCost: roundMeasure(normalHourlyCost * shiftFactor),
      extra70HourlyCost: roundMeasure(normalHourlyCost * LEC_EXTRA_70_MULTIPLIER * shiftFactor),
      extra100HourlyCost: roundMeasure(normalHourlyCost * LEC_EXTRA_100_MULTIPLIER * shiftFactor),
      benefits: 0,
      shiftPremiumValue: roundMoney(shiftPremiumValue),
      extraBaseHourlyCost: roundMeasure(normalHourlyCost * shiftFactor),
      components: [
        {
          id: "loaded-monthly-cost",
          label: "Custo mensal carregado informado",
          value: roundMoney(baseSalary),
          group: "remuneration",
        },
        ...(shiftPremiumValue > 0 ? [{
          id: "night-shift",
          label: `Adicional de turno noturno (${nightPremiumPercent}%)`,
          value: roundMoney(shiftPremiumValue),
          group: "shift" as const,
        }] : []),
      ],
    };
  }

  const insalubrity = LEC_MINIMUM_SALARY * percentRate(LEC_INSALUBRITY_PERCENT);
  const conditionFactor = condition === "headquarters" ? 5 / 7 : 1;
  const hazardPay = baseSalary * .3 * conditionFactor;
  const auxiliary = isAuxiliaryLecRole(role);

  let conditionAdditional = 0;
  if (auxiliary) {
    if (condition === "headquarters") {
      conditionAdditional = (baseSalary + insalubrity + hazardPay) * .05;
    } else if (condition === "travel") {
      conditionAdditional = (baseSalary + insalubrity) * .1;
    } else {
      conditionAdditional = (baseSalary + insalubrity) * .2;
    }
  } else if (condition === "headquarters") {
    conditionAdditional = (baseSalary + insalubrity + hazardPay) * .15;
  } else {
    conditionAdditional = (baseSalary + insalubrity) * .3;
  }

  const recurringPayroll = baseSalary + insalubrity + hazardPay + conditionAdditional;
  const fgts = recurringPayroll * .08;
  const vacation = recurringPayroll / 12;
  const vacationThird = vacation / 3;
  const vacationFgts = (vacation + vacationThird) * .08;
  const thirteenthSalary = recurringPayroll / 12;
  const thirteenthFgts = thirteenthSalary * .08;
  const notice = recurringPayroll / 12;
  const noticeFgts = notice * .08;
  const fgtsFine = (fgts + vacationFgts + thirteenthFgts + noticeFgts) * .5;
  const payrollComponents = recurringPayroll
    + fgts
    + vacation
    + vacationThird
    + vacationFgts
    + thirteenthSalary
    + thirteenthFgts
    + notice
    + noticeFgts
    + fgtsFine;
  const benefits = Object.values(LEC_MONTHLY_BENEFITS).reduce((sum, value) => sum + value, 0);
  const monthlyCost = payrollComponents + benefits;
  const normalHourlyCost = monthlyCost / hourlyDivisor;
  const extraBaseHourlyCost = payrollComponents
    * LEC_EXTRA_PAYROLL_FACTOR
    / (1 - percentRate(LEC_EXTRA_RETENTION_PERCENT))
    / hourlyDivisor;
  const shiftPremiumValue = monthlyCost * (shiftFactor - 1);
  return {
    role,
    condition,
    usesLoadedMonthlyCost: false,
    baseSalary: roundMoney(baseSalary),
    payrollComponents: roundMoney(payrollComponents),
    monthlyCost: roundMoney(monthlyCost * shiftFactor),
    normalHourlyCost: roundMeasure(normalHourlyCost * shiftFactor),
    extra70HourlyCost: roundMeasure(extraBaseHourlyCost * LEC_EXTRA_70_MULTIPLIER * shiftFactor),
    extra100HourlyCost: roundMeasure(extraBaseHourlyCost * LEC_EXTRA_100_MULTIPLIER * shiftFactor),
    benefits: roundMoney(benefits),
    shiftPremiumValue: roundMoney(shiftPremiumValue),
    extraBaseHourlyCost: roundMeasure(extraBaseHourlyCost * shiftFactor),
    components: [
      { id: "base-salary", label: "Salário + ajuste", value: roundMoney(baseSalary), group: "remuneration" },
      { id: "insalubrity", label: "Insalubridade", value: roundMoney(insalubrity), group: "remuneration" },
      { id: "hazard-pay", label: "Periculosidade", value: roundMoney(hazardPay), group: "remuneration" },
      { id: "condition-additional", label: "Adicional da condição de trabalho", value: roundMoney(conditionAdditional), group: "remuneration" },
      { id: "fgts", label: "FGTS", value: roundMoney(fgts), group: "payroll" },
      { id: "vacation", label: "Provisão de férias", value: roundMoney(vacation), group: "payroll" },
      { id: "vacation-third", label: "1/3 de férias", value: roundMoney(vacationThird), group: "payroll" },
      { id: "vacation-fgts", label: "FGTS sobre férias", value: roundMoney(vacationFgts), group: "payroll" },
      { id: "thirteenth", label: "Provisão de 13º salário", value: roundMoney(thirteenthSalary), group: "payroll" },
      { id: "thirteenth-fgts", label: "FGTS sobre 13º", value: roundMoney(thirteenthFgts), group: "payroll" },
      { id: "notice", label: "Provisão de aviso prévio", value: roundMoney(notice), group: "payroll" },
      { id: "notice-fgts", label: "FGTS sobre aviso prévio", value: roundMoney(noticeFgts), group: "payroll" },
      { id: "fgts-fine", label: "Provisão de multa do FGTS", value: roundMoney(fgtsFine), group: "payroll" },
      { id: "life-insurance", label: "Seguro de vida", value: LEC_MONTHLY_BENEFITS.lifeInsurance, group: "benefit" },
      { id: "meal-allowance", label: "Vale alimentação", value: LEC_MONTHLY_BENEFITS.mealAllowance, group: "benefit" },
      { id: "health-plan", label: "Plano de saúde", value: LEC_MONTHLY_BENEFITS.healthPlan, group: "benefit" },
      { id: "dental-plan", label: "Plano odontológico", value: LEC_MONTHLY_BENEFITS.dentalPlan, group: "benefit" },
      { id: "education", label: "Educação / capacitação", value: LEC_MONTHLY_BENEFITS.education, group: "benefit" },
      { id: "housing", label: "Moradia", value: LEC_MONTHLY_BENEFITS.housing, group: "benefit" },
      ...(shiftPremiumValue > 0 ? [{
        id: "night-shift",
        label: `Adicional de turno noturno (${nightPremiumPercent}%)`,
        value: roundMoney(shiftPremiumValue),
        group: "shift" as const,
      }] : []),
    ],
  };
}

export function lecLaborRates(
  role: string,
  condition: WorkCondition,
  monthlySalary = roleSalary(role),
  adjustment = 0,
  shift: LaborShift = "day",
  nightPremiumPercent = LEC_NIGHT_PREMIUM_PERCENT,
): LecLaborRates {
  const breakdown = lecLaborCostBreakdown(
    role,
    condition,
    monthlySalary,
    adjustment,
    shift,
    nightPremiumPercent,
  );
  return {
    role: breakdown.role,
    condition: breakdown.condition,
    baseSalary: breakdown.baseSalary,
    payrollComponents: breakdown.payrollComponents,
    monthlyCost: breakdown.monthlyCost,
    normalHourlyCost: breakdown.normalHourlyCost,
    extra70HourlyCost: breakdown.extra70HourlyCost,
    extra100HourlyCost: breakdown.extra100HourlyCost,
  };
}

/** Returns the applicable payroll-burden multiplier (0.84 means 84% of payroll). */
export function burdenRate(months: number): number {
  const index = Math.max(1, Math.min(60, Math.round(months || 1))) - 1;
  return Math.max(0, ONERATED_RATES[index] ?? ONERATED_RATES[0]);
}

/** Circular pipe volume in liters: π × d² / 4 × length × quantity. */
export function pipeVolumeLiters(segment: Pick<PipeSegment,
  "quantity" | "lengthM" | "internalDiameterMm" | "fillPercent">): number {
  const diameterM = nonNegative(segment.internalDiameterMm) / 1000;
  const lengthM = nonNegative(segment.lengthM);
  const quantity = nonNegative(segment.quantity);
  const fillRate = boundedPercent(segment.fillPercent, 100) / 100;
  return roundMeasure(Math.PI * diameterM * diameterM / 4 * lengthM * quantity * 1000 * fillRate);
}

/** LEC convention: up to five days are all useful; longer periods use 5/7, rounded up. */
export function lecBusinessDays(calendarDays: number): number {
  const days = nonNegative(calendarDays);
  return days <= 5 ? days : Math.ceil(days / 7 * 5);
}

/** Common offshore preset: up to 21 consecutive 12-hour days, starting on Monday. */
export function offshoreWorkSchedule(calendarDays: number) {
  const durationDays = Math.max(1, Math.min(21, Math.round(finiteNumber(calendarDays, 1))));
  const completeWeeks = Math.floor(durationDays / 7);
  const remainingDays = durationDays % 7;
  const saturdayCount = completeWeeks + (remainingDays > 5 ? 1 : 0);
  const sundayCount = completeWeeks + (remainingDays > 6 ? 1 : 0);
  return {
    durationDays,
    workingDays: durationDays - saturdayCount - sundayCount,
    hoursPerDay: 12,
    weekdayExtra70HoursPerDay: 0,
    saturdayCount,
    saturdayHoursPerDay: saturdayCount > 0 ? 12 : 0,
    sundayCount,
    sundayHoursPerDay: sundayCount > 0 ? 12 : 0,
  };
}

function payloadUsesUnionOvertime(assumptions: CostEstimateAssumptions): boolean {
  return assumptions.overtimePolicy === "union_monthly_30_v1";
}

function calculateContext(context: LaborContext, assumptions: CostEstimateAssumptions): LaborContextResult {
  const usesLecLabor = assumptions.laborPricingModel === LEC_LABOR_PRICING_MODEL;
  const workingDays = context.workingDays === undefined
    ? usesLecLabor
      ? lecBusinessDays(context.durationDays)
      : context.durationDays
    : context.workingDays;
  const months = workingDays / assumptions.workdaysPerMonth;
  const overtimeCalendarMonths = Math.max(1, Math.ceil(context.durationDays / 30));
  const assignments = context.assignments.map<LaborAssignmentResult>((assignment) => {
    const allocatedQuantity = assignment.quantity * assignment.allocationPercent / 100;
    const scheduleDays = assignment.workSchedule?.days;
    const scheduledActiveDays = scheduleDays?.reduce(
      (sum, day) => sum + (day.normalHoursPerDay > 0 || day.extraHoursPerDay > 0 ? day.days : 0),
      0,
    );
    const activeDays = scheduleDays
      ? (scheduledActiveDays ?? 0)
      : usesLecLabor
        ? workingDays + context.saturdayCount + context.sundayCount
        : workingDays;
    const assignmentMonths = scheduleDays ? activeDays / assumptions.workdaysPerMonth : months;
    const employeeMonths = allocatedQuantity * assignmentMonths;
    const personDays = allocatedQuantity * activeDays;
    const normalHours = scheduleDays
      ? allocatedQuantity * scheduleDays.reduce(
        (sum, day) => sum + day.days * day.normalHoursPerDay,
        0,
      )
      : allocatedQuantity * workingDays * context.hoursPerDay;
    const requestedExtra70Hours = usesLecLabor
      ? scheduleDays
        ? allocatedQuantity * scheduleDays.reduce(
          (sum, day) => sum + (day.overtimePercent === 70 ? day.days * day.extraHoursPerDay : 0),
          0,
        )
        : allocatedQuantity * (
          workingDays * context.weekdayExtra70HoursPerDay
          + context.saturdayCount * context.saturdayHoursPerDay
        )
      : 0;
    const explicitExtra100Hours = usesLecLabor && scheduleDays
      ? allocatedQuantity * scheduleDays.reduce(
        (sum, day) => sum + (day.overtimePercent === 100 ? day.days * day.extraHoursPerDay : 0),
        0,
      )
      : usesLecLabor
        ? allocatedQuantity * context.sundayCount * context.sundayHoursPerDay
        : 0;
    const customExtraHours = usesLecLabor && scheduleDays
      ? allocatedQuantity * scheduleDays.reduce(
        (sum, day) => sum + (
          day.overtimePercent !== 70 && day.overtimePercent !== 100
            ? day.days * day.extraHoursPerDay
            : 0
        ),
        0,
      )
      : 0;
    const extra70LimitHours = payloadUsesUnionOvertime(assumptions)
      ? allocatedQuantity
        * LEC_MONTHLY_EXTRA_70_LIMIT_HOURS
        * overtimeCalendarMonths
      : requestedExtra70Hours;
    const extra70Hours = Math.min(requestedExtra70Hours, extra70LimitHours);
    const extra70ConvertedTo100Hours = Math.max(
      0,
      requestedExtra70Hours - extra70Hours,
    );
    const extra100Hours = explicitExtra100Hours + extra70ConvertedTo100Hours;
    const laborHours = normalHours + extra70Hours + extra100Hours + customExtraHours;

    if (usesLecLabor) {
      const breakdown = lecLaborCostBreakdown(
        assignment.role,
        context.workCondition || "headquarters",
        assignment.monthlySalary,
        assignment.adjustment,
        assignment.shift,
        assignment.nightPremiumPercent ?? LEC_NIGHT_PREMIUM_PERCENT,
      );
      const rates = breakdown;
      const normalCost = roundMoney(normalHours * rates.normalHourlyCost);
      const extra70Cost = roundMoney(extra70Hours * rates.extra70HourlyCost);
      const extra100Cost = roundMoney(extra100Hours * rates.extra100HourlyCost);
      const customExtraCost = roundMoney(scheduleDays?.reduce((sum, day) => {
        if (day.overtimePercent === 70 || day.overtimePercent === 100) return sum;
        const hours = allocatedQuantity * day.days * day.extraHoursPerDay;
        return sum + hours * breakdown.extraBaseHourlyCost * (1 + day.overtimePercent / 100);
      }, 0) ?? 0);
      const baseLaborCost = normalCost + extra70Cost + extra100Cost + customExtraCost;
      return {
        ...assignment,
        allocatedQuantity: roundMeasure(allocatedQuantity),
        employeeMonths: roundMeasure(employeeMonths),
        personDays: roundMeasure(personDays),
        laborHours: roundMeasure(laborHours),
        normalHours: roundMeasure(normalHours),
        extra70Hours: roundMeasure(extra70Hours),
        extra100Hours: roundMeasure(extra100Hours),
        extra70ConvertedTo100Hours: roundMeasure(extra70ConvertedTo100Hours),
        effectiveMonthlySalary: rates.monthlyCost,
        normalHourlyCost: rates.normalHourlyCost,
        extra70HourlyCost: rates.extra70HourlyCost,
        extra100HourlyCost: rates.extra100HourlyCost,
        dailyNormalCost: roundMoney(rates.normalHourlyCost * context.hoursPerDay),
        monthlyLoadedCost: rates.monthlyCost,
        normalCost,
        extra70Cost,
        extra100Cost,
        ...(scheduleDays ? {
          customExtraHours: roundMeasure(customExtraHours),
          customExtraCost,
        } : {}),
        burdenRate: 0,
        baseLaborCost: roundMoney(baseLaborCost),
        burdenCost: 0,
        total: roundMoney(baseLaborCost),
      };
    }

    const shiftPremium = assignment.shift === "night" ? percentRate(assignment.nightPremiumPercent ?? 35) : 0;
    const effectiveMonthlySalary = (assignment.monthlySalary + assignment.adjustment) * (1 + shiftPremium);
    const rate = assignment.burdenRateOverride ?? burdenRate(months);
    const baseLaborCost = employeeMonths * effectiveMonthlySalary;
    const burdenCost = baseLaborCost * rate;
    const total = baseLaborCost + burdenCost;
    const normalHourlyCost = laborHours > 0 ? roundMeasure(total / laborHours) : 0;
    const monthlyLoadedCost = roundMoney(effectiveMonthlySalary * (1 + rate));
    return {
      ...assignment,
      allocatedQuantity: roundMeasure(allocatedQuantity),
      employeeMonths: roundMeasure(employeeMonths),
      personDays: roundMeasure(personDays),
      laborHours: roundMeasure(laborHours),
      normalHours: roundMeasure(normalHours),
      extra70Hours: 0,
      extra100Hours: 0,
      extra70ConvertedTo100Hours: 0,
      effectiveMonthlySalary: roundMoney(effectiveMonthlySalary),
      normalHourlyCost,
      extra70HourlyCost: 0,
      extra100HourlyCost: 0,
      dailyNormalCost: roundMoney(normalHourlyCost * context.hoursPerDay),
      monthlyLoadedCost,
      normalCost: roundMoney(total),
      extra70Cost: 0,
      extra100Cost: 0,
      ...(scheduleDays ? {
        customExtraHours: roundMeasure(customExtraHours),
        customExtraCost: 0,
      } : {}),
      burdenRate: rate,
      baseLaborCost: roundMoney(baseLaborCost),
      burdenCost: roundMoney(burdenCost),
      total: roundMoney(total),
    };
  });
  const headcount = assignments.reduce((sum, item) => sum + item.allocatedQuantity, 0);
  const employeeMonths = assignments.reduce((sum, item) => sum + item.employeeMonths, 0);
  const personDays = assignments.reduce((sum, item) => sum + item.personDays, 0);
  const laborHours = assignments.reduce((sum, item) => sum + item.laborHours, 0);
  const normalHours = assignments.reduce((sum, item) => sum + item.normalHours, 0);
  const extra70Hours = assignments.reduce((sum, item) => sum + item.extra70Hours, 0);
  const extra100Hours = assignments.reduce((sum, item) => sum + item.extra100Hours, 0);
  const extra70ConvertedTo100Hours = assignments.reduce(
    (sum, item) => sum + item.extra70ConvertedTo100Hours,
    0,
  );
  const baseLaborCost = assignments.reduce((sum, item) => sum + item.baseLaborCost, 0);
  const burdenCost = assignments.reduce((sum, item) => sum + item.burdenCost, 0);
  const laborCost = baseLaborCost + burdenCost;
  const vehicleCapacity = context.vehicleType ? VEHICLE_CAPACITIES[context.vehicleType] : 0;
  const vehicleCount = context.vehicleType === "none"
    ? 0
    : context.vehicleCountMode === "manual"
      ? context.vehicleCount
      : headcount > 0 && vehicleCapacity > 0
        ? Math.ceil(headcount / vehicleCapacity)
        : 0;
  const hasIndividualSchedules = assignments.some((assignment) => assignment.workSchedule);
  const staffedDays = hasIndividualSchedules
    ? assignments.reduce((maximum, assignment) => {
      if (assignment.allocatedQuantity <= 0) return maximum;
      return Math.max(maximum, assignment.personDays / assignment.allocatedQuantity);
    }, 0)
    : usesLecLabor
      ? workingDays + context.saturdayCount + context.sundayCount
      : workingDays;
  const expenses = context.expenses.filter((item) => item.included).map<ContextExpenseResult>((expense) => {
    const quantity = expense.quantity;
    let basisQuantity = 1;
    if (expense.basis === "per_person") basisQuantity = headcount;
    if (expense.basis === "per_person_day") basisQuantity = personDays;
    if (expense.basis === "per_person_calendar_day") {
      basisQuantity = headcount * context.durationDays;
    }
    if (expense.basis === "per_person_workday") {
      basisQuantity = hasIndividualSchedules ? personDays : headcount * workingDays;
    }
    if (expense.basis === "per_person_month") basisQuantity = employeeMonths;
    if (expense.basis === "per_vehicle_calendar_day") {
      basisQuantity = vehicleCount * context.durationDays;
    }
    if (expense.basis === "per_vehicle_workday") basisQuantity = vehicleCount * workingDays;
    if (expense.basis === "per_vehicle_staffed_day") {
      basisQuantity = context.workCondition === "travel"
        ? vehicleCount * staffedDays
        : 0;
    }
    if (expense.basis === "per_context_day") basisQuantity = workingDays;
    if (expense.basis === "per_context_month") basisQuantity = months;
    const total = expense.basis === "percent_labor"
      ? laborCost * percentRate(expense.unitValue) * quantity
      : basisQuantity * expense.unitValue * quantity;
    return { ...expense, basisQuantity: roundMeasure(basisQuantity), total: roundMoney(total) };
  });
  const expenseCost = expenses.reduce((sum, item) => sum + item.total, 0);
  return {
    id: context.id,
    name: context.name,
    startOffsetDays: context.startOffsetDays,
    durationDays: context.durationDays,
    workingDays: roundMeasure(workingDays),
    months: roundMeasure(months),
    headcount: roundMeasure(headcount),
    workCondition: context.workCondition,
    vehicleType: context.vehicleType,
    vehicleCapacity,
    vehicleCount: roundMeasure(vehicleCount),
    hotelSiteDistanceKmPerDay: roundMeasure(context.hotelSiteDistanceKmPerDay),
    employeeMonths: roundMeasure(employeeMonths),
    personDays: roundMeasure(personDays),
    laborHours: roundMeasure(laborHours),
    normalHours: roundMeasure(normalHours),
    extra70Hours: roundMeasure(extra70Hours),
    extra100Hours: roundMeasure(extra100Hours),
    extra70ConvertedTo100Hours: roundMeasure(extra70ConvertedTo100Hours),
    baseLaborCost: roundMoney(baseLaborCost),
    burdenCost: roundMoney(burdenCost),
    laborCost: roundMoney(laborCost),
    expenseCost: roundMoney(expenseCost),
    total: roundMoney(laborCost + expenseCost),
    assignments,
    expenses,
  };
}

function calculatePeakHeadcount(contexts: LaborContextResult[]): number {
  const points = new Set<number>();
  contexts.forEach((context) => {
    points.add(context.startOffsetDays);
    points.add(context.startOffsetDays + context.durationDays);
  });
  let peak = 0;
  [...points].sort((a, b) => a - b).forEach((point) => {
    const active = contexts.reduce((sum, context) => {
      const end = context.startOffsetDays + context.durationDays;
      return context.durationDays > 0 && context.startOffsetDays <= point && point < end
        ? sum + context.headcount
        : sum;
    }, 0);
    peak = Math.max(peak, active);
  });
  return roundMeasure(peak);
}

function calculateIndirectCost(
  item: IndirectCost,
  contexts: LaborContextResult[],
  laborCost: number,
  peakHeadcount: number,
): IndirectCostResult {
  const totalEmployeeMonths = contexts.reduce((sum, context) => sum + context.employeeMonths, 0);
  const totalPersonDays = contexts.reduce((sum, context) => sum + context.personDays, 0);
  const totalPersonCalendarDays = contexts.reduce(
    (sum, context) => sum + context.headcount * context.durationDays,
    0,
  );
  const totalPersonWorkdays = contexts.reduce(
    (sum, context) => sum + context.headcount * context.workingDays,
    0,
  );
  const totalVehicleWorkdays = contexts.reduce(
    (sum, context) => sum + context.vehicleCount * context.workingDays,
    0,
  );
  const totalVehicleCalendarDays = contexts.reduce(
    (sum, context) => sum + context.vehicleCount * context.durationDays,
    0,
  );
  const totalVehicleStaffedDays = contexts.reduce(
    (sum, context) => sum + (
      context.workCondition === "travel"
        ? context.vehicleCount
          * (context.headcount > 0 ? context.personDays / context.headcount : context.workingDays)
        : 0
    ),
    0,
  );
  const totalContextDays = contexts.reduce((sum, context) => sum + context.workingDays, 0);
  const totalContextMonths = contexts.reduce((sum, context) => sum + context.months, 0);
  let basisQuantity = 1;
  if (item.basis === "per_person") basisQuantity = peakHeadcount;
  if (item.basis === "per_person_day") basisQuantity = totalPersonDays;
  if (item.basis === "per_person_calendar_day") basisQuantity = totalPersonCalendarDays;
  if (item.basis === "per_person_workday") basisQuantity = totalPersonWorkdays;
  if (item.basis === "per_person_month") basisQuantity = totalEmployeeMonths;
  if (item.basis === "per_vehicle_calendar_day") basisQuantity = totalVehicleCalendarDays;
  if (item.basis === "per_vehicle_workday") basisQuantity = totalVehicleWorkdays;
  if (item.basis === "per_vehicle_staffed_day") basisQuantity = totalVehicleStaffedDays;
  if (item.basis === "per_context_day") basisQuantity = totalContextDays;
  if (item.basis === "per_context_month") basisQuantity = totalContextMonths;
  const total = item.basis === "percent_labor"
    ? laborCost * percentRate(item.unitValue) * item.quantity
    : basisQuantity * item.unitValue * item.quantity;
  return {
    ...item,
    basisQuantity: roundMeasure(basisQuantity),
    total: roundMoney(total),
  };
}

function calculateMaterial(item: MaterialItem): MaterialResult {
  const quantityWithWaste = item.quantity * (1 + percentRate(item.wastePercent));
  const itemCost = quantityWithWaste * item.unitCost;
  return {
    ...item,
    quantityWithWaste: roundMeasure(quantityWithWaste),
    itemCost: roundMoney(itemCost),
    total: roundMoney(itemCost + item.freightValue),
  };
}

function calculateVolumeSystem(system: VolumeSystem): VolumeSystemResult {
  const pipeSegments = system.pipeSegments.map<PipeSegmentResult>((segment) => ({
    ...segment,
    volumeLiters: pipeVolumeLiters(segment),
  }));
  const hoseSegments = system.hoseSegments.map<HoseSegmentResult>((segment) => ({
    ...segment,
    volumeLiters: pipeVolumeLiters(segment),
  }));
  const equipmentVolumes = system.equipmentVolumes
    .filter((item) => item.included)
    .map<EquipmentVolumeResult>((item) => ({
      ...item,
      totalVolumeLiters: roundMeasure(item.quantity * item.volumeLiters),
    }));
  const manualVolumes = system.manualVolumes.map<ManualVolumeResult>((item) => ({
    ...item,
    totalVolumeLiters: roundMeasure(item.quantity * item.volumeLiters),
  }));
  const pipeVolumeLitersTotal = pipeSegments.reduce((sum, item) => sum + item.volumeLiters, 0);
  const hoseVolumeLiters = hoseSegments.reduce((sum, item) => sum + item.volumeLiters, 0);
  const equipmentVolumeLiters = equipmentVolumes.reduce((sum, item) => sum + item.totalVolumeLiters, 0);
  const manualVolumeLiters = manualVolumes.reduce((sum, item) => sum + item.totalVolumeLiters, 0);
  const physicalVolumeLiters = pipeVolumeLitersTotal
    + hoseVolumeLiters
    + equipmentVolumeLiters
    + manualVolumeLiters;
  return {
    id: system.id,
    name: system.name,
    material: system.material,
    pipeVolumeLiters: roundMeasure(pipeVolumeLitersTotal),
    hoseVolumeLiters: roundMeasure(hoseVolumeLiters),
    equipmentVolumeLiters: roundMeasure(equipmentVolumeLiters),
    manualVolumeLiters: roundMeasure(manualVolumeLiters),
    physicalVolumeLiters: roundMeasure(physicalVolumeLiters),
    cycles: system.cycles,
    totalVolumeLiters: roundMeasure(physicalVolumeLiters * system.cycles),
    pipeSegments,
    hoseSegments,
    equipmentVolumes,
    manualVolumes,
  };
}

function quantityForProduct(product: ProductRequirement, sourceVolumeLiters: number): number {
  if (product.doseMode === "manual") return product.manualQuantity;
  if (product.doseMode === "percent_volume") {
    const liters = sourceVolumeLiters * percentRate(product.dose);
    return product.unit.toLowerCase().startsWith("kg") ? liters * product.densityKgPerL : liters;
  }
  if (product.doseMode === "liters_per_m3") {
    const liters = sourceVolumeLiters / 1000 * product.dose;
    return product.unit.toLowerCase().startsWith("kg") ? liters * product.densityKgPerL : liters;
  }
  const kilograms = sourceVolumeLiters / 1000 * product.dose;
  return product.unit.toLowerCase().startsWith("l") ? kilograms / product.densityKgPerL : kilograms;
}

function calculateProduct(product: ProductRequirement, volumes: VolumeSystemResult[]): ProductResult {
  const selectedVolumes = product.systemId && product.systemId !== "*"
    ? volumes.filter((system) => system.id === product.systemId)
    : volumes;
  const sourceVolumeLiters = selectedVolumes.reduce((sum, system) => sum + system.totalVolumeLiters, 0);
  const doseQuantity = quantityForProduct(product, sourceVolumeLiters);
  const requiredQuantity = doseQuantity * (1 + percentRate(product.wastePercent));
  const packageCount = product.packageSize > 0 ? Math.ceil(requiredQuantity / product.packageSize) : 0;
  const purchaseQuantity = product.packageSize > 0 ? packageCount * product.packageSize : requiredQuantity;
  const total = product.priceBasis === "package"
    ? packageCount * product.unitCost
    : purchaseQuantity * product.unitCost;
  return {
    ...product,
    sourceVolumeLiters: roundMeasure(sourceVolumeLiters),
    requiredQuantity: roundMeasure(requiredQuantity),
    purchaseQuantity: roundMeasure(purchaseQuantity),
    packageCount,
    total: roundMoney(total),
  };
}

function calculateFilter(filter: FilterRequirement): FilterResult {
  return {
    ...filter,
    total: roundMoney(filter.quantity * filter.unitCost),
  };
}

function calculateLogisticsItem(
  item: LogisticsItem,
  contextResults: LaborContextResult[],
  peakHeadcount: number,
  totalPersonDays: number,
  assumptions: CostEstimateAssumptions,
): LogisticsResult {
  const linkedContext = item.contextId ? contextResults.find((context) => context.id === item.contextId) : undefined;
  const isCompanyCrewVehicle = item.calculationMode === "company_crew_vehicle";
  const isRentalCrewVehicle = item.calculationMode === "rental_crew_vehicle";
  const isBusCrewTransport = item.calculationMode === "bus_crew_transport";
  const isAirCrewTransport = item.calculationMode === "air_crew_transport";
  const isTicketedCrewTransport = isBusCrewTransport || isAirCrewTransport;
  const isCrewTransport = isCompanyCrewVehicle
    || isRentalCrewVehicle
    || isTicketedCrewTransport;
  const isCompanyTruck = item.calculationMode === "company_truck_driver";
  const usesRoadVehicle = isCompanyCrewVehicle || isRentalCrewVehicle || isCompanyTruck;
  const usesEmployeeTravel = isCrewTransport || isCompanyTruck;
  const isExternalFreight = item.calculationMode === "external_freight";
  const usesAssignmentTravelers = item.travelerAssignmentsConfirmed;
  const linkedHeadcount = linkedContext?.headcount ?? 0;
  const automaticTravelerAssignments = isCrewTransport && linkedContext
    ? linkedContext.assignments
      .map((assignment) => ({
        assignment,
        quantity: Math.ceil(assignment.allocatedQuantity),
      }))
      .filter((entry) => entry.quantity > 0)
    : [];
  const manualTravelerAssignments = usesEmployeeTravel && linkedContext
    ? item.travelerAssignments
      .map((traveler) => ({
        assignment: linkedContext.assignments.find(
          (assignment) => assignment.id === traveler.assignmentId,
        ),
        quantity: traveler.quantity,
      }))
      .filter((entry): entry is {
        assignment: LaborAssignmentResult;
        quantity: number;
      } => Boolean(entry.assignment) && entry.quantity > 0)
    : [];
  const travelerAssignments = item.travelerCountMode === "manual"
    ? manualTravelerAssignments
    : automaticTravelerAssignments;
  const assignmentPeople = travelerAssignments.reduce(
    (sum, traveler) => sum + traveler.quantity,
    0,
  );
  const legacyAutomaticPeople = isCrewTransport
    ? Math.ceil(linkedHeadcount)
    : isCompanyTruck
      ? item.vehicleCountMode === "manual" ? item.vehicleCount : 1
      : 0;
  const legacyPeople = item.travelerCountMode === "manual"
    ? item.travelerCount
    : legacyAutomaticPeople;
  const people = usesEmployeeTravel
    ? usesAssignmentTravelers ? assignmentPeople : legacyPeople
    : isExternalFreight
      ? 0
      : linkedContext?.headcount ?? peakHeadcount;
  const selectedAverageRate = (
    key: "normalHourlyCost" | "extra70HourlyCost" | "extra100HourlyCost",
  ) => assignmentPeople > 0
    ? travelerAssignments.reduce(
      (sum, traveler) => sum + traveler.quantity * traveler.assignment[key],
      0,
    ) / assignmentPeople
    : 0;
  const legacyAverageRate = (
    key: "normalHourlyCost" | "extra70HourlyCost" | "extra100HourlyCost",
  ) => linkedContext && linkedHeadcount > 0
    ? linkedContext.assignments.reduce(
      (sum, assignment) => sum + assignment.allocatedQuantity * assignment[key],
      0,
    ) / linkedHeadcount
    : 0;
  const averageRate = (
    key: "normalHourlyCost" | "extra70HourlyCost" | "extra100HourlyCost",
  ) => usesAssignmentTravelers
    ? selectedAverageRate(key)
    : legacyAverageRate(key);
  const averageNormalHourlyCost = averageRate("normalHourlyCost");
  const averageExtra70HourlyCost = averageRate("extra70HourlyCost");
  const averageExtra100HourlyCost = averageRate("extra100HourlyCost");
  const vehicleCapacity = isCompanyCrewVehicle || isRentalCrewVehicle
    ? Math.min(
      LOGISTICS_TRAVEL_DEFAULTS.passengersPerCompanyCar,
      Math.max(1, item.passengersPerVehicle),
    )
    : isCompanyTruck
      ? 1
      : 0;
  const automaticVehicleCount = isCompanyCrewVehicle || isRentalCrewVehicle
    ? people > 0 ? Math.ceil(people / vehicleCapacity) : 0
    : isCompanyTruck
      ? usesAssignmentTravelers ? people : 1
      : linkedContext?.vehicleCount
        ?? contextResults.reduce((maximum, context) => Math.max(maximum, context.vehicleCount), 0)
        ?? 0;
  const calculatedVehicleCount = isExternalFreight
    ? item.quantity
    : isTicketedCrewTransport
      ? 0
      : usesRoadVehicle
      ? item.vehicleCountMode === "manual" ? item.vehicleCount : automaticVehicleCount
      : item.vehicleCount > 0 ? item.vehicleCount : automaticVehicleCount;
  let basisQuantity = 1;
  if (item.basis === "per_person") basisQuantity = people;
  if (item.basis === "per_person_day") {
    basisQuantity = linkedContext?.personDays ?? totalPersonDays;
  }
  if (item.basis === "per_trip") basisQuantity = item.trips;
  if (item.basis === "per_km") basisQuantity = item.trips * Math.max(1, calculatedVehicleCount);
  const routeTravelDays = item.distanceKmPerVehicle > 0 && item.dailyDistanceLimitKm > 0
    ? Math.ceil(item.distanceKmPerVehicle / item.dailyDistanceLimitKm)
    : 0;
  const travelDays = usesRoadVehicle
    ? routeTravelDays * item.trips
    : isTicketedCrewTransport
      ? item.travelCalendarDaysPerTrip * item.trips
      : 0;
  const travelSaturdayDays = Math.min(travelDays, item.travelSaturdayDays);
  const travelSundayDays = Math.min(
    Math.max(0, travelDays - travelSaturdayDays),
    item.travelSundayDays,
  );
  const travelWeekdays = Math.max(0, travelDays - travelSaturdayDays - travelSundayDays);
  const fleetDistanceKm = usesRoadVehicle
    ? item.distanceKmPerVehicle * calculatedVehicleCount * item.trips
    : 0;
  const normalTravelHoursPerWeekday = Math.min(DEFAULT_HOURS_PER_DAY, item.travelHoursPerDay);
  const extra70TravelHoursPerWeekday = Math.max(
    0,
    item.travelHoursPerDay - normalTravelHoursPerWeekday,
  );
  const requestedExtra70TravelHoursPerPerson = (
    travelWeekdays * extra70TravelHoursPerWeekday
    + travelSaturdayDays * item.travelHoursPerDay
  );
  const overtimeCalendarMonths = Math.max(1, Math.ceil(travelDays / 30));
  const extra70TravelLimitHoursPerPerson = payloadUsesUnionOvertime(assumptions)
    ? LEC_MONTHLY_EXTRA_70_LIMIT_HOURS * overtimeCalendarMonths
    : requestedExtra70TravelHoursPerPerson;
  const extra70TravelHoursPerPerson = Math.min(
    requestedExtra70TravelHoursPerPerson,
    extra70TravelLimitHoursPerPerson,
  );
  const extra70TravelConvertedTo100HoursPerPerson = Math.max(
    0,
    requestedExtra70TravelHoursPerPerson - extra70TravelHoursPerPerson,
  );
  const extra100TravelHoursPerPerson = (
    travelSundayDays * item.travelHoursPerDay
    + extra70TravelConvertedTo100HoursPerPerson
  );
  const normalTravelHoursPerPerson = travelWeekdays * normalTravelHoursPerWeekday;
  const travelLaborHours = usesEmployeeTravel
    ? people * travelDays * item.travelHoursPerDay
    : 0;
  const travelLaborCost = usesEmployeeTravel
    ? usesAssignmentTravelers
      ? travelerAssignments.reduce((sum, traveler) => sum + traveler.quantity * (
        normalTravelHoursPerPerson * traveler.assignment.normalHourlyCost
        + extra70TravelHoursPerPerson * traveler.assignment.extra70HourlyCost
        + extra100TravelHoursPerPerson * traveler.assignment.extra100HourlyCost
      ), 0)
      : people * (
        normalTravelHoursPerPerson * averageNormalHourlyCost
        + extra70TravelHoursPerPerson * averageExtra70HourlyCost
        + extra100TravelHoursPerPerson * averageExtra100HourlyCost
      )
    : 0;
  const lodgingNights = usesRoadVehicle
    ? travelDays
    : isBusCrewTransport && item.busOvernightMode === "hotel_stop"
      ? item.lodgingNightsPerTrip * item.trips
      : isAirCrewTransport && item.travelCalendarDaysPerTrip > 1
        ? item.lodgingNightsPerTrip * item.trips
        : 0;
  const lodgingCost = usesEmployeeTravel
    ? people * lodgingNights * item.lodgingPerPersonDay
    : 0;
  const mealCost = usesEmployeeTravel
    ? people * travelDays * item.mealPerPersonDay
    : 0;
  const ticketCost = isTicketedCrewTransport
    ? people * item.ticketPerPersonPerTrip * item.trips
    : 0;
  const rentalDays = isRentalCrewVehicle
    ? travelDays + (
        item.direction === "mobilization"
        && item.rentalUse === "mobilization_and_site"
          ? item.rentalSiteDays
          : 0
      )
    : 0;
  const rentalCost = isRentalCrewVehicle
    ? calculatedVehicleCount * rentalDays * item.rentalDailyRate
    : 0;
  const fuelLiters = usesRoadVehicle && item.fuelEfficiencyKmPerLiter > 0
    ? fleetDistanceKm / item.fuelEfficiencyKmPerLiter
    : 0;
  const fuelCost = fuelLiters * item.fuelPricePerLiter;
  const tollCost = usesRoadVehicle ? fleetDistanceKm * item.tollPerVehicleKm : 0;
  const vehicleOperatingCost = isCompanyCrewVehicle || isCompanyTruck
    ? fleetDistanceKm * item.vehicleOperatingCostPerKm
    : 0;
  const additionalCostTotal = item.additionalCosts
    .filter((additional) => additional.included)
    .reduce((sum, additional) => {
      let multiplier = 1;
      if (additional.basis === "per_vehicle") multiplier = calculatedVehicleCount;
      if (additional.basis === "per_trip") multiplier = item.trips;
      if (additional.basis === "per_vehicle_trip") {
        multiplier = calculatedVehicleCount * item.trips;
      }
      return sum + additional.quantity * additional.unitCost * multiplier;
    }, 0);
  const legacyBaseCost = item.quantity * basisQuantity * item.unitCost;
  const externalFreightBaseCost = item.quantity * item.trips * item.unitCost;
  const ownedVehicleBaseCost = travelLaborCost
    + ticketCost
    + lodgingCost
    + mealCost
    + rentalCost
    + fuelCost
    + tollCost
    + vehicleOperatingCost;
  const baseCost = item.calculationMode === "legacy"
    ? legacyBaseCost + additionalCostTotal
    : isExternalFreight
      ? externalFreightBaseCost + additionalCostTotal
      : usesEmployeeTravel
        ? ownedVehicleBaseCost + additionalCostTotal
        : 0;
  const directCost = baseCost * (1 + percentRate(item.contingencyPercent));
  const taxRate = percentRate(item.taxPercent);
  const marginFactor = 1 + percentRate(item.marginPercent);
  const freightDenominator = 1 - taxRate * marginFactor;
  const chargeValue = freightDenominator > MIN_PRICING_DENOMINATOR
    ? directCost * marginFactor / freightDenominator
    : 0;
  const taxValue = chargeValue * taxRate;
  return {
    ...item,
    people: roundMeasure(people),
    personDays: roundMeasure(usesEmployeeTravel
      ? people * travelDays
      : linkedContext?.personDays ?? totalPersonDays),
    calculatedVehicleCount: roundMeasure(calculatedVehicleCount),
    vehicleCapacity,
    travelDays: roundMeasure(travelDays),
    travelWeekdays: roundMeasure(travelWeekdays),
    fleetDistanceKm: roundMeasure(fleetDistanceKm),
    travelLaborHours: roundMeasure(travelLaborHours),
    averageNormalHourlyCost: roundMoney(averageNormalHourlyCost),
    averageExtra70HourlyCost: roundMoney(averageExtra70HourlyCost),
    averageExtra100HourlyCost: roundMoney(averageExtra100HourlyCost),
    travelLaborCost: roundMoney(travelLaborCost),
    ticketCost: roundMoney(ticketCost),
    lodgingNights: roundMeasure(lodgingNights),
    lodgingCost: roundMoney(lodgingCost),
    mealCost: roundMoney(mealCost),
    rentalDays: roundMeasure(rentalDays),
    rentalCost: roundMoney(rentalCost),
    fuelLiters: roundMeasure(fuelLiters),
    fuelCost: roundMoney(fuelCost),
    tollCost: roundMoney(tollCost),
    vehicleOperatingCost: roundMoney(vehicleOperatingCost),
    additionalCostTotal: roundMoney(additionalCostTotal),
    basisQuantity: roundMeasure(basisQuantity),
    baseCost: roundMoney(baseCost),
    taxValue: roundMoney(taxValue),
    costWithTax: roundMoney(directCost + taxValue),
    chargeValue: roundMoney(chargeValue),
    total: roundMoney(directCost),
  };
}

type CostLineSeed = Omit<
  ProposalPriceLine,
  "unitValue" | "value" | "calculatedValue" | "presentationAdjustment"
>;
type BaseProposalPriceLine = Omit<
  ProposalPriceLine,
  "calculatedValue" | "presentationAdjustment"
>;

function buildCostLineSeeds(payload: CostEstimatePayloadV2, result: CostEstimateResultV2): CostLineSeed[] {
  const seeds: CostLineSeed[] = [];
  const usesLecLabor = payload.assumptions.laborPricingModel === LEC_LABOR_PRICING_MODEL;
  result.contextResults.forEach((context) => {
    context.assignments.forEach((assignment) => {
      if (usesLecLabor) {
        const laborLines = [
          ["normal", "HH normal", assignment.normalHours, assignment.normalCost],
          ["extra-70", "HH extra 70%", assignment.extra70Hours, assignment.extra70Cost],
          ["extra-100", "HH extra 100%", assignment.extra100Hours, assignment.extra100Cost],
          [
            "extra-variable",
            "HH extra com percentual configurado",
            assignment.customExtraHours ?? 0,
            assignment.customExtraCost ?? 0,
          ],
        ] as const;
        laborLines.forEach(([suffix, label, quantity, costValue]) => {
          if (quantity <= 0 && costValue <= 0) return;
          seeds.push({
            id: `labor:${context.id}:${assignment.id}:${suffix}`,
            sourceId: assignment.id,
            category: "Mão de obra",
            description: `${context.name} — ${assignment.role} — ${label}`,
            unit: "HH",
            quantity,
            costValue,
          });
        });
        return;
      }
      seeds.push({
        id: `labor:${context.id}:${assignment.id}`,
        sourceId: assignment.id,
        category: "Mão de obra",
        description: `${context.name} — ${assignment.role}`,
        unit: "HH",
        quantity: assignment.laborHours,
        costValue: assignment.total,
      });
    });
    context.expenses.forEach((expense) => {
      seeds.push({
        id: `expense:${context.id}:${expense.id}`,
        sourceId: expense.id,
        category: "Custos da etapa",
        description: `${context.name} — ${expense.name}`,
        unit: "serviço",
        quantity: 1,
        costValue: expense.total,
      });
    });
  });
  result.indirectResults.forEach((item) => {
    if (item.total <= 0) return;
    seeds.push({
      id: `indirect:${item.id}`,
      sourceId: item.id,
      category: "Custos indiretos",
      description: item.name,
      unit: "serviço",
      quantity: 1,
      costValue: item.total,
    });
  });
  result.materialResults.forEach((item) => {
    seeds.push({
      id: `material:${item.id}`,
      sourceId: item.id,
      category: item.category === "material" ? "Materiais" : "Insumos",
      description: item.description,
      unit: item.unit,
      quantity: item.quantityWithWaste,
      costValue: item.total,
    });
  });
  result.productResults.forEach((item) => {
    seeds.push({
      id: `product:${item.id}`,
      sourceId: item.id,
      category: "Produtos e insumos",
      description: item.productName,
      unit: item.unit,
      quantity: item.purchaseQuantity,
      costValue: item.total,
    });
  });
  result.filterResults.forEach((item) => {
    seeds.push({
      id: `filter:${item.id}`,
      sourceId: item.id,
      category: "Filtros",
      description: [item.filterName, item.micronRating].filter(Boolean).join(" — "),
      unit: item.unit,
      quantity: item.quantity,
      costValue: item.total,
    });
  });
  if (result.effluentCost > 0) {
    seeds.push({
      id: "effluent:disposal",
      category: "Efluente",
      description: "Transporte e destinação de efluente",
      unit: "m³",
      quantity: result.effluentVolumeLiters / 1_000,
      costValue: result.effluentCost,
    });
  }
  result.logisticsResults.forEach((item) => {
    seeds.push({
      id: `logistics:${item.id}`,
      sourceId: item.id,
      category: item.direction === "mobilization" ? "Mobilização" : "Desmobilização",
      description: item.description,
      unit: "serviço",
      quantity: 1,
      costValue: item.total,
    });
  });
  return seeds.filter((item) => item.costValue > 0 || item.quantity > 0);
}

function reconcileProposalLineTotal(
  lines: BaseProposalPriceLine[],
  salePrice: number,
): BaseProposalPriceLine[] {
  if (!lines.length) return lines;
  const reconciled = lines.map((line) => ({ ...line }));
  const difference = roundMoney(
    salePrice - reconciled.reduce((sum, line) => sum + line.value, 0),
  );
  const reconciliationTarget = reconciled.reduce(
    (largest, line) => line.value > largest.value ? line : largest,
    reconciled[0],
  );
  reconciliationTarget.value = roundMoney(Math.max(0, reconciliationTarget.value + difference));
  reconciliationTarget.unitValue = roundMoney(
    reconciliationTarget.value / Math.max(1, reconciliationTarget.quantity),
  );
  return reconciled;
}

function applyProposalPresentationAdjustments(
  lines: BaseProposalPriceLine[],
  commercial: CommercialSettings,
  salePrice: number,
): ProposalPriceLine[] {
  const reconciled = reconcileProposalLineTotal(lines, salePrice);
  const base = reconciled.map((line) => ({
    ...line,
    calculatedValue: roundMoney(line.value),
    presentationAdjustment: 0,
  }));
  if (!base.length || !commercial.presentationAdjustments.length) return base;

  const targetIndexes = base
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      line.category !== "Mobilização"
      && line.category !== "Desmobilização"
      && line.calculatedValue > 0)
    .map(({ index }) => index);
  if (!targetIndexes.length) return base;

  const requestedBySource = new Map<string, number>();
  commercial.presentationAdjustments.forEach((adjustment) => {
    requestedBySource.set(
      adjustment.sourceLineId,
      (requestedBySource.get(adjustment.sourceLineId) || 0) + adjustment.value,
    );
  });
  let transferredCents = 0;
  base.forEach((line) => {
    if (line.category !== "Mobilização" && line.category !== "Desmobilização") return;
    const requestedCents = Math.round((requestedBySource.get(line.id) || 0) * 100);
    const availableCents = Math.max(0, Math.round(line.calculatedValue * 100));
    const appliedCents = Math.min(requestedCents, availableCents);
    if (appliedCents <= 0) return;
    const applied = roundMoney(appliedCents / 100);
    line.presentationAdjustment = -applied;
    line.value = roundMoney(line.calculatedValue - applied);
    line.unitValue = roundMoney(line.value / Math.max(1, line.quantity));
    transferredCents += appliedCents;
  });
  if (transferredCents <= 0) return base;

  const targetBasisCents = targetIndexes.reduce(
    (sum, index) => sum + Math.max(0, Math.round(base[index].calculatedValue * 100)),
    0,
  );
  let remainingCents = transferredCents;
  targetIndexes.forEach((index, position) => {
    const target = base[index];
    const isLast = position === targetIndexes.length - 1;
    const basisCents = Math.max(0, Math.round(target.calculatedValue * 100));
    const allocatedCents = isLast
      ? remainingCents
      : Math.min(
          remainingCents,
          Math.round(transferredCents * basisCents / Math.max(1, targetBasisCents)),
        );
    remainingCents -= allocatedCents;
    const allocated = roundMoney(allocatedCents / 100);
    target.presentationAdjustment = allocated;
    target.value = roundMoney(target.calculatedValue + allocated);
    target.unitValue = roundMoney(target.value / Math.max(1, target.quantity));
  });
  return base;
}

function buildProposalPricesFromResult(payload: CostEstimatePayloadV2, result: CostEstimateResultV2): ProposalPriceLine[] {
  const mode = payload.commercial.pricingMode;
  let baseLines: BaseProposalPriceLine[];
  if (mode === "global") {
    baseLines = [{
      id: "commercial:global",
      category: "Valor global",
      description: payload.title || "Valor global dos serviços",
      unit: "serviço",
      quantity: 1,
      unitValue: roundMoney(result.salePrice),
      value: roundMoney(result.salePrice),
      costValue: roundMoney(result.directCost),
    }];
  } else if (mode === "commercial_lines" || mode === "fabrication") {
    const commercialTotal = payload.commercial.lines.reduce((sum, item) => sum + item.quantity * item.unitValue, 0);
    const grossUpFactor = commercialTotal > 0 ? result.salePrice / commercialTotal : 0;
    baseLines = payload.commercial.lines.map((item) => {
      const enteredValue = item.quantity * item.unitValue;
      const value = enteredValue * grossUpFactor;
      const allocatedCost = commercialTotal > 0 ? result.directCost * enteredValue / commercialTotal : 0;
      return {
        id: `commercial:${item.id}`,
        sourceId: item.id,
        category: "Comercial",
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unitValue: roundMoney(value / Math.max(1, item.quantity)),
        value: roundMoney(value),
        costValue: roundMoney(allocatedCost),
      };
    });
  } else {
    const rawSeeds = buildCostLineSeeds(payload, result);
    const rawCostTotal = rawSeeds.reduce((sum, item) => sum + item.costValue, 0);
    const seeds = rawSeeds.length
      ? rawSeeds.map((item) => ({
          ...item,
          costValue: roundMoney(
            rawCostTotal > 0
              ? item.costValue * result.directCost / rawCostTotal
              : result.directCost / rawSeeds.length,
          ),
        }))
      : result.salePrice > 0
        ? [{
            id: "service:global",
            category: "Serviços",
            description: payload.title || "Serviços Filtrovali",
            unit: "serviço",
            quantity: 1,
            costValue: roundMoney(result.directCost),
          }]
        : [];
    const costTotal = seeds.reduce((sum, item) => sum + item.costValue, 0);
    if (costTotal <= 0) {
      const equalValue = seeds.length ? result.salePrice / seeds.length : 0;
      baseLines = seeds.map((item) => ({
        ...item,
        unitValue: roundMoney(equalValue / Math.max(1, item.quantity)),
        value: roundMoney(equalValue),
      }));
    } else {
      baseLines = seeds.map((item) => {
        const value = result.salePrice * item.costValue / costTotal;
        return {
          ...item,
          unitValue: roundMoney(value / Math.max(1, item.quantity)),
          value: roundMoney(value),
          costValue: roundMoney(item.costValue),
        };
      });
    }
  }
  return applyProposalPresentationAdjustments(
    baseLines,
    payload.commercial,
    result.salePrice,
  );
}

function buildQqpFromResult(payload: CostEstimatePayloadV2, result: CostEstimateResultV2): QqpLine[] {
  const hidden = new Set(payload.commercial.hiddenQqpIds);
  const visible = buildProposalPricesFromResult(payload, result)
    .filter((line) => !hidden.has(line.id) && !(line.sourceId && hidden.has(line.sourceId)))
    .map((line) => ({ ...line }));
  if (!visible.length && result.salePrice > 0) {
    visible.push({
      id: "qqp:consolidated-services",
      category: "Serviços",
      description: payload.title || "Serviços Filtrovali",
      unit: "serviço",
      quantity: 1,
      unitValue: roundMoney(result.salePrice),
      value: roundMoney(result.salePrice),
      costValue: roundMoney(result.directCost),
      calculatedValue: roundMoney(result.salePrice),
      presentationAdjustment: 0,
    });
  }
  const targetIndexes = visible
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      line.category !== "Mobilização"
      && line.category !== "Desmobilização")
    .map(({ index }) => index);
  const distributionTargets = targetIndexes.length
    ? targetIndexes
    : visible.map((_, index) => index);
  const distributeDifference = (
    field: "value" | "costValue",
    expectedTotal: number,
  ) => {
    if (!distributionTargets.length) return;
    const differenceCents = Math.round((
      expectedTotal - visible.reduce((sum, line) => sum + line[field], 0)
    ) * 100);
    if (!differenceCents) return;
    const basisTotalCents = distributionTargets.reduce(
      (sum, index) => sum + Math.max(0, Math.round(visible[index][field] * 100)),
      0,
    );
    let remainingCents = differenceCents;
    distributionTargets.forEach((index, position) => {
      const line = visible[index];
      const isLast = position === distributionTargets.length - 1;
      const basisCents = Math.max(0, Math.round(line[field] * 100));
      const allocatedCents = isLast
        ? remainingCents
        : Math.round(
            differenceCents * (
              basisTotalCents > 0
                ? basisCents / basisTotalCents
                : 1 / distributionTargets.length
            ),
          );
      remainingCents -= allocatedCents;
      const allocated = roundMoney(allocatedCents / 100);
      line[field] = roundMoney(Math.max(0, line[field] + allocated));
      if (field === "value") {
        line.calculatedValue = roundMoney(Math.max(
          0,
          line.calculatedValue + allocated,
        ));
      }
    });
  };
  distributeDifference("value", result.salePrice);
  distributeDifference("costValue", result.directCost);
  return visible.map((line) => ({
    ...line,
    unitValue: roundMoney(line.value / Math.max(1, line.quantity)),
    costUnitValue: roundMoney(line.costValue / Math.max(1, line.quantity)),
    sharePercent: result.salePrice > 0 ? roundMeasure(line.value / result.salePrice * 100) : 0,
    context: line.category === "Mão de obra" ? line.description.split(" — ")[0] : undefined,
  }));
}

type CircuitServiceState = {
  configured: boolean;
  assignments: CircuitServiceAssignment[];
  chemicalSystemIds: Set<string>;
  hasChemicalProducts: boolean;
  hasFilters: boolean;
};

/**
 * Levantamentos anteriores não possuíam `circuitServices`; nesses registros,
 * produtos e filtros continuam com o comportamento histórico. Nos novos, só
 * entram no custo os insumos exigidos pelos serviços ligados a circuitos ativos.
 */
function circuitServiceState(payload: CostEstimatePayloadV2): CircuitServiceState {
  const configured = Array.isArray(payload.circuitServices);
  const enabledSystemIds = new Set(
    payload.volumeSystems.filter((system) => system.enabled).map((system) => system.id),
  );
  const assignments = (payload.circuitServices ?? []).filter((assignment) =>
    enabledSystemIds.has(assignment.systemId)
    && Boolean(getTechnicalServiceDefinition(assignment.serviceId as TechnicalServiceId)));
  const chemicalSystemIds = new Set(
    assignments
      .filter((assignment) => technicalServiceRequiresChemicalProducts(assignment.serviceId))
      .map((assignment) => assignment.systemId),
  );
  return {
    configured,
    assignments,
    chemicalSystemIds,
    hasChemicalProducts: chemicalSystemIds.size > 0,
    hasFilters: assignments.some((assignment) =>
      technicalServiceRequiresFilters(assignment.serviceId)),
  };
}

function productAppliesToCircuitServices(
  product: ProductRequirement,
  services: CircuitServiceState,
): boolean {
  if (!services.configured) return true;
  if (!services.hasChemicalProducts) return false;
  return !product.systemId
    || product.systemId === "*"
    || services.chemicalSystemIds.has(product.systemId);
}

function calculateEstimateCore(input: CostEstimatePayloadV2): CostEstimateResultV2 {
  const payload = normalizeCostEstimatePayload(input);
  const circuitServices = circuitServiceState(payload);
  const contexts = payload.scopeConfirmations.noLabor
    ? []
    : payload.laborContexts.filter((context) => context.enabled);
  const contextResults = contexts.map((context) => calculateContext(context, payload.assumptions));
  const payrollCost = contextResults.reduce((sum, context) => sum + context.laborCost, 0);
  const contextExpenseCost = contextResults.reduce((sum, context) => sum + context.expenseCost, 0);
  const totalPersonDays = contextResults.reduce((sum, context) => sum + context.personDays, 0);
  const peakHeadcount = calculatePeakHeadcount(contextResults);
  const laborCost = payrollCost;
  const indirectResults = payload.indirectCosts.filter((item) => item.included)
    .map((item) => calculateIndirectCost(item, contextResults, laborCost, peakHeadcount));
  const globalIndirectCost = indirectResults.reduce((sum, item) => sum + item.total, 0);
  const indirectCost = contextExpenseCost + globalIndirectCost;
  const materialResults = payload.scopeConfirmations.noInputs
    ? []
    : payload.materials.filter((item) => item.included).map(calculateMaterial);
  const materialCost = materialResults.filter((item) => item.category === "material")
    .reduce((sum, item) => sum + item.total, 0);
  const materialInputCost = materialResults.filter((item) => item.category === "input")
    .reduce((sum, item) => sum + item.total, 0);
  const volumeResults = payload.scopeConfirmations.noInputs
    ? []
    : payload.volumeSystems.filter((system) => system.enabled).map(calculateVolumeSystem);
  const chemicalVolumeResults = circuitServices.configured
    ? volumeResults.filter((system) => circuitServices.chemicalSystemIds.has(system.id))
    : volumeResults;
  const productResults = payload.scopeConfirmations.noInputs
    ? []
    : payload.products.filter((product) =>
      product.included && productAppliesToCircuitServices(product, circuitServices))
      .map((product) => calculateProduct(product, chemicalVolumeResults));
  const productCost = productResults.reduce((sum, item) => sum + item.total, 0);
  const filterResults = payload.scopeConfirmations.noInputs
    ? []
    : payload.filters.filter((filter) =>
      filter.included && (!circuitServices.configured || circuitServices.hasFilters))
      .map(calculateFilter);
  const filterCost = filterResults.reduce((sum, item) => sum + item.total, 0);
  const totalVolumeLiters = volumeResults.reduce((sum, item) => sum + item.totalVolumeLiters, 0);
  const totalPhysicalVolumeLiters = volumeResults.reduce((sum, item) => sum + item.physicalVolumeLiters, 0);
  const effluentVolumeLiters = totalPhysicalVolumeLiters * payload.effluent.multiplier;
  const effluentCost = !payload.scopeConfirmations.noInputs && payload.effluent.includeDisposalCost
    ? effluentVolumeLiters / 1_000 * payload.effluent.unitCostPerM3
    : 0;
  const inputCost = materialInputCost + productCost + filterCost + effluentCost;
  const logisticsResults = payload.scopeConfirmations.noLogistics
    ? []
    : payload.logistics.filter((item) =>
      item.included
      && !isEquipmentTransportCoveredByCrew(item, payload.scopeConfirmations)
      && !isCrewTransportWaived(item, payload.scopeConfirmations))
      .map((item) => calculateLogisticsItem(
        item,
        contextResults,
        peakHeadcount,
        totalPersonDays,
        payload.assumptions,
      ));
  const mobilizationCost = logisticsResults.filter((item) => item.direction === "mobilization")
    .reduce((sum, item) => sum + item.total, 0);
  const demobilizationCost = logisticsResults.filter((item) => item.direction === "demobilization")
    .reduce((sum, item) => sum + item.total, 0);
  const employeeReferralBonusCost = payload.commercial.employeeReferralBonuses
    .filter((item) => item.included)
    .reduce((sum, item) => sum + item.amount, 0);
  const directCost = laborCost
    + indirectCost
    + materialCost
    + inputCost
    + mobilizationCost
    + demobilizationCost
    + employeeReferralBonusCost;
  const usesFiltrovaliPricing = payload.assumptions.pricingModel === FILTROVALI_PRICING_MODEL;
  const taxRate = percentRate(payload.assumptions.taxPercent);
  const marginRate = percentRate(payload.assumptions.desiredMarginPercent);
  const commissionRate = percentRate(payload.assumptions.commissionPercent);
  const overheadRate = percentRate(payload.assumptions.overheadPercent);
  const commercialRate = percentRate(payload.assumptions.commercialPercent);
  const representativeCommission = payload.commercial.representativeCommission;
  const representativeRate = representativeCommission.enabled
    ? percentRate(representativeCommission.percent)
    : 0;
  const representativeCoefficient = representativeCommission.basis === "gross_invoice"
    ? representativeRate
    : representativeRate * (1 - taxRate);
  const netRevenueExpenseRate = commissionRate + overheadRate + commercialRate;
  const availableRateWithoutRepresentative = usesFiltrovaliPricing
    ? 1 - taxRate - marginRate - netRevenueExpenseRate * (1 - taxRate)
    : 1 - taxRate - marginRate - commissionRate;
  const availableRate = availableRateWithoutRepresentative - representativeCoefficient;
  const legacyOverheadValue = directCost * overheadRate;
  const pricingCostBase = usesFiltrovaliPricing ? directCost : directCost + legacyOverheadValue;
  const calculatedSalePriceWithoutRepresentative =
    availableRateWithoutRepresentative > MIN_PRICING_DENOMINATOR
      ? pricingCostBase / availableRateWithoutRepresentative
      : 0;
  const calculatedSalePrice = availableRate > MIN_PRICING_DENOMINATOR
    ? pricingCostBase / availableRate
    : 0;
  const commercialMode = payload.commercial.pricingMode;
  const commercialLinesTotal = payload.commercial.lines.reduce((sum, item) => sum + item.quantity * item.unitValue, 0);
  const manualBaseSalePrice = commercialMode === "global"
    ? payload.commercial.globalValue
    : commercialMode === "commercial_lines" || commercialMode === "fabrication"
      ? commercialLinesTotal
      : calculatedSalePrice;
  const manualRepresentativeGrossUpFactor =
    representativeRate > 0
    && availableRateWithoutRepresentative > MIN_PRICING_DENOMINATOR
    && availableRate > MIN_PRICING_DENOMINATOR
      ? availableRateWithoutRepresentative / availableRate
      : 1;
  const salePrice = commercialMode === "global"
    || commercialMode === "commercial_lines"
    || commercialMode === "fabrication"
      ? representativeRate > 0
        ? Math.max(
            manualBaseSalePrice * manualRepresentativeGrossUpFactor,
            calculatedSalePrice,
          )
        : manualBaseSalePrice
      : calculatedSalePrice;
  const taxValue = salePrice * taxRate;
  const netRevenue = usesFiltrovaliPricing
    ? salePrice - taxValue
    : salePrice - taxValue - salePrice * commissionRate;
  const commissionValue = usesFiltrovaliPricing ? netRevenue * commissionRate : salePrice * commissionRate;
  const representativeCommissionValue = representativeCommission.enabled
    ? representativeCommission.basis === "gross_invoice"
      ? salePrice * representativeRate
      : (salePrice - taxValue) * representativeRate
    : 0;
  const overheadValue = usesFiltrovaliPricing ? netRevenue * overheadRate : legacyOverheadValue;
  const commercialValue = usesFiltrovaliPricing ? netRevenue * commercialRate : 0;
  const costWithOverhead = directCost + overheadValue;
  const profitValue = usesFiltrovaliPricing
    ? netRevenue
      - directCost
      - overheadValue
      - commissionValue
      - representativeCommissionValue
      - commercialValue
    : netRevenue - costWithOverhead - representativeCommissionValue;
  const maximumMarginPercent = Math.max(0, usesFiltrovaliPricing
    ? (1 - taxRate - netRevenueExpenseRate * (1 - taxRate) - representativeCoefficient) * 100
    : (1 - taxRate - commissionRate - representativeCoefficient) * 100);
  const representativeCommissionGrossUpValue =
    commercialMode === "global"
    || commercialMode === "commercial_lines"
    || commercialMode === "fabrication"
      ? salePrice - manualBaseSalePrice
      : calculatedSalePrice - calculatedSalePriceWithoutRepresentative;
  const provisional = {
    schemaVersion: 2 as const,
    contextResults,
    indirectResults,
    materialResults,
    volumeResults,
    productResults,
    filterResults,
    logisticsResults,
    laborCost: roundMoney(laborCost),
    indirectCost: roundMoney(indirectCost),
    materialCost: roundMoney(materialCost),
    inputCost: roundMoney(inputCost),
    filterCost: roundMoney(filterCost),
    effluentVolumeLiters: roundMeasure(effluentVolumeLiters),
    effluentCost: roundMoney(effluentCost),
    mobilizationCost: roundMoney(mobilizationCost),
    demobilizationCost: roundMoney(demobilizationCost),
    directCost: roundMoney(directCost),
    totalCost: roundMoney(directCost),
    overheadValue: roundMoney(overheadValue),
    costWithOverhead: roundMoney(costWithOverhead),
    calculatedSalePrice: roundMoney(calculatedSalePrice),
    salePrice: roundMoney(salePrice),
    taxValue: roundMoney(taxValue),
    commissionValue: roundMoney(commissionValue),
    representativeCommissionValue: roundMoney(representativeCommissionValue),
    representativeCommissionGrossUpValue: roundMoney(representativeCommissionGrossUpValue),
    employeeReferralBonusCost: roundMoney(employeeReferralBonusCost),
    presentationReallocationValue: 0,
    commercialValue: roundMoney(commercialValue),
    netRevenue: roundMoney(netRevenue),
    profitValue: roundMoney(profitValue),
    balance: roundMoney(profitValue),
    margin: salePrice > 0 ? profitValue / salePrice : 0,
    targetMarginPercent: payload.assumptions.desiredMarginPercent,
    suggestedMarginPercent: usesFiltrovaliPricing
      ? DEFAULT_MARGIN_PERCENT
      : lecSuggestedMarginPercent(salePrice || calculatedSalePrice),
    maximumMarginPercent: roundMeasure(maximumMarginPercent),
    pricingDenominator: roundMeasure(availableRate),
    totalVolumeLiters: roundMeasure(totalVolumeLiters),
    totalLaborHours: roundMeasure(contextResults.reduce((sum, context) => sum + context.laborHours, 0)),
    totalPersonDays: roundMeasure(totalPersonDays),
    peakHeadcount,
    proposalPrices: [] as ProposalPriceLine[],
    qqp: [] as QqpLine[],
    validPricing: availableRate > MIN_PRICING_DENOMINATOR,
  };
  provisional.proposalPrices = buildProposalPricesFromResult(payload, provisional);
  provisional.qqp = buildQqpFromResult(payload, provisional);
  provisional.presentationReallocationValue = roundMoney(
    provisional.proposalPrices
      .filter((line) => line.presentationAdjustment < 0)
      .reduce((sum, line) => sum + Math.abs(line.presentationAdjustment), 0),
  );
  return provisional;
}

export function calculateEstimate(value: CostEstimatePayloadV2 | unknown): CostEstimateResultV2 {
  return calculateEstimateCore(normalizeCostEstimatePayload(value));
}

/** Compatibility alias for API code that uses an explicit V2 name. */
export const calculateCostV2 = calculateEstimate;

export function buildProposalPrices(
  value: CostEstimatePayloadV2 | unknown,
  result?: CostEstimateResultV2,
): ProposalPriceLine[] {
  const payload = normalizeCostEstimatePayload(value);
  return buildProposalPricesFromResult(payload, result ?? calculateEstimateCore(payload));
}

export function buildQqp(
  value: CostEstimatePayloadV2 | unknown,
  result?: CostEstimateResultV2,
): QqpLine[] {
  const payload = normalizeCostEstimatePayload(value);
  return buildQqpFromResult(payload, result ?? calculateEstimateCore(payload));
}

function hasMeaningfulLaborPayload(payload: CostEstimatePayloadV2): boolean {
  return payload.laborContexts.some((context) =>
    context.enabled
    && context.assignments.some((assignment) =>
      assignment.quantity > 0 && assignment.allocationPercent > 0));
}

function hasMeaningfulInputsPayload(payload: CostEstimatePayloadV2): boolean {
  const circuitServices = circuitServiceState(payload);
  if (payload.materials.some((item) =>
    item.included
    && item.quantity > 0
    && item.description.trim().length > 0)) return true;
  const volumeResults = payload.volumeSystems
    .filter((system) => system.enabled)
    .map(calculateVolumeSystem);
  if (volumeResults.some((system) => system.physicalVolumeLiters > 0)) return true;
  if (payload.products.some((product) =>
    product.included
    && productAppliesToCircuitServices(product, circuitServices)
    && product.doseMode === "manual"
    && product.manualQuantity > 0)) return true;
  if ((!circuitServices.configured || circuitServices.hasFilters)
    && payload.filters.some((filter) => filter.included && filter.quantity > 0)) return true;
  return payload.effluent.includeDisposalCost
    && volumeResults.some((system) => system.physicalVolumeLiters > 0);
}

export function hasMeaningfulLabor(value: CostEstimatePayloadV2 | unknown): boolean {
  return hasMeaningfulLaborPayload(normalizeCostEstimatePayload(value));
}

export function hasMeaningfulInputs(value: CostEstimatePayloadV2 | unknown): boolean {
  return hasMeaningfulInputsPayload(normalizeCostEstimatePayload(value));
}

/**
 * Compatibilidade: levantamentos antigos, sem a coleção, já eram completos.
 * Nos novos, todo circuito ativo precisa declarar ao menos um serviço válido.
 */
export function hasCompleteCircuitServices(value: CostEstimatePayloadV2 | unknown): boolean {
  const payload = normalizeCostEstimatePayload(value);
  if (!Array.isArray(payload.circuitServices)) return true;
  const services = circuitServiceState(payload);
  const assignedSystemIds = new Set(services.assignments.map((item) => item.systemId));
  return payload.volumeSystems
    .filter((system) => system.enabled)
    .every((system) => assignedSystemIds.has(system.id));
}

function isCrewTransportWaived(
  item: LogisticsItem,
  scopeConfirmations: CostScopeConfirmations,
): boolean {
  if (!item.requiredSlot || item.slotType !== "crew") return false;
  if (scopeConfirmations.noLabor) return true;
  if (item.calculationMode && item.calculationModeConfirmed) return false;
  return item.direction === "mobilization"
    ? scopeConfirmations.mobilizationCrewAlreadyOnSite
    : scopeConfirmations.demobilizationCrewAlreadyOnSite;
}

/**
 * Quando equipe e equipamentos usam o mesmo evento, o card de equipe é a
 * composição financeira única. O slot estrutural de equipamentos permanece no
 * payload para que a opção possa ser desfeita sem perder o que havia nele, mas
 * não é validado nem cobrado enquanto estiver coberto pelo deslocamento conjunto.
 */
function isEquipmentTransportCoveredByCrew(
  item: LogisticsItem,
  scopeConfirmations: CostScopeConfirmations,
): boolean {
  return scopeConfirmations.combinedCrewAndEquipmentTransport
    && item.requiredSlot
    && item.slotType === "equipment";
}

export function logisticsCrewCoverage(
  result: CostEstimateResultV2,
  direction: LogisticsDirection,
): { required: number; covered: number; missing: number } {
  const required = Math.ceil(result.peakHeadcount);
  const covered = Math.ceil(result.logisticsResults
    .filter((item) => item.direction === direction
      && (item.calculationMode === "company_crew_vehicle"
        || item.calculationMode === "rental_crew_vehicle"
        || item.calculationMode === "bus_crew_transport"
        || item.calculationMode === "air_crew_transport"
        || item.calculationMode === "company_truck_driver"))
    .reduce((sum, item) => sum + (
      item.calculationMode === "bus_crew_transport"
      || item.calculationMode === "air_crew_transport"
        ? item.people
        : Math.min(
            item.people,
            item.calculatedVehicleCount * item.vehicleCapacity,
          )
    ), 0));
  return {
    required,
    covered,
    missing: Math.max(0, required - covered),
  };
}

export function validateCostEstimate(value: CostEstimatePayloadV2 | unknown): CostEstimateValidation {
  const payload = normalizeCostEstimatePayload(value);
  const circuitServices = circuitServiceState(payload);
  const errors: CostEstimateValidationIssue[] = [];
  const warnings: CostEstimateValidationIssue[] = [];
  const add = (severity: "error" | "warning", path: string, message: string) => {
    (severity === "error" ? errors : warnings).push({ path, message, severity });
  };
  const usesFiltrovaliPricing = payload.assumptions.pricingModel === FILTROVALI_PRICING_MODEL;
  const taxRate = percentRate(payload.assumptions.taxPercent);
  const netRevenueExpenseRate = usesFiltrovaliPricing
    ? percentRate(payload.assumptions.commissionPercent)
      + percentRate(payload.assumptions.overheadPercent)
      + percentRate(payload.assumptions.commercialPercent)
    : 0;
  const representativeCommission = payload.commercial.representativeCommission;
  const representativeRate = representativeCommission.enabled
    ? percentRate(representativeCommission.percent)
    : 0;
  const representativeCoefficient = representativeCommission.basis === "gross_invoice"
    ? representativeRate
    : representativeRate * (1 - taxRate);
  const denominator = usesFiltrovaliPricing
    ? 1
      - taxRate
      - percentRate(payload.assumptions.desiredMarginPercent)
      - netRevenueExpenseRate * (1 - taxRate)
      - representativeCoefficient
    : 1
      - taxRate
      - percentRate(payload.assumptions.desiredMarginPercent)
      - percentRate(payload.assumptions.commissionPercent)
      - representativeCoefficient;
  if (denominator <= MIN_PRICING_DENOMINATOR) {
    const maximumMargin = Math.max(0, usesFiltrovaliPricing
      ? (1 - taxRate - netRevenueExpenseRate * (1 - taxRate) - representativeCoefficient) * 100
      : (1 - taxRate
        - percentRate(payload.assumptions.commissionPercent)
        - representativeCoefficient) * 100);
    add(
      "error",
      "assumptions.desiredMarginPercent",
      usesFiltrovaliPricing
        ? `A margem deve ser menor que ${roundMeasure(maximumMargin)}% com imposto, comissão, overhead e comercial atuais.`
        : `A margem deve ser menor que ${roundMeasure(maximumMargin)}% com os impostos e a comissão atuais.`,
    );
  }
  const hasLabor = hasMeaningfulLaborPayload(payload);
  const hasInputs = hasMeaningfulInputsPayload(payload);
  const hasIncludedLogistics = payload.logistics.some((item) => item.included);
  if (!payload.scopeConfirmations.noLabor && !hasLabor) {
    add(
      "error",
      "scopeConfirmations.noLabor",
      "Adicione colaboradores ou confirme que este levantamento não terá mão de obra.",
    );
  }
  if (!payload.scopeConfirmations.noInputs && !hasInputs) {
    add(
      "error",
      "scopeConfirmations.noInputs",
      "Adicione materiais ou insumos, ou confirme que este levantamento não terá insumos.",
    );
  }
  if (!payload.scopeConfirmations.noLogistics && !hasIncludedLogistics) {
    add(
      "error",
      "scopeConfirmations.noLogistics",
      "Adicione mobilização e desmobilização, ou confirme que não haverá esses deslocamentos.",
    );
  }
  if (!payload.laborContexts.length && !payload.scopeConfirmations.noLabor) {
    add("warning", "laborContexts", "Nenhuma etapa de mão de obra foi informada.");
  }
  const contextIds = new Set<string>();
  payload.laborContexts.forEach((context, index) => {
    const path = `laborContexts[${index}]`;
    if (contextIds.has(context.id)) add("error", `${path}.id`, "O identificador da etapa está duplicado.");
    contextIds.add(context.id);
    if (payload.scopeConfirmations.noLabor || !context.enabled) return;
    if (!context.name) add("error", `${path}.name`, "Informe o nome da etapa.");
    if (context.durationDays <= 0) add("warning", `${path}.durationDays`, "A etapa não possui duração.");
    if (context.workCondition === "offshore" && context.durationDays > 21) {
      add("error", `${path}.durationDays`, "A escala offshore pode ter no máximo 21 dias consecutivos.");
    }
    if (context.workCondition === "offshore" && context.hoursPerDay > 12) {
      add("error", `${path}.hoursPerDay`, "A jornada offshore pode ter no máximo 12 horas por dia.");
    }
    if (context.workCondition === "offshore"
      && context.hoursPerDay + context.weekdayExtra70HoursPerDay > 12) {
      add(
        "error",
        `${path}.weekdayExtra70HoursPerDay`,
        "Na escala offshore, a jornada normal e a HE dos dias úteis não podem ultrapassar 12 horas no total.",
      );
    }
    if (context.workCondition === "offshore" && context.saturdayHoursPerDay > 12) {
      add("error", `${path}.saturdayHoursPerDay`, "O sábado offshore pode ter no máximo 12 horas.");
    }
    if (context.workCondition === "offshore" && context.sundayHoursPerDay > 12) {
      add("error", `${path}.sundayHoursPerDay`, "O domingo ou feriado offshore pode ter no máximo 12 horas.");
    }
    if (context.workingDays !== undefined && context.workingDays > context.durationDays) {
      add("warning", `${path}.workingDays`, "Os dias trabalhados superam a duração da etapa.");
    }
    if (payload.assumptions.laborPricingModel === LEC_LABOR_PRICING_MODEL) {
      if (!context.workCondition || !context.workConditionConfirmed) {
        add("error", `${path}.workCondition`, "Selecione obrigatoriamente a condição de trabalho da etapa.");
      }
      const staffedDays = (context.workingDays ?? context.durationDays)
        + context.saturdayCount
        + context.sundayCount;
      if (staffedDays > context.durationDays) {
        add("warning", `${path}.saturdayCount`, "A soma dos dias úteis, sábados e domingos/feriados supera a duração da etapa.");
      }
      if (context.hoursPerDay <= 0
        && context.weekdayExtra70HoursPerDay <= 0
        && context.saturdayHoursPerDay <= 0
        && context.sundayHoursPerDay <= 0) {
        add("warning", `${path}.hoursPerDay`, "A etapa não possui jornada de mão de obra.");
      }
      if (!context.vehicleType) {
        add("error", `${path}.vehicleType`, "Selecione o veículo obrigatório da etapa.");
      }
      if (context.workCondition === "travel" && context.vehicleType !== "none") {
        const commuteExpense = context.expenses.find((expense) =>
          expense.code === HOTEL_SITE_COMMUTE_EXPENSE_CODE);
        if (context.hotelSiteDistanceKmPerDay <= 0) {
          add("error", `${path}.hotelSiteDistanceKmPerDay`, "Informe a distância diária entre hotel e obra.");
        }
        if (!commuteExpense || !commuteExpense.included
          || commuteExpense.quantity <= 0 || commuteExpense.unitValue <= 0) {
          add(
            "error",
            `${path}.expenses`,
            "O combustível do deslocamento hotel ↔ obra é obrigatório nas etapas em viagem.",
          );
        }
      }
      if (context.vehicleType !== "none"
        && context.vehicleCountMode === "manual" && context.vehicleCount <= 0
        && context.assignments.some((assignment) => assignment.quantity > 0)) {
        add("warning", `${path}.vehicleCount`, "Informe quantos veículos serão usados ou selecione o cálculo automático.");
      }
    }
    context.assignments.forEach((assignment, assignmentIndex) => {
      const assignmentPath = `${path}.assignments[${assignmentIndex}]`;
      if (!assignment.role) add("error", `${assignmentPath}.role`, "Informe a função do colaborador.");
      if (payload.assumptions.laborPricingModel === LEC_LABOR_PRICING_MODEL
        && !LEC_LABOR_ROLES.some((role) => role.role === assignment.role)) {
        add("warning", `${assignmentPath}.role`, "Cargo histórico preservado e calculado pela composição LEC. Se possível, selecione um dos cargos oficiais.");
      }
      if (assignment.quantity <= 0) add("warning", `${assignmentPath}.quantity`, "A quantidade do colaborador está zerada.");
      if (assignment.monthlySalary + assignment.adjustment <= 0) {
        add("warning", `${assignmentPath}.monthlySalary`, "O custo mensal do colaborador está zerado.");
      }
      const schedule = assignment.workSchedule;
      if (schedule) {
        if (schedule.targetType === "collaborator" && !schedule.collaboratorName) {
          add(
            "error",
            `${assignmentPath}.workSchedule.collaboratorName`,
            "Informe o colaborador ao qual esta jornada se aplica.",
          );
        }
        if (schedule.targetType === "collaborator" && assignment.quantity !== 1) {
          add(
            "error",
            `${assignmentPath}.quantity`,
            "Uma jornada nominal deve representar exatamente um colaborador.",
          );
        }
        if (!schedule.days.length) {
          add(
            "error",
            `${assignmentPath}.workSchedule.days`,
            "Informe ao menos um grupo de dias para a jornada.",
          );
        }
        const dayTypes = new Set<LaborScheduleDayType>();
        let scheduledDays = 0;
        schedule.days.forEach((day, dayIndex) => {
          const dayPath = `${assignmentPath}.workSchedule.days[${dayIndex}]`;
          if (dayTypes.has(day.dayType)) {
            add(
              "error",
              `${dayPath}.dayType`,
              "O mesmo tipo de dia aparece mais de uma vez na jornada.",
            );
          }
          dayTypes.add(day.dayType);
          if (day.normalHoursPerDay + day.extraHoursPerDay > 24) {
            add(
              "error",
              `${dayPath}.extraHoursPerDay`,
              "A soma das horas normais e extras não pode ultrapassar 24 horas por dia.",
            );
          }
          if (context.workCondition === "offshore"
            && day.normalHoursPerDay + day.extraHoursPerDay > 12) {
            add(
              "error",
              `${dayPath}.extraHoursPerDay`,
              "A jornada offshore não pode ultrapassar 12 horas por dia.",
            );
          }
          if (day.days > 0 && day.normalHoursPerDay + day.extraHoursPerDay <= 0) {
            add(
              "warning",
              `${dayPath}.normalHoursPerDay`,
              "Há dias trabalhados sem horas informadas.",
            );
          }
          if (day.extraHoursPerDay > 0 && day.overtimePercent <= 0) {
            add(
              "error",
              `${dayPath}.overtimePercent`,
              "Informe o percentual aplicado à hora extra.",
            );
          }
          if (day.normalHoursPerDay > 0 || day.extraHoursPerDay > 0) scheduledDays += day.days;
        });
        if (scheduledDays > context.durationDays) {
          add(
            "warning",
            `${assignmentPath}.workSchedule.days`,
            "Os dias desta jornada superam a duração da etapa.",
          );
        }
      }
    });
  });
  const systemIds = new Set<string>();
  const enabledSystemIds = new Set<string>();
  payload.volumeSystems.forEach((system, index) => {
    const path = `volumeSystems[${index}]`;
    if (systemIds.has(system.id)) add("error", `${path}.id`, "O identificador do sistema está duplicado.");
    systemIds.add(system.id);
    if (system.enabled) enabledSystemIds.add(system.id);
    if (payload.scopeConfirmations.noInputs || !system.enabled) return;
    system.pipeSegments.forEach((segment, segmentIndex) => {
      const segmentPath = `${path}.pipeSegments[${segmentIndex}]`;
      if (segment.lengthM > 0 && segment.internalDiameterMm <= 0) {
        add("error", `${segmentPath}.internalDiameterMm`, "Informe o diâmetro interno para calcular o volume.");
      }
    });
    system.hoseSegments.forEach((segment, segmentIndex) => {
      const segmentPath = `${path}.hoseSegments[${segmentIndex}]`;
      if (segment.lengthM > 0 && segment.internalDiameterMm <= 0) {
        add("error", `${segmentPath}.internalDiameterMm`, "Informe o diâmetro interno da mangueira.");
      }
    });
  });
  if (circuitServices.configured) {
    const assignmentIds = new Set<string>();
    const assignmentKeys = new Set<string>();
    const assignedSystemIds = new Set<string>();
    (payload.circuitServices ?? []).forEach((assignment, index) => {
      const path = `circuitServices[${index}]`;
      if (assignmentIds.has(assignment.id)) {
        add("error", `${path}.id`, "O identificador da associação de serviço está duplicado.");
      }
      assignmentIds.add(assignment.id);
      if (!assignment.systemId) {
        add("error", `${path}.systemId`, "Selecione o circuito em que o serviço será realizado.");
      } else if (!enabledSystemIds.has(assignment.systemId)) {
        add("error", `${path}.systemId`, "O serviço está ligado a um circuito inexistente ou desativado.");
      }
      const definition = getTechnicalServiceDefinition(
        assignment.serviceId as TechnicalServiceId,
      );
      if (!definition) {
        add("error", `${path}.serviceId`, "Selecione o serviço que será realizado.");
      }
      const key = `${assignment.systemId}:${assignment.serviceId}`;
      if (assignment.systemId && definition) {
        if (assignmentKeys.has(key)) {
          add("error", `${path}.serviceId`, "Este serviço já foi adicionado ao circuito selecionado.");
        }
        assignmentKeys.add(key);
        if (enabledSystemIds.has(assignment.systemId)) assignedSystemIds.add(assignment.systemId);
      }
    });
    const systemsWithoutService = payload.volumeSystems.filter((system) =>
      system.enabled && !assignedSystemIds.has(system.id));
    if (systemsWithoutService.length) {
      add(
        "error",
        "circuitServices",
        `Adicione ao menos um serviço para: ${systemsWithoutService.map((system) => system.name).join(", ")}.`,
      );
    }
  }
  payload.products.forEach((product, index) => {
    if (payload.scopeConfirmations.noInputs
      || !product.included
      || !productAppliesToCircuitServices(product, circuitServices)) return;
    const path = `products[${index}]`;
    if (product.systemId && product.systemId !== "*" && !systemIds.has(product.systemId)) {
      add("error", `${path}.systemId`, "O produto está ligado a um sistema inexistente.");
    }
    if (product.doseMode !== "manual" && product.dose <= 0) {
      add("warning", `${path}.dose`, "A dosagem do produto está zerada.");
    }
    if (product.priceBasis === "package" && product.packageSize <= 0) {
      add("error", `${path}.packageSize`, "Informe o tamanho da embalagem para preço por embalagem.");
    }
  });
  const destinationIds = new Set<string>();
  payload.logisticsDestinations.forEach((destination, index) => {
    const path = `logisticsDestinations[${index}]`;
    if (destinationIds.has(destination.id)) {
      add("error", `${path}.id`, "O identificador do destino está duplicado.");
    }
    destinationIds.add(destination.id);
    if (!destination.name.trim()) {
      add("error", `${path}.name`, "Selecione uma fase da mão de obra ou informe o nome do destino.");
    }
    if (destination.nameSource === "labor_context"
      && (!destination.laborContextId || !contextIds.has(destination.laborContextId))) {
      add(
        "error",
        `${path}.laborContextId`,
        "A fase vinculada a este destino não existe mais. Selecione outra fase ou use um nome personalizado.",
      );
    }
    const destinationItems = payload.logistics.filter((item) =>
      item.destinationId === destination.id
      && item.included
      && !isEquipmentTransportCoveredByCrew(item, payload.scopeConfirmations));
    const requiresDistance = !payload.scopeConfirmations.noLogistics
      && destinationItems.some((item) =>
        item.requiredSlot
        || item.calculationMode === "company_crew_vehicle"
        || item.calculationMode === "company_truck_driver");
    if (requiresDistance && destination.oneWayDistanceKm <= 0) {
      add("error", `${path}.oneWayDistanceKm`, "Informe a distância da Sede até este destino.");
    }
    const requiredSlots = payload.logistics.filter((item) =>
      item.destinationId === destination.id && item.requiredSlot);
    if (!payload.scopeConfirmations.noLogistics
      && (payload.logisticsStructureVersion >= 1 || requiredSlots.length > 0)) {
      const requiredKeyCounts = new Map<string, number>();
      requiredSlots.forEach((item) => {
        const key = `${item.direction}:${item.slotType}`;
        requiredKeyCounts.set(key, (requiredKeyCounts.get(key) || 0) + 1);
      });
      [
        "mobilization:crew",
        "demobilization:crew",
        "mobilization:equipment",
        "demobilization:equipment",
      ].forEach((requiredKey) => {
        if ((requiredKeyCounts.get(requiredKey) || 0) !== 1) {
          add(
            "error",
            `${path}.requiredSlots`,
            "Mantenha exatamente um item de equipe e um de equipamento na mobilização e na desmobilização.",
          );
        }
      });
    }
  });
  payload.logistics.forEach((item, index) => {
    const path = `logistics[${index}]`;
    if (payload.scopeConfirmations.noLogistics) return;
    if (isEquipmentTransportCoveredByCrew(item, payload.scopeConfirmations)) return;
    if (isCrewTransportWaived(item, payload.scopeConfirmations)) return;
    if (item.requiredSlot && !item.included) {
      add("error", `${path}.included`, "Este item obrigatório deve ser preenchido ou a ausência de mobilização deve ser confirmada.");
      return;
    }
    if (!item.included) return;
    if (item.direction === "demobilization"
      && (item.requiredSlot || item.mobilizationSourceId)
      && item.returnSetup === "pending") {
      add(
        "error",
        `${path}.returnSetup`,
        "Confirme se a desmobilização repetirá a ida ou será preenchida separadamente.",
      );
    }
    if (item.mobilizationSourceId && item.returnSetup !== "custom"
      && !payload.logistics.some((source) => source.id === item.mobilizationSourceId
        && source.direction === "mobilization" && source.destinationId === item.destinationId)) {
      add("error", `${path}.returnSetup`, "A mobilização vinculada não existe neste destino. Preencha o retorno separadamente.");
    }
    if (!item.destinationId || !destinationIds.has(item.destinationId)) {
      add("error", `${path}.destinationId`, "Selecione um destino válido para este transporte.");
    }
    if (item.contextId && !contextIds.has(item.contextId)) {
      add("error", `logistics[${index}].contextId`, "O item de logística está ligado a uma etapa inexistente.");
    }
    if (!item.calculationMode || !item.calculationModeConfirmed) {
      add("error", `${path}.calculationMode`, "Selecione obrigatoriamente como o transporte será realizado.");
    }
    if (item.requiredSlot
      && item.slotType === "crew"
      && !isLogisticsCalculationModeAllowed(item.calculationMode, item.slotType, item.requiredSlot)) {
      add("error", `${path}.calculationMode`, "Selecione carro da empresa, carro alugado, ônibus, avião ou cálculo manual para a equipe.");
    }
    if (item.requiredSlot
      && item.slotType === "equipment"
      && !isLogisticsCalculationModeAllowed(item.calculationMode, item.slotType, item.requiredSlot)) {
      add("error", `${path}.calculationMode`, "O item obrigatório do equipamento deve usar frete, caminhão próprio ou cálculo manual.");
    }
    const isCompanyCrewVehicle = item.calculationMode === "company_crew_vehicle";
    const isRentalCrewVehicle = item.calculationMode === "rental_crew_vehicle";
    const isBusCrewTransport = item.calculationMode === "bus_crew_transport";
    const isAirCrewTransport = item.calculationMode === "air_crew_transport";
    const isTicketedCrewTransport = isBusCrewTransport || isAirCrewTransport;
    const isCrewTransport = isCompanyCrewVehicle
      || isRentalCrewVehicle
      || isTicketedCrewTransport;
    const isCompanyTruck = item.calculationMode === "company_truck_driver";
    const usesRoadVehicle = isCompanyCrewVehicle || isRentalCrewVehicle || isCompanyTruck;
    const usesEmployeeTravel = isCrewTransport || isCompanyTruck;
    if (usesEmployeeTravel) {
      const linkedContext = payload.laborContexts.find((context) => context.id === item.contextId);
      const usesAssignmentTravelers = item.travelerAssignmentsConfirmed;
      const rawLinkedHeadcount = (linkedContext?.assignments || []).reduce(
        (sum, assignment) => sum + assignment.quantity * assignment.allocationPercent / 100,
        0,
      );
      const availableByAssignment = new Map(
        (linkedContext?.assignments || []).map((assignment) => [
          assignment.id,
          Math.ceil(assignment.quantity * assignment.allocationPercent / 100),
        ]),
      );
      const assignmentHeadcount = [...availableByAssignment.values()]
        .reduce((sum, quantity) => sum + quantity, 0);
      const selectedByAssignment = new Map<string, number>();
      if (usesAssignmentTravelers) {
        item.travelerAssignments.forEach((traveler, travelerIndex) => {
          const travelerPath = `${path}.travelerAssignments[${travelerIndex}]`;
          if (!availableByAssignment.has(traveler.assignmentId)) {
            add("error", `${travelerPath}.assignmentId`, "O cargo selecionado não pertence à fase vinculada.");
            return;
          }
          if (traveler.quantity <= 0 || !Number.isInteger(traveler.quantity)) {
            add("error", `${travelerPath}.quantity`, "A quantidade de viajantes deve ser um número inteiro maior que zero.");
            return;
          }
          selectedByAssignment.set(
            traveler.assignmentId,
            (selectedByAssignment.get(traveler.assignmentId) || 0) + traveler.quantity,
          );
        });
        selectedByAssignment.forEach((quantity, assignmentId) => {
          if (quantity > (availableByAssignment.get(assignmentId) || 0)) {
            add(
              "error",
              `${path}.travelerAssignments`,
              "A quantidade selecionada em um cargo supera o efetivo disponível na fase.",
            );
          }
        });
      }
      const assignmentAutomaticPeople = isCrewTransport
        ? assignmentHeadcount
        : 0;
      const assignmentPeople = item.travelerCountMode === "manual"
        ? [...selectedByAssignment.values()].reduce((sum, quantity) => sum + quantity, 0)
        : assignmentAutomaticPeople;
      const legacyAutomaticPeople = isCrewTransport
        ? Math.ceil(rawLinkedHeadcount)
        : item.vehicleCountMode === "manual" ? item.vehicleCount : 1;
      const legacyPeople = item.travelerCountMode === "manual"
        ? item.travelerCount
        : legacyAutomaticPeople;
      const people = usesAssignmentTravelers ? assignmentPeople : legacyPeople;
      const capacity = isCompanyCrewVehicle || isRentalCrewVehicle
        ? Math.min(LOGISTICS_TRAVEL_DEFAULTS.passengersPerCompanyCar, Math.max(1, item.passengersPerVehicle))
        : isCompanyTruck ? 1 : 0;
      const automaticVehicles = isCompanyCrewVehicle || isRentalCrewVehicle
        ? people > 0 ? Math.ceil(people / capacity) : 0
        : isCompanyTruck
          ? usesAssignmentTravelers ? people : 1
          : 0;
      const vehicles = item.vehicleCountMode === "manual"
        ? item.vehicleCount
        : automaticVehicles;
      const travelDays = usesRoadVehicle
        ? item.dailyDistanceLimitKm > 0
          ? Math.ceil(item.distanceKmPerVehicle / item.dailyDistanceLimitKm) * item.trips
          : 0
        : item.travelCalendarDaysPerTrip * item.trips;
      if (!item.contextId) {
        add("error", `${path}.contextId`, "Selecione a fase que fornece os colaboradores desta viagem.");
      }
      if (linkedContext && !linkedContext.enabled) {
        add("error", `${path}.contextId`, "A fase vinculada ao transporte precisa estar incluída no levantamento.");
      }
      if (!usesAssignmentTravelers) {
        add(
          "warning",
          `${path}.travelerAssignmentsConfirmed`,
          "Este evento preserva a composição histórica de HH até os cargos dos viajantes serem confirmados.",
        );
      }
      if (people <= 0) {
        add(
          "error",
          usesAssignmentTravelers ? `${path}.travelerAssignments` : `${path}.travelerCount`,
          usesAssignmentTravelers
            ? "Selecione ao menos um colaborador da fase para a viagem."
            : "Informe ao menos um colaborador para a viagem histórica.",
        );
      }
      if (!usesAssignmentTravelers && people > Math.ceil(rawLinkedHeadcount)) {
        add("error", `${path}.travelerCount`, "A quantidade de viajantes supera os colaboradores dimensionados na fase.");
      }
      if (isCompanyTruck
        && usesAssignmentTravelers
        && item.travelerCountMode !== "manual") {
        add("error", `${path}.travelerCountMode`, "Selecione obrigatoriamente o cargo do motorista do caminhão.");
      }
      if (usesRoadVehicle && item.vehicleCountMode === "manual" && item.vehicleCount <= 0) {
        add("error", `${path}.vehicleCount`, "Informe a quantidade manual de veículos.");
      }
      if (usesRoadVehicle
        && usesAssignmentTravelers
        && item.vehicleCountMode === "manual"
        && !Number.isInteger(item.vehicleCount)) {
        add("error", `${path}.vehicleCount`, "A quantidade de veículos deve ser um número inteiro.");
      }
      if ((isCompanyCrewVehicle || isRentalCrewVehicle)
        && (item.passengersPerVehicle < 1
          || item.passengersPerVehicle > LOGISTICS_TRAVEL_DEFAULTS.passengersPerCompanyCar
          || (usesAssignmentTravelers && !Number.isInteger(item.passengersPerVehicle)))) {
        add("error", `${path}.passengersPerVehicle`, "A lotação da viagem deve ficar entre 1 e 4 pessoas por carro.");
      }
      if ((isCompanyCrewVehicle || isRentalCrewVehicle)
        && vehicles * capacity < people) {
        add("error", `${path}.vehicleCount`, "A quantidade de carros informada não comporta todos os colaboradores.");
      }
      if (isCompanyTruck && people < vehicles) {
        add(
          "error",
          usesAssignmentTravelers ? `${path}.travelerAssignments` : `${path}.travelerCount`,
          "Considere ao menos um colaborador para cada caminhão próprio.",
        );
      }
      if (usesRoadVehicle && item.distanceKmPerVehicle <= 0) {
        add("error", `${path}.distanceKmPerVehicle`, "Informe a distância total da viagem por veículo.");
      }
      if (usesRoadVehicle && (item.dailyDistanceLimitKm <= 0
        || item.dailyDistanceLimitKm > LOGISTICS_TRAVEL_DEFAULTS.dailyDistanceLimitKm)) {
        add("error", `${path}.dailyDistanceLimitKm`, "O limite diário deve ficar entre 1 e 750 km.");
      }
      if (isTicketedCrewTransport
        && (!Number.isInteger(item.travelCalendarDaysPerTrip)
          || item.travelCalendarDaysPerTrip <= 0)) {
        add("error", `${path}.travelCalendarDaysPerTrip`, "Informe os dias corridos de viagem por trecho.");
      }
      if (item.travelHoursPerDay <= 0
        || item.travelHoursPerDay > (isTicketedCrewTransport
          ? 24
          : LOGISTICS_TRAVEL_DEFAULTS.travelHoursPerDay)) {
        add(
          "error",
          `${path}.travelHoursPerDay`,
          isTicketedCrewTransport
            ? "O tempo de viagem deve ficar entre 1 e 24 horas por dia."
            : "A jornada de deslocamento deve ficar entre 1 e 10 horas por dia.",
        );
      }
      if (item.trips <= 0) {
        add("error", `${path}.trips`, "Informe ao menos uma viagem.");
      }
      if (item.travelSaturdayDays + item.travelSundayDays > travelDays) {
        add("error", `${path}.travelSaturdayDays`, "Sábados e domingos não podem superar os dias calculados da viagem.");
      }
      const requiresLodging = usesRoadVehicle
        || (isBusCrewTransport && item.busOvernightMode === "hotel_stop")
        || (isAirCrewTransport && item.travelCalendarDaysPerTrip > 1);
      if (requiresLodging && item.lodgingPerPersonDay <= 0) {
        add("error", `${path}.lodgingPerPersonDay`, "Informe o custo diário de hospedagem.");
      }
      if (item.mealPerPersonDay <= 0) {
        add("error", `${path}.mealPerPersonDay`, "Informe o custo diário de alimentação.");
      }
      if (usesRoadVehicle
        && (item.fuelEfficiencyKmPerLiter <= 0 || item.fuelPricePerLiter <= 0)) {
        add("error", `${path}.fuelEfficiencyKmPerLiter`, "Informe o rendimento e o preço do combustível.");
      }
      if (isTicketedCrewTransport && item.ticketPerPersonPerTrip <= 0) {
        add("error", `${path}.ticketPerPersonPerTrip`, "Informe o valor da passagem por pessoa e por trecho.");
      }
      if (isBusCrewTransport && !item.busOvernightMode) {
        add("error", `${path}.busOvernightMode`, "Informe se o ônibus seguirá direto ou terá parada para dormir.");
      }
      if (isBusCrewTransport
        && item.busOvernightMode === "hotel_stop"
        && item.lodgingNightsPerTrip <= 0) {
        add("error", `${path}.lodgingNightsPerTrip`, "Informe ao menos um pernoite por trecho.");
      }
      if (isAirCrewTransport
        && item.travelCalendarDaysPerTrip > 1
        && item.lodgingNightsPerTrip <= 0) {
        add("error", `${path}.lodgingNightsPerTrip`, "Viagens aéreas com mais de um dia devem incluir hospedagem.");
      }
      if (isRentalCrewVehicle) {
        if (!item.rentalUse) {
          add("error", `${path}.rentalUse`, "Informe se o carro alugado será usado apenas na viagem ou também na obra.");
        }
        if (item.rentalDailyRate <= 0) {
          add("error", `${path}.rentalDailyRate`, "Informe a diária do carro alugado.");
        }
        if (item.direction === "mobilization"
          && item.rentalUse === "mobilization_and_site"
          && item.rentalSiteDays <= 0) {
          add("error", `${path}.rentalSiteDays`, "Informe os dias corridos de locação durante a obra.");
        }
        if (item.direction === "mobilization"
          && item.rentalUse === "mobilization_and_site"
          && linkedContext?.expenses.some((expense) =>
            expense.code === VEHICLE_RENTAL_CALENDAR_DAY_EXPENSE_CODE
            && expense.included)) {
          add(
            "error",
            `${path}.rentalUse`,
            "A locação já está incluída na fase de mão de obra. Desative uma das duas composições para não duplicar o custo.",
          );
        }
      }
    }
    if (item.calculationMode === "external_freight") {
      if (item.quantity <= 0) {
        add("error", `${path}.quantity`, "Informe a quantidade de fretes ou veículos contratados.");
      }
      if (item.trips <= 0) {
        add("error", `${path}.trips`, "Informe ao menos uma viagem do frete.");
      }
      if (item.unitCost <= 0) {
        add("error", `${path}.unitCost`, "Informe o valor contratado de cada frete.");
      }
    }
    item.additionalCosts.forEach((additional, additionalIndex) => {
      if (!additional.included) return;
      const additionalPath = `${path}.additionalCosts[${additionalIndex}]`;
      if (!additional.description) {
        add("error", `${additionalPath}.description`, "Descreva o custo adicional.");
      }
      if (additional.quantity <= 0 || additional.unitCost <= 0) {
        add("error", `${additionalPath}.unitCost`, "Informe quantidade e valor do custo adicional.");
      }
    });
    if (1 - percentRate(item.taxPercent) * (1 + percentRate(item.marginPercent)) <= MIN_PRICING_DENOMINATOR) {
      add(
        "error",
        `logistics[${index}].marginPercent`,
        "A combinação de impostos/comissão e margem do frete não permite calcular o valor a cobrar.",
      );
    }
  });
  const ownedTravelGroups = new Map<string, LogisticsItem[]>();
  payload.logistics
    .filter((item) => !payload.scopeConfirmations.noLogistics
      && item.included
      && !isCrewTransportWaived(item, payload.scopeConfirmations)
      && !isEquipmentTransportCoveredByCrew(item, payload.scopeConfirmations)
      && item.contextId
      && (item.calculationMode === "company_crew_vehicle"
        || item.calculationMode === "rental_crew_vehicle"
        || item.calculationMode === "bus_crew_transport"
        || item.calculationMode === "air_crew_transport"
        || item.calculationMode === "company_truck_driver"))
    .forEach((item) => {
      const key = `${item.direction}:${item.contextId}`;
      ownedTravelGroups.set(key, [...(ownedTravelGroups.get(key) || []), item]);
    });
  ownedTravelGroups.forEach((items) => {
    if (items.length <= 1) return;
    const keyPath = `logistics[${payload.logistics.indexOf(items[0])}].travelerAssignments`;
    if (items.some((item) => !item.travelerAssignmentsConfirmed)) {
      add(
        "warning",
        keyPath,
        "Há transportes históricos na mesma fase; revise a composição antes de alterar esses eventos.",
      );
      return;
    }
    if (items.some((item) => item.travelerCountMode === "automatic")) {
      add(
        "error",
        keyPath,
        "Há mais de um transporte ligado à mesma fase. Selecione os colaboradores de cada evento para evitar dupla contagem.",
      );
      return;
    }
    const linkedContext = payload.laborContexts.find((context) => context.id === items[0].contextId);
    const availableByAssignment = new Map(
      (linkedContext?.assignments || []).map((assignment) => [
        assignment.id,
        Math.ceil(assignment.quantity * assignment.allocationPercent / 100),
      ]),
    );
    const selectedByAssignment = new Map<string, number>();
    items.flatMap((item) => item.travelerAssignments).forEach((traveler) => {
      selectedByAssignment.set(
        traveler.assignmentId,
        (selectedByAssignment.get(traveler.assignmentId) || 0) + traveler.quantity,
      );
    });
    if ([...selectedByAssignment].some(
      ([assignmentId, quantity]) => quantity > (availableByAssignment.get(assignmentId) || 0),
    )) {
      add(
        "error",
        keyPath,
        "O mesmo colaborador foi alocado em mais de um transporte desta direção.",
      );
    }
  });
  if (!payload.scopeConfirmations.noLabor && !payload.scopeConfirmations.noLogistics) {
    const calculated = calculateEstimateCore(payload);
    (["mobilization", "demobilization"] as const).forEach((direction) => {
      const coverage = logisticsCrewCoverage(calculated, direction);
      const confirmed = direction === "mobilization"
        ? payload.scopeConfirmations.mobilizationCrewAlreadyOnSite
        : payload.scopeConfirmations.demobilizationCrewAlreadyOnSite;
      if (coverage.missing > 0 && !confirmed) {
        add(
          "error",
          direction === "mobilization"
            ? "scopeConfirmations.mobilizationCrewAlreadyOnSite"
            : "scopeConfirmations.demobilizationCrewAlreadyOnSite",
          direction === "mobilization"
            ? `Faltam vagas para ${coverage.missing} colaborador(es). Dimensione o transporte ou confirme que eles já estarão na obra.`
            : `Faltam vagas para ${coverage.missing} colaborador(es). Dimensione o retorno ou confirme que eles não precisarão ser desmobilizados.`,
        );
      }
    });
  }
  if (!payload.scopeConfirmations.noInputs
    && payload.effluent.includeDisposalCost
    && payload.effluent.unitCostPerM3 <= 0) {
    add("warning", "effluent.unitCostPerM3", "O custo de destinação do efluente está incluído, mas o valor por m³ está zerado.");
  }
  if ((payload.commercial.pricingMode === "commercial_lines" || payload.commercial.pricingMode === "fabrication")
    && !payload.commercial.lines.length) {
    add("error", "commercial.lines", "Inclua ao menos um item para a formação comercial informada.");
  }
  if (payload.commercial.pricingMode === "global" && payload.commercial.globalValue <= 0) {
    add("warning", "commercial.globalValue", "O valor global está zerado.");
  }
  if (representativeCommission.enabled) {
    if (!representativeCommission.representativeName.trim()) {
      add(
        "error",
        "commercial.representativeCommission.representativeName",
        "Informe o nome do representante que receberá a comissão.",
      );
    }
    if (representativeCommission.percent <= 0) {
      add(
        "error",
        "commercial.representativeCommission.percent",
        "Informe o percentual da comissão do representante.",
      );
    }
  }
  const referralBonusIds = new Set<string>();
  payload.commercial.employeeReferralBonuses.forEach((bonus, index) => {
    const path = `commercial.employeeReferralBonuses[${index}]`;
    if (referralBonusIds.has(bonus.id)) {
      add("error", `${path}.id`, "O identificador do bônus de indicação está duplicado.");
    }
    referralBonusIds.add(bonus.id);
    if (!bonus.included) return;
    if (!bonus.employeeName.trim()) {
      add("error", `${path}.employeeName`, "Informe o nome do colaborador que indicou o serviço.");
    }
    if (bonus.amount <= 0) {
      add("error", `${path}.amount`, "Informe o valor do bônus de indicação interna.");
    }
  });
  if (payload.commercial.presentationAdjustments.length) {
    const preview = calculateEstimateCore(payload);
    const linesById = new Map(preview.proposalPrices.map((line) => [line.id, line]));
    const requestedBySource = new Map<string, number>();
    payload.commercial.presentationAdjustments.forEach((adjustment, index) => {
      requestedBySource.set(
        adjustment.sourceLineId,
        (requestedBySource.get(adjustment.sourceLineId) || 0) + adjustment.value,
      );
      const sourceLine = linesById.get(adjustment.sourceLineId);
      if (!sourceLine) {
        add(
          "warning",
          `commercial.presentationAdjustments[${index}].sourceLineId`,
          "Um ajuste de apresentação antigo não corresponde mais à composição atual e será ignorado.",
        );
        return;
      }
      if (sourceLine.category !== "Mobilização" && sourceLine.category !== "Desmobilização") {
        add(
          "error",
          `commercial.presentationAdjustments[${index}].sourceLineId`,
          "A realocação comercial só pode sair de uma linha de mobilização ou desmobilização.",
        );
      }
      if (adjustment.value > sourceLine.calculatedValue) {
        add(
          "warning",
          `commercial.presentationAdjustments[${index}].value`,
          "A realocação supera o valor calculado da linha e será limitada ao valor disponível.",
        );
      }
    });
    requestedBySource.forEach((requestedValue, sourceLineId) => {
      const sourceLine = linesById.get(sourceLineId);
      if (!sourceLine || requestedValue <= sourceLine.calculatedValue) return;
      add(
        "warning",
        "commercial.presentationAdjustments",
        `As realocações somadas de “${sourceLine.description}” superam o valor calculado da linha e serão limitadas ao valor disponível.`,
      );
    });
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** Compatibility alias for API code that treats the payload as a draft. */
export const validateCostDraft = validateCostEstimate;

/**
 * Legacy flat calculator retained during the UI migration.
 * The returned `burden` is now the monetary burden, not the decimal multiplier.
 */
export function calculateCost(lines: CostLine[], indirects: Array<LegacyIndirectCost | IndirectCost>, options: {
  monthlyHours?: number;
  overheadPercent?: number;
  taxPercent?: number;
  desiredMarginPercent?: number;
  commissionPercent?: number;
} = {}) {
  const monthlyHours = Math.max(1, options.monthlyHours || MONTHLY_HOURS);
  const overheadPercent = Math.max(0, options.overheadPercent ?? LEGACY_DEFAULT_ASSUMPTIONS.overheadPercent);
  const taxPercent = Math.max(0, Math.min(99, options.taxPercent ?? LEGACY_DEFAULT_ASSUMPTIONS.taxPercent));
  const desiredMarginPercent = Math.max(
    0,
    Math.min(99, options.desiredMarginPercent ?? LEGACY_DEFAULT_ASSUMPTIONS.desiredMarginPercent),
  );
  const commissionPercent = Math.max(
    0,
    Math.min(99, options.commissionPercent ?? LEGACY_DEFAULT_ASSUMPTIONS.commissionPercent),
  );
  const indirectMonthly = indirects.filter((item) => item.included).reduce((sum, item) => sum + item.monthly, 0);
  const lineResults = lines.map((line) => {
    const salary = nonNegative(line.salary ?? roleTotal(line.role));
    const rate = burdenRate(line.months);
    const burden = salary * rate;
    const total = nonNegative(line.quantity) * nonNegative(line.months) * (salary + burden + indirectMonthly);
    return { ...line, salary, burdenRate: rate, burden, indirectMonthly, total };
  });
  const totalEmployees = lines.reduce((sum, line) => sum + nonNegative(line.quantity), 0);
  const payrollCost = lineResults.reduce((sum, line) =>
    sum + nonNegative(line.quantity) * nonNegative(line.months) * (line.salary + line.burden), 0);
  const indirectCostTotal = lineResults.reduce((sum, line) =>
    sum + nonNegative(line.quantity) * nonNegative(line.months) * line.indirectMonthly, 0);
  const directCost = payrollCost + indirectCostTotal;
  const availableRate = 1 - taxPercent / 100 - commissionPercent / 100 - desiredMarginPercent / 100;
  const overheadValue = directCost * overheadPercent / 100;
  const costWithOverhead = directCost + overheadValue;
  const salePrice = availableRate > MIN_PRICING_DENOMINATOR ? costWithOverhead / availableRate : 0;
  const taxValue = Math.max(0, salePrice) * taxPercent / 100;
  const commissionValue = Math.max(0, salePrice) * commissionPercent / 100;
  const netRevenue = Math.max(0, salePrice) * (1 - taxPercent / 100 - commissionPercent / 100);
  const balance = netRevenue - costWithOverhead;
  const profitValue = balance;
  return {
    lineResults,
    indirectMonthly,
    indirectHourly: indirectMonthly / monthlyHours,
    totalEmployees,
    payrollCost,
    indirectCostTotal,
    directCost,
    overheadValue,
    costWithOverhead,
    totalCost: directCost,
    salePrice,
    taxValue,
    commissionValue,
    profitValue,
    netRevenue,
    balance,
    monthlyBalance: balance / Math.max(1, Math.max(...lines.map((line) => line.months), 1)),
    margin: salePrice > 0 ? balance / salePrice : 0,
    monthlyHours,
    overheadPercent,
    taxPercent,
    commissionPercent,
    desiredMarginPercent,
    validPricing: availableRate > MIN_PRICING_DENOMINATOR,
  };
}
