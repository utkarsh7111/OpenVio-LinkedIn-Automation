'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PostTone } from '@/types/linkedin';
import { linkedinApi } from '@/services/linkedinApi';

interface AIPostGeneratorModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onInsertContent: (generatedText: string, mode?: 'append' | 'replace') => void;
  initialTopic?: string;
  hasExistingContent?: boolean;
}

export const AIPostGeneratorModal: React.FC<AIPostGeneratorModalProps> = ({
  projectId,
  isOpen,
  onClose,
  onInsertContent,
  initialTopic = '',
  hasExistingContent = false,
}) => {
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState<PostTone>('thought_leadership');
  const [targetAudience, setTargetAudience] = useState('');
  const [objective, setObjective] = useState('');
  const [keyPoints, setKeyPoints] = useState('');
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [callToAction, setCallToAction] = useState('What are your thoughts on this? Drop a comment below 👇');
  const [generatedResult, setGeneratedResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Sync initial topic when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialTopic && !topic) {
        setTopic(initialTopic);
      }
      setGenerationError(null);
    }
  }, [isOpen, initialTopic]);

  const toneOptions: { id: PostTone; label: string; icon: string; desc: string }[] = [
    {
      id: 'thought_leadership',
      label: 'Thought Leadership',
      icon: '💡',
      desc: 'Industry insights & forward-looking trends',
    },
    {
      id: 'storytelling',
      label: 'Storytelling',
      icon: '📖',
      desc: 'Personal story, hook, obstacle & lesson',
    },
    {
      id: 'professional',
      label: 'Professional & Direct',
      icon: '👔',
      desc: 'Polished company update or milestone',
    },
    {
      id: 'educational',
      label: 'How-to / Educational',
      icon: '🎓',
      desc: 'Actionable frameworks and tip lists',
    },
    {
      id: 'promotional',
      label: 'Product & Promotional',
      icon: '🚀',
      desc: 'Launch announcements & feature highlights',
    },
  ];

  const handleGenerate = async () => {
    // Prevent duplicate requests from rapid clicking
    if (isLoading || !topic.trim()) return;
    setIsLoading(true);
    setGenerationError(null);

    try {
      const response = await linkedinApi.generateWithAI({
        topic: topic.trim(),
        tone,
        targetAudience: targetAudience.trim() || undefined,
        objective: objective.trim() || undefined,
        keyPoints: keyPoints.trim() || undefined,
        callToAction: callToAction.trim() || undefined,
        includeHashtags,
      }, projectId);

      if (!response.content || !response.content.trim()) {
        throw new Error('Gemini returned an empty response. Please adjust your prompt and try again.');
      }

      setGeneratedResult(response.content.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI generation failed. Please try again.';
      setGenerationError(message);
      setGeneratedResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInsert = (mode: 'append' | 'replace' = 'append') => {
    if (generatedResult && generatedResult.trim()) {
      onInsertContent(generatedResult.trim(), mode);
      onClose();
      setGeneratedResult(null);
    }
  };

  const handleReset = () => {
    setGeneratedResult(null);
    setGenerationError(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Post with Gemini AI"
      description="Create authentic, high-engagement LinkedIn posts powered by Google Gemini in seconds."
      maxWidth="lg"
    >
      <div className="space-y-4 pt-2">
        {generationError && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <svg className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <h4 className="font-semibold text-rose-900 dark:text-rose-100">Generation Failed</h4>
                  <p className="mt-1 text-xs leading-relaxed text-rose-700 dark:text-rose-300">{generationError}</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={isLoading || !topic.trim()}
                className="shrink-0 text-xs border-rose-300 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/50"
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {!generatedResult ? (
          <>
            {/* Topic Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Topic or Idea <span className="text-rose-500">*</span>
                </label>
                <span className="text-[11px] text-slate-400">What would you like to share?</span>
              </div>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={isLoading}
                placeholder="e.g., Announcing our new automated analytics report feature that saves teams 10 hours a week..."
                rows={3}
                className="w-full text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none resize-none disabled:opacity-60"
              />
            </div>

            {/* Target Audience & Objective (Optional) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Target Audience <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  disabled={isLoading}
                  placeholder="e.g., Founders, Product Managers, CTOs"
                  className="w-full text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Post Objective <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  disabled={isLoading}
                  placeholder="e.g., Build authority, drive comments, hire talent"
                  className="w-full text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-60"
                />
              </div>
            </div>

            {/* Tone Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Tone of Voice
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {toneOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isLoading}
                    onClick={() => setTone(opt.id)}
                    className={`flex items-start text-left gap-2.5 p-2.5 rounded-xl border text-xs transition-all ${
                      tone === opt.id
                        ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 text-blue-950 dark:text-blue-100 ring-1 ring-blue-500'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                    } disabled:opacity-60`}
                  >
                    <span className="text-base">{opt.icon}</span>
                    <div>
                      <div className="font-semibold">{opt.label}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {opt.desc}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Key bullet points */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Key points or context <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={keyPoints}
                onChange={(e) => setKeyPoints(e.target.value)}
                disabled={isLoading}
                placeholder="e.g., 40% time saved, released v2.4, zero migration downtime"
                className="w-full text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-60"
              />
            </div>

            {/* Call to action & Hashtag options */}
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Call to Action (CTA) <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={callToAction}
                  onChange={(e) => setCallToAction(e.target.value)}
                  disabled={isLoading}
                  className="w-full text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-60"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeHashtags}
                  onChange={(e) => setIncludeHashtags(e.target.checked)}
                  disabled={isLoading}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  Automatically append 3–5 relevant LinkedIn hashtags
                </span>
              </label>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100 dark:border-slate-800">
              <Button variant="ghost" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleGenerate}
                isLoading={isLoading}
                disabled={isLoading || !topic.trim()}
                leftIcon={
                  !isLoading ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  ) : undefined
                }
              >
                {isLoading ? 'Generating with Gemini...' : 'Generate with AI'}
              </Button>
            </div>
          </>
        ) : (
          /* Result Preview & Insertion */
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2 font-medium">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>Gemini Generated LinkedIn Post</span>
                </div>
                <span>{generatedResult.length} / 3000 chars</span>
              </div>
              <textarea
                value={generatedResult}
                onChange={(e) => setGeneratedResult(e.target.value)}
                rows={8}
                className="w-full text-sm text-slate-800 dark:text-slate-100 bg-transparent border-0 outline-none resize-y leading-relaxed font-sans focus:ring-1 focus:ring-blue-500/30 rounded p-1"
                placeholder="Review and edit generated post content..."
              />
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                leftIcon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                }
              >
                Tweak & Regenerate
              </Button>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <Button variant="ghost" onClick={onClose}>
                  Discard
                </Button>
                {hasExistingContent ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleInsert('append')}
                      title="Keep your current post and append the generated text"
                    >
                      Append to Draft
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => handleInsert('replace')}
                      title="Replace your current post with the generated text"
                      leftIcon={
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      }
                    >
                      Replace Draft
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => handleInsert('replace')}
                    leftIcon={
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    }
                  >
                    Insert into Editor
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
