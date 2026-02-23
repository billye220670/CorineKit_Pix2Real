import { useRef, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ThumbnailStripProps {
  outputs: Array<{ filename: string; url: string }>;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  onHoverEnd: () => void;
  isVideoWorkflow: boolean;
}

interface ThumbDims {
  w: number;
  h: number;
  gap: number;
  pad: number;
  arrowSize: number;
}

function dimsForWidth(w: number): ThumbDims {
  if (w < 220) return { w: 28, h: 21, gap: 4, pad: 4, arrowSize: 12 };
  if (w < 400) return { w: 44, h: 33, gap: 5, pad: 5, arrowSize: 14 };
  return { w: 76, h: 57, gap: 8, pad: 8, arrowSize: 16 };
}

export function ThumbnailStrip({
  outputs,
  selectedIndex,
  onSelect,
  onHover,
  onHoverEnd,
  isVideoWorkflow,
}: ThumbnailStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [dims, setDims] = useState<ThumbDims>({ w: 44, h: 33, gap: 5, pad: 5, arrowSize: 14 });

  useEffect(() => {
    const container = containerRef.current;
    const row = rowRef.current;
    if (!container || !row) return;
    const obs = new ResizeObserver(() => {
      setDims(dimsForWidth(container.clientWidth));
      setHasOverflow(row.scrollWidth > row.clientWidth);
    });
    obs.observe(container);
    obs.observe(row);
    setDims(dimsForWidth(container.clientWidth));
    setHasOverflow(row.scrollWidth > row.clientWidth);
    return () => obs.disconnect();
  }, [outputs]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const child = row.children[selectedIndex] as HTMLElement | undefined;
    child?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [selectedIndex]);

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect((selectedIndex - 1 + outputs.length) % outputs.length);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect((selectedIndex + 1) % outputs.length);
  };

  const stripHeight = dims.h + dims.pad * 2;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        height: stripHeight,
        display: 'flex',
        alignItems: 'center',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Prev arrow */}
      <button
        onClick={handlePrev}
        style={{
          flexShrink: 0,
          width: dims.arrowSize + 8,
          height: stripHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          padding: 0,
          opacity: hasOverflow ? 1 : 0,
          pointerEvents: hasOverflow ? 'auto' : 'none',
          filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))',
        }}
      >
        <ChevronLeft size={dims.arrowSize} />
      </button>

      {/* Thumbnail row */}
      <div
        ref={rowRef}
        className="no-scrollbar"
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          gap: dims.gap,
          padding: `${dims.pad}px 0`,
          scrollBehavior: 'smooth',
          alignItems: 'center',
        }}
      >
        {outputs.map((output, i) => (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); onSelect(i); }}
            onMouseEnter={(e) => { e.stopPropagation(); onHover(i); }}
            onMouseLeave={(e) => { e.stopPropagation(); onHoverEnd(); }}
            style={{
              flexShrink: 0,
              width: dims.w,
              height: dims.h,
              padding: 0,
              border: 'none',
              cursor: 'pointer',
              outline: i === selectedIndex ? '2px solid var(--color-primary)' : '1.5px solid rgba(255,255,255,0.25)',
              outlineOffset: 0,
              opacity: i === selectedIndex ? 1 : 0.65,
              overflow: 'hidden',
              backgroundColor: 'transparent',
              transition: 'opacity 0.15s, outline-color 0.15s',
            }}
          >
            {isVideoWorkflow ? (
              <video
                src={output.url}
                preload="metadata"
                muted
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <img
                src={output.url}
                alt={output.filename}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Next arrow */}
      <button
        onClick={handleNext}
        style={{
          flexShrink: 0,
          width: dims.arrowSize + 8,
          height: stripHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          padding: 0,
          opacity: hasOverflow ? 1 : 0,
          pointerEvents: hasOverflow ? 'auto' : 'none',
          filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))',
        }}
      >
        <ChevronRight size={dims.arrowSize} />
      </button>
    </div>
  );
}
