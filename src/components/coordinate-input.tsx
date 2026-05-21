import { useState, useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Crosshair } from "lucide-react";
import * as m from "@/paraglide/messages";
import { getBrowserLocation } from "@/services/browser-geolocation";

interface CoordinateInputProps {
  lat: number;
  lng: number;
  onLatChange: (lat: number) => void;
  onLngChange: (lng: number) => void;
  onCoordinatesChange?: (lat: number, lng: number) => void;
}

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatCoord(v: number): string {
  // 保留 6 位小数，去掉末尾多余的 0
  return v.toFixed(6).replace(/\.?0+$/, "");
}

export function CoordinateInput({
  lat,
  lng,
  onLatChange,
  onLngChange,
  onCoordinatesChange,
}: CoordinateInputProps) {
  const [latStr, setLatStr] = useState(() => formatCoord(lat));
  const [lngStr, setLngStr] = useState(() => formatCoord(lng));
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // 同步来自 props 的坐标变化（地图拖拽 → setLocation 回传）
  // 用 ref 避免用户正在输入时被覆盖
  const isFocusedLat = useRef(false);
  const isFocusedLng = useRef(false);

  useEffect(() => {
    if (!isFocusedLat.current) {
      setLatStr(formatCoord(lat));
    }
  }, [lat]);

  useEffect(() => {
    if (!isFocusedLng.current) {
      setLngStr(formatCoord(lng));
    }
  }, [lng]);

  const commitLat = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.") {
      return;
    }
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed) && isFinite(parsed)) {
      const clamped = clamp(parsed, LAT_MIN, LAT_MAX);
      setLatStr(formatCoord(clamped));
      onLatChange(clamped);
      console.log(`[GeoMatch] commitLat calling onCoordinatesChange(lat=${clamped}, lng=${lng})`);
      onCoordinatesChange?.(clamped, lng);
    } else {
      setLatStr(formatCoord(lat));
    }
  };

  const commitLng = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.") {
      return;
    }
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed) && isFinite(parsed)) {
      const clamped = clamp(parsed, LNG_MIN, LNG_MAX);
      setLngStr(formatCoord(clamped));
      onLngChange(clamped);
      console.log(`[GeoMatch] commitLng calling onCoordinatesChange(lat=${lat}, lng=${clamped})`);
      onCoordinatesChange?.(lat, clamped);
    } else {
      setLngStr(formatCoord(lng));
    }
  };

  const handleUseMyLocation = async () => {
    setGpsLoading(true);
    setGpsError(null);

    const result = await getBrowserLocation();

    if (result.error === "unsupported") {
      setGpsError(m.gps_error_unsupported());
      setGpsLoading(false);
      return;
    }

    if (result.error === "denied") {
      setGpsError(m.gps_error_denied());
      setGpsLoading(false);
      return;
    }

    if (result.error === "unavailable") {
      setGpsError(m.gps_error_unavailable());
      setGpsLoading(false);
      return;
    }

    if (result.error === "timeout") {
      setGpsError(m.gps_error_timeout());
      setGpsLoading(false);
      return;
    }

    if (result.coordinates) {
      const newLat = Number(result.coordinates.lat.toFixed(6));
      const newLng = Number(result.coordinates.lng.toFixed(6));
      setLatStr(formatCoord(newLat));
      setLngStr(formatCoord(newLng));
      onLatChange(newLat);
      onLngChange(newLng);
      onCoordinatesChange?.(newLat, newLng);
    }

    setGpsLoading(false);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {m.label_latitude()}
          </Label>
          <Input
            type="text"
            inputMode="decimal"
            value={latStr}
            onFocus={() => {
              isFocusedLat.current = true;
            }}
            onBlur={() => {
              isFocusedLat.current = false;
              commitLat(latStr);
            }}
            onChange={(e) => setLatStr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="border-border bg-card text-foreground font-mono text-sm"
          />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {m.label_longitude()}
          </Label>
          <Input
            type="text"
            inputMode="decimal"
            value={lngStr}
            onFocus={() => {
              isFocusedLng.current = true;
            }}
            onBlur={() => {
              isFocusedLng.current = false;
              commitLng(lngStr);
            }}
            onChange={(e) => setLngStr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="border-border bg-card text-foreground font-mono text-sm"
          />
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2"
        onClick={handleUseMyLocation}
        disabled={gpsLoading}
      >
        <Crosshair className={`w-4 h-4 ${gpsLoading ? "animate-spin" : ""}`} />
        {gpsLoading ? m.gps_loading() : m.button_use_my_location()}
      </Button>

      {gpsError && <p className="text-xs text-destructive mt-1">{gpsError}</p>}
    </div>
  );
}
