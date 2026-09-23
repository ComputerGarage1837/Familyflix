#pragma once

#include <QObject>
#include <QByteArray>
#include <QDateTime>
#include <QColor>
#include <QNetworkAccessManager>
#include <QSettings>
#include <QStringList>
#include <QSet>
#include <QVariantList>
#include <QVariantMap>
#include <functional>
#include <memory>

// Native Windows data source. It deliberately does not use the server web client.
class FamilyApiClient final : public QObject
{
  Q_OBJECT
  Q_PROPERTY(bool signedIn READ signedIn NOTIFY sessionChanged)
  Q_PROPERTY(QString userName READ userName NOTIFY sessionChanged)
  Q_PROPERTY(QVariantList publicUsers READ publicUsers NOTIFY publicUsersChanged)
  Q_PROPERTY(QVariantList coWatchProfiles READ coWatchProfiles NOTIFY coWatchChanged)
  Q_PROPERTY(bool watchingTogether READ watchingTogether NOTIFY coWatchChanged)
  Q_PROPERTY(QString coWatchLabel READ coWatchLabel NOTIFY coWatchChanged)
  Q_PROPERTY(QString homeFeedOwnerId READ homeFeedOwnerId NOTIFY coWatchChanged)
  Q_PROPERTY(bool combinedGroupDeckEnabled READ combinedGroupDeckEnabled NOTIFY coWatchChanged)
  Q_PROPERTY(QVariantList groupDeckItems READ groupDeckItems NOTIFY homeChanged)
  Q_PROPERTY(bool kidsModeEnabled READ kidsModeEnabled NOTIFY kidsSettingsChanged)
  Q_PROPERTY(bool kidsHideSpoilers READ kidsHideSpoilers NOTIFY kidsSettingsChanged)
  Q_PROPERTY(int kidsEpisodeLimit READ kidsEpisodeLimit NOTIFY kidsSettingsChanged)
  Q_PROPERTY(int kidsBedtimeStart READ kidsBedtimeStart NOTIFY kidsSettingsChanged)
  Q_PROPERTY(bool kidsHasPin READ kidsHasPin NOTIFY kidsSettingsChanged)
  Q_PROPERTY(QString nextUpMode READ nextUpMode NOTIFY nextUpModeChanged)
  Q_PROPERTY(bool mediaQueuingEnabled READ mediaQueuingEnabled NOTIFY nextUpModeChanged)
  Q_PROPERTY(bool backdropEnabled READ backdropEnabled NOTIFY profileAppearanceChanged)
  Q_PROPERTY(QString clockBehavior READ clockBehavior NOTIFY profileAppearanceChanged)
  Q_PROPERTY(QVariantList coWatchPresets READ coWatchPresets NOTIFY coWatchPresetsChanged)
  Q_PROPERTY(QVariantList familyNightCandidates READ familyNightCandidates NOTIFY familyNightChanged)
  Q_PROPERTY(bool familyNightLoading READ familyNightLoading NOTIFY familyNightChanged)
  Q_PROPERTY(QVariantList libraries READ libraries NOTIFY homeChanged)
  Q_PROPERTY(QVariantList railLibraries READ railLibraries NOTIFY homeChanged)
  Q_PROPERTY(QVariantList continueItems READ continueItems NOTIFY homeChanged)
  Q_PROPERTY(QVariantList deckItems READ deckItems NOTIFY homeChanged)
  Q_PROPERTY(QVariantList libraryRows READ libraryRows NOTIFY homeChanged)
  Q_PROPERTY(QStringList homeRowOrder READ homeRowOrder NOTIFY homeChanged)
  Q_PROPERTY(QStringList hiddenHomeRows READ hiddenHomeRows NOTIFY homeChanged)
  Q_PROPERTY(QVariantList homeLayoutRows READ homeLayoutRows NOTIFY homeChanged)
  Q_PROPERTY(QVariantMap selectedLibrary READ selectedLibrary NOTIFY libraryBrowseChanged)
  Q_PROPERTY(QVariantList libraryItems READ libraryItems NOTIFY libraryBrowseChanged)
  Q_PROPERTY(bool libraryHasMore READ libraryHasMore NOTIFY libraryBrowseChanged)
  Q_PROPERTY(bool libraryLoading READ libraryLoading NOTIFY libraryBrowseChanged)
  Q_PROPERTY(QVariantMap selectedItem READ selectedItem NOTIFY selectedItemChanged)
  Q_PROPERTY(QVariantList selectedCast READ selectedCast NOTIFY selectedCastChanged)
  Q_PROPERTY(QVariantMap selectedIssueSummary READ selectedIssueSummary NOTIFY selectedIssueSummaryChanged)
  Q_PROPERTY(QVariantList watchlistEntries READ watchlistEntries NOTIFY watchlistChanged)
  Q_PROPERTY(QVariantList watchlistItems READ watchlistItems NOTIFY watchlistChanged)
  Q_PROPERTY(QVariantList householdWatchlistEntries READ householdWatchlistEntries NOTIFY watchlistChanged)
  Q_PROPERTY(QVariantList householdWatchlistItems READ householdWatchlistItems NOTIFY watchlistChanged)
  Q_PROPERTY(QVariantList seasons READ seasons NOTIFY seriesChanged)
  Q_PROPERTY(QVariantList episodes READ episodes NOTIFY seriesChanged)
  Q_PROPERTY(QVariantList seasonCast READ seasonCast NOTIFY seriesChanged)
  Q_PROPERTY(QVariantList playlists READ playlists NOTIFY playlistsChanged)
  Q_PROPERTY(QVariantList playlistItems READ playlistItems NOTIFY playlistsChanged)
  Q_PROPERTY(bool playlistLoading READ playlistLoading NOTIFY playlistsChanged)
  Q_PROPERTY(QString selectedPlaylistId READ selectedPlaylistId NOTIFY playlistsChanged)
  Q_PROPERTY(QVariantList tvCategories READ tvCategories NOTIFY liveTvChanged)
  Q_PROPERTY(QVariantList tvChannels READ tvChannels NOTIFY liveTvChanged)
  Q_PROPERTY(QVariantList tvPrograms READ tvPrograms NOTIFY liveTvChanged)
  Q_PROPERTY(QVariantList mediaSegments READ mediaSegments NOTIFY mediaSegmentsChanged)
  Q_PROPERTY(QString activeSeriesAutoplayMode READ activeSeriesAutoplayMode NOTIFY seriesPlaybackPreferencesChanged)
  Q_PROPERTY(QString activeSeriesIntroSkipMode READ activeSeriesIntroSkipMode NOTIFY seriesPlaybackPreferencesChanged)
  Q_PROPERTY(bool activeSeriesPreferencesReady READ activeSeriesPreferencesReady NOTIFY seriesPlaybackPreferencesChanged)
  Q_PROPERTY(bool activeSeriesPreferencesBusy READ activeSeriesPreferencesBusy NOTIFY seriesPlaybackPreferencesChanged)
  Q_PROPERTY(QVariantMap activeSeriesPlaybackValues READ activeSeriesPlaybackValues NOTIFY seriesPlaybackPreferencesChanged)
  Q_PROPERTY(QString themeName READ themeName NOTIFY themeChanged)
  Q_PROPERTY(QColor themeScreen READ themeScreen NOTIFY themeChanged)
  Q_PROPERTY(QColor themeSurface READ themeSurface NOTIFY themeChanged)
  Q_PROPERTY(QColor themeAccent READ themeAccent NOTIFY themeChanged)
  Q_PROPERTY(QColor themeAccentSecondary READ themeAccentSecondary NOTIFY themeChanged)
  Q_PROPERTY(QColor themeText READ themeText NOTIFY themeChanged)
  Q_PROPERTY(QColor themeOnAccent READ themeOnAccent NOTIFY themeChanged)
  Q_PROPERTY(QVariantList themeOptions READ themeOptions CONSTANT)
  Q_PROPERTY(QVariantMap windowsUpdate READ windowsUpdate NOTIFY windowsUpdateChanged)

public:
  explicit FamilyApiClient(QObject* parent = nullptr);

