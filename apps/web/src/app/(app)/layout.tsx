import { Sidebar } from '@/components/app-shell/sidebar';
import { ImpersonationBanner } from '@/components/app-shell/impersonation-banner';
import { Topbar } from '@/components/app-shell/topbar';
import { RealtimeProvider } from '@/lib/realtime';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col">
          <ImpersonationBanner />
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </RealtimeProvider>
  );
}
