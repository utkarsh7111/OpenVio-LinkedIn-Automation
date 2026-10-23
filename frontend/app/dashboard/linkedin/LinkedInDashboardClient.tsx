'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Project, LinkedInAccount, LinkedInPost, CreateOrUpdatePostDto, MediaAttachment } from '@/types/linkedin';
import { AccountConnectionCard } from '@/components/linkedin/AccountConnectionCard';
import { PostComposer } from '@/components/linkedin/PostComposer';
import { LinkedInPreviewCard } from '@/components/linkedin/LinkedInPreviewCard';
import { PostHistoryTable } from '@/components/linkedin/PostHistoryTable';
import { DeleteConfirmModal } from '@/components/linkedin/DeleteConfirmModal';
import { useToast } from '@/components/ui/Toast';
import { linkedinApi } from '@/services/linkedinApi';

export const LinkedInDashboardClient: React.FC = () => {
  const toast = useToast();
  const composerRef = useRef<HTMLDivElement>(null);

  // 1. Project & Account Connection State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [connectedAccount, setConnectedAccount] = useState<LinkedInAccount | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // 2. Posts Data & Table State
  const [posts, setPosts] = useState<LinkedInPost[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);

  // 3. Composer & Live Preview State (Live Synchronized)
  const [composerContent, setComposerContent] = useState('');
  const [composerMedia, setComposerMedia] = useState<MediaAttachment[]>([]);
  const [editingPost, setEditingPost] = useState<LinkedInPost | null>(null);

  // 4. Loading States for Post Actions
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);

  // 5. Delete Confirmation Modal State
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    post: LinkedInPost | null;
    isDeleting: boolean;
  }>({
    isOpen: false,
    post: null,
    isDeleting: false,
  });

  // Mobile view toggle (between Composer and Live Preview)
  const [mobileTab, setMobileTab] = useState<'composer' | 'preview'>('composer');

  // Load initial data and handle OAuth callback search params
  useEffect(() => {
    async function initData() {
      // Check for OAuth callback params safely in the browser
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const linkedinParam = params.get('linkedin');
        const reasonParam = params.get('reason');

        if (linkedinParam === 'error') {
          const reasonText = reasonParam === 'ACCESS_DENIED'
            ? 'LinkedIn authorization was canceled or access was denied.'
            : reasonParam === 'EXPIRED_STATE'
            ? 'Connection session expired. Please try connecting again.'
            : `LinkedIn returned an authorization error (${reasonParam || 'UNKNOWN'}).`;
          setConnectionError(reasonText);
          toast.error('Connection Failed', reasonText);
          const cleanUrl = window.location.pathname;
          window.history.replaceState({}, '', cleanUrl);
        } else if (linkedinParam === 'connected') {
          setConnectionError(null);
          toast.success('Connection Successful', 'Verifying active LinkedIn connection status...');
          const cleanUrl = window.location.pathname;
          window.history.replaceState({}, '', cleanUrl);
        }
      }

      try {
        const loadedProjects = await linkedinApi.getProjects();
        setProjects(loadedProjects);
        if (loadedProjects.length > 0) {
          const defaultProj = loadedProjects[0].id;
          setSelectedProjectId(defaultProj);
          loadAccountAndPosts(defaultProj);
        }
      } catch (err: unknown) {
        toast.error('Initialization Failed', (err as Error).message);
      }
    }
    initData();
  }, []);

  const loadAccountAndPosts = async (projectId: string) => {
    setIsLoadingPosts(true);
    try {
      const [account, loadedPosts] = await Promise.all([
        linkedinApi.getAccountStatus(projectId),
        linkedinApi.getPosts(projectId),
      ]);
      setConnectedAccount(account);
      setPosts(loadedPosts);
    } catch (error) {
      toast.error('Data Fetch Error', error instanceof Error ? error.message : 'Unable to load project LinkedIn records.');
    } finally {
      setIsLoadingPosts(false);
    }
  };

  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setConnectionError(null);
    loadAccountAndPosts(projectId);
    // Reset composer when switching project
    handleResetComposer();
  };

  // OAuth Connect Trigger
  const handleConnectLinkedIn = async () => {
    setIsConnecting(true);
    setConnectionError(null);
    try {
      const authorizationUrl = await linkedinApi.getOAuthUrl(selectedProjectId);
      window.location.assign(authorizationUrl);
    } catch {
      const errMsg = 'LinkedIn OAuth returned an authorization error.';
      setConnectionError(errMsg);
      toast.error('Connection Failed', errMsg);
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect
  const handleDisconnectLinkedIn = async () => {
    setIsDisconnecting(true);
    try {
      await linkedinApi.disconnectAccount(selectedProjectId);
      setConnectedAccount(null);
      setConnectionError(null);
      toast.info('Account Disconnected', 'LinkedIn integration removed for this project.');
    } catch (error) {
      toast.error('Disconnect Failed', error instanceof Error ? error.message : 'Could not disconnect LinkedIn.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Reset composer to blank state
  const handleResetComposer = () => {
    setEditingPost(null);
    setComposerContent('');
    setComposerMedia([]);
  };

  // Save Draft
  const handleSaveDraft = async (payload: CreateOrUpdatePostDto) => {
    if (!payload.content || !payload.content.trim()) {
      toast.warning('Commentary Required', 'Please enter commentary text before saving a draft.');
      return;
    }

    setIsSavingDraft(true);
    try {
      if (editingPost) {
        let updated = await linkedinApi.updatePost(editingPost.id, {
          ...payload,
          status: editingPost.status === 'published' ? 'published' : payload.status,
        });
        if (editingPost.status === 'scheduled') updated = await linkedinApi.unschedulePost(updated.id);
        setPosts((prev) => prev.map((p) => (p.id === editingPost.id ? updated : p)));
        toast.success(editingPost.status === 'published' ? 'Post Updated' : 'Draft Updated', editingPost.status === 'published' ? 'Commentary updated on LinkedIn.' : 'Changes to your draft have been saved.');
      } else {
        const created = await linkedinApi.createPost(payload);
        setPosts((prev) => [created, ...prev]);
        toast.success('Draft Saved', 'Post draft saved successfully.');
      }
      handleResetComposer();
    } catch (error) {
      toast.error('Save Failed', error instanceof Error ? error.message : 'Unable to save post draft.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Schedule Post
  const handleSchedule = async (payload: CreateOrUpdatePostDto) => {
    if (!connectedAccount?.isConnected) {
      toast.warning('Account Required', 'Please connect a LinkedIn account before scheduling.');
      return;
    }

    if (editingPost?.status === 'published') {
      toast.warning('Already Published', 'A published LinkedIn post cannot be rescheduled. Only commentary text can be updated.');
      return;
    }

    if (!payload.content || !payload.content.trim()) {
      toast.warning('Commentary Required', 'Please enter commentary text before scheduling a post.');
      return;
    }

    if (!payload.scheduledTime) {
      toast.warning('Schedule Time Required', 'Please select a scheduled date and time at least 5 minutes in the future.');
      return;
    }

    setIsScheduling(true);
    try {
      if (editingPost) {
        const updated = await linkedinApi.updatePost(editingPost.id, payload);
        setPosts((prev) => prev.map((p) => (p.id === editingPost.id ? updated : p)));
        toast.success('Schedule Updated', `Post scheduled for ${new Date(payload.scheduledTime!).toLocaleString()}.`);
      } else {
        const created = await linkedinApi.createPost(payload);
        setPosts((prev) => [created, ...prev]);
        toast.success('Post Scheduled!', `Post will be published automatically on LinkedIn.`);
      }
      handleResetComposer();
    } catch (error) {
      toast.error('Scheduling Failed', error instanceof Error ? error.message : 'Could not queue post for publishing.');
    } finally {
      setIsScheduling(false);
    }
  };

  // Publish Now / Update on LinkedIn
  const handlePublishNow = async (payload: CreateOrUpdatePostDto) => {
    if (!connectedAccount?.isConnected) {
      toast.warning('Account Required', 'Please connect a LinkedIn account before publishing.');
      return;
    }

    if (!payload.content || !payload.content.trim()) {
      toast.warning('Commentary Required', 'Please enter commentary text before publishing to LinkedIn.');
      return;
    }

    setIsPublishing(true);
    try {
      let target: LinkedInPost;
      if (editingPost) {
        target = await linkedinApi.updatePost(editingPost.id, { ...payload, status: editingPost.status === 'published' ? 'published' : 'draft' });
        if (editingPost.status !== 'published') target = await linkedinApi.publishPost(target.id);
        setPosts((prev) => prev.map((p) => (p.id === target.id ? target : p)));
      } else {
        const draft = await linkedinApi.createPost({ ...payload, status: 'draft', scheduledTime: null });
        target = await linkedinApi.publishPost(draft.id);
        setPosts((prev) => [target, ...prev]);
      }

      toast.success(editingPost?.status === 'published' ? 'Post Updated' : 'Published in LinkedIn mode', editingPost?.status === 'published' ? 'Your post commentary was updated on LinkedIn.' : 'The backend confirmed the publish result.');
      handleResetComposer();
    } catch (error) {
      toast.error('Publication Failed', error instanceof Error ? error.message : 'Publishing failed.');
    } finally {
      setIsPublishing(false);
    }
  };

  // Load post into composer for editing
  const handleEditPost = (post: LinkedInPost) => {
    setEditingPost(post);
    setComposerContent(post.content);
    setComposerMedia(post.media || []);
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast.info('Editing Post', `Post #${post.id} loaded into composer.`);
  };

  // Trigger delete modal
  const handlePromptDelete = (post: LinkedInPost) => {
    setDeleteModalState({
      isOpen: true,
      post,
      isDeleting: false,
    });
  };

  // Confirm delete
  const handleConfirmDelete = async () => {
    if (!deleteModalState.post) return;

    setDeleteModalState((prev) => ({ ...prev, isDeleting: true }));
    try {
      const postId = deleteModalState.post.id;
      await linkedinApi.deletePost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      
      if (editingPost?.id === postId) {
        handleResetComposer();
      }

      toast.success('Post Deleted', 'The post has been deleted from your workspace.');
      setDeleteModalState({ isOpen: false, post: null, isDeleting: false });
    } catch (error) {
      toast.error('Delete Failed', error instanceof Error ? error.message : 'Could not delete the post.');
      setDeleteModalState((prev) => ({ ...prev, isDeleting: false }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Module Title & Breadcrumbs matching OpenVio GBP Module */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>OpenVio Automation</span>
            <span>/</span>
            <span className="text-slate-900 dark:text-white font-medium">LinkedIn Posts</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-[#0a66c2] text-white">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.8v8.37h-2.8v-8.37M7.86 6.3a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24z" />
              </svg>
            </span>
            LinkedIn Post Automation
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Create, AI-generate, schedule, and automate organic LinkedIn content for your company profiles and executive accounts alongside Google Business Profile campaigns.
          </p>
        </div>

        {/* Quick Module Stats */}
        <div className="flex items-center gap-3">
          <div className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs text-right">
            <div className="text-[11px] font-semibold uppercase text-slate-400 tracking-wider">Scheduled</div>
            <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {posts.filter((p) => p.status === 'scheduled').length}
            </div>
          </div>
          <div className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs text-right">
            <div className="text-[11px] font-semibold uppercase text-slate-400 tracking-wider">Published</div>
            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {posts.filter((p) => p.status === 'published').length}
            </div>
          </div>
        </div>
      </div>

      {/* 1. Account Connection & Project Association View */}
      <section aria-label="Account Settings & Project Association">
        <AccountConnectionCard
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          connectedAccount={connectedAccount}
          isConnecting={isConnecting}
          connectionError={connectionError}
          onConnectLinkedIn={handleConnectLinkedIn}
          onDisconnectLinkedIn={handleDisconnectLinkedIn}
          isDisconnecting={isDisconnecting}
        />
      </section>

      {/* Mobile Tab Switcher (Composer vs Preview) */}
      <div className="lg:hidden flex items-center bg-slate-200 dark:bg-slate-800 p-1 rounded-xl">
        <button
          type="button"
          onClick={() => setMobileTab('composer')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
            mobileTab === 'composer'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Post Composer
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('preview')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
            mobileTab === 'preview'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Live LinkedIn Preview
        </button>
      </div>

      {/* 2 & 3. Core Workspace: Post Composer + Live Post Preview Card */}
      <section ref={composerRef} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Post Composer (The Core Workspace) */}
        <div className={`lg:col-span-7 ${mobileTab === 'composer' ? 'block' : 'hidden lg:block'}`}>
          <PostComposer
            projectId={selectedProjectId}
            initialContent={composerContent}
            initialMedia={composerMedia}
            initialScheduledTime={editingPost?.scheduledTime}
            editingPostId={editingPost?.id}
            isPublishedPost={editingPost?.status === 'published'}
            onContentChange={(val) => setComposerContent(val)}
            onMediaChange={(val) => setComposerMedia(val)}
            onSaveDraft={handleSaveDraft}
            onPublishNow={handlePublishNow}
            onSchedule={handleSchedule}
            onCancelEdit={handleResetComposer}
            isSavingDraft={isSavingDraft}
            isPublishing={isPublishing}
            isScheduling={isScheduling}
            disabled={!connectedAccount?.isConnected}
          />
        </div>

        {/* Right Column: Live Post Preview Card */}
        <div className={`lg:col-span-5 sticky top-6 ${mobileTab === 'preview' ? 'block' : 'hidden lg:block'}`}>
          <div className="bg-slate-100/60 dark:bg-slate-900/40 p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <LinkedInPreviewCard
              content={composerContent}
              media={composerMedia}
              account={connectedAccount}
              scheduledTime={editingPost?.scheduledTime}
            />
          </div>
        </div>
      </section>

      {/* 5. Post History & Dashboard Data Table */}
      <section aria-label="Post History & Schedules">
        <PostHistoryTable
          posts={posts}
          isLoading={isLoadingPosts}
          onEditPost={handleEditPost}
          onDeletePost={handlePromptDelete}
          onCreateNewPost={() => {
            handleResetComposer();
            composerRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      </section>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={deleteModalState.isOpen}
        onClose={() => setDeleteModalState({ isOpen: false, post: null, isDeleting: false })}
        onConfirm={handleConfirmDelete}
        postSnippet={deleteModalState.post?.content}
        isDeleting={deleteModalState.isDeleting}
      />
    </div>
  );
};
