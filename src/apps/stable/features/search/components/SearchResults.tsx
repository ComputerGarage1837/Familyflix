import React, { type FC, useCallback, useState } from 'react';
import { useSearchItems } from '../api/useSearchItems';
import globalize from 'lib/globalize';
import Loading from 'components/loading/LoadingComponent';
import SearchResultsRow from './SearchResultsRow';
import { CardShape } from 'utils/card';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import { Section } from '../types';
import { Link } from 'react-router-dom';
import type { FamilySearchFilter } from 'familyflix/videoPolicy';

interface SearchResultsProps {
    parentId?: string;
    collectionType?: CollectionType;
    query?: string;
}

/*
 * React component to display search result rows for global search and library view search
 */
const SearchResults: FC<SearchResultsProps> = ({
    parentId,
    collectionType,
    query
}) => {
    const [filter, setFilter] = useState<FamilySearchFilter>('video');
    const { data, isPending, isError, retry, refresh } = useSearchItems(parentId, collectionType, query?.trim(), filter);
    const onFilterClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        setFilter(event.currentTarget.value as FamilySearchFilter);
    }, []);
    const onRetryClick = useCallback(() => {
        if (!isPending) void (isError ? retry() : refresh());
    }, [isPending, isError, retry, refresh]);

    const renderSection = (section: Section) => {
        return (
            <SearchResultsRow
                key={section.title}
                title={globalize.translate(section.title)}
                items={section.items}
                cardOptions={{
                    shape: CardShape.AutoOverflow,
                    scalable: true,
                    showTitle: true,
                    overlayText: false,
                    centerText: true,
                    allowBottomPadding: false,
                    ...section.cardOptions
                }}
            />
        );
    };

    return (
        <div className={'searchResults padded-top padded-bottom-page'}>
            <div className='padded-left padded-right focuscontainer-x' aria-label='Search categories'>
                {([
                    ['video', 'Movies, shows & episodes'], ['people', 'People'],
                    ['playlists', 'Playlists'], ['collections', 'Collections'], ['other', 'Other media']
                ] as const).map(([value, label]) => (
                    <button key={value} type='button' className='emby-button button-raised' value={value}
                        aria-pressed={filter === value} onClick={onFilterClick}>{label}</button>
                ))}
            </div>
            {query?.trim() && <div className='padded-left padded-right'>
                {isError && <p role='status'>Some results could not be loaded. Existing results are still available.</p>}
                <button type='button' className='emby-button button-raised' aria-label='Retry or refresh search'
                    aria-disabled={isPending} onClick={onRetryClick}>
                    {isError ? 'Retry search' : 'Refresh search'}
                </button>
            </div>}
            {isPending && (data.length ? <p className='padded-left' role='status'>Loading remaining results…</p> : <Loading />)}
            {!isPending && !isError && !data.length && <div className='noItemsMessage centerMessage'>
                {globalize.translate('SearchResultsEmpty', query)}
                {collectionType && <div><Link className='emby-button'
                    to={`/search?query=${encodeURIComponent(query || '')}`}>{globalize.translate('RetryWithGlobalSearch')}</Link></div>}
            </div>}
            {data.map(renderSection)}
        </div>
    );
};

export default SearchResults;
