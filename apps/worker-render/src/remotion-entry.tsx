import { Composition, registerRoot } from 'remotion';

import type { ValidatedRenderPayload } from '@vision/application';

import { VisionComposition } from './composition.tsx';

type RuntimeProps = Partial<ValidatedRenderPayload>;

const requireRenderPayload = (props: RuntimeProps): ValidatedRenderPayload => {
  if (
    !props.editingPlan ||
    !props.renderSettings ||
    !props.template ||
    !props.provenance ||
    !props.resolvedAssets
  ) {
    throw new Error('RENDER_PAYLOAD_MISSING');
  }

  return props as ValidatedRenderPayload;
};

const compositionKeys = [
  'product-demo-v1',
  'manual-to-vision-v1',
  'problem-solution-v1',
  'green-screen-explainer-v1',
  'founder-story-v1',
] as const;

function RuntimeVisionComposition(props: RuntimeProps) {
  return <VisionComposition {...requireRenderPayload(props)} />;
}

function Root() {
  return (
    <>
      {compositionKeys.map((id) => (
        <Composition
          key={id}
          id={id}
          component={RuntimeVisionComposition}
          defaultProps={{}}
          width={1080}
          height={1920}
          fps={30}
          durationInFrames={30}
          calculateMetadata={({ props }) => {
            const payload = requireRenderPayload(props);
            return {
              width: payload.renderSettings.width,
              height: payload.renderSettings.height,
              fps: payload.renderSettings.fps,
              durationInFrames: Math.max(
                1,
                Math.ceil(
                  (payload.editingPlan.masterDurationMs * payload.renderSettings.fps) / 1_000,
                ),
              ),
            };
          }}
        />
      ))}
    </>
  );
}

registerRoot(Root);
