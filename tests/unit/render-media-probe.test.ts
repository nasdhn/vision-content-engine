import { expect, it } from 'vitest';

import { parseProbe } from '../../packages/media/src/index.js';

const hlg = {
  format: { format_name: 'mov,mp4', duration: '1' },
  streams: [
    {
      codec_type: 'video',
      codec_name: 'hevc',
      width: 1080,
      height: 1920,
      avg_frame_rate: '30/1',
      pix_fmt: 'yuv420p10le',
      color_primaries: 'bt2020',
      color_transfer: 'arib-std-b67',
      color_space: 'bt2020nc',
    },
  ],
};

it('keeps upload probing fail-closed while render probing can classify HDR for normalization', () => {
  expect(() => parseProbe(hlg)).toThrow('UNSUPPORTED_HDR_COLOR');
  expect(parseProbe(hlg, { allowHdr: true }).video?.color).toMatchObject({ hdrKind: 'HLG' });
});
