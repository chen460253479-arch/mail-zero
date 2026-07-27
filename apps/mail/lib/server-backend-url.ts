type ServerBackendUrlOptions = {
  internalBackendUrl?: string;
  isBrowser: boolean;
  publicBackendUrl: string;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/u, '');

export function resolveServerBackendUrl({
  internalBackendUrl,
  isBrowser,
  publicBackendUrl,
}: ServerBackendUrlOptions) {
  return normalizeBaseUrl(!isBrowser && internalBackendUrl ? internalBackendUrl : publicBackendUrl);
}

export const getServerBackendUrl = () =>
  resolveServerBackendUrl({
    internalBackendUrl: import.meta.env.VITE_INTERNAL_BACKEND_URL,
    isBrowser: typeof window !== 'undefined',
    publicBackendUrl: import.meta.env.VITE_PUBLIC_BACKEND_URL,
  });
