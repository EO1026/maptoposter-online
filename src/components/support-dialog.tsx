import { Heart, Coffee } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import * as m from "@/paraglide/messages";
import { type AvailableLanguageTag } from "@/hooks/useLanguage";

interface SupportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeLang: AvailableLanguageTag;
}

export function SupportDialog({ open, onOpenChange, activeLang }: SupportDialogProps) {
  const localeOptions = { locale: activeLang };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-red-500" aria-hidden="true" />
            {m.support_title({}, localeOptions)}
          </DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            {m.support_description({}, localeOptions)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <a
            href="https://www.buymeacoffee.com/ianho7"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border p-4 hover:bg-accent hover:text-vanilla transition-colors cursor-pointer"
            data-ai-action="support-buy-me-a-coffee"
          >
            <Coffee className="w-6 h-6 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">{m.support_buy_me_a_coffee({}, localeOptions)}</p>
              <p className="text-xs">{m.support_buy_me_a_coffee_desc({}, localeOptions)}</p>
            </div>
          </a>
          <a
            href="https://afdian.com/a/ianho7"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border p-4 hover:bg-accent hover:text-vanilla transition-colors cursor-pointer"
            data-ai-action="support-afdian"
          >
            <Heart className="w-6 h-6 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">{m.support_afdian({}, localeOptions)}</p>
              <p className="text-xs">{m.support_afdian_desc({}, localeOptions)}</p>
            </div>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
