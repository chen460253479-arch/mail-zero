import { redirect } from 'react-router';

import { requiresInitialPasswordChange } from './login-method';

type ProtectedRouteSession = {
  user: {
    id: string;
    role?: string | null;
    mustChangePassword?: boolean | null;
  };
  session: {
    authMethod?: string | null;
  };
};

type ProtectedRouteSessionDependencies = {
  getSession(input: { headers: Headers }): Promise<ProtectedRouteSession | null>;
};

export async function loadProtectedRouteSession(
  request: Pick<Request, 'headers'>,
  dependencies: ProtectedRouteSessionDependencies,
): Promise<{ userId: string; passwordChangeRequired: boolean }> {
  const session = await dependencies.getSession({ headers: request.headers });
  if (!session) throw redirect('/login');
  return {
    userId: session.user.id,
    passwordChangeRequired: requiresInitialPasswordChange(session),
  };
}
