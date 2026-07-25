const fallbackMessage = 'Nango validation failed; the existing configuration was kept.';

const operationDetails = {
  get_connection: {
    action: 'reading connection credentials',
    endpoint: 'connection credentials endpoint',
    scope: 'environment:connections:read_credentials',
  },
  list_connections: {
    action: 'listing connections',
    endpoint: 'connections endpoint',
    scope: 'environment:connections:list',
  },
  list_integrations: {
    action: 'listing integrations',
    endpoint: 'integrations endpoint',
    scope: 'environment:integrations:list',
  },
} as const;

type NangoOperation = keyof typeof operationDetails;

const parseError = (
  error: unknown,
): { code: string; operation?: NangoOperation; status?: string } => {
  if (!(error instanceof Error)) return { code: '' };
  const [code = '', rawOperation, status] = error.message.split('|');
  const operation =
    rawOperation && rawOperation in operationDetails ? (rawOperation as NangoOperation) : undefined;
  return { code, operation, status: status || undefined };
};

const withStatus = (message: string, status?: string): string =>
  `${message}${status ? ` (${status})` : ''}.`;

export const getNangoValidationErrorMessage = (error: unknown): string => {
  const { code, operation, status } = parseError(error);
  const details = operation ? operationDetails[operation] : undefined;

  switch (code) {
    case 'NANGO_API_KEY_INVALID':
      return withStatus(
        'The Nango API Key is invalid or belongs to a different environment',
        status,
      );
    case 'NANGO_INSUFFICIENT_PERMISSIONS':
      return details
        ? withStatus(`The Nango API Key is missing ${details.scope}`, status)
        : withStatus('The Nango API Key does not have the required permissions', status);
    case 'NANGO_ENDPOINT_NOT_FOUND':
      return details
        ? withStatus(`The Nango Base URL does not expose the ${details.endpoint}`, status)
        : withStatus('The Nango Base URL does not expose the required API endpoint', status);
    case 'NANGO_CONNECTION_NOT_FOUND':
      return withStatus(
        'An existing Nango connection could not be found; disconnect that mailbox before updating the configuration',
        status,
      );
    case 'NANGO_UNREACHABLE':
      return details
        ? withStatus(`Zero could not reach the Nango service while ${details.action}`)
        : withStatus('Zero could not reach the Nango service');
    case 'NANGO_INVALID_RESPONSE':
      return details
        ? withStatus(`Nango returned an incompatible response while ${details.action}`, status)
        : withStatus('Nango returned an incompatible response', status);
    case 'NANGO_CONNECTION_INVALID':
      return withStatus(
        'Nango could not provide valid credentials for an existing connection',
        status,
      );
    case 'NANGO_REQUEST_FAILED':
      return details
        ? withStatus(`Nango rejected the request while ${details.action}`, status)
        : withStatus('Nango rejected the validation request', status);
    default:
      return fallbackMessage;
  }
};
