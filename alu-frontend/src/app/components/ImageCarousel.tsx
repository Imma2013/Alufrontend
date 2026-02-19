'use client';

import { useState, useEffect } from 'react';

interface ImageCarouselProps {
  images: string[]; // Array of image URLs
  aspectRatio?: string; // Default '4/3'
  objectFit?: 'cover' | 'contain';
  showDots?: 'always' | 'mobile' | 'never';
  avoidTopRight?: boolean;
}

export default function ImageCarousel({
  images,
  aspectRatio = '4/3',
  objectFit = 'cover',
  showDots = 'always',
  avoidTopRight = false,
}: ImageCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile for swipe gestures
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Swipe detection (minimum 50px swipe distance)
  const minSwipeDistance = 50;

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && currentIndex < images.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else if (isRightSwipe && currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const goToPrevious = () => {
    setCurrentIndex(prev => Math.max(0, prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex(prev => Math.min(images.length - 1, prev + 1));
  };

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };
  const shouldShowDots =
    showDots === 'always' || (showDots === 'mobile' && isMobile);

  // Single image - no carousel needed
  if (images.length <= 1) {
    return (
      <div className="relative w-full h-full">
        <img
          src={images[0]}
          alt=""
          className={`w-full h-full ${objectFit === 'contain' ? 'object-contain bg-black' : 'object-cover'}`}
        />
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Images container */}
      <div
        className="flex h-full transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {images.map((url, i) => (
          <div key={i} className="w-full h-full flex-shrink-0">
            <img
              src={url}
              alt={`Slide ${i + 1}`}
              className={`w-full h-full ${objectFit === 'contain' ? 'object-contain bg-black' : 'object-cover'}`}
            />
          </div>
        ))}
      </div>

      {/* Navigation arrows (desktop only) */}
      {!isMobile && currentIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); goToPrevious(); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 hover:bg-white shadow-lg flex items-center justify-center transition-all hover:scale-110 z-10"
          aria-label="Previous image"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      {!isMobile && currentIndex < images.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); goToNext(); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 hover:bg-white shadow-lg flex items-center justify-center transition-all hover:scale-110 z-10"
          aria-label="Next image"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* Dots indicator */}
      {shouldShowDots && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); goToSlide(i); }}
              className={`transition-all rounded-full ${
                i === currentIndex
                  ? 'w-6 h-1.5 bg-white'
                  : 'w-1.5 h-1.5 bg-white/60 hover:bg-white/80'
              }`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* Image counter (top right) */}
      <div className={`absolute top-3 ${avoidTopRight ? 'right-14 md:right-3' : 'right-3'} px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm text-white text-xs font-medium z-10`}>
        {currentIndex + 1} / {images.length}
      </div>
    </div>
  );
}
