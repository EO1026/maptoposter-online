import { useState, useRef, useEffect, useDeferredValue, useMemo } from "react";
import { type PosterSize } from "@/components/artistic-map";
import {
  Square,
  Smartphone,
  Monitor,
  FileImage,
  MapPin,
  Settings2,
  Palette,
  Eye,
  FileText,
  Scaling,
} from "lucide-react";
import { useLocationData } from "@/hooks/useLocationData";
import { getUserGeolocation } from "@/services/ip-geolocation";

// WASM and Utils
import init, { init_panic_hook } from "./pkg/wasm";
import { shardRoadsBinary } from "./utils";
import { type MapColors, MAP_THEMES as THEMES, type Location } from "@/lib/types";
import { mapDataService } from "./services/map-data";
import { type State, type City, type District } from "@/services/location-types";
// Paraglide i18n
import * as m from "@/paraglide/messages";
import { useDynamicFont } from "./hooks/useDynamicFont";
import { useLanguage } from "./hooks/useLanguage";
import { useConfigNavigation } from "./hooks/useConfigNavigation";
import { useFontManagement } from "./hooks/useFontManagement";
import { PosterGallery } from "./components/gallery";
import Footer from "./components/footer";
import { ConfigNav, type NavSection } from "./components/config-nav";
import { SEOHead } from "./hooks/useSEO";
import { AppHeader } from "./components/app-header";
import { LocationSettings } from "./components/location-settings";
import { DataSettings } from "./components/data-settings";
import { ThemeColors } from "./components/theme-colors";
import { FontSettings } from "./components/font-settings";
import { RenderControlSettings } from "./components/render-control-settings";
import { PosterSizeSelector } from "./components/poster-size-selector";
import { MapPreview } from "./components/map-preview";
import { GenerationModal } from "./components/generation-modal";
import { ErrorModal } from "./components/error-modal";
import { useReverseGeocode } from "@/hooks/useReverseGeocode";

// Extended PosterSize includes icon for size selector UI
interface LocalPosterSize extends PosterSize {
  icon: React.ReactNode;
}

// Worker task types
type WorkerTaskType = "roads" | "polygons" | "pois" | "render";
type ExportFormat = "png" | "svg";

interface RenderOptions {
  roads_shards: Float64Array[];
  water_bin: Float64Array;
  parks_bin: Float64Array;
  config_json: string;
  custom_font?: Uint8Array;
}

function formatTimingMs(duration: number): string {
  return `${Math.round(duration)}ms`;
}

