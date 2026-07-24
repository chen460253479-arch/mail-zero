export class IntegrationPermissionError extends Error {
  constructor(public readonly code: 'ADMIN_REQUIRED') {
    super(code);
    this.name = 'IntegrationPermissionError';
  }
}

export const assertAdministrator = (user: { role?: string | null }): void => {
  if (user.role !== 'admin') throw new IntegrationPermissionError('ADMIN_REQUIRED');
};
