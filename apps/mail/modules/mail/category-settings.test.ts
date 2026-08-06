import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_CATEGORY_ID,
  ensureCustomerCategory,
  type CategorySetting,
} from '@/hooks/use-categories';

const allMail: CategorySetting = {
  id: 'All Mail',
  name: 'All Mail',
  searchValue: '',
  order: 1,
  isDefault: true,
};

describe('fixed customer category', () => {
  it('appends a non-default customer email filter that maps to the customer keyword', () => {
    expect(ensureCustomerCategory([allMail], 'Customer email')).toEqual([
      allMail,
      {
        id: CUSTOMER_CATEGORY_ID,
        name: 'Customer email',
        searchValue: 'CUSTOMER',
        order: 2,
        icon: 'User',
        isDefault: false,
      },
    ]);
  });

  it('replaces a stored customer category so the system filter remains fixed', () => {
    const storedCustomer: CategorySetting = {
      id: CUSTOMER_CATEGORY_ID,
      name: 'Changed by user',
      searchValue: 'wrong-label',
      order: 0,
      isDefault: true,
    };

    const result = ensureCustomerCategory([storedCustomer, allMail], 'Customer email');

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      id: CUSTOMER_CATEGORY_ID,
      name: 'Customer email',
      searchValue: 'CUSTOMER',
      isDefault: false,
    });
  });
});
