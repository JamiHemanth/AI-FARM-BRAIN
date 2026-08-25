import { FarmType, SensorReading } from "@prisma/client";

export type SensorScenario = "normal" | "low-moisture" | "high-temperature" | "disease-risk" | "rainfall" | "water-shortage";
export interface SensorProvider { read(farmId: string, type: FarmType, scenario: SensorScenario, previous?: SensorReading | null): Promise<Omit<SensorReading, "id" | "farmId" | "observedAt">>; }
const jitter = (base: number, spread: number) => Math.round((base + (Math.random() - .5) * spread) * 10) / 10;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export class DemoSensorProvider implements SensorProvider {
  async read(_farmId: string, type: FarmType, scenario: SensorScenario, previous?: SensorReading | null) {
    const fishery = type === "FISHERY";
    let soilMoisture = fishery ? null : jitter(previous?.soilMoisture ?? 48, 5);
    let airTemperature = jitter(previous?.airTemperature ?? 29, 2);
    let humidity = jitter(previous?.humidity ?? 68, 5);
    const rainfall = scenario === "rainfall" ? jitter(24, 8) : jitter(0.5, 1);
    let waterLevel = jitter(previous?.waterLevel ?? (fishery ? 78 : 62), 4);
    let dissolvedOxygen = fishery ? jitter(previous?.dissolvedOxygen ?? 5.8, .5) : null;
    if (scenario === "low-moisture") soilMoisture = jitter(25, 4);
    if (scenario === "high-temperature") { airTemperature = jitter(39, 3); humidity = jitter(38, 5); }
    if (scenario === "disease-risk") humidity = jitter(91, 4);
    if (scenario === "water-shortage") { waterLevel = jitter(18, 4); if (fishery) dissolvedOxygen = jitter(3.4, .5); }
    return {
      provider: "demo", scenario, soilMoisture: soilMoisture == null ? null : clamp(soilMoisture, 0, 100),
      soilTemperature: fishery ? null : jitter(27, 2), airTemperature, humidity: clamp(humidity, 0, 100), ph: jitter(fishery ? 7.2 : 6.7, .3),
      waterLevel: clamp(waterLevel, 0, 100), rainfall: Math.max(0, rainfall), nitrogen: fishery ? null : jitter(54, 7), dissolvedOxygen
    };
  }
}

export function sensorProvider(): SensorProvider { return new DemoSensorProvider(); }
