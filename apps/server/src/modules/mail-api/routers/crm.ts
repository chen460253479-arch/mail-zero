import {
  requestCustomerCreationInputSchema,
  requestCustomerCreationResultSchema,
} from '../contracts/crm';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { router } from '../../../trpc/trpc';

export const crmRouter = router({
  requestCustomerCreation: mailAccountProcedure
    .input(requestCustomerCreationInputSchema)
    .output(requestCustomerCreationResultSchema)
    .mutation(({ ctx, input }) => ctx.mailApi.customerCreation.request(input)),
});
