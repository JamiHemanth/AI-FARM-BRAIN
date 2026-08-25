import type { Farm } from "@prisma/client";

export type WeatherData = { provider: string; temperature: number; humidity: number; rainProbability: number; rainfall: number; windSpeed: number; forecast: { day: string; condition: string; high: number; low: number }[] };
export interface WeatherProvider { current(farm: Farm): Promise<WeatherData>; }

class MockWeatherProvider implements WeatherProvider {
  async current(farm: Farm): Promise<WeatherData> {
    const seed = [...farm.village].reduce((n, c) => n + c.charCodeAt(0), 0);
    const rain = seed % 42;
    return { provider: "demo-weather", temperature: 29 + seed % 5, humidity: 62 + seed % 18, rainProbability: rain, rainfall: rain > 35 ? 2.4 : 0,
      windSpeed: 7 + seed % 9, forecast: [0,1,2].map((d) => ({ day: new Date(Date.now() + d * 86400000).toISOString(), condition: d === 1 && rain > 25 ? "Possible rain" : "Partly cloudy", high: 32 + d, low: 23 + d })) };
  }
}

export function weatherProvider(): WeatherProvider { return new MockWeatherProvider(); }
