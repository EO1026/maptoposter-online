import { memo } from "react";
import { cn } from "@/lib/utils";

export interface NavSection {
  id: string;
  icon: React.ReactNode;
  label: string;
}

interface ConfigNavProps {
  sections: NavSection[];
  activeSection: string;
  onNavigate: (id: string) => void;
}

export const ConfigNav = memo(function ConfigNav({
  sections,
  activeSection,
  onNavigate,
}: ConfigNavProps) {
  return (
    <nav
      className="hidden md:flex flex-col items-center gap-3 w-[110px] shrink-0 pl-2 pr-8 bg-background border-r border-[#b4a08c]/25"
      aria-label="Config sections"
    >
      {sections.map((section) => {
        const isActive = activeSection === section.id;
        return (
          <button
            key={section.id}
            onClick={() => onNavigate(section.id)}
            className={cn(
              "relative flex flex-col items-center gap-1.5 w-full px-1.5 py-2.5 transition-colors cursor-pointer",
              "hover:bg-primary/6 hover:text-primary hover:-translate-y-px",
              "transition-all duration-150 relative group",
              isActive ? "text-primary bg-primary/10" : "text-muted-foreground"
            )}
            aria-current={isActive ? "true" : undefined}
          >
            <span className="w-5 h-5 flex items-center justify-center">{section.icon}</span>
            <span className="text-[11px] leading-tight text-center">{section.label}</span>
            {isActive && (
              <span className="absolute h-full w-[2px] bg-primary rounded-full left-0 top-0" />
            )}
          </button>
        );
      })}
    </nav>
  );
});
