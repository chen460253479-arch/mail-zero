import { HotkeyProviderWrapper } from '@/components/providers/hotkey-provider-wrapper';
import { useAppAccess } from '@/modules/external-access/access-context';
import { AppSidebar } from '@/components/ui/app-sidebar';
import { Navigate } from 'react-router';
import { Outlet } from 'react-router';

export default function MailLayout() {
  const access = useAppAccess();
  if (access.mode === 'anonymous') {
    return <Navigate to="/login" replace />;
  }
  return (
    <HotkeyProviderWrapper>
      <AppSidebar />
      <div className="bg-sidebar dark:bg-sidebar w-full">
        <Outlet />
      </div>
    </HotkeyProviderWrapper>
  );
}
