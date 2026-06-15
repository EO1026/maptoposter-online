import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type PoiShape, type PoiSource } from "@/lib/types";
import { MapPinned, Pin } from "lucide-react";
import * as m from "@/paraglide/messages";

interface CustomPOISettingsProps {
  customPoiCount: number;
  poiSource: PoiSource;
  poiShape: PoiShape;
  onManageClick: () => void;
  onPoiSourceChange: (val: PoiSource) => void;
  onPoiShapeChange: (val: PoiShape) => void;
}

interface RadioOption<T extends string> {
  value: T;
  label: string;
}

interface RadioOptionGroupProps<T extends string> {
  name: string;
  options: RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

function RadioOptionGroup<T extends string>({
  name,
  options,
  value,
  onChange,
}: RadioOptionGroupProps<T>) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((option) => {
        const checked = value === option.value;
        const inputId = `${name}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={inputId}
            className={cn(
              // justify-center
              "flex cursor-pointer items-center py-1 gap-2 text-xs text-foreground transition-all"
            )}
          >
            <input
              id={inputId}
              name={name}
              type="radio"
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export function CustomPOISettings({
  customPoiCount,
  poiSource,
  poiShape,
  onManageClick,
  onPoiSourceChange,
  onPoiShapeChange,
}: CustomPOISettingsProps) {
  const poiSourceOptions: { value: PoiSource; label: string }[] = [
    { value: "off", label: m.poi_source_off() },
    { value: "overpass", label: m.poi_source_overpass() },
    { value: "custom", label: m.poi_source_custom() },
  ];
  const poiShapeOptions: { value: PoiShape; label: string }[] = [
    { value: "circle", label: m.poi_shape_circle() },
    { value: "star", label: m.poi_shape_star() },
    { value: "heart", label: m.poi_shape_heart() },
  ];

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Pin className="h-4 w-4 text-primary" />
        <h2 className="text-lg text-foreground">{m.custom_poi_nav_label()}</h2>
      </div>
      <div className="space-y-4">
        {/* <p className="text-sm text-muted-foreground">{m.custom_poi_section_description()}</p> */}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {m.poi_source_label()}
          </p>
          <RadioOptionGroup
            name="poi-source"
            options={poiSourceOptions}
            value={poiSource}
            onChange={onPoiSourceChange}
          />
        </div>
        {poiSource === "custom" && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {m.poi_source_custom()}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 border border-border/70 bg-secondary/20 p-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <MapPinned className="h-4 w-4 text-primary" />
                  <span>{m.custom_poi_added_count({ count: String(customPoiCount) })}</span>
                </div>
              </div>
              <Button type="button" className="h-7 cursor-pointer" onClick={onManageClick}>
                {m.custom_poi_manage_button()}
              </Button>
            </div>
          </div>
        )}
        {poiSource !== 'off' && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {m.poi_shape_label()}
            </p>
            <RadioOptionGroup
              name="poi-shape"
              options={poiShapeOptions}
              value={poiShape}
              onChange={onPoiShapeChange}
            />
          </div>
        )}
        <p className="text-[12px] italic text-muted-foreground">
          {poiSource === "off"
            ? m.poi_hint_off()
            : poiSource === "overpass"
              ? m.poi_hint_overpass()
              : m.poi_hint_custom()}
        </p>
      </div>
    </Card>
  );
}
