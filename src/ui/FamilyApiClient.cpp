#include "FamilyApiClient.h"

#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QMetaType>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSet>
#include <QStringList>
#include <QUrlQuery>
#include <QUuid>
#include <QUrl>

namespace {
const QUrl server(QStringLiteral("https://myfamilyflix.duckdns.org/"));
}

FamilyApiClient::FamilyApiClient(QObject* parent)
  : QObject(parent), m_settings(QSettings::IniFormat, QSettings::UserScope,
                              QStringLiteral("Family Flix"), QStringLiteral("Windows Native"))
{
  m_deviceId = m_settings.value(QStringLiteral("deviceId")).toString();
  if (m_deviceId.isEmpty()) {
    m_deviceId = QUuid::createUuid().toString(QUuid::WithoutBraces);
    m_settings.setValue(QStringLiteral("deviceId"), m_deviceId);
  }
  m_token = m_settings.value(QStringLiteral("token")).toString();
  m_userId = m_settings.value(QStringLiteral("userId")).toString();
  m_userName = m_settings.value(QStringLiteral("userName")).toString();
}

void FamilyApiClient::request(const QByteArray& method, const QString& path,
                              const QVariantMap& query, const QByteArray& body,
                              ReplyHandler handler)
{
  requestWithStatus(method, path, query, body,
    [handler = std::move(handler)](const QVariant& data, const QString& error, int) {
      handler(data, error);
    });
}

void FamilyApiClient::requestWithStatus(const QByteArray& method, const QString& path,
                                        const QVariantMap& query, const QByteArray& body,
                                        StatusHandler handler)
{
  QUrl url = server.resolved(QUrl(path));
  QUrlQuery parameters;
  for (auto it = query.cbegin(); it != query.cend(); ++it)
    parameters.addQueryItem(it.key(), it.value().toString());
  url.setQuery(parameters);
  QNetworkRequest networkRequest(url);
  networkRequest.setRawHeader("Accept", "application/json");
  const bool publicRequest = path == QStringLiteral("Users/Public")
                          || path == QStringLiteral("Users/AuthenticateByName");
  QString authorization = QStringLiteral(
    "MediaBrowser Client=\"Family Flix Windows\", Device=\"Windows\", "
    "DeviceId=\"%1\", Version=\"0.1\"").arg(m_deviceId);
  if (!publicRequest && !m_token.isEmpty()) {
    authorization += QStringLiteral(", Token=\"%1\"").arg(m_token);
    networkRequest.setRawHeader("X-Emby-Token", m_token.toUtf8());
  }
  networkRequest.setRawHeader("Authorization", authorization.toUtf8());
  networkRequest.setRawHeader("X-Emby-Authorization", authorization.toUtf8());
  if (!body.isEmpty()) networkRequest.setHeader(QNetworkRequest::ContentTypeHeader,
                                                QStringLiteral("application/json"));
  QNetworkReply* reply = method == "POST" ? m_network.post(networkRequest, body)
                       : method == "PUT" ? m_network.put(networkRequest, body)
                                         : m_network.get(networkRequest);
  connect(reply, &QNetworkReply::finished, this, [reply, handler = std::move(handler)] {
    const QByteArray bytes = reply->readAll();
    const auto parsed = QJsonDocument::fromJson(bytes);
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QString error = reply->error() == QNetworkReply::NoError ? QString() : reply->errorString();
    const QVariant data = parsed.isArray() ? QVariant(parsed.array().toVariantList())
                                            : QVariant(parsed.object().toVariantMap());
    handler(data, error, status);
    reply->deleteLater();
  });
}

QVariantList FamilyApiClient::items(const QVariant& response)
{
  if (response.metaType().id() == QMetaType::QVariantList) return response.toList();
  return response.toMap().value(QStringLiteral("Items")).toList();
}

