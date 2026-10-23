'use client';

import React, { useState, useEffect } from 'react';

interface ImageWithFallbackProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallbackText?: string;
  fallbackIcon?: React.ReactNode;
  containerClassName?: string;
}

export const ImageWithFallback: React.FC<ImageWithFallbackProps> = ({
  src,
  alt = 'Image preview',
  className = '',
  containerClassName = '',
  fallbackText,
  fallbackIcon,
  onError,
  ...props
}) => {
  const [hasError, setHasError] = useState(false);

  // Normalize API base URL for relative /uploads/... paths
  const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
  let resolvedSrc = typeof src === 'string' ? src : '';
  
  // Prefer relative /uploads/ path on the frontend origin so it uses the Next.js rewrite and avoids cross-origin blocking
  if (resolvedSrc.includes('/uploads/')) {
    const filename = resolvedSrc.split('/uploads/').pop();
    if (filename) {
      resolvedSrc = `/uploads/${filename}`;
    }
  } else if (resolvedSrc.startsWith('/') && !resolvedSrc.startsWith('//')) {
    resolvedSrc = `${apiBaseUrl}${resolvedSrc}`;
  }

  // Detect unresolvable test domains like example.test
  const isInvalidUrl = !resolvedSrc || resolvedSrc.includes('example.test');

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (hasError || isInvalidUrl) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 p-2 text-center select-none ${containerClassName || className}`}
        role="img"
        aria-label={alt}
      >
        {fallbackIcon || (
          <svg
            className="w-8 h-8 mb-1 text-slate-300 dark:text-slate-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        )}
        {fallbackText ? (
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 line-clamp-1 max-w-full">
            {fallbackText}
          </span>
        ) : (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            Image unavailable
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={(e) => {
        setHasError(true);
        if (onError) onError(e);
      }}
      {...props}
    />
  );
};
