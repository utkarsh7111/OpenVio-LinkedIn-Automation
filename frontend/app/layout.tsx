import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpenVio | LinkedIn Automation',
  description: 'Automate social media and Google Business Profile publishing with AI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