  bool signedIn() const { return !m_token.isEmpty() && !m_userId.isEmpty(); }
  QString userName() const { return m_userName; }
  QVariantList publicUsers() const { return m_publicUsers; }
  QVariantList coWatchProfiles() const;
  bool watchingTogether() const { return !m_coWatchUserIds.isEmpty(); }
  QString coWatchLabel() const;
  QString homeFeedOwnerId() const { return m_homeFeedOwnerId; }
  bool combinedGroupDeckEnabled() const { return m_combinedGroupDeckEnabled; }
  QVariantList groupDeckItems() const { return m_groupDeckItems; }
  bool kidsModeEnabled() const { return m_kidsEnabled; }
  bool kidsHideSpoilers() const { return m_kidsHideSpoilers; }
  int kidsEpisodeLimit() const { return m_kidsEpisodeLimit; }
  int kidsBedtimeStart() const { return m_kidsBedtimeStart; }
  bool kidsHasPin() const { return !m_kidsPinSalt.isEmpty() && !m_kidsPinHash.isEmpty(); }
  QString nextUpMode() const { return m_nextUpMode; }
  bool mediaQueuingEnabled() const { return m_mediaQueuingEnabled; }
  bool backdropEnabled() const { return m_backdropEnabled; }
  QString clockBehavior() const { return m_clockBehavior; }
  QVariantList coWatchPresets() const { return m_coWatchPresets; }
  QVariantList familyNightCandidates() const { return m_familyNightCandidates; }
  bool familyNightLoading() const { return m_familyNightLoading; }
  QVariantList libraries() const { return m_libraries; }
  QVariantList railLibraries() const;
  QVariantList continueItems() const { return m_continueItems; }
  QVariantList deckItems() const { return m_deckItems; }
  QVariantList libraryRows() const { return m_libraryRows; }
  QStringList homeRowOrder() const { return m_homeRowOrder; }
  QStringList hiddenHomeRows() const { return m_hiddenHomeRows; }
  QVariantList homeLayoutRows() const;
  QVariantMap selectedLibrary() const { return m_selectedLibrary; }
  QVariantList libraryItems() const { return m_libraryItems; }
  bool libraryHasMore() const { return m_libraryHasMore; }
  bool libraryLoading() const { return m_libraryLoading; }
  QVariantMap selectedItem() const { return m_selectedItem; }
  QVariantList selectedCast() const { return m_selectedCast; }
  QVariantMap selectedIssueSummary() const { return m_selectedIssueSummary; }
  QVariantList watchlistEntries() const { return m_watchlistEntries; }
  QVariantList watchlistItems() const { return m_watchlistItems; }
  QVariantList householdWatchlistEntries() const { return m_householdWatchlistEntries; }
  QVariantList householdWatchlistItems() const { return m_householdWatchlistItems; }
  QVariantList seasons() const { return m_seasons; }
  QVariantList episodes() const { return m_episodes; }
  QVariantList seasonCast() const { return m_seasonCast; }
  QVariantList playlists() const { return m_playlists; }
  QVariantList playlistItems() const { return m_playlistItems; }
  bool playlistLoading() const { return m_playlistLoading; }
  QString selectedPlaylistId() const { return m_selectedPlaylistId; }
  QVariantList tvCategories() const { return m_tvCategories; }
  QVariantList tvChannels() const { return m_tvChannels; }
  QVariantList tvPrograms() const { return m_tvPrograms; }
  QVariantList mediaSegments() const { return m_mediaSegments; }
  QString activeSeriesAutoplayMode() const { return m_activeSeriesAutoplayMode; }
  QString activeSeriesIntroSkipMode() const { return m_activeSeriesIntroSkipMode; }
  bool activeSeriesPreferencesReady() const { return m_activeSeriesPreferencesReady; }
  bool activeSeriesPreferencesBusy() const { return m_activeSeriesPreferencesWriteActive; }
  QVariantMap activeSeriesPlaybackValues() const { return m_activeSeriesValues; }
  QString themeName() const { return m_themeName; }
  QColor themeScreen() const;
  QColor themeSurface() const;
  QColor themeAccent() const;
  QColor themeAccentSecondary() const;
  QColor themeText() const;
  QColor themeOnAccent() const;
  QVariantList themeOptions() const;
  QVariantMap windowsUpdate() const { return m_windowsUpdate; }

