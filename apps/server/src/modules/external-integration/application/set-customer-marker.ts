import type { CustomerMarkerInput, CustomerMarkerResult } from '../contracts/customer-marker';
import { ExternalIntegrationError } from '../errors';

export interface ExternalCustomerMarkerRepository {
  setCustomerMarker(input: {
    messageId: string;
    marker: CustomerMarkerInput;
  }): Promise<CustomerMarkerResult | null>;
}

export const createExternalCustomerMarkerWriter = (dependencies: {
  repository: ExternalCustomerMarkerRepository;
}) => ({
  async setCustomerMarker(
    messageId: string,
    marker: CustomerMarkerInput,
  ): Promise<CustomerMarkerResult> {
    const result = await dependencies.repository.setCustomerMarker({ messageId, marker });
    if (result === null) {
      throw new ExternalIntegrationError('MESSAGE_NOT_FOUND');
    }
    return result;
  },
});

export type ExternalCustomerMarkerWriter = ReturnType<typeof createExternalCustomerMarkerWriter>;
