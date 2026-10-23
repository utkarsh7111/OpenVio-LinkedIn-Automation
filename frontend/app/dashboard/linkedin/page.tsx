import { Metadata } from 'next';
import { LinkedInDashboardClient } from './LinkedInDashboardClient';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'LinkedIn Post Automation | OpenVio',
  description: 'Manage, schedule, and automate AI-powered LinkedIn posts for your OpenVio projects alongside Google Business Profile workflows.',
};

export default function LinkedInPostDashboardPage() {
  return (
    <ToastProvider>
      <main className="min-h-screen bg-slate-50/50 dark:bg-slate-950">
        <LinkedInDashboardClient />
      </main>
    </ToastProvider>
  );
}