  Q_INVOKABLE void refreshPublicUsers();
  Q_INVOKABLE void signIn(const QString& userName, const QString& password);
  Q_INVOKABLE bool hasSavedProfile(const QString& userId) const;
  Q_INVOKABLE void useSavedProfile(const QString& userId);
  Q_INVOKABLE void authenticateParticipant(const QString& userId, const QString& password);
  Q_INVOKABLE bool setCoWatchProfile(const QString& userId, bool selected);
  Q_INVOKABLE void setHomeFeedOwner(const QString& userId);
  Q_INVOKABLE void setCombinedGroupDeckEnabled(bool enabled);
  Q_INVOKABLE void setKidsModeEnabled(bool enabled);
  Q_INVOKABLE void setKidsHideSpoilers(bool hidden);
  Q_INVOKABLE void cycleKidsEpisodeLimit();
  Q_INVOKABLE void cycleKidsBedtime();
  Q_INVOKABLE bool setKidsPin(const QString& pin);
  Q_INVOKABLE bool verifyKidsPin(const QString& pin) const;
  Q_INVOKABLE bool kidsPlaybackAllowed() const;
  Q_INVOKABLE bool kidsSpoilerHidden(const QVariantMap& item) const;
  Q_INVOKABLE void cycleNextUpMode();
  Q_INVOKABLE void toggleBackdropEnabled();
  Q_INVOKABLE void cycleClockBehavior();
  Q_INVOKABLE void stopWatchingTogether();
  Q_INVOKABLE void refreshCoWatchPresets();
  Q_INVOKABLE void saveCoWatchPreset(const QString& name);
  Q_INVOKABLE bool activateCoWatchPreset(const QString& presetId);
  Q_INVOKABLE void deleteCoWatchPreset(const QString& presetId);
  Q_INVOKABLE void refreshFamilyNightCandidates();
  Q_INVOKABLE int familyNightRequiredAge(const QString& rating) const;
  Q_INVOKABLE void resolveFirstUnwatchedEpisode(const QString& seriesId);
  Q_INVOKABLE void resolvePlayableItem(const QString& itemId);
  Q_INVOKABLE void resolveNextEpisode(const QVariantMap& currentEpisode);
  Q_INVOKABLE void signOut();
  Q_INVOKABLE void refreshHome();
  Q_INVOKABLE void openLibrary(const QVariantMap& library);
  Q_INVOKABLE void loadMoreLibrary();
  Q_INVOKABLE bool libraryVisibleInRail(const QString& libraryId) const;
  Q_INVOKABLE void setLibraryVisibleInRail(const QString& libraryId, bool visible);
  Q_INVOKABLE void moveLibrary(const QString& libraryId, int offset);
  Q_INVOKABLE QString homeRowIdForLibrary(const QString& libraryId) const;
  Q_INVOKABLE void setHomeRowVisible(const QString& rowId, bool visible);
  Q_INVOKABLE void moveHomeRow(const QString& rowId, int offset);
  Q_INVOKABLE void openItem(const QString& itemId);
  Q_INVOKABLE void openSeason(const QString& seasonId);
  Q_INVOKABLE void refreshPlaylists();
  Q_INVOKABLE void openPlaylist(const QString& playlistId);
  Q_INVOKABLE void createPlaylist(const QString& name);
  Q_INVOKABLE void createPlaylistAndAdd(const QString& name, const QVariantMap& item);
  Q_INVOKABLE void renamePlaylist(const QString& playlistId, const QString& name);
  Q_INVOKABLE void addToPlaylist(const QString& playlistId, const QVariantMap& item);
  Q_INVOKABLE void removePlaylistEntry(const QString& playlistId, const QString& playlistItemId);
  Q_INVOKABLE void movePlaylistEntry(const QString& playlistId, const QString& playlistItemId, int newIndex);
  Q_INVOKABLE void refreshLiveTv();
  Q_INVOKABLE QVariantList tvChannelsForBand(int band) const;
  Q_INVOKABLE QVariantList tvProgramsForChannel(const QString& channelId) const;
  Q_INVOKABLE void refreshTvGuide(int band, const QDateTime& startUtc);
  Q_INVOKABLE void refreshMediaSegments(const QString& itemId);
  Q_INVOKABLE void refreshSeriesPlaybackPreferences(const QString& seriesId);
  Q_INVOKABLE void setActiveSeriesPlaybackPreference(const QString& key, const QString& value);
  Q_INVOKABLE QString mediaSegmentAction(const QString& type) const;
  Q_INVOKABLE void setMediaSegmentAction(const QString& type, const QString& action);
  Q_INVOKABLE void reportIssue(const QString& itemId, const QString& category, const QString& note);
  Q_INVOKABLE void setTheme(const QString& name);
  Q_INVOKABLE QString imageUrl(const QString& itemId, const QString& kind = QStringLiteral("Primary"),
                               int maxWidth = 640) const;
  Q_INVOKABLE QString streamUrl(const QString& itemId) const;
  Q_INVOKABLE QString temporaryStorageGiB() const;
  Q_INVOKABLE void checkWindowsUpdate(bool manual = false);
  Q_INVOKABLE void dismissWindowsUpdate();
  Q_INVOKABLE void refreshWatchlist();
  Q_INVOKABLE void refreshHouseholdWatchlist();
  Q_INVOKABLE bool isWatchlisted(const QString& itemId) const;
  Q_INVOKABLE bool isHouseholdWatchlisted(const QString& itemId) const;
  Q_INVOKABLE void toggleWatchlist(const QVariantMap& item);
  Q_INVOKABLE void setPlayed(const QVariantMap& item, bool played);
  Q_INVOKABLE void toggleHouseholdWatchlist(const QVariantMap& item);
  Q_INVOKABLE void voteHouseholdWatchlistItem(const QString& itemId, bool voted);
  Q_INVOKABLE void reportPlaybackStart(const QVariantMap& item, qlonglong positionMilliseconds);
  Q_INVOKABLE void reportPlaybackProgress(qlonglong positionMilliseconds, bool paused);
  Q_INVOKABLE void reportPlaybackStopped(qlonglong positionMilliseconds);

signals:
  void sessionChanged();
  void publicUsersChanged();
  void coWatchChanged();
  void kidsSettingsChanged();
  void nextUpModeChanged();
  void profileAppearanceChanged();
  void coWatchPresetsChanged();
  void familyNightChanged();
  void firstUnwatchedEpisodeReady(const QString& seriesId, const QVariantMap& episode);
  void playableItemReady(const QString& itemId, const QVariantMap& item);
  void nextEpisodeReady(const QVariantMap& episode);
  void homeChanged();
  void libraryBrowseChanged();
  void selectedItemChanged();
  void selectedCastChanged();
  void selectedIssueSummaryChanged();
  void watchlistChanged();
  void seriesChanged();
  void playlistsChanged();
  void liveTvChanged();
  void mediaSegmentsChanged();
  void seriesPlaybackPreferencesChanged();
  void issueReportFinished(bool success, const QString& message);
  void themeChanged();
  void windowsUpdateChanged();
  void errorOccurred(const QString& message);

private:
  struct CoWatchPlaybackState {
    QString playSessionId;
    QString itemId;
    QString mediaSourceId;
    QVariantList targets;
    QSet<QString> startedUserIds;
    qlonglong stopMilliseconds = -1;
    bool abandoned = false;
  };
  using ReplyHandler = std::function<void(const QVariant&, const QString&)>;
  using StatusHandler = std::function<void(const QVariant&, const QString&, int)>;
  void request(const QByteArray& method, const QString& path, const QVariantMap& query,
               const QByteArray& body, ReplyHandler handler);
  void requestWithStatus(const QByteArray& method, const QString& path, const QVariantMap& query,
                         const QByteArray& body, StatusHandler handler);
  void requestAs(const QByteArray& method, const QString& path, const QVariantMap& query,
                 const QByteArray& body, const QString& token, const QString& userId,
                 StatusHandler handler);
  static QVariantList items(const QVariant& response);
  static QVariantList untouchedDeck(const QVariantList& response);
  void correctDeckFromRecent();
  void writeWatchlistMembership(quint64 session, bool present, const QVariantMap& entry,
                                const QString& operationId, qlonglong expected, int retries);
  void writeHouseholdMembership(quint64 session, bool present, const QVariantMap& entry,
                                const QString& operationId, qlonglong expected, int retries);
  void writeHouseholdVote(quint64 session, const QString& itemId, bool voted,
                          const QString& operationId, qlonglong expected, int retries);
  void sendPlaybackStopped(qlonglong positionMilliseconds);
  void sendCoWatchStop(const std::shared_ptr<CoWatchPlaybackState>& state,
                       const QVariantMap& target, qlonglong positionMilliseconds);
  void addPlayableIdsToPlaylist(const QString& playlistId, const QStringList& ids);
  void loadPlaylistPage(const QString& playlistId, int startIndex, quint64 session, quint64 loadRevision);
  void activateSession(const QString& token, const QString& userId, const QString& userName);
  void loadCoWatchParty();
  void saveCoWatchParty();
  void reconcileCoWatchParty();
  void mutateCoWatchPresets(const std::function<QVariantList(const QVariantList&)>& transform);
  void refreshGroupDeck(quint64 session, quint64 homeRevision);
  void loadKidsSettings();
  void saveKidsSettings();
  void refreshLibraryMenuPreferences();
  void applyLibraryMenuPreferences(const QVariantMap& customPrefs);
  void changeLibraryMenuPreference(const QString& key, const QString& value);
  void flushLibraryMenuPreferences();
  void refreshProfileSettings();
  void applyProfileSettings(const QVariantMap& values);
  void changeProfileSetting(const QString& key, const QString& value);
  void flushProfileSetting();

