#pragma once

#include <QObject>
#include <QNetworkAccessManager>
#include <QSettings>
#include <QStringList>
#include <QVariantList>
#include <QVariantMap>
#include <functional>

// Native Windows data source. It deliberately does not use the server web client.
class FamilyApiClient final : public QObject
{
  Q_OBJECT
  Q_PROPERTY(bool signedIn READ signedIn NOTIFY sessionChanged)
  Q_PROPERTY(QString userName READ userName NOTIFY sessionChanged)
  Q_PROPERTY(QVariantList publicUsers READ publicUsers NOTIFY publicUsersChanged)
  Q_PROPERTY(QVariantList libraries READ libraries NOTIFY homeChanged)
  Q_PROPERTY(QVariantList railLibraries READ railLibraries NOTIFY homeChanged)
  Q_PROPERTY(QVariantList continueItems READ continueItems NOTIFY homeChanged)
  Q_PROPERTY(QVariantList deckItems READ deckItems NOTIFY homeChanged)
  Q_PROPERTY(QVariantList libraryRows READ libraryRows NOTIFY homeChanged)
  Q_PROPERTY(QVariantMap selectedItem READ selectedItem NOTIFY selectedItemChanged)
  Q_PROPERTY(QVariantList watchlistEntries READ watchlistEntries NOTIFY watchlistChanged)
  Q_PROPERTY(QVariantList householdWatchlistEntries READ householdWatchlistEntries NOTIFY watchlistChanged)
  Q_PROPERTY(QVariantList seasons READ seasons NOTIFY seriesChanged)
  Q_PROPERTY(QVariantList episodes READ episodes NOTIFY seriesChanged)
  Q_PROPERTY(QVariantList playlists READ playlists NOTIFY playlistsChanged)
  Q_PROPERTY(QVariantList playlistItems READ playlistItems NOTIFY playlistsChanged)
  Q_PROPERTY(QString selectedPlaylistId READ selectedPlaylistId NOTIFY playlistsChanged)

public:
  explicit FamilyApiClient(QObject* parent = nullptr);

  bool signedIn() const { return !m_token.isEmpty() && !m_userId.isEmpty(); }
  QString userName() const { return m_userName; }
  QVariantList publicUsers() const { return m_publicUsers; }
  QVariantList libraries() const { return m_libraries; }
  QVariantList railLibraries() const;
  QVariantList continueItems() const { return m_continueItems; }
  QVariantList deckItems() const { return m_deckItems; }
  QVariantList libraryRows() const { return m_libraryRows; }
  QVariantMap selectedItem() const { return m_selectedItem; }
  QVariantList watchlistEntries() const { return m_watchlistEntries; }
  QVariantList householdWatchlistEntries() const { return m_householdWatchlistEntries; }
  QVariantList seasons() const { return m_seasons; }
  QVariantList episodes() const { return m_episodes; }
  QVariantList playlists() const { return m_playlists; }
  QVariantList playlistItems() const { return m_playlistItems; }
  QString selectedPlaylistId() const { return m_selectedPlaylistId; }

  Q_INVOKABLE void refreshPublicUsers();
  Q_INVOKABLE void signIn(const QString& userName, const QString& password);
  Q_INVOKABLE void signOut();
  Q_INVOKABLE void refreshHome();
  Q_INVOKABLE bool libraryVisibleInRail(const QString& libraryId) const;
  Q_INVOKABLE void setLibraryVisibleInRail(const QString& libraryId, bool visible);
  Q_INVOKABLE void moveLibrary(const QString& libraryId, int offset);
  Q_INVOKABLE void openItem(const QString& itemId);
  Q_INVOKABLE void openSeason(const QString& seasonId);
  Q_INVOKABLE void refreshPlaylists();
  Q_INVOKABLE void openPlaylist(const QString& playlistId);
  Q_INVOKABLE void createPlaylist(const QString& name);
  Q_INVOKABLE void addToPlaylist(const QString& playlistId, const QVariantMap& item);
  Q_INVOKABLE QString imageUrl(const QString& itemId, const QString& kind = QStringLiteral("Primary")) const;
  Q_INVOKABLE QString streamUrl(const QString& itemId) const;
  Q_INVOKABLE void refreshWatchlist();
  Q_INVOKABLE void refreshHouseholdWatchlist();
  Q_INVOKABLE bool isWatchlisted(const QString& itemId) const;
  Q_INVOKABLE bool isHouseholdWatchlisted(const QString& itemId) const;
  Q_INVOKABLE void toggleWatchlist(const QVariantMap& item);
  Q_INVOKABLE void toggleHouseholdWatchlist(const QVariantMap& item);
  Q_INVOKABLE void voteHouseholdWatchlistItem(const QString& itemId, bool voted);
  Q_INVOKABLE void reportPlaybackStart(const QVariantMap& item, qlonglong positionMilliseconds);
  Q_INVOKABLE void reportPlaybackProgress(qlonglong positionMilliseconds, bool paused);
  Q_INVOKABLE void reportPlaybackStopped(qlonglong positionMilliseconds);

signals:
  void sessionChanged();
  void publicUsersChanged();
  void homeChanged();
  void selectedItemChanged();
  void watchlistChanged();
  void seriesChanged();
  void playlistsChanged();
  void errorOccurred(const QString& message);

private:
  using ReplyHandler = std::function<void(const QVariant&, const QString&)>;
  using StatusHandler = std::function<void(const QVariant&, const QString&, int)>;
  void request(const QByteArray& method, const QString& path, const QVariantMap& query,
               const QByteArray& body, ReplyHandler handler);
  void requestWithStatus(const QByteArray& method, const QString& path, const QVariantMap& query,
                         const QByteArray& body, StatusHandler handler);
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
  void addPlayableIdsToPlaylist(const QString& playlistId, const QStringList& ids);

  QNetworkAccessManager m_network;
  QSettings m_settings;
  QString m_deviceId;
  QString m_token;
  QString m_userId;
  QString m_userName;
  QVariantList m_publicUsers;
  QVariantList m_libraries;
  QVariantList m_continueItems;
  QVariantList m_deckItems;
  QVariantList m_recentDeckActivity;
  bool m_deckFallbackReady = false;
  bool m_recentDeckActivityReady = false;
  bool m_deckCorrectionStarted = false;
  QVariantList m_libraryRows;
  QVariantMap m_selectedItem;
  QVariantList m_watchlistEntries;
  QVariantList m_householdWatchlistEntries;
  QVariantList m_seasons;
  QVariantList m_episodes;
  QVariantList m_playlists;
  QVariantList m_playlistItems;
  QString m_selectedPlaylistId;
  qlonglong m_watchlistRevision = 0;
  qlonglong m_householdWatchlistRevision = 0;
  quint64 m_sessionRevision = 0;
  quint64 m_homeRevision = 0;
  quint64 m_itemRevision = 0;
  QString m_playingItemId;
  QString m_playSessionId;
  QString m_mediaSourceId;
  bool m_playbackStartConfirmed = false;
  qlonglong m_pendingStopMilliseconds = -1;
};
