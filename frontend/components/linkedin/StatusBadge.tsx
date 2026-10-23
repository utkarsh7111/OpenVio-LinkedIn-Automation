import React from 'react';
import { PostStatus } from '@/types/linkedin';

interface StatusBadgeProps {
  status: PostStatus;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  const configs: Record<PostStatus, { label: string; bg: string; text: string; dot: string }> = {
    draft: {
      label: 'Draft',
      bg: 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700',
      text: 'text-slate-700 dark:text-slate-300',
      dot: 'bg-slate-400',
    },
    scheduled: {
      label: 'Scheduled',
      bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',
      text: 'text-blue-700 dark:text-blue-300',
      dot: 'bg-blue-500 animate-pulse',
    },
    publishing: {
      label: 'Publishing',
      bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
      text: 'text-amber-700 dark:text-amber-300',
      dot: 'bg-amber-500 animate-pulse',
    },
    published: {
      label: 'Published',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
      text: 'text-emerald-700 dark:text-emerald-300',
      dot: 'bg-emerald-500',
    },
    failed: {
      label: 'Failed',
      bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',
      text: 'text-rose-700 dark:text-rose-300',
      dot: 'bg-rose-500',
    },
  };

  const config = configs[status] || configs.draft;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.bg} ${config.text} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
};
