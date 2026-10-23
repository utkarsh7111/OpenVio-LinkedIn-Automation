'use client';

import React, { useState } from 'react';
import { MediaAttachment, LinkedInAccount } from '@/types/linkedin';
import { ImageWithFallback } from '@/components/ui/ImageWithFallback';
import { LinkedInAvatar } from './LinkedInAvatar';

interface LinkedInPreviewCardProps {
  content: string;
  media: MediaAttachment[];
  account: LinkedInAccount | null;
  scheduledTime?: string | null;
}

export const LinkedInPreviewCard: React.FC<LinkedInPreviewCardProps> = ({
  content,
  media,
  account,
  scheduledTime,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [devicePreviewMode, setDevicePreviewMode] = useState<'desktop' | 'mobile'>('desktop');

  const charThreshold = 180;
  const shouldTruncate = content.length > charThreshold && !isExpanded;

  const displayName = account?.name || 'Your Account Name';
  const displayHeadline =
    account?.headline || 'Growth Leader & Product Strategist | Building OpenVio';

  // Format content with hashtags in blue
  const renderFormattedContent = (text: string) => {
    const textToShow = shouldTruncate ? text.slice(0, charThreshold) : text;
    const parts = textToShow.split(/(\s+)/);

    return (
      <>
        {parts.map((part, index) => {
          if (part.startsWith('#') && part.length > 1) {
            return (
              <span key={index} className="text-[#0a66c2] font-medium hover:underline cursor-pointer">
                {part}
              </span>
            );
          }
          if (part.startsWith('http://') || part.startsWith('https://')) {
            return (
              <span key={index} className="text-[#0a66c2] hover:underline cursor-pointer">
                {part}
              </span>
            );
          }
          return <span key={index}>{part}</span>;
        })}
        {shouldTruncate && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-semibold ml-1 cursor-pointer"
          >
            ...see more
          </button>
        )}
      </>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header controls for Preview */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Post Preview
          </span>
          {scheduledTime && (
            <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-900">
              Scheduled for {new Date(scheduledTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
        </div>

        {/* Device toggle */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setDevicePreviewMode('desktop')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              devicePreviewMode === 'desktop'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-medium'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setDevicePreviewMode('mobile')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              devicePreviewMode === 'mobile'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-medium'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Mobile
          </button>
        </div>
      </div>

      {/* Outer simulated container */}
      <div className={`transition-all duration-200 mx-auto ${devicePreviewMode === 'mobile' ? 'max-w-sm' : 'w-full'}`}>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden text-slate-900 dark:text-slate-100 font-sans">
          
          {/* Post Header: Profile details */}
          <div className="p-4 pb-2.5 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <LinkedInAvatar
                src={account?.avatarUrl}
                name={displayName}
                profileType={account?.profileType}
                size="lg"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white hover:text-[#0a66c2] cursor-pointer truncate">
                    {displayName}
                  </h4>
                  <span className="text-xs text-slate-400 font-normal">• 1st</span>
                </div>
                <p className="text-[12px] text-slate-500 dark:text-slate-400 line-clamp-1 leading-tight">
                  {displayHeadline}
                </p>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  <span>Now</span>
                  <span>•</span>
                  <span>Edited</span>
                  <span>•</span>
                  <svg className="w-3 h-3 fill-current" viewBox="0 0 16 16">
                    <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm0 14.5a6.5 6.5 0 110-13 6.5 6.5 0 010 13zM7 2.1a6.38 6.38 0 00-3.3 2.9h2.3A9.78 9.78 0 017 2.1zm2 0c.4.8.8 1.8 1 2.9H7.7c.2-1.1.6-2.1 1-2.9h.3zm2.3 2.9h2.3a6.38 6.38 0 00-3.3-2.9c.4.8.7 1.8 1 2.9zm1.6 2H11c.1.7.1 1.3 0 2h1.9a6.6 6.6 0 000-2zm-3.9 0H7V7h2c-.1.7-.1 1.3 0 2zm-4 0H3.1a6.6 6.6 0 000 2H5c-.1-.7-.1-1.3 0-2zm.7 4h2.6c-.2 1.1-.6 2.1-1 2.9-.4-.8-.8-1.8-1-2.9zm4.6 0h-2.3c.3.9.7 1.8 1.1 2.6.5-.8.9-1.7 1.2-2.6zm2.3 0H11c-.3 1.1-.6 2.1-1.1 2.9a6.38 6.38 0 003.4-2.9z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* LinkedIn Header Menu Icons */}
            <div className="flex items-center gap-1 text-slate-400 hover:text-slate-600">
              <button type="button" className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="More options">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M6 12a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Post Text Body */}
          <div className="px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {content.trim() ? (
              renderFormattedContent(content)
            ) : (
              <span className="text-slate-400 dark:text-slate-500 italic text-sm">
                Your post text will appear here. Start typing in the composer to view the exact layout, paragraphs, and hashtags...
              </span>
            )}
          </div>

          {/* Media Section */}
          {media.length > 0 && (
            <div className="mt-2.5 bg-slate-100 dark:bg-slate-800/80 border-t border-b border-slate-100 dark:border-slate-800">
              {media.length === 1 && (
                <div className="relative max-h-[460px] overflow-hidden flex items-center justify-center">
                  {media[0].type === 'image' ? (
                    <ImageWithFallback
                      src={media[0].previewUrl}
                      alt={media[0].name || "Uploaded media preview"}
                      className="w-full h-auto object-cover max-h-[460px]"
                      fallbackText={media[0].name || "Media attachment"}
                    />
                  ) : media[0].type === 'video' ? (
                    <video
                      src={media[0].previewUrl}
                      controls
                      className="w-full max-h-[460px] bg-black"
                    />
                  ) : (
                    <div className="w-full p-4 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-lg flex items-center gap-3">
                      <div className="p-3 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 shrink-0">
                        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h5 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {media[0].title || media[0].name || 'Document attachment'}
                        </h5>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          LinkedIn Document • {(media[0].size / (1024 * 1024)).toFixed(1)} MB
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {media.length === 2 && (
                <div className="grid grid-cols-2 gap-0.5">
                  {media.map((item) => (
                    <div key={item.id} className="aspect-square overflow-hidden bg-slate-200 dark:bg-slate-800">
                      <ImageWithFallback
                        src={item.previewUrl}
                        alt={item.name || "Media attachment"}
                        className="w-full h-full object-cover"
                        fallbackText={item.name}
                      />
                    </div>
                  ))}
                </div>
              )}

              {media.length === 3 && (
                <div className="grid grid-cols-2 gap-0.5">
                  <div className="row-span-2 aspect-[4/5] overflow-hidden">
                    <ImageWithFallback
                      src={media[0].previewUrl}
                      alt={media[0].name || "Media attachment"}
                      className="w-full h-full object-cover"
                      fallbackText={media[0].name}
                    />
                  </div>
                  <div className="aspect-square overflow-hidden">
                    <ImageWithFallback
                      src={media[1].previewUrl}
                      alt={media[1].name || "Media attachment"}
                      className="w-full h-full object-cover"
                      fallbackText={media[1].name}
                    />
                  </div>
                  <div className="aspect-square overflow-hidden">
                    <ImageWithFallback
                      src={media[2].previewUrl}
                      alt={media[2].name || "Media attachment"}
                      className="w-full h-full object-cover"
                      fallbackText={media[2].name}
                    />
                  </div>
                </div>
              )}

              {media.length >= 4 && (
                <div className="grid grid-cols-2 gap-0.5">
                  {media.slice(0, 4).map((item, idx) => (
                    <div key={item.id} className="relative aspect-square overflow-hidden">
                      <ImageWithFallback
                        src={item.previewUrl}
                        alt={item.name || "Media attachment"}
                        className="w-full h-full object-cover"
                        fallbackText={item.name}
                      />
                      {idx === 3 && media.length > 4 && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-bold text-xl backdrop-blur-xs">
                          +{media.length - 3}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Social Stats Counters (Simulated) */}
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800/70 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-1">
                <span className="w-4 h-4 rounded-full bg-[#0a66c2] text-white flex items-center justify-center text-[9px] shadow-xs">
                  👍
                </span>
                <span className="w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[9px] shadow-xs">
                  ❤️
                </span>
                <span className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[9px] shadow-xs">
                  👏
                </span>
              </div>
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                124
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span>18 comments</span>
              <span>•</span>
              <span>4 reposts</span>
            </div>
          </div>

          {/* Native Action Bar (Like, Comment, Repost, Send) */}
          <div className="px-2 py-1 grid grid-cols-4 gap-1 text-slate-600 dark:text-slate-300">
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017a2 2 0 01-2-2v-7a2 2 0 012-2h1.5a1 1 0 001-1V5a2 2 0 00-2-2 1 1 0 00-1 1v5" />
              </svg>
              <span>Like</span>
            </button>

            <button
              type="button"
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>Comment</span>
            </button>

            <button
              type="button"
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Repost</span>
            </button>

            <button
              type="button"
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
