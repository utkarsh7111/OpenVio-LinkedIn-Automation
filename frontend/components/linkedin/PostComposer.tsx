'use client';

import React, { useState } from 'react';
import { MediaAttachment, CreateOrUpdatePostDto } from '@/types/linkedin';
import { MediaUploader } from '@/components/linkedin/MediaUploader';
import { AIPostGeneratorModal } from '@/components/linkedin/AIPostGeneratorModal';
import { PostActionBar } from '@/components/linkedin/PostActionBar';
import { Button } from '@/components/ui/Button';

interface PostComposerProps {
  projectId: string;
  initialContent?: string;
  initialMedia?: MediaAttachment[];
  initialScheduledTime?: string | null;
  editingPostId?: string | null;
  onSaveDraft: (data: CreateOrUpdatePostDto) => Promise<void> | void;
  onPublishNow: (data: CreateOrUpdatePostDto) => Promise<void> | void;
  onSchedule: (data: CreateOrUpdatePostDto) => Promise<void> | void;
  onCancelEdit?: () => void;
  onContentChange?: (content: string) => void;
  onMediaChange?: (media: MediaAttachment[]) => void;
  isSavingDraft?: boolean;
  isPublishing?: boolean;
  isScheduling?: boolean;
  disabled?: boolean;
  isPublishedPost?: boolean;
}

const LINKEDIN_MAX_CHARS = 3000;

