import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type { ValidatedRenderPayload } from '@vision/application';

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

function dbToLinear(gainDb: number) {
  return Math.pow(10, gainDb / 20);
}

function regionStyle(region: Rect): CSSProperties {
  return {
    position: 'absolute',
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
    overflow: 'hidden',
  };
}

function assetFor(payload: ValidatedRenderPayload, assetId: string) {
  return payload.resolvedAssets.find((asset) => asset.assetId === assetId);
}

function selectedAssetFor(payload: ValidatedRenderPayload, assetId: string) {
  return payload.editingPlan.selectedAssets.find((asset) => asset.assetId === assetId);
}

function sourceTrimFrames(payload: ValidatedRenderPayload, assetId: string, fps: number) {
  const selected = selectedAssetFor(payload, assetId);
  if (!selected) return {};

  return {
    ...(selected.sourceInMs !== undefined
      ? { trimBefore: Math.floor((selected.sourceInMs * fps) / 1_000) }
      : {}),
    ...(selected.sourceOutMs !== undefined
      ? { trimAfter: Math.ceil((selected.sourceOutMs * fps) / 1_000) }
      : {}),
  };
}

function fitMode(mode: 'FIT' | 'FILL' | 'CROP'): CSSProperties['objectFit'] {
  if (mode === 'FIT') return 'contain';
  return 'cover';
}

