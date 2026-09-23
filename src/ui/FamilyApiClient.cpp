#include "FamilyApiClient.h"

#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QMetaType>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSet>
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
  QUrl url = server.resolved(QUrl(path));
  QUrlQuery parameters;
  for (auto it = query.cbegin(); it != query.cend(); ++it)
    parameters.addQueryItem(it.key(), it.value().toString());
  url.setQuery(parameters);
  QNetworkRequest networkRequest(url);
  networkRequest.setRawHeader("Accept", "application/json");
  networkRequest.setRawHeader("X-Emby-Authorization",
    QStringLiteral("MediaBrowser Client=\"Family Flix Windows\", Device=\"Windows\", "
                   "DeviceId=\"%1\", Version=\"0.1\"").arg(m_deviceId).toUtf8());
  if (!m_token.isEmpty()) networkRequest.setRawHeader("X-Emby-Token", m_token.toUtf8());
  if (!body.isEmpty()) networkRequest.setHeader(QNetworkRequest::ContentTypeHeader,
                                                QStringLiteral("application/json"));
  QNetworkReply* reply = method == "POST" ? m_network.post(networkRequest, body)
                                           : m_network.get(networkRequest);
  connect(reply, &QNetworkReply::finished, this, [reply, handler = std::move(handler)] {
    const QByteArray bytes = reply->readAll();
    const auto parsed = QJsonDocument::fromJson(bytes);
    const QString error = reply->error() == QNetworkReply::NoError ? QString() : reply->errorString();
    const QVariant data = parsed.isArray() ? QVariant(parsed.array().toVariantList())
                                            : QVariant(parsed.object().toVariantMap());
    handler(data, error);
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
  });
}

void FamilyApiClient::signOut()
{
  ++m_sessionRevision;
  m_token.clear(); m_userId.clear(); m_userName.clear();
  m_libraries.clear(); m_continueItems.clear(); m_deckItems.clear();
  m_libraryRows.clear(); m_selectedItem.clear();
  m_settings.remove(QStringLiteral("token"));
  m_settings.remove(QStringLiteral("userId"));
  m_settings.remove(QStringLiteral("userName"));
  emit sessionChanged();
  emit homeChanged();
  emit selectedItemChanged();
  refreshPublicUsers();
}

void FamilyApiClient::refreshHome()
{
  if (!signedIn()) return;
  const quint64 revision = m_sessionRevision;
  request("GET", QStringLiteral("Users/%1/Views").arg(m_userId), {}, {},
          [this, revision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_libraries.clear();
    for (const auto& value : items(data)) {
      const auto library = value.toMap();
      const auto kind = library.value(QStringLiteral("CollectionType")).toString().toLower();
      if (kind == QStringLiteral("music") || kind == QStringLiteral("musicvideos")
          || kind == QStringLiteral("livetv")) continue;
      m_libraries.append(library);
    }
    m_libraryRows.clear();
    emit homeChanged();
    for (const auto& value : m_libraries) {
      const auto library = value.toMap();
      const QString id = library.value(QStringLiteral("Id")).toString();
      const QString name = library.value(QStringLiteral("Name")).toString();
      if (id.isEmpty()) continue;
      m_libraryRows.append(QVariantMap{
        { QStringLiteral("Id"), id }, { QStringLiteral("Name"), name },
        { QStringLiteral("Items"), QVariantList{} }
      });
      request("GET", QStringLiteral("Users/%1/Items/Latest").arg(m_userId),
              { { QStringLiteral("ParentId"), id }, { QStringLiteral("Limit"), 12 },
                { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode,Movie,Series") } }, {},
              [this, revision, id](const QVariant& recent, const QString& recentError) {
        if (revision != m_sessionRevision || !recentError.isEmpty()) return;
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
  });
  request("GET", QStringLiteral("Users/%1/Items/Resume").arg(m_userId),
          { { QStringLiteral("Limit"), 15 }, { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode,Movie") } }, {},
          [this, revision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_continueItems = items(data);
    emit homeChanged();
  });
  request("GET", QStringLiteral("Shows/NextUp"),
          { { QStringLiteral("UserId"), m_userId }, { QStringLiteral("Limit"), 30 },
            { QStringLiteral("EnableResumable"), false }, { QStringLiteral("EnableRewatching"), true } }, {},
          [this, revision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_deckItems = untouchedDeck(items(data));
    emit homeChanged();
  });
}

void FamilyApiClient::openItem(const QString& itemId)
{
  if (!signedIn() || itemId.isEmpty()) return;
  const quint64 revision = m_sessionRevision;
  request("GET", QStringLiteral("Users/%1/Items/%2").arg(m_userId, itemId), {}, {},
          [this, revision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_selectedItem = data.toMap();
    emit selectedItemChanged();
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