export const PostComposer: React.FC<PostComposerProps> = ({
  projectId,
  initialContent = '',
  initialMedia = [],
  initialScheduledTime = null,
  editingPostId = null,
  onSaveDraft,
  onPublishNow,
  onSchedule,
  onCancelEdit,
  onContentChange,
  onMediaChange,
  isSavingDraft = false,
  isPublishing = false,
  isScheduling = false,
  disabled = false,
  isPublishedPost = false,
}) => {
  const [content, setContent] = useState(initialContent);
  const [media, setMedia] = useState<MediaAttachment[]>(initialMedia);
  const [scheduledTime, setScheduledTime] = useState<string | null>(initialScheduledTime);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  // Synchronize when initial props change (e.g. when user clicks Edit from table)
  React.useEffect(() => {
    setContent(initialContent);
    setContentError(null);
  }, [initialContent]);

  React.useEffect(() => {
    setMedia(initialMedia);
  }, [initialMedia]);

  React.useEffect(() => {
    setScheduledTime(initialScheduledTime);
  }, [initialScheduledTime]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setContent(newText);
    if (newText.trim()) setContentError(null);
    onContentChange?.(newText);
  };

  const handleMediaUpdate = (newMedia: MediaAttachment[]) => {
    setMedia(newMedia);
    onMediaChange?.(newMedia);
  };

  const validateBeforeSubmit = (): boolean => {
    if (!content.trim()) {
      setContentError('Post commentary text cannot be empty. LinkedIn requires text content for every post.');
      return false;
    }
    if (content.length > LINKEDIN_MAX_CHARS) {
      setContentError(`Post commentary exceeds the LinkedIn limit of ${LINKEDIN_MAX_CHARS} characters.`);
      return false;
    }
    setContentError(null);
    return true;
  };

  const handleInsertAIContent = (aiText: string, mode: 'append' | 'replace' = 'append') => {
    let updated: string;
    if (mode === 'replace' || !content.trim()) {
      updated = aiText;
    } else {
      updated = `${content.trim()}\n\n${aiText}`;
    }
    setContent(updated);
    setContentError(null);
    onContentChange?.(updated);
  };

  const appendQuickEmoji = (emoji: string) => {
    const updated = content + emoji;
    setContent(updated);
    if (updated.trim()) setContentError(null);
    onContentChange?.(updated);
  };

  const appendHashtag = (tag: string) => {
    const separator = content.endsWith(' ') || content.endsWith('\n') || !content ? '' : ' ';
    const updated = `${content}${separator}#${tag}`;
    setContent(updated);
    if (updated.trim()) setContentError(null);
    onContentChange?.(updated);
  };

  const getPostPayload = (status: 'draft' | 'scheduled' | 'published', timeOverride?: string | null): CreateOrUpdatePostDto => {
    return {
      id: editingPostId || undefined,
      projectId,
      content,
      media: isPublishedPost ? undefined : media,
      mediaIds: isPublishedPost ? undefined : media.map((m) => m.id),
      scheduledTime: isPublishedPost ? null : (timeOverride !== undefined ? timeOverride : scheduledTime),
      status: isPublishedPost ? 'published' : status,
    };
  };

  // Calculations for character counter
  const charCount = content.length;
  const charsRemaining = LINKEDIN_MAX_CHARS - charCount;
  const isOverLimit = charsRemaining < 0;
  const percentageUsed = Math.min(100, (charCount / LINKEDIN_MAX_CHARS) * 100);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 md:p-6 shadow-sm flex flex-col justify-between h-full">
      <div className="space-y-4">
        {/* Composer Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-[#0a66c2] dark:text-blue-400">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.8v8.37h-2.8v-8.37M7.86 6.3a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isPublishedPost ? 'Edit Published LinkedIn Post' : editingPostId ? 'Edit LinkedIn Post' : 'Post Composer'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isPublishedPost
                  ? 'Update commentary on your published LinkedIn post. Images cannot be changed after publishing.'
                  : 'Craft, optimize, and preview your post for maximum LinkedIn organic reach.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {editingPostId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancelEdit}
                className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Cancel Edit
              </Button>
            )}

            {/* AI Generator Button with Magic Wand Icon */}
            <button
              type="button"
              onClick={() => setIsAiModalOpen(true)}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-semibold text-xs shadow-xs hover:shadow-md hover:opacity-95 transition-all duration-150 cursor-pointer active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              <span>Generate with AI</span>
            </button>
          </div>
        </div>

        {/* Textarea Editor */}
        <div className="relative">
          <textarea
            value={content}
            onChange={handleTextChange}
            disabled={disabled}
            placeholder="What do you want to talk about? Share an industry insight, milestone, case study, or company story..."
            rows={7}
            className={`w-full text-sm rounded-xl border p-4 text-slate-900 dark:text-white placeholder-slate-400 bg-slate-50/50 dark:bg-slate-800/40 focus:bg-white dark:focus:bg-slate-800 transition-all outline-none resize-y leading-relaxed font-sans ${
              contentError || isOverLimit
                ? 'border-rose-500 ring-2 ring-rose-500/20'
                : 'border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
            }`}
          />

          {/* Inline Validation Error Message */}
          {contentError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
              <svg className="w-4 h-4 shrink-0 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{contentError}</span>
            </p>
          )}

          {/* Quick Helper Tip When Image Is Uploaded Without Commentary */}
          {!content.trim() && media.length > 0 && !contentError && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1.5 mt-2">
              <svg className="w-4 h-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>LinkedIn requires commentary text before saving or publishing, even with an image attached.</span>
            </p>
          )}

          {/* Quick Emoji & Hashtag Helpers */}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-2 px-1">
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-400 text-[11px] mr-1 hidden sm:inline">Add reaction:</span>
              {['🚀', '💡', '👇', '✨', '📈', '🔥'].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => appendQuickEmoji(emoji)}
                  className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-sm transition-transform active:scale-90"
                >
                  {emoji}
                </button>
              ))}

              <div className="h-3 w-px bg-slate-200 dark:bg-slate-700 mx-1.5 hidden sm:block" />

              <div className="hidden sm:flex items-center gap-1">
                {['OpenVio', 'Innovation', 'Growth', 'Leadership'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => appendHashtag(tag)}
                    className="text-[11px] font-medium text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-full hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Character Counter Progress */}
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${
                    isOverLimit
                      ? 'bg-rose-500'
                      : percentageUsed > 85
                      ? 'bg-amber-500'
                      : 'bg-blue-600'
                  }`}
                  style={{ width: `${percentageUsed}%` }}
                />
              </div>
              <span
                className={`text-xs font-mono font-medium ${
                  isOverLimit
                    ? 'text-rose-600 font-bold'
                    : percentageUsed > 85
                    ? 'text-amber-600'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {charCount} / {LINKEDIN_MAX_CHARS}
              </span>
            </div>
          </div>
        </div>

        {/* Media Upload Area */}
        <div className="pt-1">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Attach Media (Images, Video, or Document)
          </label>
          {isPublishedPost ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/60 dark:bg-slate-800/40 text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>LinkedIn policy: Media cannot be modified once published. You can edit commentary text above and click <strong>&quot;Update on LinkedIn&quot;</strong>.</span>
            </div>
          ) : (
            <MediaUploader
              media={media}
              onChange={handleMediaUpdate}
              disabled={disabled}
              maxFiles={20}
            />
          )}
        </div>
      </div>

      {/* Action and Scheduling Bar */}
      <div className="mt-5">
        <PostActionBar
          onSaveDraft={() => {
            if (!validateBeforeSubmit()) return;
            onSaveDraft(getPostPayload('draft'));
          }}
          onPublishNow={() => {
            if (!validateBeforeSubmit()) return;
            onPublishNow(getPostPayload('published'));
          }}
          onSchedule={(isoString) => {
            if (!validateBeforeSubmit()) return;
            setScheduledTime(isoString);
            onSchedule(getPostPayload('scheduled', isoString));
          }}
          initialScheduledTime={scheduledTime}
          isSavingDraft={isSavingDraft}
          isPublishing={isPublishing}
          isScheduling={isScheduling}
          disabled={disabled || !content.trim() || isOverLimit}
          isPublishedPost={isPublishedPost}
        />
      </div>

      {/* AI Post Generator Modal */}
      <AIPostGeneratorModal
        projectId={projectId}
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        onInsertContent={handleInsertAIContent}
        initialTopic={content.trim()}
        hasExistingContent={Boolean(content.trim())}
      />
    </div>
  );
};