function MotionSurface(input: {
  children: ReactNode;
  presetKey?: string | undefined;
  purpose: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  let transform = 'none';
  let opacity = 1;

  if (input.presetKey === 'SUBTLE_SCALE_IN') {
    const end = Math.max(1, Math.round(0.7 * fps));
    const scale = interpolate(frame, [0, end], [1, 1.04], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    transform = `scale(${scale})`;
  } else if (input.presetKey === 'SUBTLE_SCALE') {
    const end = Math.max(1, Math.round(0.9 * fps));
    const scale = interpolate(frame, [0, end], [1, 1.025], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    transform = `scale(${scale})`;
  } else if (input.presetKey === 'FOCUS_ZOOM') {
    const end = Math.max(1, Math.round(0.45 * fps));
    const scale = interpolate(frame, [0, end], [1, 1.2], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    transform = `scale(${scale})`;
  } else if (input.presetKey === 'SHORT_SLIDE_UP') {
    const end = Math.max(1, Math.round(0.22 * fps));
    const y = interpolate(frame, [0, end], [8, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    transform = `translateY(${y}%)`;
  } else if (input.presetKey === 'SHORT_SLIDE_LEFT' || input.presetKey === 'SHORT_SLIDE') {
    const end = Math.max(1, Math.round(0.22 * fps));
    const x = interpolate(frame, [0, end], [8, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    transform = `translateX(${x}%)`;
  } else if (input.presetKey === 'RESULT_POP') {
    const end = Math.max(1, Math.round(0.18 * fps));
    const scale = interpolate(frame, [0, end], [0.96, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    transform = `scale(${scale})`;
  } else if (input.presetKey === 'SUBTLE_FADE' || input.presetKey === 'MASK_REVEAL') {
    const end = Math.max(1, Math.round(0.22 * fps));
    opacity = interpolate(frame, [0, end], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }

  return (
    <div
      data-purpose={input.purpose}
      style={{
        width: '100%',
        height: '100%',
        transform,
        opacity,
        transformOrigin: 'center center',
      }}
    >
      {input.children}
    </div>
  );
}

function TimelineAsset(input: {
  payload: ValidatedRenderPayload;
  assetId: string;
  scaleMode: 'FIT' | 'FILL' | 'CROP';
  blockStartMs: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const asset = assetFor(input.payload, input.assetId);
  if (!asset) return null;

  const absoluteMs = input.blockStartMs + (frame * 1_000) / fps;
  const focus = input.payload.editingPlan.productFocus.find(
    (window) =>
      window.assetId === input.assetId && absoluteMs >= window.startMs && absoluteMs < window.endMs,
  );

  let focusTransform = 'none';
  let transformOrigin = 'center center';

  if (focus) {
    const centerX = focus.region.x + focus.region.width / 2;
    const centerY = focus.region.y + focus.region.height / 2;
    const targetScale = Math.min(
      2.4,
      Math.max(1.05, 1 / Math.max(focus.region.width, focus.region.height)),
    );
    let scale = targetScale;

    if (focus.behavior === 'ZOOM_IN' || focus.behavior === 'PAN') {
      const start = Math.floor(((focus.startMs - input.blockStartMs) * fps) / 1_000);
      const end = Math.max(
        start + 1,
        Math.ceil(((focus.endMs - input.blockStartMs) * fps) / 1_000),
      );
      scale = interpolate(frame, [start, end], [1, targetScale], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
    }

    focusTransform = `scale(${scale})`;
    transformOrigin = `${centerX * 100}% ${centerY * 100}%`;
  }

  const style: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: fitMode(input.scaleMode),
    display: 'block',
    transform: focusTransform,
    transformOrigin,
  };

  if (asset.kind === 'IMAGE')
    return <Img src={asset.localUri} style={style} crossOrigin="anonymous" />;

  if (asset.kind === 'VIDEO')
    return (
      <OffthreadVideo
        src={asset.localUri}
        style={style}
        muted
        crossOrigin="anonymous"
        {...sourceTrimFrames(input.payload, asset.assetId, fps)}
      />
    );

  return null;
}

function TimelineLayer(input: {
  payload: ValidatedRenderPayload;
  block: ValidatedRenderPayload['editingPlan']['timeline'][number];
}) {
  const { fps } = useVideoConfig();
  const block = input.block;
  const from = Math.floor((block.startMs * fps) / 1_000);
  const end = Math.ceil((block.endMs * fps) / 1_000);
  const durationInFrames = Math.max(1, end - from);

  if (block.layer === 'PRESENTER' || block.layer === 'CAPTION') return null;

  let content: ReactNode;

  if (block.source.type === 'ASSET') {
    content = (
      <TimelineAsset
        payload={input.payload}
        assetId={block.source.assetId}
        scaleMode={block.composition.scaleMode}
        blockStartMs={block.startMs}
      />
    );
  } else if (block.source.type === 'GENERATED_SHAPE') {
    content = (
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 32,
          background: 'rgba(46, 46, 56, 0.96)',
        }}
      />
    );
  } else {
    const textKey = block.source.textKey;
    const cue = input.payload.editingPlan.onScreenText.find((item) => item.id === textKey);
    content = cue ? (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          fontFamily: 'Inter, Arial, sans-serif',
          fontWeight: 800,
          fontSize: 76,
          lineHeight: 1.04,
          padding: 24,
          color: '#ffffff',
        }}
      >
        {cue.text}
      </div>
    ) : null;
  }

  return (
    <Sequence from={from} durationInFrames={durationInFrames} name={block.id}>
      <div
        style={{
          ...regionStyle(block.composition.region),
          zIndex: block.zIndex,
          opacity: block.composition.opacity,
        }}
      >
        <MotionSurface presetKey={block.composition.motionPresetKey} purpose={block.purpose}>
          {content}
        </MotionSurface>
      </div>
    </Sequence>
  );
}

function PresenterLayer(input: {
  payload: ValidatedRenderPayload;
  cue: ValidatedRenderPayload['editingPlan']['presenter'][number];
}) {
  const { fps } = useVideoConfig();
  const from = Math.floor((input.cue.startMs * fps) / 1_000);
  const end = Math.ceil((input.cue.endMs * fps) / 1_000);
  const asset = assetFor(input.payload, input.cue.assetId);
  if (!asset) return null;

  return (
    <Sequence
      from={from}
      durationInFrames={Math.max(1, end - from)}
      name={`presenter-${input.cue.assetId}`}
    >
      <div style={{ ...regionStyle(input.cue.region), zIndex: 600 }}>
        <OffthreadVideo
          src={asset.localUri}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          muted
          transparent
          crossOrigin="anonymous"
          {...sourceTrimFrames(input.payload, input.cue.assetId, fps)}
        />
      </div>
    </Sequence>
  );
}

function EditorialTextLayer(input: {
  cue: ValidatedRenderPayload['editingPlan']['onScreenText'][number];
}) {
  const { fps } = useVideoConfig();
  const from = Math.floor((input.cue.startMs * fps) / 1_000);
  const end = Math.ceil((input.cue.endMs * fps) / 1_000);

  return (
    <Sequence from={from} durationInFrames={Math.max(1, end - from)} name={input.cue.id}>
      <div
        style={{
          ...regionStyle(input.cue.region),
          zIndex: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: input.cue.role === 'CTA' ? 66 : 74,
          fontWeight: 850,
          lineHeight: 1.02,
          textAlign: 'center',
          textShadow: '0 4px 18px rgba(0,0,0,0.55)',
        }}
      >
        <MotionSurface
          presetKey={input.cue.motionPresetKey}
          purpose={`editorial-${input.cue.role}`}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {input.cue.text}
          </div>
        </MotionSurface>
      </div>
    </Sequence>
  );
}

function CaptionText(input: {
  text: string;
  emphasisRanges: readonly Readonly<{ start: number; end: number; kind: 'KEYWORD' }>[];
}) {
  if (input.emphasisRanges.length === 0) return <>{input.text}</>;

  const ranges = [...input.emphasisRanges]
    .map((range) => ({
      start: Math.max(0, Math.min(input.text.length, range.start)),
      end: Math.max(0, Math.min(input.text.length, range.end)),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) parts.push(input.text.slice(cursor, range.start));
    if (range.start >= cursor) {
      parts.push(
        <span key={`${range.start}-${range.end}-${index}`} style={{ color: '#f5d565' }}>
          {input.text.slice(range.start, range.end)}
        </span>,
      );
      cursor = range.end;
    }
  });
  if (cursor < input.text.length) parts.push(input.text.slice(cursor));
  return <>{parts}</>;
}

function CaptionLayer(input: { cue: ValidatedRenderPayload['editingPlan']['captions'][number] }) {
  const { fps } = useVideoConfig();
  const from = Math.floor((input.cue.startMs * fps) / 1_000);
  const end = Math.ceil((input.cue.endMs * fps) / 1_000);

  return (
    <Sequence from={from} durationInFrames={Math.max(1, end - from)} name={input.cue.id}>
      <AbsoluteFill style={{ zIndex: 900, justifyContent: 'flex-end', alignItems: 'center' }}>
        <div
          style={{
            width: '88%',
            marginBottom: '10%',
            padding: '18px 26px',
            borderRadius: 24,
            background: 'rgba(0,0,0,0.66)',
            color: '#ffffff',
            fontFamily: 'Inter, Arial, sans-serif',
            fontWeight: 800,
            fontSize: 62,
            lineHeight: 1.08,
            textAlign: 'center',
            textShadow: '0 3px 12px rgba(0,0,0,0.65)',
          }}
        >
          <CaptionText text={input.cue.text} emphasisRanges={input.cue.emphasisRanges} />
        </div>
      </AbsoluteFill>
    </Sequence>
  );
}

function AudioLayers(input: { payload: ValidatedRenderPayload }) {
  const { fps } = useVideoConfig();
  const plan = input.payload.editingPlan.audio;
  const nodes: ReactNode[] = [];

  if (plan.voice) {
    const asset = assetFor(input.payload, plan.voice.assetId);
    if (asset)
      nodes.push(
        <Html5Audio
          key="voice"
          src={asset.localUri}
          volume={dbToLinear(plan.voice.gainDb)}
          crossOrigin="anonymous"
          {...sourceTrimFrames(input.payload, asset.assetId, fps)}
        />,
      );
  }

  if (plan.music) {
    const asset = assetFor(input.payload, plan.music.assetId);
    if (asset) {
      const from = Math.floor((plan.music.startMs * fps) / 1_000);
      const end =
        plan.music.endMs !== undefined
          ? Math.ceil((plan.music.endMs * fps) / 1_000)
          : Math.ceil((input.payload.editingPlan.masterDurationMs * fps) / 1_000);

      nodes.push(
        <Sequence key="music-sequence" from={from} durationInFrames={Math.max(1, end - from)}>
          <Html5Audio
            src={asset.localUri}
            volume={dbToLinear(
              plan.voice && plan.ducking
                ? Math.min(plan.music.gainDb, plan.ducking.musicUnderVoiceDb)
                : plan.music.gainDb,
            )}
            crossOrigin="anonymous"
            {...sourceTrimFrames(input.payload, asset.assetId, fps)}
          />
        </Sequence>,
      );
    }
  }

  plan.sfx.forEach((event, index) => {
    const asset = assetFor(input.payload, event.assetId);
    if (!asset) return;

    nodes.push(
      <Sequence
        key={`sfx-${index}`}
        from={Math.floor((event.atMs * fps) / 1_000)}
        name={`sfx-${event.purpose}`}
      >
        <Html5Audio
          src={asset.localUri}
          volume={dbToLinear(event.gainDb)}
          crossOrigin="anonymous"
          {...sourceTrimFrames(input.payload, asset.assetId, fps)}
        />
      </Sequence>,
    );
  });

  return <>{nodes}</>;
}

function TransitionLayers(input: { payload: ValidatedRenderPayload }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <>
      {input.payload.editingPlan.transitions.map((transition, index) => {
        if (transition.presetKey === 'CUT' || transition.presetKey === 'MATCH_CUT') return null;

        const center = (transition.atMs * fps) / 1_000;
        const duration = Math.max(1, (transition.durationMs * fps) / 1_000);
        const half = duration / 2;
        const opacity = interpolate(
          frame,
          [center - half, center, center + half],
          [0, transition.presetKey === 'SHORT_FADE' ? 0.32 : 0.18, 0],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          },
        );

        const translate =
          transition.presetKey === 'SLIDE'
            ? interpolate(frame, [center - half, center + half], [5, -5], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })
            : 0;

        return (
          <AbsoluteFill
            key={`${transition.atMs}-${index}`}
            style={{
              zIndex: 950,
              pointerEvents: 'none',
              background:
                transition.presetKey === 'MASK_REVEAL'
                  ? `linear-gradient(90deg, transparent, rgba(255,255,255,${opacity}), transparent)`
                  : `rgba(0,0,0,${opacity})`,
              transform: translate ? `translateX(${translate}%)` : undefined,
            }}
          />
        );
      })}
    </>
  );
}

export function VisionComposition(payload: ValidatedRenderPayload) {
  const blocks = [...payload.editingPlan.timeline].sort(
    (a, b) => a.zIndex - b.zIndex || a.startMs - b.startMs || a.id.localeCompare(b.id),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#09090b', overflow: 'hidden' }}>
      {blocks.map((block) => (
        <TimelineLayer key={block.id} payload={payload} block={block} />
      ))}

      {payload.editingPlan.presenter.map((cue, index) => (
        <PresenterLayer
          key={`${cue.assetId}-${cue.startMs}-${index}`}
          payload={payload}
          cue={cue}
        />
      ))}

      {payload.editingPlan.onScreenText.map((cue) => (
        <EditorialTextLayer key={cue.id} cue={cue} />
      ))}

      {payload.editingPlan.captions.map((cue) => (
        <CaptionLayer key={cue.id} cue={cue} />
      ))}

      <TransitionLayers payload={payload} />
      <AudioLayers payload={payload} />
    </AbsoluteFill>
  );
}
