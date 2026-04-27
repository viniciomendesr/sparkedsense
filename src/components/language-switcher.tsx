import { getLocale, setLocale, locales } from '../paraglide/runtime';
import { m } from '../paraglide/messages';

const labels: Record<string, string> = {
  en: 'EN',
  pt: 'PT',
};

// Segmented switch: both locales visible, active one filled. One click flips.
// Plain native buttons (not the Radix-wrapped Button) to avoid the forwardRef
// asChild ref warning and any portal/z-index quirks of the dropdown variant.
export function LanguageSwitcher() {
  const current = getLocale();

  return (
    <div
      role="group"
      aria-label={m.language_switcher_aria()}
      className="inline-flex h-9 items-center rounded-md border border-border bg-card overflow-hidden"
    >
      {locales.map((locale) => {
        const isActive = locale === current;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => {
              if (!isActive) setLocale(locale);
            }}
            aria-pressed={isActive}
            className={`h-full px-3 text-xs font-mono tracking-wider transition-colors ${
              isActive
                ? 'bg-primary text-primary-foreground cursor-default'
                : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {labels[locale] ?? locale.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
