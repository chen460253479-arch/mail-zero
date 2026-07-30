import { ForcedPasswordChangeDialog } from './forced-password-change-dialog';
import { Skeleton } from '@/components/ui/skeleton';

const sidebarRows = Array.from({ length: 7 }, (_, index) => index);
const messageRows = Array.from({ length: 8 }, (_, index) => index);

export function PasswordChangeRequiredView() {
  return (
    <div
      data-password-change-required="true"
      className="bg-background relative h-screen w-full overflow-hidden"
    >
      <div aria-hidden="true" className="pointer-events-none flex h-full select-none">
        <aside className="bg-sidebar hidden w-64 shrink-0 border-r p-5 sm:block">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#006FFE] text-sm font-semibold text-white">
              Z
            </div>
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="mb-6 h-9 w-full rounded-lg" />
          <div className="space-y-3">
            {sidebarRows.map((row) => (
              <Skeleton key={row} className="h-8 w-full rounded-lg" />
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center border-b px-6">
            <Skeleton className="h-8 w-64 max-w-full rounded-lg" />
          </header>
          <section className="space-y-3 p-6">
            {messageRows.map((row) => (
              <div key={row} className="flex h-14 items-center gap-4 rounded-lg border px-4">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-36 rounded" />
                <Skeleton className="h-4 min-w-0 flex-1 rounded" />
              </div>
            ))}
          </section>
        </main>
      </div>

      <ForcedPasswordChangeDialog />
    </div>
  );
}