QVariantList FamilyApiClient::untouchedDeck(const QVariantList& response)
{
  QVariantList result;
  QSet<QString> seen;
  for (const auto& value : response) {
    const auto item = value.toMap();
    const auto userData = item.value(QStringLiteral("UserData")).toMap();
    const QString series = item.value(QStringLiteral("SeriesId")).toString();
    if (userData.value(QStringLiteral("Played")).toBool()
        || userData.value(QStringLiteral("PlaybackPositionTicks")).toLongLong() > 0
        || series.isEmpty() || seen.contains(series)) continue;
    seen.insert(series);
    result.append(item);
    if (result.size() == 15) break;
  }
  return result;
}

QVariantList FamilyApiClient::railLibraries() const
{
  QVariantList visible;
  for (const auto& value : m_libraries) {
    const auto library = value.toMap();
    if (libraryVisibleInRail(library.value(QStringLiteral("Id")).toString())) visible.append(value);
  }
  return visible;
}

bool FamilyApiClient::libraryVisibleInRail(const QString& libraryId) const
{
  const auto hidden = m_settings.value(QStringLiteral("users/%1/hiddenLibraryIds").arg(m_userId)).toStringList();
  return !hidden.contains(libraryId, Qt::CaseInsensitive);
}

void FamilyApiClient::setLibraryVisibleInRail(const QString& libraryId, bool visible)
{
  if (m_userId.isEmpty() || libraryId.isEmpty()) return;
  const QString key = QStringLiteral("users/%1/hiddenLibraryIds").arg(m_userId);
  QStringList hidden = m_settings.value(key).toStringList();
  hidden.removeAll(libraryId);
  if (!visible) hidden.append(libraryId);
  m_settings.setValue(key, hidden);
  emit homeChanged();
}

void FamilyApiClient::moveLibrary(const QString& libraryId, int offset)
{
  if (m_userId.isEmpty() || libraryId.isEmpty() || m_libraries.isEmpty()) return;
  int from = -1;
  for (int index = 0; index < m_libraries.size(); ++index) {
    if (m_libraries[index].toMap().value(QStringLiteral("Id")).toString() == libraryId) {
      from = index;
      break;
    }
  }
  if (from < 0) return;
  const int to = qBound(0, from + offset, int(m_libraries.size()) - 1);
  if (to == from) return;
  m_libraries.move(from, to);
  QStringList order;
  for (const auto& value : m_libraries)
    order.append(value.toMap().value(QStringLiteral("Id")).toString());
  m_settings.setValue(QStringLiteral("users/%1/libraryMenuOrder").arg(m_userId), order);
  QVariantList reorderedRows;
  for (const auto& value : m_libraries) {
    const QString id = value.toMap().value(QStringLiteral("Id")).toString();
    for (const auto& row : m_libraryRows) {
      if (row.toMap().value(QStringLiteral("Id")).toString() == id) {
        reorderedRows.append(row);
        break;
      }
    }
  }
  m_libraryRows = reorderedRows;
  emit homeChanged();
}

void FamilyApiClient::refreshPublicUsers()
{
  request("GET", QStringLiteral("Users/Public"), {}, {}, [this](const QVariant& data, const QString& error) {
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_publicUsers = items(data);
    emit publicUsersChanged();
  });
}

void FamilyApiClient::signIn(const QString& userName, const QString& password)
{
  const QByteArray body = QJsonDocument(QJsonObject{
    { QStringLiteral("Username"), userName }, { QStringLiteral("Pw"), password }
  }).toJson(QJsonDocument::Compact);
  request("POST", QStringLiteral("Users/AuthenticateByName"), {}, body,
          [this](const QVariant& data, const QString& error) {
    const auto login = data.toMap();
    const auto user = login.value(QStringLiteral("User")).toMap();
    const QString token = login.value(QStringLiteral("AccessToken")).toString();
    const QString id = user.value(QStringLiteral("Id")).toString();
    if (!error.isEmpty() || token.isEmpty() || id.isEmpty()) {
      emit errorOccurred(QStringLiteral("Could not sign in. Check the password and try again."));
      return;
    }
    ++m_sessionRevision;
    m_token = token;
    m_userId = id;
    m_userName = user.value(QStringLiteral("Name")).toString();
    m_settings.setValue(QStringLiteral("token"), m_token);
    m_settings.setValue(QStringLiteral("userId"), m_userId);
    m_settings.setValue(QStringLiteral("userName"), m_userName);
    emit sessionChanged();
    refreshHome();
    refreshWatchlist();
    refreshHouseholdWatchlist();
  });
}

