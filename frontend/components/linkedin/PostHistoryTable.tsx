'use client';

import React, { useState, useMemo } from 'react';
import { LinkedInPost, PostStatus } from '@/types/linkedin';
import { StatusBadge } from '@/components/linkedin/StatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { ImageWithFallback } from '@/components/ui/ImageWithFallback';

interface PostHistoryTableProps {
  posts: LinkedInPost[];
  isLoading: boolean;
  onEditPost: (post: LinkedInPost) => void;
  onDeletePost: (post: LinkedInPost) => void;
  onCreateNewPost?: () => void;
}

export const PostHistoryTable: React.FC<PostHistoryTableProps> = ({
  posts,
  isLoading,
  onEditPost,
  onDeletePost,
  onCreateNewPost,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | PostStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Count items per status
  const counts = useMemo(() => {
    return {
      all: posts.length,
      draft: posts.filter((p) => p.status === 'draft').length,
      scheduled: posts.filter((p) => p.status === 'scheduled').length,
      publishing: posts.filter((p) => p.status === 'publishing').length,
      published: posts.filter((p) => p.status === 'published').length,
      failed: posts.filter((p) => p.status === 'failed').length,
    };
  }, [posts]);

  // Filter and search
  const filteredPosts = useMemo(() => {
    return posts.filter((post) => {
      const matchesTab = activeTab === 'all' || post.status === activeTab;
      const matchesSearch =
        !searchQuery.trim() ||
        post.content.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesTab && matchesSearch;
    });
  }, [posts, activeTab, searchQuery]);

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return '—';
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
      {/* Table Header & Toolbar */}
      <div className="p-5 border-b border-slate-100 dark:border-slate-800/80 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Project Post History & Schedule
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Review published campaigns, queued schedules, and saved drafts.
            </p>
          </div>

          {/* Search Input */}
          <div className="relative max-w-xs w-full">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search post content..."
              className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 pl-9 pr-3.5 py-2 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
          {(
            [
              { id: 'all', label: 'All Posts', count: counts.all },
              { id: 'published', label: 'Published', count: counts.published },
              { id: 'scheduled', label: 'Scheduled', count: counts.scheduled },
              { id: 'draft', label: 'Drafts', count: counts.draft },
              { id: 'failed', label: 'Failed', count: counts.failed },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/20 font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-800/30 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              <th className="py-3 px-5">Post Content & Media</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Timeline / Schedule</th>
              <th className="py-3 px-4">Performance</th>
              <th className="py-3 px-5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {isLoading ? (
              // Skeleton Rows
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="py-4 px-5">
                    <div className="flex items-center gap-3">
                      <Skeleton className="w-12 h-12 rounded-lg shrink-0" />
                      <div className="space-y-1.5 flex-1 max-w-sm">
                        <Skeleton className="h-3.5 w-full" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </td>
                  <td className="py-4 px-4">
                    <Skeleton className="h-3.5 w-28" />
                  </td>
                  <td className="py-4 px-4">
                    <Skeleton className="h-3.5 w-16" />
                  </td>
                  <td className="py-4 px-5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Skeleton className="h-7 w-14 rounded-md" />
                      <Skeleton className="h-7 w-7 rounded-md" />
                    </div>
                  </td>
                </tr>
              ))
            ) : filteredPosts.length === 0 ? (
              // Empty State
              <tr>
                <td colSpan={5} className="py-12 px-4 text-center">
                  <div className="max-w-xs mx-auto flex flex-col items-center">
                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      No posts found
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
                      {searchQuery
                        ? `No results matching "${searchQuery}" in this view.`
                        : 'There are no LinkedIn posts in this category yet.'}
                    </p>
                    {onCreateNewPost && (
                      <Button size="sm" variant="outline" onClick={onCreateNewPost}>
                        Draft New Post
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              // Real Post Rows
              filteredPosts.map((post) => {
                const firstMedia = post.media && post.media.length > 0 ? post.media[0] : null;

                return (
                  <tr
                    key={post.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group"
                  >
                    {/* Snippet / Thumbnail */}
                    <td className="py-3.5 px-5">
                      <div className="flex items-start gap-3">
                        {firstMedia ? (
                          <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 border border-slate-200/80 dark:border-slate-700">
                            {firstMedia.type === 'image' ? (
                              <ImageWithFallback
                                src={firstMedia.previewUrl}
                                alt={firstMedia.name || 'Post attachment thumbnail'}
                                className="w-full h-full object-cover"
                                fallbackText=""
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-slate-900 text-blue-400">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                </svg>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-800 shrink-0 flex items-center justify-center text-slate-400">
                            <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                        )}

                        <div className="min-w-0 max-w-md">
                          <p className="text-xs font-medium text-slate-900 dark:text-slate-100 line-clamp-2 leading-relaxed">
                            {post.content || <span className="italic text-slate-400">No text content</span>}
                          </p>
                          {post.media.length > 1 && (
                            <span className="inline-block mt-1 text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                              +{post.media.length - 1} additional media
                            </span>
                          )}
                          {post.errorReason && (
                            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1 font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              Error: {post.errorReason}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <StatusBadge status={post.status} />
                    </td>

                    {/* Timeline Date */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                      {post.status === 'scheduled' && post.scheduledTime ? (
                        <div className="flex flex-col">
                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                            Scheduled
                          </span>
                          <span>{formatDate(post.scheduledTime)}</span>
                        </div>
                      ) : post.status === 'published' && post.publishedAt ? (
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            Published
                          </span>
                          <span>{formatDate(post.publishedAt)}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-slate-500">Updated</span>
                          <span>{formatDate(post.updatedAt || post.createdAt)}</span>
                        </div>
                      )}
                    </td>

                    {/* Performance Metrics */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                      {post.status === 'published' && post.metrics ? (
                        <div className="flex items-center gap-2.5 text-[11px]">
                          <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300" title="Reactions">
                            👍 {post.metrics.likes}
                          </span>
                          <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300" title="Comments">
                            💬 {post.metrics.comments}
                          </span>
                          <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300" title="Reposts">
                            🔁 {post.metrics.reposts}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>

                    {/* Row Actions */}
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onEditPost(post)}
                          className="h-8 px-2.5 text-xs text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
                          leftIcon={
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          }
                        >
                          Edit
                        </Button>

                        <button
                          type="button"
                          onClick={() => onDeletePost(post)}
                          aria-label="Delete post"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
