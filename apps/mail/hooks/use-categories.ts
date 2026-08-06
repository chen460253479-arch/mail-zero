import { useSettings } from '@/hooks/use-settings';
import { getLocale } from '@/paraglide/runtime';
import { m } from '@/paraglide/messages';
import { useMemo } from 'react';

export interface CategorySetting {
  id: string;
  name: string;
  searchValue: string;
  order: number;
  icon?: string;
  isDefault: boolean;
}

export const CUSTOMER_CATEGORY_ID = 'Customer';

export function ensureCustomerCategory(
  categories: readonly CategorySetting[],
  name: string,
): CategorySetting[] {
  const withoutCustomer = categories.filter((category) => category.id !== CUSTOMER_CATEGORY_ID);
  const order = withoutCustomer.reduce(
    (maximum, category) => Math.max(maximum, category.order),
    -1,
  );

  return [
    ...withoutCustomer,
    {
      id: CUSTOMER_CATEGORY_ID,
      name,
      searchValue: 'CUSTOMER',
      order: order + 1,
      icon: 'User',
      isDefault: false,
    },
  ];
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

  if (category.id === CUSTOMER_CATEGORY_ID) {
    return m['common.mailCategories.customerEmail']();
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
    const categories =
      sorted.length === 0
        ? [
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
          ]
        : sorted.map((category) => ({
            ...category,
            name: getCategoryDisplayName(category),
          }));

    return ensureCustomerCategory(categories, m['common.mailCategories.customerEmail']());
  }, [data?.settings.categories, locale]);

  return merged;
}

export function useDefaultCategoryId(): string {
  const categories = useCategorySettings();
  const defaultCat = categories.find((c) => c.isDefault) ?? categories[0];
  return defaultCat?.id ?? 'All Mail';
}