void FamilyApiClient::signOut()
{
  ++m_sessionRevision;
  ++m_homeRevision;
  ++m_itemRevision;
  m_playingItemId.clear(); m_playSessionId.clear(); m_mediaSourceId.clear();
  m_playbackStartConfirmed = false; m_pendingStopMilliseconds = -1;
  m_token.clear(); m_userId.clear(); m_userName.clear();
  m_libraries.clear(); m_continueItems.clear(); m_deckItems.clear();
  m_libraryRows.clear(); m_selectedItem.clear();
  m_seasons.clear(); m_episodes.clear();
  m_watchlistEntries.clear(); m_watchlistRevision = 0;
  m_householdWatchlistEntries.clear(); m_householdWatchlistRevision = 0;
  m_settings.remove(QStringLiteral("token"));
  m_settings.remove(QStringLiteral("userId"));
  m_settings.remove(QStringLiteral("userName"));
  emit sessionChanged();
  emit homeChanged();
  emit selectedItemChanged();
  emit watchlistChanged();
  emit seriesChanged();
  refreshPublicUsers();
}

void FamilyApiClient::refreshHome()
{
  if (!signedIn()) return;
  const quint64 revision = m_sessionRevision;
  const quint64 homeRevision = ++m_homeRevision;
  request("GET", QStringLiteral("Users/%1/Views").arg(m_userId), {}, {},
          [this, revision, homeRevision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision || homeRevision != m_homeRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_libraries.clear();
    for (const auto& value : items(data)) {
      const auto library = value.toMap();
      const auto kind = library.value(QStringLiteral("CollectionType")).toString().toLower();
      if (kind == QStringLiteral("music") || kind == QStringLiteral("musicvideos")
          || kind == QStringLiteral("livetv")) continue;
      m_libraries.append(library);
    }
    const QStringList order = m_settings.value(
      QStringLiteral("users/%1/libraryMenuOrder").arg(m_userId)).toStringList();
    QVariantList ordered;
    for (const QString& id : order) {
      for (const auto& value : m_libraries) {
        if (value.toMap().value(QStringLiteral("Id")).toString() == id) {
          ordered.append(value);
          break;
        }
      }
    }
    for (const auto& value : m_libraries) {
      const QString id = value.toMap().value(QStringLiteral("Id")).toString();
      if (!order.contains(id)) ordered.append(value);
    }
    m_libraries = ordered;
    const QVariantList previousRows = m_libraryRows;
    QVariantList nextRows;
    for (const auto& value : m_libraries) {
      const auto library = value.toMap();
      const QString id = library.value(QStringLiteral("Id")).toString();
      const QString name = library.value(QStringLiteral("Name")).toString();
      if (id.isEmpty()) continue;
      QVariantList cachedItems;
      for (const auto& previous : previousRows) {
        const auto previousRow = previous.toMap();
        if (previousRow.value(QStringLiteral("Id")).toString() == id) {
          cachedItems = previousRow.value(QStringLiteral("Items")).toList();
          break;
        }
      }
      nextRows.append(QVariantMap{
        { QStringLiteral("Id"), id }, { QStringLiteral("Name"), name },
        { QStringLiteral("Items"), cachedItems }
      });
      request("GET", QStringLiteral("Users/%1/Items/Latest").arg(m_userId),
              { { QStringLiteral("ParentId"), id }, { QStringLiteral("Limit"), 12 },
                { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode,Movie,Series") } }, {},
              [this, revision, homeRevision, id](const QVariant& recent, const QString& recentError) {
        if (revision != m_sessionRevision || homeRevision != m_homeRevision || !recentError.isEmpty()) return;
        for (int index = 0; index < m_libraryRows.size(); ++index) {
          auto row = m_libraryRows[index].toMap();
          if (row.value(QStringLiteral("Id")).toString() != id) continue;
          row.insert(QStringLiteral("Items"), items(recent));
          m_libraryRows[index] = row;
          break;
        }
        emit homeChanged();
      });
    }
    m_libraryRows = nextRows;
    emit homeChanged();
  });
  request("GET", QStringLiteral("Users/%1/Items/Resume").arg(m_userId),
          { { QStringLiteral("Limit"), 15 }, { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode,Movie") } }, {},
          [this, revision, homeRevision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision || homeRevision != m_homeRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_continueItems = items(data);
    emit homeChanged();
  });
  request("GET", QStringLiteral("Shows/NextUp"),
          { { QStringLiteral("UserId"), m_userId }, { QStringLiteral("Limit"), 30 },
            { QStringLiteral("EnableResumable"), false }, { QStringLiteral("EnableRewatching"), true } }, {},
          [this, revision, homeRevision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision || homeRevision != m_homeRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_deckItems = untouchedDeck(items(data));
    emit homeChanged();
  });
}

void FamilyApiClient::refreshWatchlist()
{
  if (!signedIn()) return;
  const quint64 revision = m_sessionRevision;
  request("GET", QStringLiteral("FamilyFlix/Watchlists/personal"), {}, {},
          [this, revision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("Watchlist could not load.")); return; }
    const auto document = data.toMap();
    m_watchlistRevision = document.value(QStringLiteral("revision")).toLongLong();
    m_watchlistEntries = document.value(QStringLiteral("entries")).toList();
    emit watchlistChanged();
  });
}

void FamilyApiClient::refreshHouseholdWatchlist()
{
  if (!signedIn()) return;
  const quint64 revision = m_sessionRevision;
  request("GET", QStringLiteral("FamilyFlix/Watchlists/household"), {}, {},
          [this, revision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("Family watchlist could not load.")); return; }
    const auto document = data.toMap();
    m_householdWatchlistRevision = document.value(QStringLiteral("revision")).toLongLong();
    m_householdWatchlistEntries = document.value(QStringLiteral("entries")).toList();
    emit watchlistChanged();
  });
}

