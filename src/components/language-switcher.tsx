import { Globe } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { getLocale, setLocale, locales } from '../paraglide/runtime';
import { m } from '../paraglide/messages';

const labels: Record<string, string> = {
  en: 'English',
  pt: 'Português',
};

// Paraglide's setLocale defaults to reload: true so every t-call re-renders.
// We accept the page reload — it's the simplest correctness path for an SPA
// where dozens of components capture strings at module-eval time.
export function LanguageSwitcher() {
  const current = getLocale();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={m.language_switcher_aria()}
          className="h-9 w-9"
        >
          <Globe className="w-4 h-4" />
          <span className="sr-only">{m.language_switcher_label()}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => {
              if (locale !== current) setLocale(locale);
            }}
            className={locale === current ? 'font-semibold' : ''}
          >
            {labels[locale] ?? locale}
            {locale === current && <span className="ml-auto text-xs text-muted-foreground">●</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