  QNetworkAccessManager m_network;
  QSettings m_settings;
  QString m_deviceId;
  QString m_token;
  QString m_userId;
  QString m_userName;
  QStringList m_coWatchUserIds;
  QString m_homeFeedOwnerId;
  bool m_combinedGroupDeckEnabled = true;
  QVariantList m_groupDeckItems;
  quint64 m_groupDeckRevision = 0;
  bool m_kidsEnabled = false;
  bool m_kidsHideSpoilers = true;
  int m_kidsEpisodeLimit = 0;
  int m_kidsBedtimeStart = -1;
  QByteArray m_kidsPinSalt;
  QByteArray m_kidsPinHash;
  QString m_nextUpMode = QStringLiteral("Extended");
  bool m_mediaQueuingEnabled = true;
  bool m_backdropEnabled = true;
  QString m_clockBehavior = QStringLiteral("ALWAYS");
  QVariantMap m_profileSettingsValues;
  QVariantMap m_pendingProfileSettings;
  bool m_profileSettingsWriteActive = false;
  bool m_profileSettingsReady = false;
  quint64 m_profileSettingsRevision = 0;
  QString m_homeFeedUserId;
  QString m_homeFeedToken;
  QVariantList m_coWatchPresets;
  quint64 m_coWatchPresetRevision = 0;
  bool m_coWatchPresetMutationBusy = false;
  QVariantList m_familyNightCandidates;
  QVariantMap m_windowsUpdate;
  bool m_windowsUpdateCheckActive = false;
  bool m_familyNightLoading = false;
  quint64 m_familyNightRevision = 0;
  QVariantList m_publicUsers;
  QVariantList m_libraries;
  QVariantMap m_libraryMenuPrefsValues;
  QVariantMap m_libraryMenuPending;
  bool m_libraryMenuPrefsReady = false;
  bool m_libraryMenuWriteActive = false;
  quint64 m_libraryMenuPrefsRevision = 0;
  QVariantList m_continueItems;
  QVariantList m_deckItems;
  QVariantList m_recentDeckActivity;
  bool m_deckFallbackReady = false;
  bool m_recentDeckActivityReady = false;
  bool m_deckCorrectionStarted = false;
  QVariantList m_libraryRows;
  QStringList m_homeRowOrder;
  QStringList m_hiddenHomeRows;
  QVariantMap m_selectedLibrary;
  QVariantList m_libraryItems;
  bool m_libraryHasMore = false;
  bool m_libraryLoading = false;
  quint64 m_libraryBrowseRevision = 0;
  QVariantMap m_selectedItem;
  QVariantList m_selectedCast;
  QVariantMap m_selectedIssueSummary;
  QVariantList m_watchlistEntries;
  QVariantList m_watchlistItems;
  quint64 m_watchlistItemsRevision = 0;
  QVariantList m_householdWatchlistEntries;
  QVariantList m_householdWatchlistItems;
  quint64 m_householdWatchlistItemsRevision = 0;
  QVariantList m_seasons;
  QVariantList m_episodes;
  QVariantList m_seasonCast;
  quint64 m_seasonRevision = 0;
  QVariantList m_playlists;
  QVariantList m_playlistItems;
  QString m_selectedPlaylistId;
  bool m_playlistLoading = false;
  quint64 m_playlistLoadRevision = 0;
  QVariantList m_tvCategories;
  QVariantList m_tvChannels;
  QVariantList m_tvPrograms;
  QVariantList m_mediaSegments;
  QString m_activeSeriesId;
  QString m_activeSeriesIntroSkipMode = QStringLiteral("APP_DEFAULT");
  QString m_activeSeriesAutoplayMode = QStringLiteral("APP_DEFAULT");
  QVariantMap m_activeSeriesValues;
  bool m_activeSeriesPreferencesReady = false;
  bool m_activeSeriesPreferencesWriteActive = false;
  quint64 m_seriesPlaybackPreferencesRevision = 0;
  quint64 m_mediaSegmentsRevision = 0;
  quint64 m_tvGuideRevision = 0;
  QString m_themeName = QStringLiteral("Ocean");
  qlonglong m_watchlistRevision = 0;
  qlonglong m_householdWatchlistRevision = 0;
  quint64 m_sessionRevision = 0;
  quint64 m_profileAttemptRevision = 0;
  quint64 m_homeRevision = 0;
  quint64 m_itemRevision = 0;
  QString m_playingItemId;
  QString m_playSessionId;
  QString m_mediaSourceId;
  bool m_playbackStartConfirmed = false;
  qlonglong m_pendingStopMilliseconds = -1;
  QVariantMap m_queuedPlaybackItem;
  qlonglong m_queuedPlaybackPositionMilliseconds = 0;
  qlonglong m_queuedPlaybackStopMilliseconds = -1;
  std::shared_ptr<CoWatchPlaybackState> m_coWatchPlayback;
};