bool FamilyApiClient::isWatchlisted(const QString& itemId) const
{
  for (const auto& value : m_watchlistEntries) {
    const auto entry = value.toMap();
    if (entry.value(QStringLiteral("itemId")).toString().compare(itemId, Qt::CaseInsensitive) == 0
        || entry.value(QStringLiteral("seriesId")).toString().compare(itemId, Qt::CaseInsensitive) == 0)
      return true;
  }
  return false;
}

bool FamilyApiClient::isHouseholdWatchlisted(const QString& itemId) const
{
  for (const auto& value : m_householdWatchlistEntries) {
    const auto entry = value.toMap();
    if (entry.value(QStringLiteral("itemId")).toString().compare(itemId, Qt::CaseInsensitive) == 0)
      return true;
  }
  return false;
}

void FamilyApiClient::toggleHouseholdWatchlist(const QVariantMap& item)
{
  if (!signedIn()) return;
  const QString itemId = item.value(QStringLiteral("Id")).toString();
  const QString type = item.value(QStringLiteral("Type")).toString().toLower();
  if (itemId.isEmpty() || (type != QStringLiteral("movie") && type != QStringLiteral("series"))) return;
  const auto userData = item.value(QStringLiteral("UserData")).toMap();
  const QVariantMap entry{
    { QStringLiteral("itemId"), itemId }, { QStringLiteral("itemType"), type },
    { QStringLiteral("seriesId"), type == QStringLiteral("series") ? itemId : QString() },
    { QStringLiteral("providerIds"), item.value(QStringLiteral("ProviderIds")) },
    { QStringLiteral("title"), item.value(QStringLiteral("Name")) },
    { QStringLiteral("playbackPositionTicksAtAdd"), userData.value(QStringLiteral("PlaybackPositionTicks"), 0) },
    { QStringLiteral("playedAtAdd"), userData.value(QStringLiteral("Played"), false) },
    { QStringLiteral("lastPlayedDateAtAdd"), userData.value(QStringLiteral("LastPlayedDate")) }
  };
  writeHouseholdMembership(m_sessionRevision, !isHouseholdWatchlisted(itemId), entry,
    QUuid::createUuid().toString(QUuid::WithoutBraces), m_householdWatchlistRevision, 0);
}

