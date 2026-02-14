'use client';

interface MentionTextProps {
  text: string;
  className?: string;
  onMentionClick?: (handle: string) => void;
}

const MENTION_RE = /(@[a-zA-Z0-9._]{2,30})/g;
const MENTION_TOKEN_RE = /^@[a-zA-Z0-9._]{2,30}$/;

export default function MentionText({ text, className = '', onMentionClick }: MentionTextProps) {
  const parts = String(text || '').split(MENTION_RE);

  return (
    <span className={className}>
      {parts.map((part, idx) => {
        if (part.startsWith('@') && MENTION_TOKEN_RE.test(part)) {
          const handle = part.slice(1);
          return (
            <button
              key={`${part}-${idx}`}
              type="button"
              onClick={() => onMentionClick?.(handle)}
              className="text-[#0095f6] hover:text-[#1877f2] font-medium"
            >
              {part}
            </button>
          );
        }
        return <span key={`${part}-${idx}`}>{part}</span>;
      })}
    </span>
  );
}
