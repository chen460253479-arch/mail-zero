import { useTheme } from 'next-themes';
import { useEffect } from 'react';

import { useSettings } from '@/hooks/use-settings';

export function UserThemeSync() {
  const { data } = useSettings();
  const { setTheme } = useTheme();
  const colorTheme = data?.settings.colorTheme;

  useEffect(() => {
    if (colorTheme) setTheme(colorTheme);
  }, [colorTheme, setTheme]);

  return null;
}