void FamilyApiClient::voteHouseholdWatchlistItem(const QString& itemId, bool voted)
{
  if (!signedIn() || itemId.isEmpty()) return;
  writeHouseholdVote(m_sessionRevision, itemId, voted,
    QUuid::createUuid().toString(QUuid::WithoutBraces), m_householdWatchlistRevision, 0);
}

void FamilyApiClient::toggleWatchlist(const QVariantMap& item)
{
  if (!signedIn()) return;
  const QString itemId = item.value(QStringLiteral("Id")).toString();
  const QString type = item.value(QStringLiteral("Type")).toString().toLower();
  if (itemId.isEmpty() || (type != QStringLiteral("movie") && type != QStringLiteral("series"))) return;
  const bool present = !isWatchlisted(itemId);
  const auto userData = item.value(QStringLiteral("UserData")).toMap();
  const QVariantMap entry{
    { QStringLiteral("itemId"), itemId }, { QStringLiteral("itemType"), type },
    { QStringLiteral("seriesId"), type == QStringLiteral("series") ? itemId : QString() },
    { QStringLiteral("providerIds"), item.value(QStringLiteral("ProviderIds")) },
    { QStringLiteral("title"), item.value(QStringLiteral("Name")) },
    { QStringLiteral("playbackPositionTicksAtAdd"), userData.value(QStringLiteral("PlaybackPositionTicks"), 0) },
    { QStringLiteral("playedAtAdd"), userData.value(QStringLiteral("Played"), false) },
    { QStringLiteral("lastPlayedDateAtAdd"), userData.value(QStringLiteral("LastPlayedDate")) }
  };
  const quint64 session = m_sessionRevision;
  const QString operationId = QUuid::createUuid().toString(QUuid::WithoutBraces);
  writeWatchlistMembership(session, present, entry, operationId, m_watchlistRevision, 0);
}

void FamilyApiClient::writeWatchlistMembership(quint64 session, bool present,
                                                const QVariantMap& entry, const QString& operationId,
                                                qlonglong expected, int retries)
{
  const QVariantMap command{
    { QStringLiteral("expectedRevision"), expected },
    { QStringLiteral("present"), present },
    { QStringLiteral("entry"), entry },
    { QStringLiteral("operationId"), operationId }
  };
  requestWithStatus("PUT", QStringLiteral("FamilyFlix/Watchlists/personal/Membership"), {},
    QJsonDocument(QJsonObject::fromVariantMap(command)).toJson(QJsonDocument::Compact),
    [this, session, present, entry, operationId, retries](const QVariant& data, const QString& error, int status) {
      if (session != m_sessionRevision) return;
      if (status == 409 && retries == 0) {
        const auto current = data.toMap().value(QStringLiteral("current")).toMap();
        writeWatchlistMembership(session, present, entry, operationId,
                                 current.value(QStringLiteral("revision")).toLongLong(), 1);
        return;
      }
      if (!error.isEmpty() || status < 200 || status >= 300) {
        emit errorOccurred(QStringLiteral("Watchlist change did not save. Please try again."));
        return;
      }
      const auto document = data.toMap();
      m_watchlistRevision = document.value(QStringLiteral("revision")).toLongLong();
      m_watchlistEntries = document.value(QStringLiteral("entries")).toList();
      emit watchlistChanged();
    });
}

