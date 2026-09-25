// The guide's HTML video must not inherit mpv's much broader codec support.
export function previewProfile(isTypeSupported) {
    const avc = isTypeSupported('video/mp4; codecs="avc1.42E01E"')
        && isTypeSupported('audio/mp4; codecs="mp4a.40.2"');
    const webm = isTypeSupported('video/webm; codecs="vp8,opus"');
    if (!avc && !webm) throw new Error('This client cannot decode an embedded live preview');
    return {
        Name: 'Family Flix Live Preview',
        MaxStreamingBitrate: 12000000,
        DirectPlayProfiles: [],
        TranscodingProfiles: [{
            Type: 'Video', Context: 'Streaming', Protocol: avc ? 'hls' : 'http', Container: avc ? 'ts' : 'webm',
            VideoCodec: avc ? 'h264' : 'vp8', AudioCodec: avc ? 'aac' : 'opus',
            MaxAudioChannels: '2', MinSegments: 2, BreakOnNonKeyFrames: true
        }],
        CodecProfiles: [], SubtitleProfiles: []
    };
}

export async function openPreview(apiClient, channelId, profile) {
    const result = await apiClient.ajax({
        url: apiClient.getUrl('Items/' + channelId + '/PlaybackInfo'),
        type: 'POST', contentType: 'application/json', dataType: 'json',
        data: JSON.stringify({
            UserId: apiClient.getCurrentUserId(), DeviceProfile: profile,
            IsPlayback: true, AutoOpenLiveStream: true,
            EnableDirectPlay: false, EnableDirectStream: false,
            MaxStreamingBitrate: profile.MaxStreamingBitrate
        })
    });
    const source = result.MediaSources?.[0];
    if (profile.TranscodingProfiles[0].Container === 'webm' && source?.LiveStreamId && source.SupportsTranscoding) {
        // Jellyfin's live source prefers its TS profile even when WebM was
        // negotiated. Explicitly request its standard progressive endpoint.
        return {
            url: apiClient.getUrl('Videos/' + channelId + '/stream.webm', {
                ApiKey: apiClient.accessToken(), DeviceId: apiClient.deviceId(),
                MediaSourceId: source.Id, LiveStreamId: source.LiveStreamId,
                PlaySessionId: result.PlaySessionId, Static: false,
                VideoCodec: 'vp8', AudioCodec: 'opus', MaxWidth: 640, MaxHeight: 360,
                MaxFramerate: 25, VideoBitRate: 800000, AudioBitRate: 96000,
                AudioChannels: 2, TranscodingMaxAudioChannels: 2,
                EnableAutoStreamCopy: false, AllowVideoStreamCopy: false, AllowAudioStreamCopy: false
            }),
            mimeType: 'video/webm', playSessionId: result.PlaySessionId, liveStreamId: source.LiveStreamId
        };
    }
    if (!source?.TranscodingUrl || source.TranscodingSubProtocol !== 'hls') {
        await Promise.allSettled((result.MediaSources || []).filter(s => s.LiveStreamId).map(s => apiClient.ajax({
            url: apiClient.getUrl('LiveStreams/Close', { liveStreamId: s.LiveStreamId }), type: 'POST'
        })));
        throw new Error('Server could not prepare a compatible live preview');
    }
    return {
        url: apiClient.getUrl(source.TranscodingUrl), mimeType: 'application/x-mpegURL',
        playSessionId: result.PlaySessionId, liveStreamId: source.LiveStreamId
    };
}

export async function loadChannels(apiClient, query) {
    const items = [];
    const limit = 1000;
    for (;;) {
        const result = await apiClient.getLiveTvChannels({ ...query, StartIndex: items.length, Limit: limit });
        const page = result.Items || [];
        items.push(...page);
        if (page.length < limit || (result.TotalRecordCount > 0 && items.length >= result.TotalRecordCount)) break;
    }
    return { Items: items, TotalRecordCount: items.length };
}
