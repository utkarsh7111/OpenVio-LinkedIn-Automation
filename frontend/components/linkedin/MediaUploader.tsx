'use client';

import React, { useRef, useState, useEffect } from 'react';
import { MediaAttachment } from '@/types/linkedin';
import { ImageWithFallback } from '@/components/ui/ImageWithFallback';

interface MediaUploaderProps {
  media: MediaAttachment[];
  onChange: (media: MediaAttachment[]) => void;
  maxFiles?: number;
  disabled?: boolean;
}

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska', 'video/mkv'];
const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv'];
const SUPPORTED_DOC_EXTENSIONS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx'];

export const MediaUploader: React.FC<MediaUploaderProps> = ({
  media,
  onChange,
  maxFiles = 20,
  disabled = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editingAltTextId, setEditingAltTextId] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  // Clean up blob URLs when component unmounts
  useEffect(() => {
    return () => {
      media.forEach((item) => {
        if (item.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getMediaCategory = (file: File): 'image' | 'video' | 'document' | null => {
    const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
    if (SUPPORTED_IMAGE_TYPES.includes(file.type.toLowerCase()) || ['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) return 'image';
    if (SUPPORTED_VIDEO_TYPES.includes(file.type.toLowerCase()) || SUPPORTED_VIDEO_EXTENSIONS.includes(ext)) return 'video';
    if (SUPPORTED_DOC_EXTENSIONS.includes(ext) || file.type.includes('pdf') || file.type.includes('word') || file.type.includes('presentation')) {
      return 'document';
    }
    return null;
  };

  const handleFiles = (files: FileList | File[], forcedCategory?: 'image' | 'video' | 'document') => {
    setUploadError(null);
    const filesArray = Array.from(files);
    if (!filesArray.length) return;

    // Check existing media category
    const currentCategory = media.length > 0 ? media[0].type : null;

    // Determine target category
    const firstCat = forcedCategory || getMediaCategory(filesArray[0]);
    if (!firstCat) {
      setUploadError(`"${filesArray[0].name}" is not supported. Choose JPEG, PNG, GIF, MP4, MOV, WebM, PDF, DOC, or PPT.`);
      return;
    }

    if (currentCategory && currentCategory !== firstCat) {
      setUploadError(`LinkedIn does not allow mixing ${currentCategory}s with ${firstCat}s in a single post. Remove existing attachments first.`);
      return;
    }

    if (firstCat === 'video') {
      if (filesArray.length > 1 || media.length >= 1) {
        setUploadError('LinkedIn supports only 1 video per post.');
        return;
      }
      const file = filesArray[0];
      if (file.size > 100 * 1024 * 1024) {
        setUploadError(`Video "${file.name}" exceeds the 100MB limit.`);
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      const title = file.name.replace(/\.[^/.]+$/, '');
      const newMedia: MediaAttachment = {
        id: `media-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        url: previewUrl,
        previewUrl,
        type: 'video',
        name: file.name,
        size: file.size,
        title,
        file,
      };
      onChange([newMedia]);
      return;
    }

    if (firstCat === 'document') {
      if (filesArray.length > 1 || media.length >= 1) {
        setUploadError('LinkedIn supports only 1 document per post.');
        return;
      }
      const file = filesArray[0];
      if (file.size > 100 * 1024 * 1024) {
        setUploadError(`Document "${file.name}" exceeds the 100MB limit.`);
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      const title = file.name.replace(/\.[^/.]+$/, '');
      const newMedia: MediaAttachment = {
        id: `media-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        url: previewUrl,
        previewUrl,
        type: 'document',
        name: file.name,
        size: file.size,
        title,
        file,
      };
      onChange([newMedia]);
      return;
    }

    // Image upload (up to 20 images)
    const maxAllowed = Math.min(maxFiles, 20);
    const remainingSlots = maxAllowed - media.length;
    if (remainingSlots <= 0) {
      setUploadError(`Maximum of 20 images allowed per LinkedIn post.`);
      return;
    }
    if (filesArray.length > remainingSlots) {
      setUploadError(`Cannot add ${filesArray.length} images. LinkedIn allows up to 20 images per post (you currently have ${media.length}). Only ${remainingSlots} more can be added.`);
      return;
    }

    const validFiles: MediaAttachment[] = [];
    const failedFiles: string[] = [];
    for (const file of filesArray) {
      const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
      const isImage = SUPPORTED_IMAGE_TYPES.includes(file.type.toLowerCase()) || ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
      if (!isImage) {
        failedFiles.push(`"${file.name}" (not a supported JPEG, PNG, or GIF image)`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        failedFiles.push(`"${file.name}" (exceeds 10MB limit)`);
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      validFiles.push({
        id: `media-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        url: previewUrl,
        previewUrl,
        type: 'image',
        name: file.name,
        size: file.size,
        altText: '',
        file,
      });
    }

    if (failedFiles.length > 0) {
      setUploadError(`Some files could not be added: ${failedFiles.join(', ')}.`);
    }

    if (validFiles.length > 0) {
      onChange([...media, ...validFiles]);
    }
  };

  const handleRemove = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const itemToRemove = media.find((m) => m.id === id);
    if (itemToRemove && itemToRemove.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(itemToRemove.previewUrl);
    }
    onChange(media.filter((m) => m.id !== id));
  };

  const handleMakePrimary = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const index = media.findIndex((m) => m.id === id);
    if (index <= 0) return;
    const target = media[index];
    const rest = media.filter((m) => m.id !== id);
    onChange([target, ...rest]);
  };

  const handleUpdateTitle = (id: string, newTitle: string) => {
    onChange(media.map((m) => (m.id === id ? { ...m, title: newTitle } : m)));
  };

  const handleUpdateAltText = (id: string, newAltText: string) => {
    onChange(media.map((m) => (m.id === id ? { ...m, altText: newAltText } : m)));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const isImageCategory = media.length > 0 && media[0].type === 'image';
  const isVideoCategory = media.length > 0 && media[0].type === 'video';
  const isDocCategory = media.length > 0 && media[0].type === 'document';
  const canAddMoreImages = isImageCategory && media.length < Math.min(maxFiles, 20);

  return (
    <div className="space-y-3">
      {/* Hidden file inputs for dedicated pickers */}
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/png, image/jpeg, image/gif"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files, 'image')}
        disabled={disabled}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4, video/quicktime, video/webm, video/x-msvideo, video/x-matroska, video/mkv, .mkv"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files, 'video')}
        disabled={disabled}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept=".pdf, .doc, .docx, .ppt, .pptx, application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.ms-powerpoint, application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files, 'document')}
        disabled={disabled}
      />

      {/* Main Upload Selector / Dropzone (Shown when no media attached or when more images can be added) */}
      {media.length === 0 && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-xl p-5 text-center transition-all duration-150 ${
            isDragging
              ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
              : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Drag &amp; drop media files here, or choose an attachment type:
            </div>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => !disabled && imageInputRef.current?.click()}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Add Image(s)</span>
              </button>

              <button
                type="button"
                onClick={() => !disabled && videoInputRef.current?.click()}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Add Video</span>
              </button>

              <button
                type="button"
                onClick={() => !disabled && documentInputRef.current?.click()}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span>Add Document</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Supports: Images (up to 20, max 10MB), Video (MP4/MOV up to 100MB), Documents (PDF/PPT/DOC up to 100MB)
            </p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {uploadError && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-600 dark:text-rose-400">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{uploadError}</span>
        </div>
      )}

      {/* Attached Media Previews */}
      {media.length > 0 && (
        <div className="space-y-3">
          {/* Header indicator & add more button */}
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span className="font-semibold">
              Attached {isImageCategory ? `Images (${media.length}/20)` : isVideoCategory ? 'Video' : 'Document'}
            </span>

            {canAddMoreImages && (
              <button
                type="button"
                onClick={() => !disabled && imageInputRef.current?.click()}
                disabled={disabled}
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
              >
                <span>+ Add more images</span>
              </button>
            )}
          </div>

          {/* 1. Images Grid View: Prominent Primary Thumbnail + Additional Images Strip */}
          {isImageCategory && (
            <div className="space-y-4">
              {/* Primary Image Preview (First Thumbnail in user selection order) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      Primary Thumbnail (Cover)
                    </span>
                    <span className="text-slate-500 text-[11px] truncate max-w-[200px]" title={media[0].name}>
                      {media[0].name}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingAltTextId(editingAltTextId === media[0].id ? null : media[0].id)}
                    className="text-blue-600 dark:text-blue-400 hover:underline text-[11px] font-medium cursor-pointer"
                  >
                    {media[0].altText ? 'Alt text ✓' : '+ Alt text'}
                  </button>
                </div>

                <div className="group relative rounded-xl overflow-hidden border-2 border-blue-500/30 bg-slate-100 dark:bg-slate-900 h-52 sm:h-64 flex items-center justify-center shadow-sm">
                  <ImageWithFallback
                    src={media[0].previewUrl}
                    alt={media[0].altText || media[0].name}
                    className="w-full h-full object-cover"
                    fallbackText={media[0].name}
                  />

                  {/* Primary Badge Overlay */}
                  <div className="absolute top-2.5 left-2.5 bg-blue-600/90 backdrop-blur-md px-2 py-0.5 rounded-md text-[11px] text-white font-semibold flex items-center gap-1 shadow-xs">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <span>Primary Thumbnail</span>
                  </div>

                  {/* File Size Badge */}
                  <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[11px] text-white font-mono">
                    {formatFileSize(media[0].size)}
                  </div>

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={(e) => handleRemove(media[0].id, e)}
                    aria-label={`Remove ${media[0].name}`}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-slate-900/80 hover:bg-rose-600 text-white backdrop-blur-sm transition-all duration-150 transform hover:scale-110 shadow-sm cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Inline Alt Text Input for Primary */}
                {editingAltTextId === media[0].id && (
                  <input
                    type="text"
                    value={media[0].altText || ''}
                    onChange={(e) => handleUpdateAltText(media[0].id, e.target.value)}
                    placeholder="Alt text for primary image (accessibility)..."
                    maxLength={300}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500"
                  />
                )}
              </div>

              {/* Additional Attached Images Strip */}
              {media.length > 1 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Additional Attached Images ({media.length - 1}):
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {media.slice(1).map((item, idx) => (
                      <div key={item.id} className="space-y-1.5">
                        <div className="group relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 aspect-video flex items-center justify-center shadow-xs">
                          <ImageWithFallback
                            src={item.previewUrl}
                            alt={item.altText || item.name}
                            className="w-full h-full object-cover"
                            fallbackText={item.name}
                          />

                          {/* Index Badge */}
                          <div className="absolute top-1.5 left-1.5 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] text-white font-mono">
                            #{idx + 2}
                          </div>

                          {/* Make Primary Button */}
                          <button
                            type="button"
                            onClick={(e) => handleMakePrimary(item.id, e)}
                            className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[10px] font-semibold bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 hover:bg-blue-600 hover:text-white transition-all shadow-xs cursor-pointer"
                            title="Make this the primary thumbnail"
                          >
                            Set Primary
                          </button>

                          {/* Remove button */}
                          <button
                            type="button"
                            onClick={(e) => handleRemove(item.id, e)}
                            aria-label={`Remove ${item.name}`}
                            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-slate-900/80 hover:bg-rose-600 text-white backdrop-blur-sm transition-all duration-150 transform hover:scale-110 shadow-sm cursor-pointer"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>

                        {/* Alt text editor toggle */}
                        <div className="flex items-center justify-between text-[11px] px-0.5">
                          <span className="text-slate-500 truncate max-w-[100px]" title={item.name}>
                            {item.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingAltTextId(editingAltTextId === item.id ? null : item.id)}
                            className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                          >
                            {item.altText ? 'Alt text ✓' : '+ Alt text'}
                          </button>
                        </div>

                        {/* Inline Alt Text Input */}
                        {editingAltTextId === item.id && (
                          <input
                            type="text"
                            value={item.altText || ''}
                            onChange={(e) => handleUpdateAltText(item.id, e.target.value)}
                            placeholder="Alt text..."
                            maxLength={300}
                            className="w-full px-2 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. Video Preview View */}
          {isVideoCategory && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-950 p-3 space-y-2">
              <div className="relative rounded-lg overflow-hidden bg-black max-h-[320px] flex items-center justify-center">
                <video
                  src={media[0].previewUrl}
                  controls
                  className="w-full max-h-[320px] rounded-lg"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 text-white">
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{media[0].name}</div>
                  <div className="text-[11px] text-slate-400">{formatFileSize(media[0].size)} • LinkedIn Video</div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={disabled}
                    className="px-2.5 py-1 text-xs rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(media[0].id)}
                    disabled={disabled}
                    className="px-2.5 py-1 text-xs rounded-md bg-rose-600/80 hover:bg-rose-600 text-white transition-colors cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Video Title Input */}
              <div className="pt-1">
                <label className="block text-[11px] text-slate-400 mb-1">
                  Video Title (Optional):
                </label>
                <input
                  type="text"
                  value={media[0].title || ''}
                  onChange={(e) => handleUpdateTitle(media[0].id, e.target.value)}
                  placeholder="Enter video title..."
                  maxLength={400}
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-800 bg-slate-900 text-white focus:outline-hidden focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {/* 3. Document Preview View */}
          {isDocCategory && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-900/60 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 shrink-0">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h5 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {media[0].name}
                    </h5>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      LinkedIn Document • {formatFileSize(media[0].size)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => documentInputRef.current?.click()}
                    disabled={disabled}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(media[0].id)}
                    disabled={disabled}
                    className="px-2.5 py-1 text-xs rounded-md bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-100 transition-colors cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Document Title Input */}
              <div className="pt-1">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Document Title (displayed to LinkedIn viewers):
                </label>
                <input
                  type="text"
                  value={media[0].title || ''}
                  onChange={(e) => handleUpdateTitle(media[0].id, e.target.value)}
                  placeholder="Enter a descriptive document title..."
                  maxLength={400}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