void FamilyApiClient::writeHouseholdMembership(quint64 session, bool present,
                                               const QVariantMap& entry, const QString& operationId,
                                               qlonglong expected, int retries)
{
  const QVariantMap command{
    { QStringLiteral("expectedRevision"), expected },
    { QStringLiteral("present"), present },
    { QStringLiteral("entry"), entry },
    { QStringLiteral("operationId"), operationId }
  };
  requestWithStatus("PUT", QStringLiteral("FamilyFlix/Watchlists/household/Membership"), {},
    QJsonDocument(QJsonObject::fromVariantMap(command)).toJson(QJsonDocument::Compact),
    [this, session, present, entry, operationId, retries](const QVariant& data, const QString& error, int status) {
      if (session != m_sessionRevision) return;
      if (status == 409 && retries == 0) {
        const auto current = data.toMap().value(QStringLiteral("current")).toMap();
        writeHouseholdMembership(session, present, entry, operationId,
                                 current.value(QStringLiteral("revision")).toLongLong(), 1);
        return;
      }
      if (!error.isEmpty() || status < 200 || status >= 300) {
        emit errorOccurred(QStringLiteral("Family watchlist change did not save."));
        return;
      }
      const auto document = data.toMap();
      m_householdWatchlistRevision = document.value(QStringLiteral("revision")).toLongLong();
      m_householdWatchlistEntries = document.value(QStringLiteral("entries")).toList();
      emit watchlistChanged();
    });
}

void FamilyApiClient::writeHouseholdVote(quint64 session, const QString& itemId, bool voted,
                                         const QString& operationId, qlonglong expected, int retries)
{
  const QVariantMap command{
    { QStringLiteral("expectedRevision"), expected },
    { QStringLiteral("voted"), voted },
    { QStringLiteral("operationId"), operationId }
  };
  requestWithStatus("PUT", QStringLiteral("FamilyFlix/Watchlists/household/Items/%1/Votes/Me").arg(itemId), {},
    QJsonDocument(QJsonObject::fromVariantMap(command)).toJson(QJsonDocument::Compact),
    [this, session, itemId, voted, operationId, retries](const QVariant& data, const QString& error, int status) {
      if (session != m_sessionRevision) return;
      if (status == 409 && retries == 0) {
        const auto current = data.toMap().value(QStringLiteral("current")).toMap();
        writeHouseholdVote(session, itemId, voted, operationId,
                           current.value(QStringLiteral("revision")).toLongLong(), 1);
        return;
      }
      if (!error.isEmpty() || status < 200 || status >= 300) {
        emit errorOccurred(QStringLiteral("Family vote did not save."));
        return;
      }
      const auto document = data.toMap();
      m_householdWatchlistRevision = document.value(QStringLiteral("revision")).toLongLong();
      m_householdWatchlistEntries = document.value(QStringLiteral("entries")).toList();
      emit watchlistChanged();
    });
}

