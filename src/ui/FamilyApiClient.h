#pragma once

#include <QObject>
#include <QNetworkAccessManager>
#include <QSettings>
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
  Q_PROPERTY(QVariantList continueItems READ continueItems NOTIFY homeChanged)
  Q_PROPERTY(QVariantList deckItems READ deckItems NOTIFY homeChanged)
  Q_PROPERTY(QVariantList libraryRows READ libraryRows NOTIFY homeChanged)
  Q_PROPERTY(QVariantMap selectedItem READ selectedItem NOTIFY selectedItemChanged)

public:
  explicit FamilyApiClient(QObject* parent = nullptr);

  bool signedIn() const { return !m_token.isEmpty() && !m_userId.isEmpty(); }
  QString userName() const { return m_userName; }
  QVariantList publicUsers() const { return m_publicUsers; }
  QVariantList libraries() const { return m_libraries; }
  QVariantList continueItems() const { return m_continueItems; }
  QVariantList deckItems() const { return m_deckItems; }
  QVariantList libraryRows() const { return m_libraryRows; }
  QVariantMap selectedItem() const { return m_selectedItem; }

  Q_INVOKABLE void refreshPublicUsers();
  Q_INVOKABLE void signIn(const QString& userName, const QString& password);
  Q_INVOKABLE void signOut();
  Q_INVOKABLE void refreshHome();
  Q_INVOKABLE void openItem(const QString& itemId);
  Q_INVOKABLE QString imageUrl(const QString& itemId, const QString& kind = QStringLiteral("Primary")) const;
  Q_INVOKABLE QString streamUrl(const QString& itemId) const;

signals:
  void sessionChanged();
  void publicUsersChanged();
  void homeChanged();
  void selectedItemChanged();
  void errorOccurred(const QString& message);

private:
  using ReplyHandler = std::function<void(const QVariant&, const QString&)>;
  void request(const QByteArray& method, const QString& path, const QVariantMap& query,
               const QByteArray& body, ReplyHandler handler);
  static QVariantList items(const QVariant& response);
  static QVariantList untouchedDeck(const QVariantList& response);

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
  QVariantList m_libraryRows;
  QVariantMap m_selectedItem;
  quint64 m_sessionRevision = 0;
};
