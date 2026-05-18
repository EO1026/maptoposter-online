/**
 * 区级行政区服务
 * 通过 OSM Nominatim + Overpass API 获取城市下级行政区（如区、县、郡、ward）。
 * 三级缓存策略：内存 Map → localStorage → Overpass API，刷新页面后优先从 localStorage 恢复。
 * Nominatim 有 1 req/s 的频率限制，连续调用时会自动等待。
 */

import type { District } from "./location-types";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const OVERPASS_BASE = "https://overpass-api.de/api/interpreter";
const LS_PREFIX = "maptoposter_districts_";
const LS_NOMINATIM_KEY = "maptoposter_nominatim_map";

class DistrictService {
  private nominatimCache: Map<string, number> = new Map();
  private overpassCache: Map<number, District[]> = new Map();
  private lastNominatimCall = 0;

  constructor() {
    this.loadFromLocalStorage();
  }

  clearCache(): void {
    this.nominatimCache.clear();
    this.overpassCache.clear();
    this.lastNominatimCall = 0;

    // Clear localStorage entries
    try {
      const keys = Object.keys(localStorage);
      for (const key of keys) {
        if (key.startsWith(LS_PREFIX) || key === LS_NOMINATIM_KEY) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      /* localStorage may be unavailable */
    }
  }

  /**
   * 获取城市下辖区列表（仅 API 结果，不含城市本身 fallback）
   * 调用方负责将城市自身作为默认选项插入到返回数组头部
   */
  async getDistrictsByCity(
    cityName: string,
    stateName: string,
    countryName: string
  ): Promise<District[]> {
    const cacheKey = `${cityName}|${stateName}|${countryName}`;

    // 解析 OSM Relation ID：内存 → localStorage → Nominatim API
    const relationId = await this.resolveRelationId(cacheKey, cityName, stateName, countryName);
    if (relationId === null) return [];

    // 查区列表缓存：内存 → localStorage
    const memResult = this.overpassCache.get(relationId);
    if (memResult) return memResult;

    const lsDistricts = this.readLS(`${LS_PREFIX}${relationId}`);
    if (lsDistricts) {
      this.overpassCache.set(relationId, lsDistricts);
      return lsDistricts;
    }

    // 缓存未命中，调用 Overpass API 实时查询
    try {
      const overpassQuery = `[out:json];relation(${relationId});map_to_area->.a;relation(area.a)[admin_level~"^(6|7|8)$"];out center tags;`;
      const overpassRes = await fetch(`${OVERPASS_BASE}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(overpassQuery)}`,
      });
      if (!overpassRes.ok) return [];

      const overpassData = await overpassRes.json();
      // 过滤出有名称和坐标的 relation，优先取英文名 fallback 到通用名
      const districts: District[] = (overpassData.elements || [])
        .filter((e: any) => e.type === "relation" && e.tags && e.center)
        .map((e: any) => ({
          id: e.id,
          name: e.tags["name:en"] || e.tags.name || "",
          lat: e.center.lat,
          lng: e.center.lon,
        }))
        .filter((d: District) => d.name)
        .sort((a: District, b: District) => a.name.localeCompare(b.name, "zh-CN"));

      this.overpassCache.set(relationId, districts);
      this.writeLS(`${LS_PREFIX}${relationId}`, districts);
      return districts;
    } catch (err) {
      console.error("Failed to fetch districts:", err);
      return [];
    }
  }

  /**
   * 解析城市 → OSM Relation ID，三级查找：内存 → localStorage → Nominatim API
   * Nominatim 限速 1 req/s，连续调用会自动等待
   */
  private async resolveRelationId(
    cacheKey: string,
    cityName: string,
    stateName: string,
    countryName: string
  ): Promise<number | null> {
    // 1. 内存缓存
    const memId = this.nominatimCache.get(cacheKey);
    if (memId !== undefined) return memId;

    // 2. localStorage
    const lsNominatim = this.readLS(LS_NOMINATIM_KEY);
    if (lsNominatim && lsNominatim[cacheKey] !== undefined) {
      const id = lsNominatim[cacheKey] as number;
      this.nominatimCache.set(cacheKey, id);
      return id;
    }

    // 3. Nominatim API（限速 1 req/s）
    const now = Date.now();
    const elapsed = now - this.lastNominatimCall;
    if (elapsed < 1000) {
      await new Promise((r) => setTimeout(r, 1000 - elapsed));
    }

    try {
      const nominatimUrl = `${NOMINATIM_BASE}/search?city=${encodeURIComponent(cityName)}&state=${encodeURIComponent(stateName)}&country=${encodeURIComponent(countryName)}&format=json&addressdetails=1&limit=1`;
      this.lastNominatimCall = Date.now();
      const nominatimRes = await fetch(nominatimUrl);
      if (!nominatimRes.ok) return null;

      const nominatimData = await nominatimRes.json();
      const first = nominatimData[0];
      if (!first || first.osm_type !== "relation") return null;

      const relationId = first.osm_id;
      this.nominatimCache.set(cacheKey, relationId);

      // 持久化 Nominatim 映射，避免刷新后重复请求
      const lsNominatim = this.readLS(LS_NOMINATIM_KEY) || {};
      lsNominatim[cacheKey] = relationId;
      this.writeLS(LS_NOMINATIM_KEY, lsNominatim);

      return relationId;
    } catch (err) {
      console.error("Failed to resolve relation ID:", err);
      return null;
    }
  }

  private loadFromLocalStorage(): void {
    try {
      // Restore nominatimCache
      const lsNominatim = this.readLS(LS_NOMINATIM_KEY);
      if (lsNominatim) {
        for (const [key, val] of Object.entries(lsNominatim)) {
          this.nominatimCache.set(key, val as number);
        }
      }

      // Restore overpassCache lazily — only load keys that are still in nominatimCache
      for (const relationId of this.nominatimCache.values()) {
        const lsDistricts = this.readLS(`${LS_PREFIX}${relationId}`);
        if (lsDistricts) {
          this.overpassCache.set(relationId, lsDistricts);
        }
      }
    } catch {
      /* localStorage may be unavailable */
    }
  }

  private readLS(key: string): any {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private writeLS(key: string, value: any): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota exceeded or unavailable */
    }
  }
}

export const districtService = new DistrictService();