void FamilyApiClient::openItem(const QString& itemId)
{
  if (!signedIn() || itemId.isEmpty()) return;
  const quint64 revision = m_sessionRevision;
  const quint64 itemRevision = ++m_itemRevision;
  m_selectedItem.clear();
  emit selectedItemChanged();
  request("GET", QStringLiteral("Users/%1/Items/%2").arg(m_userId, itemId), {}, {},
          [this, revision, itemRevision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision || itemRevision != m_itemRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_selectedItem = data.toMap();
    emit selectedItemChanged();
    if (m_selectedItem.value(QStringLiteral("Type")).toString() != QStringLiteral("Series")) return;
    m_seasons.clear(); m_episodes.clear();
    emit seriesChanged();
    const QString seriesId = m_selectedItem.value(QStringLiteral("Id")).toString();
    request("GET", QStringLiteral("Shows/%1/Seasons").arg(seriesId),
            { { QStringLiteral("UserId"), m_userId }, { QStringLiteral("EnableUserData"), true } }, {},
            [this, revision, itemRevision, seriesId](const QVariant& seasons, const QString& seasonError) {
      if (revision != m_sessionRevision || itemRevision != m_itemRevision
          || m_selectedItem.value(QStringLiteral("Id")).toString() != seriesId) return;
      if (!seasonError.isEmpty()) { emit errorOccurred(seasonError); return; }
      m_seasons = items(seasons);
      emit seriesChanged();
    });
  });
}

