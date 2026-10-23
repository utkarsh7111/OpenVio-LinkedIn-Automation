'use client';

import React, { useState } from 'react';
import { Project, LinkedInAccount } from '@/types/linkedin';
import { Button } from '@/components/ui/Button';
import { LinkedInAvatar } from './LinkedInAvatar';

interface AccountConnectionCardProps {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  connectedAccount: LinkedInAccount | null;
  isConnecting: boolean;
  connectionError?: string | null;
  onConnectLinkedIn: () => void;
  onDisconnectLinkedIn: () => void;
  isDisconnecting?: boolean;
}

export const AccountConnectionCard: React.FC<AccountConnectionCardProps> = ({
  projects,
  selectedProjectId,
  onSelectProject,
  connectedAccount,
  isConnecting,
  connectionError,
  onConnectLinkedIn,
  onDisconnectLinkedIn,
  isDisconnecting = false,
}) => {
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const isConnected = Boolean(connectedAccount?.isConnected);
  const isMockProvider = connectedAccount?.mode === 'DEMO';
  const isExpiringSoon = Boolean(connectedAccount?.expiringSoon);
  const isExpired = connectedAccount?.status === 'EXPIRED';

  // Determine current connection state
  let statusBadge: React.ReactNode;
  if (isConnecting) {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
        <svg className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Connecting...
      </span>
    );
  } else if (connectionError) {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
        <span className="w-2 h-2 rounded-full bg-rose-500" />
        Connection Failed
      </span>
    );
  } else if (isConnected) {
    if (isExpired) {
      statusBadge = (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
          Token Expired
        </span>
      );
    } else {
      statusBadge = (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Connected & Active
        </span>
      );
    }
  } else {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
        <span className="w-2 h-2 rounded-full bg-slate-400" />
        Disconnected
      </span>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 md:p-6 shadow-xs transition-colors">
      {/* Top Header: Project Selector & Status Indicator */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 pb-5 border-b border-slate-100 dark:border-slate-800/80">
        {/* Project Selector */}
        <div className="flex-1 max-w-md">
          <label
            htmlFor="project-select"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5"
          >
            Active Workspace Project
          </label>
          <div className="relative">
            <select
              id="project-select"
              value={selectedProjectId}
              onChange={(e) => onSelectProject(e.target.value)}
              className="w-full appearance-none bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3.5 py-2.5 pr-10 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} {project.clientName ? `(${project.clientName})` : ''}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            Posts authored in this session will publish under{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {selectedProject?.name || 'the selected project'}
            </span>
            .
          </p>
        </div>

        {/* Channel Status Pill */}
        <div className="flex items-center gap-2.5 self-start md:self-center">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Channel Status:
          </span>
          {statusBadge}
        </div>
      </div>

      {/* Main Connection Card Content */}
      <div className="pt-5">
        {/* State 1: Connection Error Alert */}
        {connectionError && !isConnected && (
          <div className="mb-4 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h5 className="text-sm font-semibold text-rose-900 dark:text-rose-200">Connection Failed</h5>
                <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">{connectionError}</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onConnectLinkedIn}
              isLoading={isConnecting}
              className="border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 shrink-0"
            >
              Retry Connection
            </Button>
          </div>
        )}

        {/* State 2: Connected Account View */}
        {isConnected && connectedAccount ? (
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 sm:p-5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
            {/* Account Details */}
            <div className="flex items-start sm:items-center gap-4 min-w-0">
              <LinkedInAvatar
                src={connectedAccount.avatarUrl}
                name={connectedAccount.name}
                profileType={connectedAccount.profileType}
                size="lg"
                showBadge={true}
              />

              <div className="min-w-0 flex-1">
                {/* Account Name and Badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-bold text-slate-900 dark:text-white text-base truncate max-w-xs sm:max-w-md">
                    {connectedAccount.name}
                  </h4>

                  {/* Profile Type Badge */}
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                    {connectedAccount.profileType === 'organization' ? 'Company Page' : 'Personal Profile'}
                  </span>

                  {/* Mock/Live Provider Badge */}
                  {isMockProvider ? (
                    <span
                      className="text-[11px] font-medium px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300/60 dark:border-amber-800/60 flex items-center gap-1"
                      title="Simulated LinkedIn environment using local mock provider (port 4100)"
                    >
                      <svg className="w-3 h-3 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                      </svg>
                      Development Mock
                    </span>
                  ) : (
                    <span
                      className="text-[11px] font-medium px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-800/60 flex items-center gap-1"
                      title="Verified LinkedIn live OAuth connection"
                    >
                      <svg className="w-3 h-3 text-emerald-600 dark:text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Verified Live OAuth
                    </span>
                  )}
                </div>

                {/* Subtitle / Expiry / Headline */}
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 max-w-lg mt-0.5">
                  {connectedAccount.headline || 'Active connection ready for scheduled and live publishing.'}
                </p>

                {/* Expiration or Connection Notice */}
                {isExpiringSoon && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-1 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Token will expire in {connectedAccount.daysUntilExpiry} days. Reconnect soon to ensure scheduled publishing continues.
                  </p>
                )}
                {isExpired && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold mt-1">
                    Token expired. Please disconnect and reconnect your LinkedIn account.
                  </p>
                )}
              </div>
            </div>

            {/* Action Buttons: Disconnect / Reconnect */}
            <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0 pt-2 lg:pt-0">
              {showDisconnectConfirm ? (
                <div className="flex items-center gap-2 animate-in fade-in duration-150 p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60">
                  <span className="text-xs text-rose-700 dark:text-rose-300 font-medium px-1">
                    Disconnect this account?
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    isLoading={isDisconnecting}
                    onClick={() => {
                      onDisconnectLinkedIn();
                      setShowDisconnectConfirm(false);
                    }}
                  >
                    Confirm Disconnect
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isDisconnecting}
                    onClick={() => setShowDisconnectConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowDisconnectConfirm(true)}
                  disabled={isDisconnecting}
                  className="text-slate-600 hover:text-rose-600 hover:border-rose-300 dark:hover:border-rose-900 transition-colors"
                >
                  Disconnect Account
                </Button>
              )}
            </div>
          </div>
        ) : (
          /* State 3: Disconnected CTA View */
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 transition-all">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-[#0a66c2] fill-current" viewBox="0 0 24 24">
                  <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.8v8.37h-2.8v-8.37M7.86 6.3a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24z" />
                </svg>
                Connect LinkedIn Profile or Company Page
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-xl">
                Authorize OpenVio to compose, draft, schedule, and automatically publish posts to your LinkedIn personal profile or showcase page via official LinkedIn API OAuth 2.0.
              </p>
            </div>

            <Button
              variant="linkedin"
              size="md"
              onClick={onConnectLinkedIn}
              isLoading={isConnecting}
              leftIcon={
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.8v8.37h-2.8v-8.37M7.86 6.3a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24z" />
                </svg>
              }
              className="shrink-0"
            >
              Connect LinkedIn
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
