import { describe, expect, it, vi } from 'vitest';
import { loadChannels, openPreview, previewProfile } from './livePreview';

describe('Live TV preview negotiation', () => {
    it('never advertises native-only audio or direct-play formats', () => {
        const profile = previewProfile(() => true);
        expect(profile.DirectPlayProfiles).toEqual([]);
        expect(profile.TranscodingProfiles[0]).toMatchObject({ VideoCodec: 'h264', AudioCodec: 'aac', MaxAudioChannels: '2' });
    });
    it('supports the open-codec Qt build without pretending it decodes H264', () => {
        expect(previewProfile(type => /vp09|opus/.test(type)).TranscodingProfiles[0])
            .toMatchObject({ Container: 'mp4', VideoCodec: 'vp9', AudioCodec: 'opus' });
        expect(() => previewProfile(() => false)).toThrow();
    });
    const client = result => ({
        getUrl: (path, query) => path + (query ? '?liveStreamId=' + query.liveStreamId : ''),
        getCurrentUserId: () => 'user', ajax: vi.fn().mockResolvedValue(result)
    });
    it('opens an authenticated server-proxied HLS stream and retains its close identifiers', async () => {
        const api = client({ PlaySessionId: 'session', MediaSources: [{ TranscodingUrl: 'Videos/channel/master.m3u8', TranscodingSubProtocol: 'hls', LiveStreamId: 'live' }] });
        const stream = await openPreview(api, 'channel', previewProfile(() => true));
        expect(stream).toMatchObject({ playSessionId: 'session', liveStreamId: 'live' });
        expect(JSON.parse(api.ajax.mock.calls[0][0].data)).toMatchObject({ IsPlayback: true, AutoOpenLiveStream: true, EnableDirectPlay: false, EnableDirectStream: false });
    });
    it('closes an opened tuner when negotiation fails', async () => {
        const api = client({ MediaSources: [{ LiveStreamId: 'rejected' }] });
        await expect(openPreview(api, 'channel', previewProfile(() => true))).rejects.toThrow();
        expect(api.ajax.mock.calls[1][0]).toMatchObject({ url: 'LiveStreams/Close?liveStreamId=rejected', type: 'POST' });
    });
    it('includes channels beyond the first 1000', async () => {
        const api = { getLiveTvChannels: vi.fn().mockResolvedValueOnce({ Items: Array.from({ length: 1000 }, (_, Id) => ({ Id })), TotalRecordCount: 1001 }).mockResolvedValueOnce({ Items: [{ Id: 1000 }], TotalRecordCount: 1001 }) };
        expect((await loadChannels(api, {})).Items).toHaveLength(1001);
        expect(api.getLiveTvChannels.mock.calls[1][0].StartIndex).toBe(1000);
    });
});
