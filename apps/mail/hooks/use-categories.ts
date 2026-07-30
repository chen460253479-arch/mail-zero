import { useSettings } from '@/hooks/use-settings';
import { m } from '@/paraglide/messages';
import { getLocale } from '@/paraglide/runtime';
import { useMemo } from 'react';

export interface CategorySetting {
  id: string;
  name: string;
  searchValue: string;
  order: number;
  icon?: string;
  isDefault: boolean;
}

export function getCategoryDisplayName(category: Pick<CategorySetting, 'id' | 'name'>): string {
  if (category.id === 'Important' && category.name === 'Important') {
    return m['common.mailCategories.important']();
  }

  if (category.id === 'All Mail' && category.name === 'All Mail') {
    return m['common.mailCategories.allMail']();
  }

  if (category.id === 'Unread' && category.name === 'Unread') {
    return m['common.mailCategories.unread']();
  }

  return category.name;
}

export function useCategorySettings(): CategorySetting[] {
  const { data } = useSettings();
  const locale = getLocale();

  const merged = useMemo(() => {
    const overrides = (data?.settings.categories as CategorySetting[] | undefined) ?? [];

    const sorted = overrides.sort((a, b) => a.order - b.order);

    // If no categories are defined, provide default ones
    if (sorted.length === 0) {
      return [
        {
          id: 'All Mail',
          name: m['common.mailCategories.allMail'](),
          searchValue: '',
          order: 0,
          isDefault: true,
        },
        {
          id: 'Unread',
          name: m['common.mailCategories.unread'](),
          searchValue: 'UNREAD',
          order: 1,
          isDefault: false,
        },
      ];
    }

    return sorted.map((category) => ({
      ...category,
      name: getCategoryDisplayName(category),
    }));
  }, [data?.settings.categories, locale]);

  return merged;
}

export function useDefaultCategoryId(): string {
  const categories = useCategorySettings();
  const defaultCat = categories.find((c) => c.isDefault) ?? categories[0];
  return defaultCat?.id ?? 'All Mail';
}
