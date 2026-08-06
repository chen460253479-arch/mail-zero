import { z } from 'zod';

const markCustomerMessageSchema = z
  .object({
    marked: z.literal(true),
    customerId: z.string().trim().min(1).max(255),
    customerName: z.string().trim().min(1).max(255),
  })
  .strict();

const unmarkCustomerMessageSchema = z
  .object({
    marked: z.literal(false),
  })
  .strict();

export const customerMarkerInputSchema = z.discriminatedUnion('marked', [
  markCustomerMessageSchema,
  unmarkCustomerMessageSchema,
]);

export type CustomerMarkerInput = z.infer<typeof customerMarkerInputSchema>;

export type CustomerMarkerResult =
  | {
      messageId: string;
      marked: true;
      customerId: string;
      customerName: string;
    }
  | {
      messageId: string;
      marked: false;
      customerId: null;
      customerName: null;
    };

export const CRM_CUSTOMER_KEYWORD = 'customer';
