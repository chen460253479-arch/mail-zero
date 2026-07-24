type ErrorClassification = {
  unauthorized: boolean;
  unrecoverableAuth?: boolean;
};

type ClientMethod<T> = (this: T, ...args: unknown[]) => unknown;

type RetryOptions<T extends object, Credential> = {
  initialCredential: Credential;
  createClient(credential: Credential): T;
  refreshCredential(): Promise<Credential>;
  classifyError(error: unknown): ErrorClassification;
  onUnrecoverableAuth?(error: unknown): void | Promise<void>;
};

export const createRetryingMailClient = <T extends object, Credential>(
  options: RetryOptions<T, Credential>,
): T => {
  let client = options.createClient(options.initialCredential);

  const callWithOneRetry = async (
    property: string | symbol,
    args: unknown[],
    initialError: unknown,
  ): Promise<unknown> => {
    if (!options.classifyError(initialError).unauthorized) throw initialError;

    let credential: Credential;
    try {
      credential = await options.refreshCredential();
    } catch (error) {
      if (options.classifyError(error).unrecoverableAuth) {
        await options.onUnrecoverableAuth?.(error);
      }
      throw error;
    }

    client = options.createClient(credential);
    const retryMethod = Reflect.get(client, property);
    try {
      return await Reflect.apply(retryMethod as ClientMethod<T>, client, args);
    } catch (error) {
      if (options.classifyError(error).unauthorized) {
        await options.onUnrecoverableAuth?.(error);
      }
      throw error;
    }
  };

  return new Proxy(client, {
    get(_target, property) {
      const value = Reflect.get(client, property);
      if (typeof value !== 'function') return value;

      return (...args: unknown[]) => {
        const method = Reflect.get(client, property);
        try {
          const result = Reflect.apply(method as ClientMethod<T>, client, args);
          if (!(result instanceof Promise)) return result;
          return result.catch((error: unknown) => callWithOneRetry(property, args, error));
        } catch (error) {
          return callWithOneRetry(property, args, error);
        }
      };
    },
  });
};