function logClientTiming(
  scope: string,
  name: string,
  timings: Record<string, number | string | undefined>
) {
  const parts = Object.entries(timings)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === "number" ? formatTimingMs(value) : value}`);
  console.log(`[Timing][${scope}][${name}] ${parts.join(" ")}`);
}

// Example locations
const EXAMPLES: { location: Location; themeId: string }[] = [
  {
    location: {
      country: "France",
      state: "Ile-de-France",
      city: "Paris",
      lat: 48.8566,
      lng: 2.3522,
    },
    themeId: "vintage-sepia",
  },
  {
    location: { country: "Japan", state: "Tokyo", city: "Tokyo", lat: 35.6762, lng: 139.6503 },
    themeId: "midnight-atlas",
  },
  {
    location: {
      country: "United States",
      state: "New York",
      city: "New York",
      lat: 40.7128,
      lng: -74.006,
    },
    themeId: "navy-gold",
  },
  {
    location: {
      country: "United Kingdom",
      state: "England",
      city: "London",
      lat: 51.5074,
      lng: -0.1278,
    },
    themeId: "antique-parchment",
  },
  {
    location: { country: "Italy", state: "Lazio", city: "Rome", lat: 41.9028, lng: 12.4964 },
    themeId: "forest-expedition",
  },
];

// Worker task helper
let taskIdCounter = 0;
function runInWorker(
  worker: Worker,
  type: WorkerTaskType,
  data: Float64Array | RenderOptions,
  transfers: Transferable[] = [],
  label: string = type
): Promise<Float64Array | Uint8Array> {
  return new Promise((resolve, reject) => {
    const id = taskIdCounter++;
    const handler = (event: MessageEvent) => {
      if (event.data.id === id) {
        worker.removeEventListener("message", handler);
        if (event.data.success) {
          if (typeof event.data.duration === "number") {
            const scope = type === "render" ? "render" : "wasm";
            const metric = type === "render" ? "total" : "duration";
            logClientTiming(scope, label, { [metric]: event.data.duration });
          }
          resolve(event.data.result);
        } else {
          reject(new Error(`Worker Protocol Error: ${event.data.error}`));
        }
      }
    };
    const errorHandler = (error: ErrorEvent) => {
      reject(new Error(`Worker Crash: ${error.message}`));
    };
    worker.addEventListener("message", handler);
    worker.addEventListener("error", errorHandler, { once: true });
    worker.postMessage({ id, type, data }, transfers);
  });
}

const yieldMainThread = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function parseCoordinate(value: number | string | undefined): number | null {
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCityCoordinates(city: City | undefined): { lat: number; lng: number } | null {
  if (!city) return null;

  const lat = parseCoordinate(city.latitude);
  const lng = parseCoordinate(city.longitude);
  if (lat === null || lng === null) return null;

  return { lat, lng };
}

function normalizeLocationName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getStateName(state: Pick<State, "name"> | string | undefined): string {
  return typeof state === "string" ? state : state?.name || "";
}

function getStateIso2(state: Pick<State, "iso2"> | string | undefined): string {
  return typeof state === "string" ? "" : state?.iso2?.toUpperCase() || "";
}

function namesReferToSameLocation(first: string, second: string): boolean {
  const normalizedFirst = normalizeLocationName(first);
  const normalizedSecond = normalizeLocationName(second);
  if (!normalizedFirst || !normalizedSecond) return false;

  return (
    normalizedFirst === normalizedSecond ||
    normalizedFirst.includes(normalizedSecond) ||
    normalizedSecond.includes(normalizedFirst)
  );
}

export default function MapPosterGenerator() {
  const {
    countries,
    getStatesByCountry,
    getCitiesByState,
    getDistrictsByCity,
    isLoading: locationLoading,
  } = useLocationData();

  const { activeLang, handleLanguageChange } = useLanguage();
  const {
    customFont,
    fontFileName,
    fontFileInputRef,
    selectedPreset,
    fontLoadingPreset,
    fontCacheRef,
    handleFontUpload,
    clearCustomFont,
    handlePresetFontSelect,
  } = useFontManagement();

  const [location, setLocation] = useState<Location>(EXAMPLES[0].location);
  const [selectedTheme, setSelectedTheme] = useState(THEMES[0]);
  const [customColors, setCustomColors] = useState<MapColors>(THEMES[0].colors);
  const [useCustomColors, setUseCustomColors] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStep, setGenerationStep] = useState("");
  const [isGameOpen, setIsGameOpen] = useState(false);
  const isGameOpenRef = useRef(false); // track isGameOpen without waiting for React re-render
  const generationCompleteRef = useRef(false);
  const currentStepRef = useRef<string>("");
  const [errorModal, setErrorModal] = useState<{
    error: Error;
    step: string;
    diagnostics: Record<string, string>;
  } | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const [locationMode, setLocationMode] = useState<"search" | "coordinates">("search");

  // Localized Sizes
  const SIZES: LocalPosterSize[] = useMemo(
    () => [
      {
        id: "iphone",
        name: m.size_iphone(),
        width: 1500,
        height: 3200,
        icon: <Smartphone className="w-4 h-4" />,
      },
      {
        id: "square",
        name: m.size_square(),
        width: 3000,
        height: 3000,
        icon: <Square className="w-4 h-4" />,
      },
      {
        id: "poster-3x4-portrait",
        name: m.size_poster_3x4_portrait(),
        width: 2400,
        height: 3200,
        icon: <FileImage className="w-4 h-4" />,
      },
      {
        id: "poster-9x16-portrait",
        name: m.size_poster_9x16_portrait(),
        width: 2160,
        height: 3840,
        icon: <FileImage className="w-4 h-4" />,
      },
      {
        id: "poster-4x3-landscape",
        name: m.size_poster_4x3_landscape(),
        width: 3200,
        height: 2400,
        icon: <Monitor className="w-4 h-4" />,
      },
      {
        id: "desktop",
        name: m.size_desktop(),
        width: 3840,
        height: 2160,
        icon: <Monitor className="w-4 h-4" />,
      },
      {
        id: "a4-portrait",
        name: m.size_a4_portrait(),
        width: 2480,
        height: 3508,
        icon: <FileImage className="w-4 h-4" />,
      },
      {
        id: "a4-landscape",
        name: m.size_a4_landscape(),
        width: 3508,
        height: 2480,
        icon: <FileImage className="w-4 h-4 rotate-90" />,
      },
    ],
    [activeLang]
  );

  const [selectedSizeId, setSelectedSizeId] = useState<string>("iphone");
  const selectedSize = SIZES.find((size) => size.id === selectedSizeId) || SIZES[0];

  // Map theme IDs to translation functions
  const themeNameMap: Record<string, string> = useMemo(
    () => ({
      "Nordic-Frost": m.theme_nordic_frost(),
      "Desert-Rose": m.theme_desert_rose(),
      "Cyberpunk-Neon": m.theme_cyberpunk_neon(),
      "Sulfur-Slate": m.theme_sulfur_slate(),
      "Vintage-Nautical": m.theme_vintage_nautical(),
      "Lavender-Mist": m.theme_lavender_mist(),
      "Carbon-Fiber": m.theme_carbon_fiber(),
      "Mediterranean-Summer": m.theme_mediterranean_summer(),
      "Royal-Velvet": m.theme_royal_velvet(),
      "Forest-Moss": m.theme_forest_moss(),
      "Cotton-Candy": m.theme_cotton_candy(),
      "Brutalist-Concrete": m.theme_brutalist_concrete(),
      "Solarized-Dark": m.theme_solarized_dark(),
      "Matcha-Latte": m.theme_matcha_latte(),
      "Red-Alert": m.theme_red_alert(),
      "Gilded-Noir": m.theme_gilded_noir(),
      "Ocean-Abyss": m.theme_ocean_abyss(),
      "Sakura-Branch": m.theme_sakura_branch(),
      "Terra-Clay": m.theme_terra_clay(),
      "Glitch-Purple": m.theme_glitch_purple(),
    }),
    [activeLang]
  );

  // 地点选择状态（国 → 省 → 市 → 区 四级联动）
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [selectedState, setSelectedState] = useState<string>("");
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedDistrict, setSelectedDistrict] = useState<string>(""); // 区/县/郡，通过 Overpass API 动态获取
  const [states, setStates] = useState<State[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [districts, setDistricts] = useState<District[]>([]); // 始终包含城市自身作为首选项（id=0）
  const [isStatesLoading, setIsStatesLoading] = useState(false);
  const [isCitiesLoading, setIsCitiesLoading] = useState(false);
  const [isDistrictsLoading, setIsDistrictsLoading] = useState(false);

  const resolveStandaloneRegionFallback = async (
    countryName: string,
    sourceState: Pick<State, "name" | "iso2"> | string | undefined
  ): Promise<{ city: string; lat: number; lng: number } | null> => {
    const stateName = getStateName(sourceState);
    const stateIso = getStateIso2(sourceState);
    if (!stateName || !stateIso) return null;

    const sourceCountry = countries.find(
      (country) => country.name.toLowerCase() === countryName.toLowerCase()
    );
    const standaloneCountry = countries.find(
      (country) =>
        country.iso2.toUpperCase() === stateIso &&
        country.id !== sourceCountry?.id &&
        namesReferToSameLocation(stateName, country.name)
    );
    if (!standaloneCountry) return null;

    const standaloneStates = await getStatesByCountry(standaloneCountry.id);
    const standaloneState =
      standaloneStates.find((state) => state.iso2.toUpperCase() === stateIso) ||
      standaloneStates.find((state) => namesReferToSameLocation(stateName, state.name)) ||
      standaloneStates[0];
    if (!standaloneState) return null;

    const standaloneCities = await getCitiesByState(standaloneState.id);
    const cityWithCoordinates = standaloneCities.find((city) => parseCityCoordinates(city));
    const coordinates = parseCityCoordinates(cityWithCoordinates);
    if (!coordinates) return null;

    return {
      city: stateName,
      ...coordinates,
    };
  };

  // Data settings state
  const [lodMode, setLodMode] = useState<"simplified" | "detailed">("simplified");
  const [baseRadius, setBaseRadius] = useState(15000);

  // Text display toggle state
  const [showCoords, setShowCoords] = useState(true);
  const [showCity, setShowCity] = useState(true);
  const [showCountry, setShowCountry] = useState(true);
  const [showPois, setShowPois] = useState(false); // 地图元素渲染：POI 兴趣点

  // Persistence Handling
  const isRestored = useRef(false);

  const handleLocationModeChange = (mode: "search" | "coordinates") => {
    setLocationMode(mode);
  };

  const handleLatChange = (lat: number) => {
    setLocation((prev) => ({ ...prev, lat }));
  };

  const handleLngChange = (lng: number) => {
    setLocation((prev) => ({ ...prev, lng }));
  };

  const { handleCoordinateReverseGeocode } = useReverseGeocode({
    countries,
    getStatesByCountry,
    getCitiesByState,
    getDistrictsByCity,
    setters: {
      setSelectedCountry,
      setSelectedState,
      setSelectedCity,
      setSelectedDistrict,
      setStates,
      setCities,
      setDistricts,
      setIsStatesLoading,
      setIsCitiesLoading,
      setIsDistrictsLoading,
      setLocation,
    },
  });

  // Persistence Effect: Save settings to LocalStorage whenever they change
  useEffect(() => {
    // Only save if we have finished the initial restoration from LocalStorage
    if (!isRestored.current) return;

    const config = {
      selectedCountry,
      selectedState,
      selectedCity,
      selectedDistrict,
      customTitle,
      lodMode,
      baseRadius,
      selectedSizeId,
      location, // Store the lat/lng coordinates too
      showCoords,
      showCity,
      showCountry,
      showPois,
    };
    localStorage.setItem("maptoposter_config", JSON.stringify(config));
  }, [
    selectedCountry,
    selectedState,
    selectedCity,
    selectedDistrict,
    customTitle,
    lodMode,
    baseRadius,
    selectedSizeId,
    location,
    showCoords,
    showCity,
    showCountry,
    showPois,
  ]);

  useEffect(() => {
    const savedConfig = localStorage.getItem("maptoposter_config");
    if (savedConfig && countries.length > 0 && !isRestored.current) {
      try {
        const config = JSON.parse(savedConfig);

        // Restore Size
        if (SIZES.some((size) => size.id === config.selectedSizeId)) {
          setSelectedSizeId(config.selectedSizeId);
        }

        // Restore LOD & Radius
        if (config.lodMode) setLodMode(config.lodMode);
        if (config.baseRadius) setBaseRadius(config.baseRadius);
        if (typeof config.showCoords === "boolean") setShowCoords(config.showCoords);
        if (typeof config.showCity === "boolean") setShowCity(config.showCity);
        if (typeof config.showCountry === "boolean") setShowCountry(config.showCountry);
        if (typeof config.showPois === "boolean") setShowPois(config.showPois);

        // Restore Location Text/Coords
        if (config.customTitle) setCustomTitle(config.customTitle);
        if (config.location) setLocation(config.location);

        // Crucial: Restore Country/State/City selections and trigger their data loading
        if (config.selectedCountry) {
          const country = countries.find((c) => c.name === config.selectedCountry);
          if (country) {
            setSelectedCountry(config.selectedCountry);
            (async () => {
              setIsStatesLoading(true);
              const countryStates = await getStatesByCountry(country.id);
              setStates(countryStates);
              setIsStatesLoading(false);

              if (config.selectedState) {
                const state = countryStates.find((s: any) => s.name === config.selectedState);
                if (state) {
                  setSelectedState(config.selectedState);
                  setIsCitiesLoading(true);
                  const stateCities = await getCitiesByState(state.id);
                  setCities(stateCities);
                  setIsCitiesLoading(false);

                  if (config.selectedCity) {
                    const cityName = config.selectedCity;
                    const city = stateCities.find(
                      (c: any) => c.name.toLowerCase() === cityName.toLowerCase()
                    );
                    const coordinates = parseCityCoordinates(city);
                    const fallback = coordinates
                      ? null
                      : await resolveStandaloneRegionFallback(config.selectedCountry, state);
                    const resolvedCityName = fallback?.city || cityName;
                    const resolvedCoordinates = coordinates || fallback || { lat: 0, lng: 0 };

                    setSelectedCity(resolvedCityName);

                    // 恢复区选择：先设城市为 fallback，再异步拉 API 结果合并
                    setSelectedDistrict(config.selectedDistrict || resolvedCityName);
                    const cityAsDistrict: District = {
                      id: 0,
                      name: resolvedCityName,
                      lat: resolvedCoordinates.lat,
                      lng: resolvedCoordinates.lng,
                    };
                    setIsDistrictsLoading(true);
                    try {
                      const apiDistricts = await getDistrictsByCity(
                        resolvedCityName,
                        config.selectedState,
                        config.selectedCountry
                      );
                      setDistricts([cityAsDistrict, ...apiDistricts]);
                    } catch {
                      setDistricts([cityAsDistrict]);
                    }
                    setIsDistrictsLoading(false);

                    setLocation({
                      country: config.selectedCountry,
                      state: config.selectedState,
                      city: resolvedCityName,
                      district: config.selectedDistrict || resolvedCityName,
                      lat: resolvedCoordinates.lat,
                      lng: resolvedCoordinates.lng,
                    });
                  }
                }
              }
              // Mark as restored AFTER child data is loaded
              isRestored.current = true;
            })();
          }
        } else {
          isRestored.current = true;
        }
      } catch (e) {
        console.error("Failed to restore config", e);
        isRestored.current = true;
      }
    } else if (countries.length > 0 && !selectedCountry && !isRestored.current) {
      // Try to auto-detect user location based on IP when no saved config exists
      (async () => {
        try {
          const geo = await getUserGeolocation();
          if (geo) {
            // 1. Find country by ISO2 code
            const country = countries.find(
              (c) => c.iso2.toUpperCase() === geo.country.toUpperCase()
            );

            if (country) {
              setIsStatesLoading(true);
              setIsCitiesLoading(true);
              setSelectedCountry(country.name);

              const countryStates = await getStatesByCountry(country.id);
              setStates(countryStates);
              setIsStatesLoading(false);

              // 2. Find state by region name (fuzzy match)
              let matchedState = countryStates.find(
                (s) => s.name.toLowerCase() === geo.region.toLowerCase()
              );

              // If exact match fails, try fuzzy match
              if (!matchedState && geo.region !== "Unknown") {
                matchedState = countryStates.find(
                  (s) =>
                    s.name.toLowerCase().includes(geo.region.toLowerCase()) ||
                    geo.region.toLowerCase().includes(s.name.toLowerCase())
                );
              }

              // Fallback to first state
              const state = matchedState || countryStates[0];
              if (state) {
                setSelectedState(state.name);
                const stateCities = await getCitiesByState(state.id);
                setCities(stateCities);
                setIsCitiesLoading(false);

                // 3. Find city by name (fuzzy match)
                let matchedCity = stateCities.find(
                  (c) => c.name.toLowerCase() === geo.city.toLowerCase()
                );

                // If exact match fails, try fuzzy match
                if (!matchedCity) {
                  matchedCity = stateCities.find(
                    (c) =>
                      c.name.toLowerCase().includes(geo.city.toLowerCase()) ||
                      geo.city.toLowerCase().includes(c.name.toLowerCase())
                  );
                }

                // Fallback to first city
                const city = matchedCity || stateCities[0];
                if (city) {
                  setSelectedCity(city.name);

                  // Use city coordinates if available, otherwise fallback to IP coordinates
                  let lat =
                    typeof city.latitude === "number"
                      ? city.latitude
                      : parseFloat(city.latitude as string) ||
                        parseFloat(String(geo.latitude)) ||
                        0;
                  let lng =
                    typeof city.longitude === "number"
                      ? city.longitude
                      : parseFloat(city.longitude as string) ||
                        parseFloat(String(geo.longitude)) ||
                        0;

                  // IP 定位成功后拉取区列表（城市自身 + API 数据）
                  setSelectedDistrict(city.name);
                  setDistricts([{ id: 0, name: city.name, lat, lng }]);
                  try {
                    const apiDistricts = await getDistrictsByCity(
                      city.name as string,
                      state.name,
                      country.name
                    );
                    setDistricts([{ id: 0, name: city.name, lat, lng }, ...apiDistricts]);
                  } catch {
                    /* 失败则仅保留城市自身选项 */
                  }

                  setLocation({
                    country: country.name,
                    state: state.name,
                    city: city.name,
                    district: city.name,
                    lat,
                    lng,
                  });
                }
              }
              isRestored.current = true;
              return; // Skip default logic
            }
          }
        } catch (error) {
          console.error("Failed to detect user location:", error);
        }

        // Default initialization if IP detection fails or no match found
        const firstCountry = countries[0];
        setSelectedCountry(firstCountry.name);
        (async () => {
          try {
            setIsStatesLoading(true);
            setIsCitiesLoading(true);
            const countryStates = await getStatesByCountry(firstCountry.id);
            setStates(countryStates);
            setIsStatesLoading(false);
            if (countryStates.length > 0) {
              const firstState = countryStates[0];
              setSelectedState(firstState.name);
              const stateCities = await getCitiesByState(firstState.id);
              setCities(stateCities);
              setIsCitiesLoading(false);
              if (stateCities.length > 0) {
                setSelectedCity(stateCities[0].name);
                const cityName = stateCities[0].name;

                // 优先从城市数据中获取坐标（CDN 数据包含坐标）
                let lat = 0,
                  lng = 0;
                const firstCity = stateCities[0];
                if (firstCity.latitude && firstCity.longitude) {
                  lat =
                    typeof firstCity.latitude === "number"
                      ? firstCity.latitude
                      : parseFloat(firstCity.latitude as string) || 0;
                  lng =
                    typeof firstCity.longitude === "number"
                      ? firstCity.longitude
                      : parseFloat(firstCity.longitude as string) || 0;
                }

                setSelectedDistrict(cityName);
                const cityDistrict: District = { id: 0, name: cityName, lat, lng };
                try {
                  const apiDistricts = await getDistrictsByCity(
                    cityName,
                    firstState.name,
                    firstCountry.name
                  );
                  setDistricts([cityDistrict, ...apiDistricts]);
                } catch {
                  setDistricts([cityDistrict]);
                }

                setLocation({
                  country: firstCountry.name,
                  state: firstState.name,
                  city: cityName,
                  district: cityName,
                  lat,
                  lng,
                });
              }
            }
            isRestored.current = true;
          } catch (error) {
            console.error("Error initializing location data:", error);
            setIsStatesLoading(false);
            setIsCitiesLoading(false);
            isRestored.current = true;
          }
        })();
      })();
    }
  }, [countries]);

  // Remove the old initialization useEffect (lines 182-211) as it's merged above

  const deferredCustomColors = useDeferredValue(customColors);
  const deferredSelectedPreset = useDeferredValue(selectedPreset);
  const colors = useCustomColors ? deferredCustomColors : selectedTheme.colors;

  const handleCountryChange = async (countryName: string) => {
    setSelectedCountry(countryName);
    setStates([]);
    setCities([]);
    setDistricts([]);
    setIsStatesLoading(true);
    setIsCitiesLoading(true);
    setIsDistrictsLoading(true);
    try {
      const country = countries.find((c) => c.name.toLowerCase() === countryName.toLowerCase());
      const countryStates = await getStatesByCountry(country?.id || 0);
      setStates(countryStates);
      setIsStatesLoading(false);
      if (countryStates.length > 0) {
        const firstState = countryStates[0];
        setSelectedState(firstState.name);
        const stateCities = await getCitiesByState(firstState.id);
        setCities(stateCities);
        setIsCitiesLoading(false);
        if (stateCities.length > 0) {
          setSelectedCity(stateCities[0].name);
          const cityName = stateCities[0].name;

          // 优先从城市数据中获取坐标（CDN 数据包含坐标）
          let lat = 0,
            lng = 0;
          const firstCity = stateCities[0];
          if (firstCity.latitude && firstCity.longitude) {
            lat =
              typeof firstCity.latitude === "number"
                ? firstCity.latitude
                : parseFloat(firstCity.latitude as string) || 0;
            lng =
              typeof firstCity.longitude === "number"
                ? firstCity.longitude
                : parseFloat(firstCity.longitude as string) || 0;
          }

          // 区列表：城市自身作为默认 fallback + API 获取的区县数据
          setSelectedDistrict(cityName);
          const cityAsDistrict: District = { id: 0, name: cityName, lat, lng };
          try {
            const apiDistricts = await getDistrictsByCity(
              cityName,
              firstState.name,
              country?.name || countryName
            );
            setDistricts([cityAsDistrict, ...apiDistricts]);
          } catch {
            setDistricts([cityAsDistrict]);
          }
          setIsDistrictsLoading(false);

          setLocation({
            country: country?.name || countryName,
            state: firstState.name,
            city: cityName,
            district: cityName,
            lat,
            lng,
          });
        }
      } else {
        // 没有州/省份数据（如澳门），使用国家名作为城市名
        setSelectedState("");
        setSelectedCity("");
        setSelectedDistrict("");
        setCities([]);
        setDistricts([]);
        setIsCitiesLoading(false);
        setIsDistrictsLoading(false);
        const cityName = countryName;
        // 无法获取坐标，仅设置地区名称
        setLocation({ country: countryName, state: "", city: cityName });
      }
    } catch (error) {
      console.error("Error loading states:", error);
      setIsStatesLoading(false);
      setIsCitiesLoading(false);
      setIsDistrictsLoading(false);
    }
  };

  const handleStateChange = async (stateName: string) => {
    setSelectedState(stateName);
    setCities([]);
    setDistricts([]);
    setIsCitiesLoading(true);
    setIsDistrictsLoading(true);
    try {
      const state = states.find((s) => s.name.toLowerCase() === stateName.toLowerCase());
      if (state) {
        const stateCities = await getCitiesByState(state.id);
        setCities(stateCities);
        setIsCitiesLoading(false);
        if (stateCities.length > 0) {
          const firstCity = stateCities[0];
          setSelectedCity(firstCity.name);
          const cityName = firstCity.name;

          // 优先从城市数据中获取坐标（CDN 数据包含坐标）
          let lat = 0,
            lng = 0;
          if (firstCity.latitude && firstCity.longitude) {
            lat =
              typeof firstCity.latitude === "number"
                ? firstCity.latitude
                : parseFloat(firstCity.latitude as string) || 0;
            lng =
              typeof firstCity.longitude === "number"
                ? firstCity.longitude
                : parseFloat(firstCity.longitude as string) || 0;
          }

          setSelectedDistrict(cityName);
          const cityAsDistrict: District = { id: 0, name: cityName, lat, lng };
          try {
            const apiDistricts = await getDistrictsByCity(cityName, state.name, selectedCountry);
            setDistricts([cityAsDistrict, ...apiDistricts]);
          } catch {
            setDistricts([cityAsDistrict]);
          }
          setIsDistrictsLoading(false);

          setLocation({
            country: selectedCountry,
            state: state.name,
            city: cityName,
            district: cityName,
            lat,
            lng,
          });
        } else {
          // 无城市数据时（如香港、澳门等独立地区），城市名回退到州名
          const fallback = await resolveStandaloneRegionFallback(selectedCountry, state);
          const cityName = fallback?.city || stateName;
          setSelectedCity(cityName);
          setSelectedDistrict(cityName);
          setDistricts([
            { id: 0, name: cityName, lat: fallback?.lat || 0, lng: fallback?.lng || 0 },
          ]);
          setIsDistrictsLoading(false);
          setLocation({
            country: selectedCountry,
            state: state.name,
            city: cityName,
            district: cityName,
            ...(fallback ? { lat: fallback.lat, lng: fallback.lng } : {}),
          });
        }
      }
    } catch (error) {
      console.error("Error loading cities:", error);
      setIsCitiesLoading(false);
      setIsDistrictsLoading(false);
    }
  };

  const handleCityChange = async (cityName: string) => {
    setSelectedCity(cityName);
    setDistricts([]);
    setIsDistrictsLoading(true);

    let coordinates: { lat: number; lng: number } | null = null;

    // 首先尝试从已加载的城市数据中获取坐标（CDN 数据包含坐标）
    const state = states.find((s) => s.name.toLowerCase() === selectedState.toLowerCase());
    if (state) {
      try {
        const stateCities = await getCitiesByState(state.id);
        const city = stateCities.find((c: any) => c.name.toLowerCase() === cityName.toLowerCase());
        coordinates = parseCityCoordinates(city);
      } catch (error) {
        console.error("Failed to get coordinates from city data:", error);
      }
    }

    const fallback = coordinates
      ? null
      : await resolveStandaloneRegionFallback(selectedCountry, state || selectedState);
    const resolvedCityName = fallback?.city || cityName;
    const resolvedCoordinates = coordinates || fallback || { lat: 0, lng: 0 };

    if (resolvedCityName !== cityName) {
      setSelectedCity(resolvedCityName);
    }

    // 构建区列表：城市自身作为默认项（id=0），API 数据排后面
    setSelectedDistrict(resolvedCityName);
    const cityAsDistrict: District = {
      id: 0,
      name: resolvedCityName,
      lat: resolvedCoordinates.lat,
      lng: resolvedCoordinates.lng,
    };
    try {
      const apiDistricts = await getDistrictsByCity(
        resolvedCityName,
        selectedState,
        selectedCountry
      );
      setDistricts([cityAsDistrict, ...apiDistricts]);
    } catch {
      setDistricts([cityAsDistrict]);
    }
    setIsDistrictsLoading(false);

    setLocation({
      country: selectedCountry,
      state: selectedState,
      city: resolvedCityName,
      district: resolvedCityName,
      lat: resolvedCoordinates.lat,
      lng: resolvedCoordinates.lng,
    });
  };

  /**
   * 区/县选择变更：从 districts 中查找对应坐标并更新 location
   * 选中城市自身（id=0）时 location.district 仍写城市名，等价于三级选择器的行为
   */
  const handleDistrictChange = (districtName: string) => {
    setSelectedDistrict(districtName);

    const district = districts.find((d) => d.name === districtName);
    if (district) {
      setLocation((prev) => ({
        ...prev,
        district: districtName,
        lat: district.lat,
        lng: district.lng,
      }));
    }
  };

  useEffect(() => {
    init()
      .then(() => {
        init_panic_hook();
      })
      .catch((err) => {
        console.error("Failed to initialize WASM:", err);
      });
  }, []);

  const handleDownload = async (scale: number, exportFormat: ExportFormat = "png") => {
    const generationStart = performance.now();
    setIsGenerating(true);
    setGenerationProgress(0);
    currentStepRef.current = "step_init";
    setGenerationStep(m.step_init());
    generationCompleteRef.current = false;
    isGameOpenRef.current = false;
    await yieldMainThread();
    const numWorkers = navigator.hardwareConcurrency || 4;
    const workers = Array.from(
      { length: numWorkers },
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
    );

    // 设置进度回调，用于接收 data-worker 发来的进度更新
    const progressHandler = (progress: number, step: string) => {
      currentStepRef.current = step;
      // 处理带等待秒数的步骤 (格式: "step_waiting_api:30" 或 "step_retrying_error:55")
      if (step.startsWith("step_waiting_api:")) {
        const seconds = step.split(":")[1];
        setGenerationStep(m.step_waiting_api({ seconds }));
      } else if (step.startsWith("step_retrying_error:")) {
        const seconds = step.split(":")[1];
        console.log(
          `[App] step_retrying_error: seconds=${seconds}, message=${m.step_retrying_error({ seconds })}`
        );
        setGenerationStep(m.step_retrying_error({ seconds }));
      } else {
        // 处理普通步骤
        const stepKey = step as keyof typeof m;
        if (stepKey && m[stepKey]) {
          // @ts-ignore - 动态调用国际化消息
          setGenerationStep(m[stepKey]());
        } else {
          setGenerationStep(step);
        }
      }
      setGenerationProgress(progress);
    };
    mapDataService.setProgressCallback(progressHandler);

    try {
      setGenerationProgress(5);
      currentStepRef.current = "step_coordinates";
      setGenerationStep(m.step_coordinates());
      await yieldMainThread();
      // 直接使用 location 中已有的坐标（来自城市数据）
      const lat = location.lat || 0;
      const lng = location.lng || 0;

      const width = selectedSize.width * scale;
      const height = selectedSize.height * scale;
      setGenerationProgress(10);
      // 初始获取数据消息，会被 worker 的进度更新覆盖
      currentStepRef.current = "step_fetching_data";
      setGenerationStep(m.step_fetching_data());
      await yieldMainThread();

      // 获取地图数据 (包含 POI)
      // 下载范围使用固定的 canonical fetch viewport，避免同半径切换画幅时重新拉取数据。
      const mapDataStart = performance.now();
      // skipPois: 用户关闭 POI 渲染时跳过 Overpass 请求和缓存检查，节省带宽与时间
      const mapResults = await mapDataService.getMapData(
        location.country,
        location.city,
        lat,
        lng,
        baseRadius,
        lodMode,
        location.district,
        !showPois // skipPois
      );

      const { roads, water, parks, pois: poisRaw, fromCache, cacheLevel, isProtomaps } = mapResults;
      logClientTiming("mapData", "getMapData", {
        total: performance.now() - mapDataStart,
        cacheLevel: cacheLevel ?? "unknown",
        roads: roads.length.toString(),
        water: water.length.toString(),
        parks: parks.length.toString(),
        pois: poisRaw.length.toString(),
      });

      // 根据缓存层级设置最终消息
      if (cacheLevel === "memory") {
        currentStepRef.current = "step_restore_memory";
        setGenerationProgress(60);
        setGenerationStep(m.step_restore_memory());
      } else if (fromCache) {
        currentStepRef.current = "step_cache_restore_complete";
        setGenerationProgress(60);
        setGenerationStep(m.step_cache_restore_complete());
      } else {
        currentStepRef.current = "step_fetch_complete";
        setGenerationProgress(60);
        setGenerationStep(m.step_fetch_complete());
      }
      await yieldMainThread();

      setGenerationProgress(62);
      currentStepRef.current = "step_sharding_roads";
      setGenerationStep(m.step_sharding_roads());
      await yieldMainThread();

      const shardStart = performance.now();
      const roadShards = shardRoadsBinary(roads, numWorkers);
      logClientTiming("processing", "shardRoads", {
        total: performance.now() - shardStart,
        shards: roadShards.length.toString(),
      });

      setGenerationProgress(65);
      currentStepRef.current = "step_wasm_processing";
      setGenerationStep(m.step_wasm_processing());
      await yieldMainThread();

      // 这里的 TypedArray 是之后会被 transfer 的
      const waterTyped = water;
      const parksTyped = parks;
      const poisTyped = poisRaw;

      // 并行处理：道路、水体、公园
      // 注意：使用取模确保索引永远在 workers 范围内
      const roadProcessingPromises = roadShards.map((shard, i) =>
        runInWorker(workers[i % numWorkers], "roads", shard, [shard.buffer], `roads_shard_${i + 1}`)
      );

      const wasmProcessingStart = performance.now();
      // 道路、水体、公园并行处理；POI 按用户开关决定是否参与 worker 处理
      const [processedRoadShards, waterBin, parksBin] = await Promise.all([
        Promise.all(roadProcessingPromises),
        runInWorker(workers[0 % numWorkers], "polygons", waterTyped, [waterTyped.buffer], "water"),
        runInWorker(workers[1 % numWorkers], "polygons", parksTyped, [parksTyped.buffer], "parks"),
      ]);
      // 用户关闭 POI 时跳过 worker 处理，直接构造空数组（WASM 会跳过渲染）
      const poisBin = showPois
        ? await runInWorker(workers[2 % numWorkers], "pois", poisTyped, [poisTyped.buffer], "pois")
        : new Float64Array([0]);
      logClientTiming("processing", "wasmAll", { total: performance.now() - wasmProcessingStart });

      // 数据处理完成
      setGenerationProgress(82);
      currentStepRef.current = "step_processing_complete";
      setGenerationStep(m.step_processing_complete());
      await yieldMainThread();

      setGenerationProgress(84);
      currentStepRef.current = "step_prepare_render";
      setGenerationStep(m.step_prepare_render());
      await yieldMainThread();

      // 准备渲染配置
      const configStart = performance.now();
      const config = {
        center: { lat, lon: lng },
        radius: baseRadius,
        theme: colors,
        width,
        height,
        display_city:
          customTitle || location.district?.toUpperCase() || location.city.toUpperCase(),
        display_country: location.country,
        text_position: "bottom",
        selected_size_height: selectedSize.height * scale,
        frontend_scale: scale,
        road_width_boost: isProtomaps ? 1.8 : 1.0,
        // 用户关闭 POI 时不传 pois 字段，WASM 端 #[serde(default)] 自动为 None
        ...(showPois ? { pois: Array.from(poisBin) } : {}),
        show_coords: showCoords,
        show_city: showCity,
        show_country: showCountry,
        export_format: exportFormat,
        svg_font_mode: "embed",
      };
      logClientTiming("processing", "prepareRenderConfig", {
        total: performance.now() - configStart,
        pois: poisBin.length.toString(),
      });

      setGenerationProgress(90);
      currentStepRef.current = "step_rendering";
      setGenerationStep(m.step_rendering());
      await yieldMainThread();

      // 构建最终渲染载体
      const renderOptions: any = {
        roads_shards: processedRoadShards,
        water_bin: waterBin,
        parks_bin: parksBin,
        config_json: JSON.stringify(config),
      };

      const finalTransfers: Transferable[] = [
        ...processedRoadShards.map((s) => s.buffer),
        waterBin.buffer,
        parksBin.buffer,
        // 空 POI 数组无 buffer 可 transfer，仅当用户开启 POI 时加入传输列表
        ...(showPois && poisBin.length > 1 ? [poisBin.buffer] : []),
      ];

      // 从缓存直接取字体数据，与预览状态解耦
      const fontData = fontCacheRef.current.get(selectedPreset)?.data;
      if (fontData) {
        const fontCopy = new Uint8Array(fontData);
        renderOptions.custom_font = fontCopy;
        finalTransfers.push(fontCopy.buffer);
      }

      // 执行渲染任务
      const renderStart = performance.now();
      const renderedData = await runInWorker(
        workers[0 % numWorkers],
        "render",
        renderOptions,
        finalTransfers,
        "poster"
      );
      logClientTiming("render", "roundTrip", { total: performance.now() - renderStart });

      if (renderedData) {
        setGenerationProgress(97);
        currentStepRef.current = "step_downloading_file";
        setGenerationStep(m.step_downloading_file());
        console.log(
          "[App] generationCompleteRef set to true, isGameOpen:",
          isGameOpen,
          new Date().toISOString()
        );
        generationCompleteRef.current = true;
        await yieldMainThread();

        const downloadStart = performance.now();
        const mimeType = exportFormat === "svg" ? "image/svg+xml;charset=utf-8" : "image/png";
        const blob = new Blob([renderedData as BlobPart], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${(customTitle || location.city).toLowerCase().replace(/\s+/g, "-")}-map-poster.${exportFormat}`;
        link.click();
        logClientTiming("download", "file", { total: performance.now() - downloadStart });
        logClientTiming("generation", "total", { total: performance.now() - generationStart });
        setGenerationProgress(100);
        currentStepRef.current = "step_complete";
        setGenerationStep(m.step_complete());
      }
    } catch (error) {
      console.error(m.error_generating(), error);

      const err = error instanceof Error ? error : new Error(String(error));

      const diagnostics: Record<string, string> = {
        Language: activeLang,
        Country: location.country || "(none)",
        State: location.state || "(none)",
        City: location.city || "(none)",
        District: location.district || "(none)",
        Coordinates: `${location.lat?.toFixed(4) ?? "?"}, ${location.lng?.toFixed(4) ?? "?"}`,
        Size: `${selectedSize.width}x${selectedSize.height}`,
        Scale: String(scale),
        Radius: `${baseRadius}m`,
        "LOD Mode": lodMode,
        Theme: selectedTheme.id,
        Font: customFont ? `Custom (${fontFileName})` : selectedPreset,
        "Show POIs": String(showPois),
        "Show Coords": String(showCoords),
        "Show City": String(showCity),
        "Show Country": String(showCountry),
        Timestamp: new Date().toISOString(),
        "User Agent": navigator.userAgent,
      };

      setErrorModal({
        error: err,
        step: currentStepRef.current || "unknown",
        diagnostics,
      });
    } finally {
      console.log(
        "[App] finally block, isGameOpenRef:",
        isGameOpenRef.current,
        "isGameOpen(state):",
        isGameOpen,
        "generationCompleteRef:",
        generationCompleteRef.current,
        new Date().toISOString()
      );
      mapDataService.setProgressCallback(null);
      if (!isGameOpenRef.current) {
        console.log("[App] finally: closing loading because game is not open");
        setIsGenerating(false);
      } else {
        console.log("[App] finally: game is open, NOT closing loading");
      }
      workers.forEach((w) => w.terminate());
    }
  };

  useDynamicFont(activeLang);

  const navSections = useMemo<NavSection[]>(
    () => [
      { id: "section-location", icon: <MapPin className="w-5 h-5" />, label: m.location() },
      { id: "section-data", icon: <Settings2 className="w-5 h-5" />, label: m.label_map_radius() },
      {
        id: "section-theme-colors",
        icon: <Palette className="w-5 h-5" />,
        label: m.theme_colors(),
      },
      {
        id: "section-text-display",
        icon: <Eye className="w-5 h-5" />,
        label: m.render_control(),
      },
      {
        id: "section-font-settings",
        icon: <FileText className="w-5 h-5" />,
        label: m.font_settings(),
      },
      { id: "section-poster-size", icon: <Scaling className="w-5 h-5" />, label: m.poster_size() },
    ],
    [activeLang]
  );
  const { configScrollRef, activeSection, setSectionRef, handleNavNavigate } =
    useConfigNavigation(navSections);

  return (
    <>
      <SEOHead />
      <div className="flex flex-col bg-background md:h-screen md:overflow-hidden">
        <AppHeader
          activeLang={activeLang}
          onLangChange={handleLanguageChange}
          onDownload={(scale, format) => handleDownload(scale, format)}
          isGenerating={isGenerating}
          locationLoading={locationLoading}
        />

        <GenerationModal
          isGenerating={isGenerating}
          generationProgress={generationProgress}
          generationStep={generationStep}
          isGameOpen={isGameOpen}
          generationCompleteRef={generationCompleteRef}
          onGameOpenChange={(open) => {
            setIsGameOpen(open);
            isGameOpenRef.current = open;
            if (!open && generationCompleteRef.current) {
              setIsGenerating(false);
              generationCompleteRef.current = false;
            }
          }}
          onClose={() => {
            setIsGenerating(false);
            generationCompleteRef.current = false;
          }}
          triggerLabel={m.snake_game_trigger()}
        />

        <ErrorModal
          open={errorModal !== null}
          onClose={() => setErrorModal(null)}
          error={errorModal?.error ?? null}
          errorStep={errorModal?.step ?? ""}
          diagnosticInfo={errorModal?.diagnostics ?? {}}
        />

        <main className="flex-1 overflow-auto custom-scrollbar w-full mx-auto px-4 py-6">
          <div className="grid md:grid-cols-[480px_1fr] px-0 md:px-20 gap-8 md:h-full">
            <div className="flex flex-row gap-8 md:min-h-0">
              <ConfigNav
                sections={navSections}
                activeSection={activeSection}
                onNavigate={handleNavNavigate}
              />
              <div
                ref={configScrollRef}
                className="flex-1 space-y-8 md:overflow-y-auto custom-scrollbar md:min-h-0"
                key={activeLang}
              >
                <div id="section-location" ref={setSectionRef("section-location")}>
                  <LocationSettings
                    location={location}
                    countries={countries}
                    states={states}
                    cities={cities}
                    districts={districts}
                    selectedCountry={selectedCountry}
                    selectedState={selectedState}
                    selectedCity={selectedCity}
                    selectedDistrict={selectedDistrict}
                    customTitle={customTitle}
                    isStatesLoading={isStatesLoading}
                    isCitiesLoading={isCitiesLoading}
                    isDistrictsLoading={isDistrictsLoading}
                    locationLoading={locationLoading}
                    onCountryChange={handleCountryChange}
                    onStateChange={handleStateChange}
                    onCityChange={handleCityChange}
                    onDistrictChange={handleDistrictChange}
                    onCustomTitleChange={setCustomTitle}
                    locationMode={locationMode}
                    onLocationModeChange={handleLocationModeChange}
                    coordinateLat={location.lat ?? 0}
                    coordinateLng={location.lng ?? 0}
                    onLatChange={handleLatChange}
                    onLngChange={handleLngChange}
                    onCoordinatesChange={handleCoordinateReverseGeocode}
                  />
                </div>

                <div id="section-data" ref={setSectionRef("section-data")}>
                  <DataSettings baseRadius={baseRadius} onBaseRadiusChange={setBaseRadius} />
                </div>

                <div id="section-theme-colors" ref={setSectionRef("section-theme-colors")}>
                  <ThemeColors
                    selectedTheme={selectedTheme}
                    customColors={customColors}
                    useCustomColors={useCustomColors}
                    themeNameMap={themeNameMap}
                    onThemeChange={(theme) => {
                      setSelectedTheme(theme);
                      setCustomColors(theme.colors);
                      setUseCustomColors(false);
                    }}
                    onCustomColorsChange={setCustomColors}
                    onUseCustomColorsChange={setUseCustomColors}
                  />
                </div>

                <div id="section-text-display" ref={setSectionRef("section-text-display")}>
                  <RenderControlSettings
                    showCoords={showCoords}
                    showCity={showCity}
                    showCountry={showCountry}
                    showPois={showPois}
                    onShowCoordsChange={setShowCoords}
                    onShowCityChange={setShowCity}
                    onShowCountryChange={setShowCountry}
                    onShowPoisChange={setShowPois}
                  />
                </div>

                <div id="section-font-settings" ref={setSectionRef("section-font-settings")}>
                  <FontSettings
                    customFont={customFont}
                    fontFileName={fontFileName}
                    fontFileInputRef={fontFileInputRef}
                    onFontUpload={handleFontUpload}
                    onClearFont={clearCustomFont}
                    selectedPreset={selectedPreset}
                    fontLoadingPreset={fontLoadingPreset}
                    onPresetFontSelect={handlePresetFontSelect}
                  />
                </div>

                <div id="section-poster-size" ref={setSectionRef("section-poster-size")}>
                  <PosterSizeSelector
                    sizes={SIZES}
                    selectedSize={selectedSize}
                    onSizeChange={(size) => setSelectedSizeId(size.id)}
                  />
                </div>
              </div>
            </div>

            <MapPreview
              location={location}
              selectedSize={selectedSize}
              colors={colors}
              fontCacheRef={fontCacheRef}
              selectedPreset={deferredSelectedPreset}
              baseRadius={baseRadius}
              customTitle={customTitle}
              showCoords={showCoords}
              showCity={showCity}
              showCountry={showCountry}
              previewRef={previewRef}
              previewHint={m.preview_actual_result()}
              interactive={true} // locationMode === "coordinates"
              onMove={(loc) => {
                setLocation((prev) => ({ ...prev, lat: loc.lat, lng: loc.lon }));
              }}
              onMoveEnd={(loc) => {
                setLocation((prev) => ({ ...prev, lat: loc.lat, lng: loc.lon }));
                handleCoordinateReverseGeocode(loc.lat, loc.lon);
              }}
            />
          </div>
          <PosterGallery />
          <Footer activeLang={activeLang} />
        </main>
      </div>
    </>
  );
}
