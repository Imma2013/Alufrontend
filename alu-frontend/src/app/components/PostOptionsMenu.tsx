'use client';

import { Post } from '../db';

interface PostOptionsMenuProps {
  post: Post;
  onClose: () => void;
  onEdit: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  allowEdit?: boolean;
  allowDelete?: boolean;
}

export default function PostOptionsMenu({
  post,
  onClose,
  onEdit,
  onCopyLink,
  onDelete,
  allowEdit = true,
  allowDelete = true,
}: PostOptionsMenuProps) {
  const handleEdit = () => {
    onEdit();
    onClose();
  };

  const handleCopyLink = () => {
    onCopyLink();
    onClose();
  };

  const handleDelete = () => {
    onDelete();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/60 flex items-end md:items-center md:justify-center animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:w-[400px] md:rounded-2xl rounded-t-2xl p-4 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar (mobile only) */}
        <div className="flex justify-center mb-4 md:hidden">
          <div className="w-10 h-1 bg-alu-border rounded-full" />
        </div>

        {/* Options */}
        <div className="flex flex-col gap-2">
          {allowEdit && (
            <button
              onClick={handleEdit}
              className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-alu-surface transition-colors text-left"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
              <span className="text-sm font-medium text-alu-text">Edit caption</span>
            </button>
          )}

          <button
            onClick={handleCopyLink}
            className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-alu-surface transition-colors text-left"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span className="text-sm font-medium text-alu-text">Copy link</span>
          </button>

          {allowDelete && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-50 transition-colors text-left"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span className="text-sm font-medium text-red-500">Delete</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