void FamilyApiClient::openSeason(const QString& seasonId)
{
  if (!signedIn() || seasonId.isEmpty()) return;
  const quint64 revision = m_sessionRevision;
  request("GET", QStringLiteral("Users/%1/Items").arg(m_userId),
          { { QStringLiteral("ParentId"), seasonId },
            { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode") },
            { QStringLiteral("SortBy"), QStringLiteral("IndexNumber") },
            { QStringLiteral("SortOrder"), QStringLiteral("Ascending") },
            { QStringLiteral("Recursive"), true },
            { QStringLiteral("Limit"), 250 },
            { QStringLiteral("EnableUserData"), true } }, {},
          [this, revision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_episodes = items(data);
    emit seriesChanged();
  });
}

QString FamilyApiClient::imageUrl(const QString& itemId, const QString& kind) const
{
  if (itemId.isEmpty()) return {};
  QUrl url = server.resolved(QUrl(QStringLiteral("Items/%1/Images/%2").arg(itemId, kind)));
  QUrlQuery query;
  query.addQueryItem(QStringLiteral("maxWidth"), QStringLiteral("640"));
  query.addQueryItem(QStringLiteral("quality"), QStringLiteral("85"));
  if (!m_token.isEmpty()) query.addQueryItem(QStringLiteral("api_key"), m_token);
  url.setQuery(query);
  return url.toString();
}

QString FamilyApiClient::streamUrl(const QString& itemId) const
{
  if (!signedIn() || itemId.isEmpty()) return {};
  QUrl url = server.resolved(QUrl(QStringLiteral("Videos/%1/stream").arg(itemId)));
  QUrlQuery query;
  query.addQueryItem(QStringLiteral("Static"), QStringLiteral("true"));
  query.addQueryItem(QStringLiteral("api_key"), m_token);
  url.setQuery(query);
  return url.toString();
}

void FamilyApiClient::reportPlaybackStart(const QVariantMap& item, qlonglong positionMilliseconds)
{
  if (!signedIn()) return;
  const QString itemId = item.value(QStringLiteral("Id")).toString();
  if (itemId.isEmpty() || !m_playingItemId.isEmpty()) return;
  m_playingItemId = itemId;
  m_playSessionId = QUuid::createUuid().toString(QUuid::WithoutBraces);
  const auto sources = item.value(QStringLiteral("MediaSources")).toList();
  m_mediaSourceId = sources.isEmpty() ? QString() : sources.first().toMap().value(QStringLiteral("Id")).toString();
  m_playbackStartConfirmed = false;
  m_pendingStopMilliseconds = -1;
  const quint64 revision = m_sessionRevision;
  const QString playSession = m_playSessionId;
  const QVariantMap report{
    { QStringLiteral("ItemId"), itemId },
    { QStringLiteral("PositionTicks"), positionMilliseconds * 10000 },
    { QStringLiteral("CanSeek"), true },
    { QStringLiteral("IsPaused"), false },
    { QStringLiteral("PlayMethod"), QStringLiteral("DirectPlay") },
    { QStringLiteral("PlaySessionId"), playSession },
    { QStringLiteral("MediaSourceId"), m_mediaSourceId }
  };
  const QString seriesId = item.value(QStringLiteral("SeriesId")).toString();
  request("POST", QStringLiteral("Sessions/Playing"), {},
          QJsonDocument(QJsonObject::fromVariantMap(report)).toJson(QJsonDocument::Compact),
          [this, revision, playSession, itemId, seriesId](const QVariant&, const QString& error) {
    if (revision != m_sessionRevision || playSession != m_playSessionId) return;
    if (!error.isEmpty()) {
      emit errorOccurred(QStringLiteral("Playback status could not sync with Jellyfin."));
      return;
    }
    m_playbackStartConfirmed = true;
    // Match Android's watchlist rule only after Jellyfin accepts the playback start.
    for (const auto& value : m_watchlistEntries) {
      const auto entry = value.toMap();
      const QString listed = entry.value(QStringLiteral("itemId")).toString();
      if (listed.compare(itemId, Qt::CaseInsensitive) != 0
          && (seriesId.isEmpty() || listed.compare(seriesId, Qt::CaseInsensitive) != 0)) continue;
      writeWatchlistMembership(revision, false, entry,
        QUuid::createUuid().toString(QUuid::WithoutBraces), m_watchlistRevision, 0);
      break;
    }
    if (m_pendingStopMilliseconds >= 0) sendPlaybackStopped(m_pendingStopMilliseconds);
  });
}

void FamilyApiClient::reportPlaybackProgress(qlonglong positionMilliseconds, bool paused)
{
  if (!signedIn() || !m_playbackStartConfirmed || m_playingItemId.isEmpty()
      || m_pendingStopMilliseconds >= 0) return;
  const QVariantMap report{
    { QStringLiteral("ItemId"), m_playingItemId },
    { QStringLiteral("PositionTicks"), positionMilliseconds * 10000 },
    { QStringLiteral("CanSeek"), true },
    { QStringLiteral("IsPaused"), paused },
    { QStringLiteral("PlayMethod"), QStringLiteral("DirectPlay") },
    { QStringLiteral("PlaySessionId"), m_playSessionId },
    { QStringLiteral("MediaSourceId"), m_mediaSourceId }
  };
  request("POST", QStringLiteral("Sessions/Playing/Progress"), {},
          QJsonDocument(QJsonObject::fromVariantMap(report)).toJson(QJsonDocument::Compact),
          [](const QVariant&, const QString&) {});
}

void FamilyApiClient::reportPlaybackStopped(qlonglong positionMilliseconds)
{
  if (m_playingItemId.isEmpty() || m_pendingStopMilliseconds >= 0) return;
  m_pendingStopMilliseconds = qMax<qlonglong>(0, positionMilliseconds);
  if (m_playbackStartConfirmed) sendPlaybackStopped(m_pendingStopMilliseconds);
}

void FamilyApiClient::sendPlaybackStopped(qlonglong positionMilliseconds)
{
  if (m_playingItemId.isEmpty()) return;
  const QVariantMap report{
    { QStringLiteral("ItemId"), m_playingItemId },
    { QStringLiteral("PositionTicks"), positionMilliseconds * 10000 },
    { QStringLiteral("PlaySessionId"), m_playSessionId },
    { QStringLiteral("MediaSourceId"), m_mediaSourceId },
    { QStringLiteral("Failed"), false }
  };
  request("POST", QStringLiteral("Sessions/Playing/Stopped"), {},
          QJsonDocument(QJsonObject::fromVariantMap(report)).toJson(QJsonDocument::Compact),
          [this](const QVariant&, const QString& error) {
    if (!error.isEmpty()) emit errorOccurred(QStringLiteral("Watched status could not sync with Jellyfin."));
    refreshHome();
    refreshWatchlist();
  });
  m_playingItemId.clear(); m_playSessionId.clear(); m_mediaSourceId.clear();
  m_playbackStartConfirmed = false; m_pendingStopMilliseconds = -1;
}
