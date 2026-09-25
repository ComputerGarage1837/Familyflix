// The guide's HTML video must not inherit mpv's much broader codec support.
export function previewProfile(isTypeSupported) {
    const avc = isTypeSupported('video/mp4; codecs="avc1.42E01E"')
        && isTypeSupported('audio/mp4; codecs="mp4a.40.2"');
    const vp9 = isTypeSupported('video/mp4; codecs="vp09.00.10.08"')
        && isTypeSupported('audio/mp4; codecs="opus"');
    if (!avc && !vp9) throw new Error('This client cannot decode an embedded live preview');
    return {
        Name: 'Family Flix Live Preview',
        MaxStreamingBitrate: 12000000,
        DirectPlayProfiles: [],
        TranscodingProfiles: [{
            Type: 'Video', Protocol: 'hls', Container: avc ? 'ts' : 'mp4',
            VideoCodec: avc ? 'h264' : 'vp9', AudioCodec: avc ? 'aac' : 'opus',
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
