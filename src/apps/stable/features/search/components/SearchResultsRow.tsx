import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import React, { type FC, useEffect, useMemo, useRef } from 'react';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import { captureFamilyBrowseFocus, restoreFamilyBrowseFocus } from 'familyflix/browseRecovery';
import type { CardOptions } from 'types/cardOptions';
import 'elements/emby-scroller/emby-scroller';
import 'elements/emby-itemscontainer/emby-itemscontainer';

// There seems to be some compatibility issues here between
// React and our legacy web components, so we need to inject
// them as an html string for now =/
const createScroller = ({ title = '' }) => ({
    __html: `<h2 class="sectionTitle sectionTitle-cards focuscontainer-x padded-left padded-right">${title}</h2>
    <div is="emby-scroller" data-horizontal="true" data-centerfocus="card" class="padded-top-focusscale padded-bottom-focusscale">
    <div is="emby-itemscontainer" class="focuscontainer-x itemsContainer scrollSlider"></div>
</div>`
});

interface SearchResultsRowProps {
    title?: string;
    items?: BaseItemDto[];
    cardOptions?: CardOptions;
}

const SearchResultsRow: FC<SearchResultsRowProps> = ({ title, items = [], cardOptions = {} }) => {
    const element = useRef<HTMLDivElement>(null);
    const scroller = useMemo(() => createScroller({ title }), [title]);

    useEffect(() => {
        const container = element.current?.querySelector<HTMLElement>('.itemsContainer');
        if (!container) return;
        const focus = captureFamilyBrowseFocus(container);
        cardBuilder.buildCards(items, {
            itemsContainer: container,
            ...cardOptions
        });
        restoreFamilyBrowseFocus(container, focus);
    }, [cardOptions, items]);

    return (
        <div
            ref={element}
            className='verticalSection'
            dangerouslySetInnerHTML={scroller}
        />
    );
};

export default React.memo(SearchResultsRow, (previous, next) => previous.title === next.title
    && previous.items === next.items && JSON.stringify(previous.cardOptions) === JSON.stringify(next.cardOptions));
