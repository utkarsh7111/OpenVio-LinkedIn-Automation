'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';

interface PostActionBarProps {
  onSaveDraft: () => Promise<void> | void;
  onPublishNow: () => Promise<void> | void;
  onSchedule: (scheduledIsoString: string) => Promise<void> | void;
  initialScheduledTime?: string | null;
  isSavingDraft?: boolean;
  isPublishing?: boolean;
  isScheduling?: boolean;
  disabled?: boolean;
  isPublishedPost?: boolean;
}

export const PostActionBar: React.FC<PostActionBarProps> = ({
  onSaveDraft,
  onPublishNow,
  onSchedule,
  initialScheduledTime,
  isSavingDraft = false,
  isPublishing = false,
  isScheduling = false,
  disabled = false,
  isPublishedPost = false,
}) => {
  const [showScheduler, setShowScheduler] = useState(Boolean(initialScheduledTime));
  
  // Format initial values
  const defaultDate = initialScheduledTime
    ? new Date(initialScheduledTime).toISOString().split('T')[0]
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const defaultTime = initialScheduledTime
    ? new Date(initialScheduledTime).toTimeString().substring(0, 5)
    : '10:00';

  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [selectedTime, setSelectedTime] = useState(defaultTime);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const getLocalDateString = () => {
    return new Date().toISOString().split('T')[0];
  };

  const handleApplyPreset = (preset: 'tomorrow_morning' | 'tomorrow_afternoon' | 'next_monday') => {
    const now = new Date();
    let target = new Date(now);

    if (preset === 'tomorrow_morning') {
      target.setDate(target.getDate() + 1);
      target.setHours(9, 30, 0, 0);
    } else if (preset === 'tomorrow_afternoon') {
      target.setDate(target.getDate() + 1);
      target.setHours(14, 0, 0, 0);
    } else if (preset === 'next_monday') {
      const day = target.getDay();
      const distance = (8 - day) % 7 || 7;
      target.setDate(target.getDate() + distance);
      target.setHours(10, 0, 0, 0);
    }

    setSelectedDate(target.toISOString().split('T')[0]);
    setSelectedTime(target.toTimeString().substring(0, 5));
    setScheduleError(null);
  };

  const handleConfirmSchedule = () => {
    setScheduleError(null);
    if (!selectedDate || !selectedTime) {
      setScheduleError('Please pick both date and time.');
      return;
    }

    const scheduledDateObj = new Date(`${selectedDate}T${selectedTime}:00`);
    if (isNaN(scheduledDateObj.getTime())) {
      setScheduleError('Invalid date or time selected.');
      return;
    }

    if (scheduledDateObj.getTime() <= Date.now() + 5 * 60 * 1000) {
      setScheduleError('Scheduled time must be at least 5 minutes in the future.');
      return;
    }

    onSchedule(scheduledDateObj.toISOString());
  };

  return (
    <div className="space-y-4 pt-3 border-t border-slate-200/80 dark:border-slate-800">
      {/* Primary Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {!isPublishedPost ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={onSaveDraft}
                isLoading={isSavingDraft}
                disabled={disabled || isPublishing || isScheduling}
                leftIcon={
                  <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                }
              >
                Save Draft
              </Button>

              <Button
                type="button"
                variant={showScheduler ? 'secondary' : 'outline'}
                size="md"
                onClick={() => setShowScheduler(!showScheduler)}
                disabled={disabled || isPublishing || isSavingDraft}
                className={showScheduler ? 'ring-2 ring-blue-500 text-blue-600 dark:text-blue-400' : ''}
                leftIcon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                }
              >
                {showScheduler ? 'Hide Scheduler' : 'Schedule'}
              </Button>
            </>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400 italic">
              Editing live published post commentary
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="linkedin"
            size="md"
            onClick={onPublishNow}
            isLoading={isPublishing}
            disabled={disabled || isSavingDraft || isScheduling}
            leftIcon={
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            }
          >
            {isPublishedPost ? 'Update on LinkedIn' : 'Publish Now'}
          </Button>
        </div>
      </div>

      {/* Expandable Scheduling Box */}
      {showScheduler && (
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Select Publishing Schedule
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </span>
          </div>

          {/* Quick Slot Presets */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">Popular slots:</span>
            <button
              type="button"
              onClick={() => handleApplyPreset('tomorrow_morning')}
              className="text-xs px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 text-slate-700 dark:text-slate-300 transition-colors"
            >
              Tomorrow, 9:30 AM
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('tomorrow_afternoon')}
              className="text-xs px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 text-slate-700 dark:text-slate-300 transition-colors"
            >
              Tomorrow, 2:00 PM
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('next_monday')}
              className="text-xs px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 text-slate-700 dark:text-slate-300 transition-colors"
            >
              Next Monday, 10:00 AM
            </button>
          </div>

          {/* Date & Time Picker Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Publication Date
              </label>
              <input
                type="date"
                min={getLocalDateString()}
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none dark:[color-scheme:dark] dark:[&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Publication Time
              </label>
              <input
                type="time"
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none dark:[color-scheme:dark] dark:[&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </div>
          </div>

          {scheduleError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
              {scheduleError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowScheduler(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleConfirmSchedule}
              isLoading={isScheduling}
              disabled={disabled}
              leftIcon={
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              }
            >
              Confirm Schedule
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
