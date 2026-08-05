import { z } from 'zod';

export const customerMarkerSchema = z.object({
  customerId: z.string(),
  customerName: z.string(),
});
