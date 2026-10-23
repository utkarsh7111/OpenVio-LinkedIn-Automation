'use client';

import React, { useState, useEffect } from 'react';
import { LinkedInProfileType } from '@/types/linkedin';

interface LinkedInAvatarProps {
  src?: string | null;
  name?: string;
  profileType?: LinkedInProfileType;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showBadge?: boolean;
  className?: string;
}

export const LinkedInAvatar: React.FC<LinkedInAvatarProps> = ({
  src,
  name = 'LinkedIn User',
  profileType = 'personal',
  size = 'md',
  showBadge = false,
  className = '',
}) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-lg',
  };

  const badgeSizeClasses = {
    sm: 'w-3 h-3 p-0.5 -bottom-0.5 -right-0.5',
    md: 'w-3.5 h-3.5 p-0.5 -bottom-0.5 -right-0.5',
    lg: 'w-4 h-4 p-0.5 -bottom-1 -right-1',
    xl: 'w-5 h-5 p-1 -bottom-1 -right-1',
  };

  const roundedClass = profileType === 'organization' ? 'rounded-xl' : 'rounded-full';

  // Compute clean initials from name
  const getInitials = (fullName: string): string => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'LI';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Reject unresolvable test domains like example.test or invalid URLs
  const isInvalid = !src || src.includes('example.test') || (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:'));

  const initials = getInitials(name);

  return (
    <div className={`relative inline-block shrink-0 ${className}`}>
      {!hasError && !isInvalid && src ? (
        <img
          src={src}
          alt={`${name}'s profile avatar`}
          className={`${sizeClasses[size]} ${roundedClass} object-cover ring-2 ring-white dark:ring-slate-800 shadow-sm transition-opacity duration-200`}
          onError={() => setHasError(true)}
        />
      ) : (
        <div
          className={`${sizeClasses[size]} ${roundedClass} bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-700 text-white font-semibold flex items-center justify-center ring-2 ring-white dark:ring-slate-800 shadow-sm select-none tracking-wider`}
          aria-label={`${name}'s profile avatar`}
          role="img"
        >
          {profileType === 'organization' ? (
            <svg className="w-1/2 h-1/2 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z" />
            </svg>
          ) : (
            <span>{initials}</span>
          )}
        </div>
      )}

      {showBadge && (
        <div
          className={`absolute ${badgeSizeClasses[size]} bg-[#0a66c2] text-white rounded-full ring-2 ring-white dark:ring-slate-900 flex items-center justify-center shadow-xs`}
          title="LinkedIn connected account"
          aria-hidden="true"
        >
          <svg className="w-full h-full fill-current" viewBox="0 0 24 24">
            <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.8v8.37h-2.8v-8.37M7.86 6.3a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24z" />
          </svg>
        </div>
      )}
    </div>
  );
};
