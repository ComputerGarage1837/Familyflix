#include "FamilyApiClient.h"

#include <QJsonDocument>
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QJsonArray>
#include <QJsonObject>
#include <QMetaType>
#include <QHash>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QRandomGenerator>
#include <QSet>
#include <QStringList>
#include <QUrlQuery>
#include <QUuid>
#include <QUrl>
#include <QTime>
#include <QStorageInfo>
#include <QDir>
#include <climits>

namespace {
const QUrl server(QStringLiteral("https://myfamilyflix.duckdns.org/"));

struct ThemePalette {
  const char* name;
  const char* screen;
  const char* surface;
  const char* accent;
  const char* secondary;
  const char* text;
  const char* onAccent;
};
const ThemePalette palettes[] = {
  {"Ocean", "#071116", "#102028", "#20C5C7", "#9585FF", "#F4FBFC", "#042326"},
  {"Violet", "#100A18", "#1B1226", "#B879EF", "#60DDE1", "#FBF7FF", "#23102E"},
  {"Royal Blue", "#07101D", "#101E30", "#5AA2FF", "#FF91A6", "#F3F8FF", "#071B33"},
  {"Forest", "#08140D", "#102419", "#58CE83", "#E8BB60", "#F3FBF5", "#082415"},
  {"Amber", "#171006", "#2A1D0B", "#F2AA3B", "#55D4C6", "#FFF8EA", "#2B1900"},
  {"Rose", "#170A10", "#2A121D", "#EC79A8", "#66D6D0", "#FFF6FA", "#35101F"},
  {"Crimson", "#160908", "#291311", "#EF756D", "#F2B84B", "#FFF7F5", "#35100D"},
  {"Indigo", "#0A0B18", "#15162A", "#8D94FF", "#52D6CE", "#F7F7FF", "#141636"},
  {"Lime", "#0D1508", "#192510", "#A4CF55", "#5FC6DD", "#F8FCEB", "#1B2808"},
  {"Copper", "#160E09", "#291B13", "#DC8B5F", "#75C7C1", "#FFF8F3", "#32180B"},
  {"Graphite", "#0D0E10", "#1A1C1F", "#A4B0BA", "#E3A65A", "#F7F8F9", "#171B1E"},
  {"Aurora", "#071326", "#101E32", "#42E0C5", "#B079FF", "#F5FBFF", "#031D24"},
  {"Sunset Cinema", "#180A19", "#271426", "#FFB44D", "#FF718F", "#FFF8EF", "#351700"},
  {"Neon Arcade", "#050817", "#0E1730", "#2DE2E6", "#FF4FD8", "#F7FBFF", "#0A1804"},
  {"Cinema Noir", "#101113", "#1C1E21", "#E6E1D7", "#D45D68", "#F5F3EE", "#16130D"}
};

const ThemePalette& paletteFor(const QString& name)
{
  for (const auto& palette : palettes) {
    if (name == QLatin1String(palette.name)) return palette;
  }
  return palettes[0];
}

QString deckSeriesId(const QVariantMap& episode)
{
  const QString id = episode.value(QStringLiteral("SeriesId")).toString();
  if (!id.isEmpty()) return id;
  return episode.value(QStringLiteral("SeriesName")).toString().trimmed().toLower();
}

bool untouchedEpisode(const QVariantMap& episode)
{
  const auto state = episode.value(QStringLiteral("UserData")).toMap();
  return !state.value(QStringLiteral("Played")).toBool()
      && state.value(QStringLiteral("PlaybackPositionTicks")).toLongLong() == 0;
}

bool watchlistEntryMatchesItem(const QVariantMap& entry, const QVariantMap& item)
{
  const QString expectedType = entry.value(QStringLiteral("itemType")).toString().toLower();
  if (item.value(QStringLiteral("Type")).toString().toLower() != expectedType) return false;
  if (entry.value(QStringLiteral("itemId")).toString().compare(
        item.value(QStringLiteral("Id")).toString(), Qt::CaseInsensitive) == 0) return true;
  const auto expected = entry.value(QStringLiteral("providerIds")).toMap();
  const auto actual = item.value(QStringLiteral("ProviderIds")).toMap();
  for (auto wanted = expected.cbegin(); wanted != expected.cend(); ++wanted) {
    if (wanted.value().toString().isEmpty()) continue;
    for (auto found = actual.cbegin(); found != actual.cend(); ++found) {
      if (wanted.key().compare(found.key(), Qt::CaseInsensitive) == 0
          && wanted.value().toString().compare(found.value().toString(), Qt::CaseInsensitive) == 0)
        return true;
    }
  }
  return false;
}

QList<int> familyVersionParts(const QString& version)
{
  static const QRegularExpression pattern(
    QStringLiteral("(?:^|[^0-9])(\\d+)\\.(\\d+)\\.(\\d+)-family\\.(\\d+)"),
    QRegularExpression::CaseInsensitiveOption);
  const auto match = pattern.match(version);
  if (!match.hasMatch()) return {};
  return { match.captured(1).toInt(), match.captured(2).toInt(),
           match.captured(3).toInt(), match.captured(4).toInt() };
}

bool laterFamilyVersion(const QList<int>& candidate, const QList<int>& current)
{
  if (candidate.size() != 4 || current.size() != 4) return false;
  for (int i = 0; i < 4; ++i) {
    if (candidate[i] != current[i]) return candidate[i] > current[i];
  }
  return false;
}

QVariantList peopleOfType(const QVariantMap& item, const QString& type)
{
  QVariantList result;
  QSet<QString> seen;
  for (const auto& value : item.value(QStringLiteral("People")).toList()) {
    const auto person = value.toMap();
    if (person.value(QStringLiteral("Type")).toString().compare(type, Qt::CaseInsensitive) != 0) continue;
    const QString key = person.value(QStringLiteral("Id")).toString().isEmpty()
      ? person.value(QStringLiteral("Name")).toString().toLower()
      : person.value(QStringLiteral("Id")).toString();
    if (key.isEmpty() || seen.contains(key)) continue;
    seen.insert(key);
    result.append(person);
    if (result.size() == 7) break;
  }
  return result;
}

int channelBand(const QVariantMap& channel)
{
  bool ok = false;
  const double number = channel.value(QStringLiteral("Number")).toString().toDouble(&ok);
  if (!ok) return -1;
  return int(number / (number >= 600000.0 ? 100000.0 : 1000.0));
}

bool decodeCoWatchPresets(const QVariantMap& preferences, QVariantList& presets)
{
  const QString raw = preferences.value(QStringLiteral("CustomPrefs")).toMap()
    .value(QStringLiteral("presetsV1")).toString();
  if (raw.isEmpty()) { presets.clear(); return true; }
  QJsonParseError parseError;
  const auto parsed = QJsonDocument::fromJson(raw.toUtf8(), &parseError);
  if (parseError.error != QJsonParseError::NoError || !parsed.isObject()) return false;
  const auto document = parsed.object().toVariantMap();
  if (document.value(QStringLiteral("version"), 1).toInt() != 1) return false;
  presets.clear();
  for (const auto& value : document.value(QStringLiteral("presets")).toList()) {
    const auto preset = value.toMap();
    if (QUuid(preset.value(QStringLiteral("id")).toString()).isNull()
        || preset.value(QStringLiteral("name")).toString().trimmed().isEmpty()
        || preset.value(QStringLiteral("participantUserIds")).toStringList().isEmpty()) continue;
    presets.append(preset);
  }
  return true;
}

QString encodeCoWatchPresets(const QVariantList& presets)
{
  return QString::fromUtf8(QJsonDocument(QJsonObject{
    { QStringLiteral("version"), 1 },
    { QStringLiteral("presets"), QJsonArray::fromVariantList(presets) }
  }).toJson(QJsonDocument::Compact));
}

const QString profileSettingsPath = QStringLiteral("DisplayPreferences/familyflix-profile-settings-v1");
const QVariantMap profileSettingsQuery{ { QStringLiteral("client"), QStringLiteral("familyflix-androidtv") } };
const QString profileSettingsKey = QStringLiteral("familyFlixProfileSettingsV1");

QString androidTheme(const QString& name)
{
  static const QHash<QString, QString> names{
    { QStringLiteral("Ocean"), QStringLiteral("DARK") },
    { QStringLiteral("Violet"), QStringLiteral("MUTED_PURPLE") },
    { QStringLiteral("Royal Blue"), QStringLiteral("ROYAL_BLUE") },
    { QStringLiteral("Forest"), QStringLiteral("EMERALD") },
    { QStringLiteral("Sunset Cinema"), QStringLiteral("SUNSET_CINEMA") },
    { QStringLiteral("Neon Arcade"), QStringLiteral("NEON_ARCADE") },
    { QStringLiteral("Cinema Noir"), QStringLiteral("CINEMA_NOIR") }
  };
  return names.value(name, name.toUpper().replace(' ', '_'));
}

QString windowsTheme(const QString& name)
{
  for (const auto& palette : palettes)
    if (androidTheme(QString::fromLatin1(palette.name)) == name)
      return QString::fromLatin1(palette.name);
  return {};
}

bool decodeProfileSettings(const QVariantMap& preferences, QVariantMap& document)
{
  const QString raw = preferences.value(QStringLiteral("CustomPrefs")).toMap()
    .value(profileSettingsKey).toString();
  if (raw.isEmpty()) return false;
  QJsonParseError error;
  const auto parsed = QJsonDocument::fromJson(raw.toUtf8(), &error);
  if (error.error != QJsonParseError::NoError || !parsed.isObject()) return false;
  document = parsed.object().toVariantMap();
  return document.value(QStringLiteral("version")).toInt() == 1
    && document.value(QStringLiteral("revision")).toLongLong() >= 0
    && document.value(QStringLiteral("values")).canConvert<QVariantMap>();
}

QVariantMap seriesPreferenceDefaults()
{
  return {
    { QStringLiteral("audioMode"), QStringLiteral("SERVER_DEFAULT") },
    { QStringLiteral("preferredAudioLanguage"), QString() },
    { QStringLiteral("subtitleMode"), QStringLiteral("SERVER_DEFAULT") },
    { QStringLiteral("preferredSubtitleLanguage"), QString() },
    { QStringLiteral("introSkipMode"), QStringLiteral("APP_DEFAULT") },
    { QStringLiteral("autoplayMode"), QStringLiteral("APP_DEFAULT") }
  };
}

bool decodeSeriesPreferenceDocument(const QVariantMap& preferences, QVariantMap& document)
{
  const QString raw = preferences.value(QStringLiteral("CustomPrefs")).toMap()
    .value(QStringLiteral("familyFlixSeriesPlaybackV1")).toString();
  if (raw.isEmpty()) { document.clear(); return true; }
  QJsonParseError error;
  const auto parsed = QJsonDocument::fromJson(raw.toUtf8(), &error);
  if (error.error != QJsonParseError::NoError || !parsed.isObject()) return false;
  document = parsed.object().toVariantMap();
  return document.value(QStringLiteral("version")).toInt() == 1
    && document.value(QStringLiteral("revision")).toLongLong() >= 0
    && document.value(QStringLiteral("values")).canConvert<QVariantMap>();
}

QString plainLibraryId(QString id)
{
  id.remove('-'); id.remove('{'); id.remove('}');
  static const QRegularExpression valid(QStringLiteral("^[0-9a-fA-F]{32}$"));
  return valid.match(id).hasMatch() ? id.toLower() : QString();
}

QStringList decodeLibraryIds(const QString& csv)
{
  QStringList result;
  for (const QString& part : csv.split(',', Qt::SkipEmptyParts)) {
    const QString id = plainLibraryId(part.trimmed());
    if (!id.isEmpty() && !result.contains(id)) result.append(id);
  }
  return result;
}

QString encodeLibraryIds(const QStringList& ids)
{
  QStringList result;
  QSet<QString> seen;
  for (const QString& value : ids) {
    const QString id = plainLibraryId(value);
    if (id.isEmpty() || seen.contains(id)) continue;
    seen.insert(id);
    result.append(id.mid(0, 8) + '-' + id.mid(8, 4) + '-' + id.mid(12, 4)
      + '-' + id.mid(16, 4) + '-' + id.mid(20, 12));
  }
  return result.join(',');
}

QStringList decodeHomeRows(const QString& encoded)
{
  QStringList rows;
  for (const QString& part : encoded.split('|', Qt::SkipEmptyParts)) {
    const QString value = part.trimmed();
    QString row;
    if (value == QStringLiteral("continue") || value == QStringLiteral("deck")
        || value == QStringLiteral("watchlist")) row = value;
    else if (value.startsWith(QStringLiteral("latest:"))) {
      const QString id = plainLibraryId(value.mid(7));
      if (!id.isEmpty()) row = QStringLiteral("latest:") + encodeLibraryIds(QStringList{ id });
    }
    if (!row.isEmpty() && !rows.contains(row)) rows.append(row);
  }
  return rows;
}
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
  if (!m_token.isEmpty() && !m_userId.isEmpty()
      && m_settings.value(QStringLiteral("profiles/%1/token").arg(m_userId)).toString().isEmpty())
    m_settings.setValue(QStringLiteral("profiles/%1/token").arg(m_userId), m_token);
  if (!m_userId.isEmpty())
    m_themeName = m_settings.value(QStringLiteral("users/%1/theme").arg(m_userId),
                                   QStringLiteral("Ocean")).toString();
  if (!m_userId.isEmpty()) {
    loadCoWatchParty(); loadKidsSettings(); refreshProfileSettings(); refreshLibraryMenuPreferences();
  }
}

QColor FamilyApiClient::themeScreen() const { return QColor(QLatin1String(paletteFor(m_themeName).screen)); }
QColor FamilyApiClient::themeSurface() const { return QColor(QLatin1String(paletteFor(m_themeName).surface)); }
QColor FamilyApiClient::themeAccent() const { return QColor(QLatin1String(paletteFor(m_themeName).accent)); }
QColor FamilyApiClient::themeAccentSecondary() const { return QColor(QLatin1String(paletteFor(m_themeName).secondary)); }
QColor FamilyApiClient::themeText() const { return QColor(QLatin1String(paletteFor(m_themeName).text)); }
QColor FamilyApiClient::themeOnAccent() const { return QColor(QLatin1String(paletteFor(m_themeName).onAccent)); }

QVariantList FamilyApiClient::themeOptions() const
{
  QVariantList options;
  for (const auto& palette : palettes) {
    options.append(QVariantMap{
      { QStringLiteral("name"), QString::fromLatin1(palette.name) },
      { QStringLiteral("screen"), QString::fromLatin1(palette.screen) },
      { QStringLiteral("accent"), QString::fromLatin1(palette.accent) },
      { QStringLiteral("secondary"), QString::fromLatin1(palette.secondary) }
    });
  }
  return options;
}

void FamilyApiClient::setTheme(const QString& name)
{
  if (m_userId.isEmpty() || name != QLatin1String(paletteFor(name).name) || name == m_themeName) return;
  m_themeName = name;
  m_settings.setValue(QStringLiteral("users/%1/theme").arg(m_userId), name);
  emit themeChanged();
  if (m_profileSettingsReady) changeProfileSetting(QStringLiteral("app_theme"), androidTheme(name));
  else refreshProfileSettings();
}

QString FamilyApiClient::mediaSegmentAction(const QString& type) const
{
  static const QSet<QString> supported = { QStringLiteral("Intro"), QStringLiteral("Outro"),
    QStringLiteral("Preview"), QStringLiteral("Recap"), QStringLiteral("Commercial") };
  if (!supported.contains(type)) return QStringLiteral("Off");
  const QString fallback = type == QStringLiteral("Intro") || type == QStringLiteral("Outro")
    ? QStringLiteral("Ask") : QStringLiteral("Off");
  if (type == QStringLiteral("Intro")) {
    if (m_activeSeriesIntroSkipMode == QStringLiteral("ASK")) return QStringLiteral("Ask");
    if (m_activeSeriesIntroSkipMode == QStringLiteral("AUTO_SKIP")) return QStringLiteral("Auto");
    if (m_activeSeriesIntroSkipMode == QStringLiteral("DO_NOT_SKIP")) return QStringLiteral("Off");
  }
  return m_settings.value(QStringLiteral("users/%1/segments/%2").arg(m_userId, type), fallback).toString();
}

void FamilyApiClient::refreshSeriesPlaybackPreferences(const QString& seriesId)
{
  const quint64 session = m_sessionRevision;
  const quint64 revision = ++m_seriesPlaybackPreferencesRevision;
  m_activeSeriesId = seriesId;
  m_activeSeriesIntroSkipMode = QStringLiteral("APP_DEFAULT");
  m_activeSeriesAutoplayMode = QStringLiteral("APP_DEFAULT");
  m_activeSeriesValues = seriesPreferenceDefaults();
  m_activeSeriesPreferencesReady = false;
  m_activeSeriesPreferencesWriteActive = false;
  emit seriesPlaybackPreferencesChanged();
  emit mediaSegmentsChanged();
  static const QRegularExpression validId(QStringLiteral("^[0-9a-fA-F]{32}$"));
  if (!signedIn() || !validId.match(seriesId).hasMatch()) return;
  request("GET", QStringLiteral("DisplayPreferences/familyflix-series-playback-v1-%1").arg(seriesId),
          { { QStringLiteral("client"), QStringLiteral("familyflix") } }, {},
          [this, session, revision, seriesId](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision || revision != m_seriesPlaybackPreferencesRevision
        || m_activeSeriesId != seriesId || !error.isEmpty()) return;
    QVariantMap document;
    if (!decodeSeriesPreferenceDocument(data.toMap(), document)) return;
    QVariantMap values = seriesPreferenceDefaults();
    const QVariantMap remoteValues = document.value(QStringLiteral("values")).toMap();
    for (auto it = remoteValues.cbegin(); it != remoteValues.cend(); ++it)
      values.insert(it.key(), it.value());
    m_activeSeriesValues = values;
    m_activeSeriesPreferencesReady = true;
    const QString intro = values.value(QStringLiteral("introSkipMode")).toString();
    if (QStringList{ QStringLiteral("APP_DEFAULT"), QStringLiteral("ASK"),
                     QStringLiteral("AUTO_SKIP"), QStringLiteral("DO_NOT_SKIP") }.contains(intro))
      m_activeSeriesIntroSkipMode = intro;
    const QString autoplay = values.value(QStringLiteral("autoplayMode")).toString();
    if (QStringList{ QStringLiteral("APP_DEFAULT"), QStringLiteral("PLAY_NEXT"),
                     QStringLiteral("STOP_AFTER_EPISODE") }.contains(autoplay))
      m_activeSeriesAutoplayMode = autoplay;
    emit seriesPlaybackPreferencesChanged();
    emit mediaSegmentsChanged();
  });
}

void FamilyApiClient::setActiveSeriesPlaybackPreference(const QString& key, const QString& value)
{
  static const QHash<QString, QStringList> allowed{
    { QStringLiteral("audioMode"), { QStringLiteral("SERVER_DEFAULT"), QStringLiteral("PREFER_LANGUAGE"),
      QStringLiteral("REMEMBER_LAST_SELECTION") } },
    { QStringLiteral("subtitleMode"), { QStringLiteral("SERVER_DEFAULT"), QStringLiteral("OFF"),
      QStringLiteral("FORCED_ONLY"), QStringLiteral("FULL") } },
    { QStringLiteral("introSkipMode"), { QStringLiteral("APP_DEFAULT"), QStringLiteral("ASK"),
      QStringLiteral("AUTO_SKIP"), QStringLiteral("DO_NOT_SKIP") } },
    { QStringLiteral("autoplayMode"), { QStringLiteral("APP_DEFAULT"), QStringLiteral("PLAY_NEXT"),
      QStringLiteral("STOP_AFTER_EPISODE") } }
  };
  static const QRegularExpression validLanguage(QStringLiteral("^[A-Za-z0-9_-]{0,32}$"));
  const bool languageKey = key == QStringLiteral("preferredAudioLanguage")
    || key == QStringLiteral("preferredSubtitleLanguage");
  if (!signedIn() || !m_activeSeriesPreferencesReady || m_activeSeriesPreferencesWriteActive
      || !(languageKey ? validLanguage.match(value).hasMatch() : allowed.value(key).contains(value))
      || m_activeSeriesId.isEmpty()) return;
  m_activeSeriesPreferencesWriteActive = true;
  emit seriesPlaybackPreferencesChanged();
  const quint64 session = m_sessionRevision;
  const quint64 revision = m_seriesPlaybackPreferencesRevision;
  const QString seriesId = m_activeSeriesId;
  const QVariant oldValue = m_activeSeriesValues.value(key);
  const QString path = QStringLiteral("DisplayPreferences/familyflix-series-playback-v1-%1").arg(seriesId);
  const QVariantMap query{ { QStringLiteral("client"), QStringLiteral("familyflix") } };
  request("GET", path, query, {}, [this, session, revision, seriesId, key, value, oldValue, path, query]
          (const QVariant& data, const QString& error) {
    if (session != m_sessionRevision || revision != m_seriesPlaybackPreferencesRevision
        || m_activeSeriesId != seriesId) return;
    QVariantMap document;
    if (!error.isEmpty() || !decodeSeriesPreferenceDocument(data.toMap(), document)) {
      m_activeSeriesPreferencesWriteActive = false;
      emit seriesPlaybackPreferencesChanged();
      emit errorOccurred(QStringLiteral("Series preferences could not be read safely."));
      return;
    }
    QVariantMap values = seriesPreferenceDefaults();
    const QVariantMap remoteValues = document.value(QStringLiteral("values")).toMap();
    for (auto it = remoteValues.cbegin(); it != remoteValues.cend(); ++it)
      values.insert(it.key(), it.value());
    if (values.value(key) != oldValue) {
      m_activeSeriesPreferencesWriteActive = false;
      refreshSeriesPlaybackPreferences(seriesId);
      emit errorOccurred(QStringLiteral("A newer series choice from another device was kept."));
      return;
    }
    values.insert(key, value);
    const qlonglong nextRevision = document.isEmpty() ? 1
      : document.value(QStringLiteral("revision")).toLongLong() + 1;
    document.insert(QStringLiteral("version"), 1);
    document.insert(QStringLiteral("revision"), nextRevision);
    document.insert(QStringLiteral("updatedAtEpochMillis"), QDateTime::currentMSecsSinceEpoch());
    document.insert(QStringLiteral("writerDeviceId"), m_deviceId);
    document.insert(QStringLiteral("values"), values);
    QVariantMap preferences = data.toMap();
    QVariantMap custom = preferences.value(QStringLiteral("CustomPrefs")).toMap();
    custom.insert(QStringLiteral("familyFlixSeriesPlaybackV1"), QString::fromUtf8(
      QJsonDocument(QJsonObject::fromVariantMap(document)).toJson(QJsonDocument::Compact)));
    preferences.insert(QStringLiteral("CustomPrefs"), custom);
    request("POST", path, query,
            QJsonDocument(QJsonObject::fromVariantMap(preferences)).toJson(QJsonDocument::Compact),
            [this, session, revision, seriesId, key, value, path, query, nextRevision]
            (const QVariant&, const QString& writeError) {
      if (session != m_sessionRevision || revision != m_seriesPlaybackPreferencesRevision
          || m_activeSeriesId != seriesId) return;
      if (!writeError.isEmpty()) {
        m_activeSeriesPreferencesWriteActive = false;
        emit seriesPlaybackPreferencesChanged();
        emit errorOccurred(QStringLiteral("Series preference could not be saved."));
        return;
      }
      request("GET", path, query, {},
              [this, session, revision, seriesId, key, value, nextRevision]
              (const QVariant& verified, const QString& verifyError) {
        if (session != m_sessionRevision || revision != m_seriesPlaybackPreferencesRevision
            || m_activeSeriesId != seriesId) return;
        m_activeSeriesPreferencesWriteActive = false;
        QVariantMap verifiedDocument;
        if (!verifyError.isEmpty() || !decodeSeriesPreferenceDocument(verified.toMap(), verifiedDocument)
            || verifiedDocument.value(QStringLiteral("revision")).toLongLong() != nextRevision
            || verifiedDocument.value(QStringLiteral("writerDeviceId")).toString() != m_deviceId
            || verifiedDocument.value(QStringLiteral("values")).toMap().value(key).toString() != value) {
          emit seriesPlaybackPreferencesChanged();
          refreshSeriesPlaybackPreferences(seriesId);
          emit errorOccurred(QStringLiteral("Series choice changed elsewhere; the latest saved choice was kept."));
          return;
        }
        m_activeSeriesValues = verifiedDocument.value(QStringLiteral("values")).toMap();
        m_activeSeriesIntroSkipMode = m_activeSeriesValues.value(QStringLiteral("introSkipMode")).toString();
        m_activeSeriesAutoplayMode = m_activeSeriesValues.value(QStringLiteral("autoplayMode")).toString();
        emit seriesPlaybackPreferencesChanged();
        emit mediaSegmentsChanged();
      });
    });
  });
}

void FamilyApiClient::setMediaSegmentAction(const QString& type, const QString& action)
{
  static const QSet<QString> supported = { QStringLiteral("Intro"), QStringLiteral("Outro"),
    QStringLiteral("Preview"), QStringLiteral("Recap"), QStringLiteral("Commercial") };
  static const QSet<QString> actions = { QStringLiteral("Off"), QStringLiteral("Ask"), QStringLiteral("Auto") };
  if (m_userId.isEmpty() || !supported.contains(type) || !actions.contains(action)) return;
  m_settings.setValue(QStringLiteral("users/%1/segments/%2").arg(m_userId, type), action);
  emit mediaSegmentsChanged();
  if (!m_profileSettingsReady) { refreshProfileSettings(); return; }
  QStringList entries = m_profileSettingsValues.value(QStringLiteral("media_segment_actions")).toString()
    .split(',', Qt::SkipEmptyParts);
  const QString prefix = type + '=';
  entries.removeIf([&prefix](const QString& entry) { return entry.startsWith(prefix); });
  entries.append(prefix + (action == QStringLiteral("Ask") ? QStringLiteral("ASK_TO_SKIP")
    : action == QStringLiteral("Auto") ? QStringLiteral("SKIP") : QStringLiteral("NOTHING")));
  changeProfileSetting(QStringLiteral("media_segment_actions"), entries.join(','));
}

void FamilyApiClient::refreshProfileSettings()
{
  if (!signedIn()) return;
  const quint64 session = m_sessionRevision;
  const quint64 revision = ++m_profileSettingsRevision;
  request("GET", profileSettingsPath, profileSettingsQuery, {},
          [this, session, revision](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision || revision != m_profileSettingsRevision) return;
    QVariantMap document;
    if (!error.isEmpty() || !decodeProfileSettings(data.toMap(), document)) return;
    m_profileSettingsValues = document.value(QStringLiteral("values")).toMap();
    m_profileSettingsReady = true;
    applyProfileSettings(m_profileSettingsValues);
    flushProfileSetting();
  });
}

void FamilyApiClient::applyProfileSettings(const QVariantMap& values)
{
  const QString theme = windowsTheme(values.value(QStringLiteral("app_theme")).toString());
  if (!theme.isEmpty() && theme != m_themeName) {
    m_themeName = theme;
    m_settings.setValue(QStringLiteral("users/%1/theme").arg(m_userId), theme);
    emit themeChanged();
  }
  const QString next = values.value(QStringLiteral("next_up_behavior")).toString();
  const QString mode = next == QStringLiteral("DISABLED") ? QStringLiteral("Off")
    : next == QStringLiteral("MINIMAL") ? QStringLiteral("Minimal")
    : next == QStringLiteral("EXTENDED") ? QStringLiteral("Extended") : QString();
  if (!mode.isEmpty() && mode != m_nextUpMode) {
    m_nextUpMode = mode;
    m_settings.setValue(QStringLiteral("users/%1/nextUpMode").arg(m_userId), mode);
    emit nextUpModeChanged();
  }
  const QString queuing = values.value(QStringLiteral("pref_enable_tv_queuing")).toString();
  if (queuing == QStringLiteral("true") || queuing == QStringLiteral("false")) {
    const bool enabled = queuing == QStringLiteral("true");
    if (enabled != m_mediaQueuingEnabled) {
      m_mediaQueuingEnabled = enabled;
      emit nextUpModeChanged();
    }
  }
  const QString backdrop = values.value(QStringLiteral("pref_show_backdrop")).toString();
  if (backdrop == QStringLiteral("true") || backdrop == QStringLiteral("false")) {
    const bool enabled = backdrop == QStringLiteral("true");
    if (enabled != m_backdropEnabled) { m_backdropEnabled = enabled; emit profileAppearanceChanged(); }
  }
  const QString clock = values.value(QStringLiteral("pref_clock_behavior")).toString();
  if (QStringList{ QStringLiteral("ALWAYS"), QStringLiteral("IN_MENUS"),
                   QStringLiteral("IN_VIDEO"), QStringLiteral("NEVER") }.contains(clock)
      && clock != m_clockBehavior) {
    m_clockBehavior = clock;
    emit profileAppearanceChanged();
  }
  const QString segments = values.value(QStringLiteral("media_segment_actions")).toString();
  if (!segments.isNull()) {
    for (const QString& type : { QStringLiteral("Intro"), QStringLiteral("Outro"),
                                 QStringLiteral("Preview"), QStringLiteral("Recap"),
                                 QStringLiteral("Commercial") })
      m_settings.setValue(QStringLiteral("users/%1/segments/%2").arg(m_userId, type),
        type == QStringLiteral("Intro") || type == QStringLiteral("Outro")
          ? QStringLiteral("Ask") : QStringLiteral("Off"));
  }
  for (const auto& entry : segments.split(',', Qt::SkipEmptyParts)) {
    const QStringList parts = entry.split('=');
    if (parts.size() != 2) continue;
    const QString action = parts[1] == QStringLiteral("ASK_TO_SKIP") ? QStringLiteral("Ask")
      : parts[1] == QStringLiteral("SKIP") ? QStringLiteral("Auto")
      : parts[1] == QStringLiteral("NOTHING") ? QStringLiteral("Off") : QString();
    if (action.isEmpty()) continue;
    m_settings.setValue(QStringLiteral("users/%1/segments/%2").arg(m_userId, parts[0]), action);
  }
  emit mediaSegmentsChanged();
}

void FamilyApiClient::changeProfileSetting(const QString& key, const QString& value)
{
  if (!signedIn()) return;
  m_pendingProfileSettings.insert(key, value);
  if (m_profileSettingsReady) flushProfileSetting();
  else refreshProfileSettings();
}

void FamilyApiClient::flushProfileSetting()
{
  if (!m_profileSettingsReady || m_profileSettingsWriteActive || m_pendingProfileSettings.isEmpty()) return;
  m_profileSettingsWriteActive = true;
  const quint64 session = m_sessionRevision;
  const QVariantMap pending = m_pendingProfileSettings;
  const QVariantMap base = m_profileSettingsValues;
  m_pendingProfileSettings.clear();
  request("GET", profileSettingsPath, profileSettingsQuery, {},
          [this, session, pending, base](const QVariant& data, const QString& error) {
    QVariantMap document;
    if (session != m_sessionRevision) return;
    if (!error.isEmpty() || !decodeProfileSettings(data.toMap(), document)) {
      m_profileSettingsWriteActive = false;
      emit errorOccurred(QStringLiteral("Profile settings could not be synced."));
      return;
    }
    const QVariantMap remote = document.value(QStringLiteral("values")).toMap();
    QVariantMap updated = remote;
    for (auto it = pending.cbegin(); it != pending.cend(); ++it) {
      if (remote.value(it.key()) == base.value(it.key())) updated.insert(it.key(), it.value());
      else emit errorOccurred(QStringLiteral("A newer profile setting from another device was kept."));
    }
    if (updated == remote) {
      m_profileSettingsValues = remote;
      applyProfileSettings(remote);
      m_profileSettingsWriteActive = false;
      flushProfileSetting();
      return;
    }
    document.insert(QStringLiteral("revision"), document.value(QStringLiteral("revision")).toLongLong() + 1);
    document.insert(QStringLiteral("updatedAtEpochMillis"), QDateTime::currentMSecsSinceEpoch());
    document.insert(QStringLiteral("writerDeviceId"), m_deviceId);
    document.insert(QStringLiteral("values"), updated);
    QVariantMap preferences = data.toMap();
    QVariantMap custom = preferences.value(QStringLiteral("CustomPrefs")).toMap();
    custom.insert(profileSettingsKey, QString::fromUtf8(QJsonDocument(QJsonObject::fromVariantMap(document))
      .toJson(QJsonDocument::Compact)));
    preferences.insert(QStringLiteral("CustomPrefs"), custom);
    request("POST", profileSettingsPath, profileSettingsQuery,
            QJsonDocument(QJsonObject::fromVariantMap(preferences)).toJson(QJsonDocument::Compact),
            [this, session, updated](const QVariant&, const QString& writeError) {
      if (session != m_sessionRevision) return;
      m_profileSettingsWriteActive = false;
      if (writeError.isEmpty()) {
        m_profileSettingsValues = updated;
        applyProfileSettings(updated);
      } else emit errorOccurred(QStringLiteral("Profile settings could not be saved."));
      flushProfileSetting();
    });
  });
}

void FamilyApiClient::refreshMediaSegments(const QString& itemId)
{
  const quint64 revision = ++m_mediaSegmentsRevision;
  const quint64 session = m_sessionRevision;
  m_mediaSegments.clear();
  emit mediaSegmentsChanged();
  if (!signedIn() || itemId.isEmpty()) return;
  request("GET", QStringLiteral("MediaSegments/%1").arg(itemId),
          { { QStringLiteral("includeSegmentTypes"),
              QStringLiteral("Intro,Outro,Preview,Recap,Commercial") } }, {},
          [this, revision, session](const QVariant& data, const QString& error) {
    if (revision != m_mediaSegmentsRevision || session != m_sessionRevision) return;
    if (!error.isEmpty()) return;
    m_mediaSegments = items(data);
    emit mediaSegmentsChanged();
  });
}

void FamilyApiClient::reportIssue(const QString& itemId, const QString& category, const QString& note)
{
  static const QSet<QString> categories = { QStringLiteral("noAudio"),
    QStringLiteral("wrongEpisode"), QStringLiteral("brokenVideo"),
    QStringLiteral("subtitles"), QStringLiteral("introTiming"), QStringLiteral("other") };
  if (!signedIn() || itemId.isEmpty() || !categories.contains(category) || note.size() > 1000) return;
  const quint64 session = m_sessionRevision;
  const QVariantMap report{
    { QStringLiteral("operationId"), QUuid::createUuid().toString(QUuid::WithoutBraces) },
    { QStringLiteral("itemId"), itemId },
    { QStringLiteral("category"), category },
    { QStringLiteral("note"), note.trimmed() },
    { QStringLiteral("deviceName"), QStringLiteral("Family Flix Windows") },
    { QStringLiteral("appVersion"), QCoreApplication::applicationVersion() }
  };
  request("POST", QStringLiteral("FamilyFlix/Issues/Reports"), {},
          QJsonDocument(QJsonObject::fromVariantMap(report)).toJson(QJsonDocument::Compact),
          [this, session, itemId](const QVariant&, const QString& error) {
    if (session != m_sessionRevision) return;
    if (!error.isEmpty()) {
      emit issueReportFinished(false, QStringLiteral("Could not send the report. Please try again."));
      return;
    }
    emit issueReportFinished(true, QStringLiteral("Problem report sent."));
    if (m_selectedItem.value(QStringLiteral("Id")).toString() == itemId) openItem(itemId);
  });
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
  requestAs(method, path, query, body, m_token, m_userId, std::move(handler));
}

void FamilyApiClient::requestAs(const QByteArray& method, const QString& path,
                                const QVariantMap& query, const QByteArray& body,
                                const QString& token, const QString& userId,
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
  const QString deviceId = userId.isEmpty() || userId == m_userId
    ? m_deviceId : QStringLiteral("%1-%2").arg(m_deviceId, userId.left(8));
  QString authorization = QStringLiteral(
    "MediaBrowser Client=\"Family Flix Windows\", Device=\"Windows\", "
    "DeviceId=\"%1\", Version=\"0.1\"").arg(deviceId);
  if (!publicRequest && !token.isEmpty()) {
    authorization += QStringLiteral(", Token=\"%1\"").arg(token);
    networkRequest.setRawHeader("X-Emby-Token", token.toUtf8());
  }
  networkRequest.setRawHeader("Authorization", authorization.toUtf8());
  networkRequest.setRawHeader("X-Emby-Authorization", authorization.toUtf8());
  if (!body.isEmpty()) networkRequest.setHeader(QNetworkRequest::ContentTypeHeader,
                                                QStringLiteral("application/json"));
  QNetworkReply* reply = method == "POST" ? m_network.post(networkRequest, body)
                       : method == "PUT" ? m_network.put(networkRequest, body)
                       : method == "DELETE" ? m_network.sendCustomRequest(networkRequest, "DELETE", body)
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
    const QString series = deckSeriesId(item);
    if (!untouchedEpisode(item) || series.isEmpty() || seen.contains(series)) continue;
    seen.insert(series);
    result.append(item);
    if (result.size() == 15) break;
  }
  return result;
}

void FamilyApiClient::correctDeckFromRecent()
{
  if (!m_deckFallbackReady || !m_recentDeckActivityReady || m_deckCorrectionStarted) return;
  m_deckCorrectionStarted = true;
  const quint64 session = m_sessionRevision;
  const quint64 home = m_homeRevision;
  const QString feedUserId = m_homeFeedUserId;
  const QString feedToken = m_homeFeedToken;
  QSet<QString> handled;
  int checked = 0;
  // DatePlayed descending makes the first qualified row the active playback anchor.
  for (const auto& value : m_recentDeckActivity) {
    const auto latest = value.toMap();
    const QString series = deckSeriesId(latest);
    const int seasonNumber = latest.value(QStringLiteral("ParentIndexNumber")).toInt();
    const int episodeNumber = latest.value(QStringLiteral("IndexNumberEnd"),
                                           latest.value(QStringLiteral("IndexNumber"))).toInt();
    const auto state = latest.value(QStringLiteral("UserData")).toMap();
    if (series.isEmpty() || handled.contains(series) || seasonNumber <= 0 || episodeNumber <= 0
        || state.value(QStringLiteral("LastPlayedDate")).toString().isEmpty()) continue;
    int fallbackIndex = -1;
    for (int index = 0; index < m_deckItems.size(); ++index) {
      if (deckSeriesId(m_deckItems[index].toMap()) == series) {
        fallbackIndex = index;
        break;
      }
    }
    if (fallbackIndex < 0) continue;
    handled.insert(series);
    if (++checked > 8) break;
    if (!state.value(QStringLiteral("Played")).toBool()
        && state.value(QStringLiteral("PlaybackPositionTicks")).toLongLong() > 0) {
      m_deckItems.removeAt(fallbackIndex);
      emit homeChanged();
      continue;
    }
    const int firstEligible = episodeNumber + (state.value(QStringLiteral("Played")).toBool() ? 1 : 0);
    const auto fallback = m_deckItems[fallbackIndex].toMap();
    if (fallback.value(QStringLiteral("ParentIndexNumber")).toInt() == seasonNumber
        && fallback.value(QStringLiteral("IndexNumber")).toInt() == firstEligible) continue;
    const QString seasonId = latest.value(QStringLiteral("SeasonId")).toString();
    if (seasonId.isEmpty()) continue;
    requestAs("GET", QStringLiteral("Users/%1/Items").arg(feedUserId),
            { { QStringLiteral("ParentId"), seasonId },
              { QStringLiteral("Recursive"), true },
              { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode") },
              { QStringLiteral("IsPlayed"), false },
              { QStringLiteral("IsMissing"), false },
              { QStringLiteral("SortBy"), QStringLiteral("IndexNumber") },
              { QStringLiteral("SortOrder"), QStringLiteral("Ascending") },
              { QStringLiteral("EnableUserData"), true },
              { QStringLiteral("Limit"), 250 } }, {}, feedToken, feedUserId,
            [this, session, home, series, seasonNumber, firstEligible](const QVariant& response, const QString& error, int) {
      if (session != m_sessionRevision || home != m_homeRevision || !error.isEmpty()) return;
      QVariantMap replacement;
      for (const auto& value : items(response)) {
        const auto candidate = value.toMap();
        if (deckSeriesId(candidate) != series
            || candidate.value(QStringLiteral("ParentIndexNumber")).toInt() != seasonNumber
            || candidate.value(QStringLiteral("IndexNumber")).toInt() < firstEligible
            || !untouchedEpisode(candidate)) continue;
        if (replacement.isEmpty()
            || candidate.value(QStringLiteral("IndexNumber")).toInt()
                < replacement.value(QStringLiteral("IndexNumber")).toInt()) replacement = candidate;
      }
      if (replacement.isEmpty()) return;
      for (int index = 0; index < m_deckItems.size(); ++index) {
        if (deckSeriesId(m_deckItems[index].toMap()) != series) continue;
        m_deckItems[index] = replacement;
        emit homeChanged();
        break;
      }
    });
  }
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

QString FamilyApiClient::homeRowIdForLibrary(const QString& libraryId) const
{
  const QString id = plainLibraryId(libraryId);
  return id.isEmpty() ? QString() : QStringLiteral("latest:") + encodeLibraryIds(QStringList{ id });
}

QVariantList FamilyApiClient::homeLayoutRows() const
{
  QVariantList result;
  QStringList available{ QStringLiteral("continue"), QStringLiteral("deck"), QStringLiteral("watchlist") };
  QHash<QString, QString> labels{
    { QStringLiteral("continue"), QStringLiteral("Continue Watching") },
    { QStringLiteral("deck"), QStringLiteral("The Deck") },
    { QStringLiteral("watchlist"), QStringLiteral("Watchlist") }
  };
  for (const auto& value : m_libraries) {
    const auto library = value.toMap();
    const QString id = homeRowIdForLibrary(library.value(QStringLiteral("Id")).toString());
    if (id.isEmpty() || available.contains(id)) continue;
    available.append(id);
    labels.insert(id, QStringLiteral("Latest in %1").arg(library.value(QStringLiteral("Name")).toString()));
  }
  QStringList order;
  for (const QString& id : m_homeRowOrder)
    if (available.contains(id) && !order.contains(id)) order.append(id);
  for (const QString& id : available)
    if (!order.contains(id)) order.append(id);
  for (const QString& id : order)
    result.append(QVariantMap{ { QStringLiteral("id"), id },
      { QStringLiteral("label"), labels.value(id) },
      { QStringLiteral("visible"), !m_hiddenHomeRows.contains(id) } });
  return result;
}

void FamilyApiClient::setHomeRowVisible(const QString& rowId, bool visible)
{
  if (!signedIn()) return;
  bool available = false;
  for (const auto& value : homeLayoutRows())
    if (value.toMap().value(QStringLiteral("id")).toString() == rowId) { available = true; break; }
  if (!available) return;
  m_hiddenHomeRows.removeAll(rowId);
  if (!visible) m_hiddenHomeRows.append(rowId);
  emit homeChanged();
  changeLibraryMenuPreference(QStringLiteral("familyTvHiddenHomeRowsV1"), m_hiddenHomeRows.join('|'));
}

void FamilyApiClient::moveHomeRow(const QString& rowId, int offset)
{
  if (!signedIn() || offset == 0) return;
  QStringList order;
  for (const auto& value : homeLayoutRows())
    order.append(value.toMap().value(QStringLiteral("id")).toString());
  const int from = order.indexOf(rowId);
  if (from < 0) return;
  const int to = qBound(0, from + offset, int(order.size()) - 1);
  if (to == from) return;
  order.move(from, to);
  m_homeRowOrder = order;
  emit homeChanged();
  changeLibraryMenuPreference(QStringLiteral("familyTvHomeRowOrderV1"), m_homeRowOrder.join('|'));
}

void FamilyApiClient::refreshLibraryMenuPreferences()
{
  if (!signedIn()) return;
  const quint64 session = m_sessionRevision;
  const quint64 revision = ++m_libraryMenuPrefsRevision;
  request("GET", QStringLiteral("DisplayPreferences/usersettings"),
          { { QStringLiteral("client"), QStringLiteral("emby") } }, {},
          [this, session, revision](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision || revision != m_libraryMenuPrefsRevision || !error.isEmpty()) return;
    m_libraryMenuPrefsValues = data.toMap().value(QStringLiteral("CustomPrefs")).toMap();
    m_libraryMenuPrefsReady = true;
    if (m_libraryMenuPending.isEmpty()) applyLibraryMenuPreferences(m_libraryMenuPrefsValues);
    else flushLibraryMenuPreferences();
  });
}

void FamilyApiClient::applyLibraryMenuPreferences(const QVariantMap& customPrefs)
{
  if (!signedIn()) return;
  const QStringList order = decodeLibraryIds(
    customPrefs.value(QStringLiteral("familyTvLibraryMenuOrderV1")).toString());
  const QStringList hidden = decodeLibraryIds(
    customPrefs.value(QStringLiteral("familyTvHiddenLibrariesV1")).toString());
  const QStringList homeOrder = decodeHomeRows(
    customPrefs.value(QStringLiteral("familyTvHomeRowOrderV1")).toString());
  const QStringList homeHidden = decodeHomeRows(
    customPrefs.value(QStringLiteral("familyTvHiddenHomeRowsV1")).toString());
  const QString orderKey = QStringLiteral("users/%1/libraryMenuOrder").arg(m_userId);
  const QString hiddenKey = QStringLiteral("users/%1/hiddenLibraryIds").arg(m_userId);
  const bool changed = m_settings.value(orderKey).toStringList() != order
    || m_settings.value(hiddenKey).toStringList() != hidden;
  const bool layoutChanged = m_homeRowOrder != homeOrder || m_hiddenHomeRows != homeHidden;
  m_settings.setValue(orderKey, order);
  m_settings.setValue(hiddenKey, hidden);
  m_homeRowOrder = homeOrder;
  m_hiddenHomeRows = homeHidden;
  if (changed) refreshHome();
  else if (layoutChanged) emit homeChanged();
}

void FamilyApiClient::changeLibraryMenuPreference(const QString& key, const QString& value)
{
  if (!signedIn()) return;
  m_libraryMenuPending.insert(key, value);
  if (m_libraryMenuPrefsReady) flushLibraryMenuPreferences();
  else refreshLibraryMenuPreferences();
}

void FamilyApiClient::flushLibraryMenuPreferences()
{
  if (!m_libraryMenuPrefsReady || m_libraryMenuWriteActive || m_libraryMenuPending.isEmpty()) return;
  m_libraryMenuWriteActive = true;
  const quint64 session = m_sessionRevision;
  const QVariantMap pending = m_libraryMenuPending;
  const QVariantMap base = m_libraryMenuPrefsValues;
  m_libraryMenuPending.clear();
  const QString path = QStringLiteral("DisplayPreferences/usersettings");
  const QVariantMap query{ { QStringLiteral("client"), QStringLiteral("emby") } };
  request("GET", path, query, {}, [this, session, pending, base, path, query]
          (const QVariant& data, const QString& error) {
    if (session != m_sessionRevision) return;
    if (!error.isEmpty()) {
      for (auto it = pending.cbegin(); it != pending.cend(); ++it)
        if (!m_libraryMenuPending.contains(it.key())) m_libraryMenuPending.insert(it.key(), it.value());
      m_libraryMenuWriteActive = false;
      emit errorOccurred(QStringLiteral("Library menu choices could not be synced."));
      return;
    }
    QVariantMap preferences = data.toMap();
    QVariantMap remote = preferences.value(QStringLiteral("CustomPrefs")).toMap();
    QVariantMap updated = remote;
    for (auto it = pending.cbegin(); it != pending.cend(); ++it) {
      if (remote.value(it.key()).toString() == base.value(it.key()).toString())
        updated.insert(it.key(), it.value());
      else emit errorOccurred(QStringLiteral("A newer library menu choice from another device was kept."));
    }
    if (updated == remote) {
      m_libraryMenuPrefsValues = remote;
      m_libraryMenuWriteActive = false;
      if (m_libraryMenuPending.isEmpty()) applyLibraryMenuPreferences(remote);
      else flushLibraryMenuPreferences();
      return;
    }
    preferences.insert(QStringLiteral("CustomPrefs"), updated);
    request("POST", path, query,
            QJsonDocument(QJsonObject::fromVariantMap(preferences)).toJson(QJsonDocument::Compact),
            [this, session, pending, updated](const QVariant&, const QString& writeError) {
      if (session != m_sessionRevision) return;
      m_libraryMenuWriteActive = false;
      if (!writeError.isEmpty()) {
        for (auto it = pending.cbegin(); it != pending.cend(); ++it)
          if (!m_libraryMenuPending.contains(it.key())) m_libraryMenuPending.insert(it.key(), it.value());
        emit errorOccurred(QStringLiteral("Library menu choice could not be saved."));
        return;
      }
      m_libraryMenuPrefsValues = updated;
      if (m_libraryMenuPending.isEmpty()) applyLibraryMenuPreferences(updated);
      else flushLibraryMenuPreferences();
    });
  });
}

bool FamilyApiClient::libraryVisibleInRail(const QString& libraryId) const
{
  const auto hidden = m_settings.value(QStringLiteral("users/%1/hiddenLibraryIds").arg(m_userId)).toStringList();
  return !hidden.contains(plainLibraryId(libraryId));
}

void FamilyApiClient::setLibraryVisibleInRail(const QString& libraryId, bool visible)
{
  if (m_userId.isEmpty() || libraryId.isEmpty()) return;
  const QString key = QStringLiteral("users/%1/hiddenLibraryIds").arg(m_userId);
  QStringList hidden = m_settings.value(key).toStringList();
  const QString normalized = plainLibraryId(libraryId);
  if (normalized.isEmpty()) return;
  hidden.removeAll(normalized);
  if (!visible) hidden.append(normalized);
  m_settings.setValue(key, hidden);
  emit homeChanged();
  changeLibraryMenuPreference(QStringLiteral("familyTvHiddenLibrariesV1"), encodeLibraryIds(hidden));
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
  QStringList normalizedOrder;
  for (const QString& id : order) normalizedOrder.append(plainLibraryId(id));
  m_settings.setValue(QStringLiteral("users/%1/libraryMenuOrder").arg(m_userId), normalizedOrder);
  changeLibraryMenuPreference(QStringLiteral("familyTvLibraryMenuOrderV1"), encodeLibraryIds(order));
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
    reconcileCoWatchParty();
    emit publicUsersChanged();
    if (signedIn()) refreshGroupDeck(m_sessionRevision, m_homeRevision);
  });
}

QVariantList FamilyApiClient::coWatchProfiles() const
{
  if (m_userId.isEmpty()) return {};
  QVariantList result{ QVariantMap{
    { QStringLiteral("Id"), m_userId }, { QStringLiteral("Name"), m_userName },
    { QStringLiteral("IsCurrent"), true } } };
  for (const auto& value : m_publicUsers) {
    const auto profile = value.toMap();
    if (m_coWatchUserIds.contains(profile.value(QStringLiteral("Id")).toString()))
      result.append(profile);
  }
  return result;
}

QString FamilyApiClient::coWatchLabel() const
{
  QStringList names;
  for (const auto& value : coWatchProfiles())
    names.append(value.toMap().value(QStringLiteral("Name")).toString());
  return names.join(QLatin1Char('/'));
}

void FamilyApiClient::loadCoWatchParty()
{
  m_coWatchUserIds = m_settings.value(QStringLiteral("users/%1/coWatchUsers").arg(m_userId)).toStringList();
  m_coWatchUserIds.removeAll(m_userId);
  m_coWatchUserIds.removeDuplicates();
  m_homeFeedOwnerId = m_settings.value(QStringLiteral("users/%1/coWatchFeedOwner").arg(m_userId),
                                      m_userId).toString();
  m_combinedGroupDeckEnabled = m_settings.value(
    QStringLiteral("users/%1/combinedGroupDeck").arg(m_userId), true).toBool();
  if (m_coWatchUserIds.isEmpty() || (m_homeFeedOwnerId != m_userId
      && !m_coWatchUserIds.contains(m_homeFeedOwnerId))) m_homeFeedOwnerId = m_userId;
  emit coWatchChanged();
}

void FamilyApiClient::saveCoWatchParty()
{
  if (m_userId.isEmpty()) return;
  m_settings.setValue(QStringLiteral("users/%1/coWatchUsers").arg(m_userId), m_coWatchUserIds);
  m_settings.setValue(QStringLiteral("users/%1/coWatchFeedOwner").arg(m_userId), m_homeFeedOwnerId);
  emit coWatchChanged();
}

void FamilyApiClient::reconcileCoWatchParty()
{
  if (m_userId.isEmpty()) return;
  QStringList allowed;
  for (const auto& id : m_coWatchUserIds) {
    if (hasSavedProfile(id) && id != m_userId) allowed.append(id);
  }
  if (allowed == m_coWatchUserIds) return;
  if (m_coWatchPlayback) m_coWatchPlayback->abandoned = true;
  m_coWatchUserIds = allowed;
  if (m_homeFeedOwnerId != m_userId && !allowed.contains(m_homeFeedOwnerId))
    m_homeFeedOwnerId = m_userId;
  saveCoWatchParty();
  refreshHome();
}

bool FamilyApiClient::setCoWatchProfile(const QString& userId, bool selected)
{
  if (!signedIn() || userId == m_userId || !hasSavedProfile(userId)) return false;
  if (m_coWatchPlayback) m_coWatchPlayback->abandoned = true;
  if (selected && !m_coWatchUserIds.contains(userId)) m_coWatchUserIds.append(userId);
  else if (!selected) m_coWatchUserIds.removeAll(userId);
  if (m_homeFeedOwnerId != m_userId && !m_coWatchUserIds.contains(m_homeFeedOwnerId))
    m_homeFeedOwnerId = m_userId;
  saveCoWatchParty();
  refreshHome();
  return true;
}

void FamilyApiClient::setHomeFeedOwner(const QString& userId)
{
  if (!signedIn() || (userId != m_userId && !m_coWatchUserIds.contains(userId))
      || userId == m_homeFeedOwnerId) return;
  m_homeFeedOwnerId = userId;
  saveCoWatchParty();
  refreshHome();
}

void FamilyApiClient::setCombinedGroupDeckEnabled(bool enabled)
{
  if (!signedIn() || enabled == m_combinedGroupDeckEnabled) return;
  m_combinedGroupDeckEnabled = enabled;
  m_settings.setValue(QStringLiteral("users/%1/combinedGroupDeck").arg(m_userId), enabled);
  emit coWatchChanged();
  refreshHome();
}

void FamilyApiClient::loadKidsSettings()
{
  const QString key = QStringLiteral("users/%1/kids/").arg(m_userId);
  m_kidsEnabled = m_settings.value(key + QStringLiteral("enabled"), false).toBool();
  m_kidsHideSpoilers = m_settings.value(key + QStringLiteral("hideSpoilers"), true).toBool();
  m_kidsEpisodeLimit = m_settings.value(key + QStringLiteral("episodeLimit"), 0).toInt();
  m_kidsBedtimeStart = m_settings.value(key + QStringLiteral("bedtimeStart"), -1).toInt();
  m_kidsPinSalt = m_settings.value(key + QStringLiteral("pinSalt")).toByteArray();
  m_kidsPinHash = m_settings.value(key + QStringLiteral("pinHash")).toByteArray();
  m_nextUpMode = m_settings.value(QStringLiteral("users/%1/nextUpMode").arg(m_userId),
                                 QStringLiteral("Extended")).toString();
  if (m_nextUpMode != QStringLiteral("Minimal") && m_nextUpMode != QStringLiteral("Off"))
    m_nextUpMode = QStringLiteral("Extended");
  emit kidsSettingsChanged();
  emit nextUpModeChanged();
}

void FamilyApiClient::saveKidsSettings()
{
  if (m_userId.isEmpty()) return;
  const QString key = QStringLiteral("users/%1/kids/").arg(m_userId);
  m_settings.setValue(key + QStringLiteral("enabled"), m_kidsEnabled);
  m_settings.setValue(key + QStringLiteral("hideSpoilers"), m_kidsHideSpoilers);
  m_settings.setValue(key + QStringLiteral("episodeLimit"), m_kidsEpisodeLimit);
  m_settings.setValue(key + QStringLiteral("bedtimeStart"), m_kidsBedtimeStart);
  m_settings.setValue(key + QStringLiteral("pinSalt"), m_kidsPinSalt);
  m_settings.setValue(key + QStringLiteral("pinHash"), m_kidsPinHash);
  emit kidsSettingsChanged();
}

void FamilyApiClient::setKidsModeEnabled(bool enabled)
{
  if (!signedIn() || m_kidsEnabled == enabled) return;
  m_kidsEnabled = enabled;
  saveKidsSettings();
}

void FamilyApiClient::setKidsHideSpoilers(bool hidden)
{
  if (!signedIn() || m_kidsHideSpoilers == hidden) return;
  m_kidsHideSpoilers = hidden;
  saveKidsSettings();
}

void FamilyApiClient::cycleKidsEpisodeLimit()
{
  if (!signedIn()) return;
  const QList<int> options{ 0, 1, 2, 3, 5 };
  const int current = qMax(0, options.indexOf(m_kidsEpisodeLimit));
  m_kidsEpisodeLimit = options[(current + 1) % options.size()];
  saveKidsSettings();
}

void FamilyApiClient::cycleKidsBedtime()
{
  if (!signedIn()) return;
  const QList<int> options{ -1, 20 * 60, 21 * 60, 22 * 60 };
  const int current = qMax(0, options.indexOf(m_kidsBedtimeStart));
  m_kidsBedtimeStart = options[(current + 1) % options.size()];
  saveKidsSettings();
}

bool FamilyApiClient::setKidsPin(const QString& pin)
{
  if (!signedIn() || (!pin.isEmpty() && !QRegularExpression(
        QStringLiteral("^[0-9]{4,8}$")).match(pin).hasMatch())) return false;
  if (pin.isEmpty()) { m_kidsPinSalt.clear(); m_kidsPinHash.clear(); }
  else {
    QByteArray salt;
    for (int i = 0; i < 4; ++i) {
      const quint32 random = QRandomGenerator::system()->generate();
      salt.append(reinterpret_cast<const char*>(&random), sizeof(random));
    }
    m_kidsPinSalt = salt.toHex();
    QByteArray value = m_kidsPinSalt + ':' + pin.toUtf8();
    for (int i = 0; i < 2000; ++i)
      value = QCryptographicHash::hash(value, QCryptographicHash::Sha256);
    m_kidsPinHash = value.toHex();
  }
  saveKidsSettings();
  return true;
}

bool FamilyApiClient::verifyKidsPin(const QString& pin) const
{
  if (!kidsHasPin()) return true;
  QByteArray value = m_kidsPinSalt + ':' + pin.toUtf8();
  for (int i = 0; i < 2000; ++i)
    value = QCryptographicHash::hash(value, QCryptographicHash::Sha256);
  return value.toHex() == m_kidsPinHash;
}

bool FamilyApiClient::kidsPlaybackAllowed() const
{
  if (!m_kidsEnabled || m_kidsBedtimeStart < 0) return true;
  const auto now = QTime::currentTime();
  const int minute = now.hour() * 60 + now.minute();
  return !(minute >= m_kidsBedtimeStart || minute < 7 * 60);
}

bool FamilyApiClient::kidsSpoilerHidden(const QVariantMap& item) const
{
  return m_kidsEnabled && m_kidsHideSpoilers
    && item.value(QStringLiteral("Type")).toString() == QStringLiteral("Episode")
    && !item.value(QStringLiteral("UserData")).toMap().value(QStringLiteral("Played")).toBool();
}

void FamilyApiClient::cycleNextUpMode()
{
  if (!signedIn()) return;
  m_nextUpMode = m_nextUpMode == QStringLiteral("Extended") ? QStringLiteral("Minimal")
    : m_nextUpMode == QStringLiteral("Minimal") ? QStringLiteral("Off")
    : QStringLiteral("Extended");
  m_settings.setValue(QStringLiteral("users/%1/nextUpMode").arg(m_userId), m_nextUpMode);
  emit nextUpModeChanged();
  if (m_profileSettingsReady) changeProfileSetting(QStringLiteral("next_up_behavior"),
    m_nextUpMode == QStringLiteral("Off") ? QStringLiteral("DISABLED") : m_nextUpMode.toUpper());
  else refreshProfileSettings();
}

void FamilyApiClient::toggleBackdropEnabled()
{
  if (!signedIn()) return;
  m_backdropEnabled = !m_backdropEnabled;
  emit profileAppearanceChanged();
  if (m_profileSettingsReady) changeProfileSetting(QStringLiteral("pref_show_backdrop"),
    m_backdropEnabled ? QStringLiteral("true") : QStringLiteral("false"));
  else refreshProfileSettings();
}

void FamilyApiClient::cycleClockBehavior()
{
  if (!signedIn()) return;
  const QStringList choices{ QStringLiteral("ALWAYS"), QStringLiteral("IN_MENUS"),
    QStringLiteral("IN_VIDEO"), QStringLiteral("NEVER") };
  m_clockBehavior = choices[(choices.indexOf(m_clockBehavior) + 1) % choices.size()];
  emit profileAppearanceChanged();
  if (m_profileSettingsReady) changeProfileSetting(QStringLiteral("pref_clock_behavior"), m_clockBehavior);
  else refreshProfileSettings();
}

QString FamilyApiClient::temporaryStorageGiB() const
{
  const qint64 bytes = QStorageInfo(QDir::tempPath()).bytesAvailable();
  if (bytes < 0) return QStringLiteral("unavailable");
  return QStringLiteral("%1 GiB").arg(bytes / (1024.0 * 1024 * 1024), 0, 'f', 1);
}

void FamilyApiClient::checkWindowsUpdate(bool manual)
{
  if (m_windowsUpdateCheckActive) return;
  m_windowsUpdateCheckActive = true;
  QNetworkRequest request(QUrl(QStringLiteral(
    "https://api.github.com/repos/ComputerGarage1837/Familyflix/releases?per_page=40")));
  request.setRawHeader("User-Agent", "FamilyFlixWindows");
  request.setRawHeader("Accept", "application/vnd.github+json");
  auto* reply = m_network.get(request); // Never send a Jellyfin token to GitHub.
  connect(reply, &QNetworkReply::finished, this, [this, reply, manual] {
    m_windowsUpdateCheckActive = false;
    const auto status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QByteArray body = reply->readAll();
    const QString error = reply->error() == QNetworkReply::NoError ? QString() : reply->errorString();
    reply->deleteLater();
    if (!error.isEmpty() || status < 200 || status >= 300) {
      if (manual) emit errorOccurred(QStringLiteral("Could not check Windows updates right now."));
      return;
    }
    QJsonParseError parseError;
    const auto document = QJsonDocument::fromJson(body, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isArray()) {
      if (manual) emit errorOccurred(QStringLiteral("The Windows update feed was unreadable."));
      return;
    }
    const auto current = familyVersionParts(QCoreApplication::applicationVersion());
    QVariantMap best;
    QList<int> bestVersion = current;
    for (const auto& value : document.array()) {
      const auto release = value.toObject().toVariantMap();
      if (release.value(QStringLiteral("draft")).toBool()) continue;
      const QString tag = release.value(QStringLiteral("tag_name")).toString();
      const auto version = familyVersionParts(tag);
      if (!laterFamilyVersion(version, bestVersion)) continue;
      for (const auto& assetValue : release.value(QStringLiteral("assets")).toList()) {
        const auto asset = assetValue.toMap();
        const QString name = asset.value(QStringLiteral("name")).toString();
        const QString download = asset.value(QStringLiteral("browser_download_url")).toString();
        if (!name.contains(QStringLiteral("windows"), Qt::CaseInsensitive)
            || !name.endsWith(QStringLiteral(".exe"), Qt::CaseInsensitive)
            || !download.startsWith(QStringLiteral("https://github.com/"))) continue;
        bestVersion = version;
        best = { { QStringLiteral("tag"), tag },
                 { QStringLiteral("name"), release.value(QStringLiteral("name"), tag) },
                 { QStringLiteral("downloadUrl"), download },
                 { QStringLiteral("releaseUrl"), release.value(QStringLiteral("html_url")) } };
        break;
      }
    }
    if (!manual && best.value(QStringLiteral("tag")).toString() == m_settings.value(
          QStringLiteral("windows/dismissedUpdateTag")).toString()) return;
    m_windowsUpdate = best;
    emit windowsUpdateChanged();
    if (manual && best.isEmpty()) emit errorOccurred(QStringLiteral("No newer Windows release is available."));
  });
}

void FamilyApiClient::dismissWindowsUpdate()
{
  const QString tag = m_windowsUpdate.value(QStringLiteral("tag")).toString();
  if (!tag.isEmpty()) m_settings.setValue(QStringLiteral("windows/dismissedUpdateTag"), tag);
  m_windowsUpdate.clear();
  emit windowsUpdateChanged();
}

void FamilyApiClient::stopWatchingTogether()
{
  if (!signedIn() || m_coWatchUserIds.isEmpty()) return;
  if (m_coWatchPlayback) m_coWatchPlayback->abandoned = true;
  m_coWatchUserIds.clear();
  m_homeFeedOwnerId = m_userId;
  saveCoWatchParty();
  refreshHome();
}

void FamilyApiClient::refreshCoWatchPresets()
{
  if (!signedIn() || m_coWatchPresetMutationBusy) return;
  const quint64 session = m_sessionRevision;
  const quint64 revision = ++m_coWatchPresetRevision;
  request("GET", QStringLiteral("DisplayPreferences/familyflix-cowatch-presets"),
          { { QStringLiteral("client"), QStringLiteral("familyflix-androidtv") } }, {},
          [this, session, revision](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision || revision != m_coWatchPresetRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("Watch Together presets could not load.")); return; }
    QVariantList presets;
    if (!decodeCoWatchPresets(data.toMap(), presets)) {
      emit errorOccurred(QStringLiteral("Watch Together presets use an unsupported format."));
      return;
    }
    m_coWatchPresets = presets;
    emit coWatchPresetsChanged();
  });
}

void FamilyApiClient::mutateCoWatchPresets(const std::function<QVariantList(const QVariantList&)>& transform)
{
  if (!signedIn() || m_coWatchPresetMutationBusy) return;
  m_coWatchPresetMutationBusy = true;
  const quint64 session = m_sessionRevision;
  const quint64 revision = ++m_coWatchPresetRevision;
  const QVariantMap query{ { QStringLiteral("client"), QStringLiteral("familyflix-androidtv") } };
  const QString path = QStringLiteral("DisplayPreferences/familyflix-cowatch-presets");
  request("GET", path, query, {},
          [this, session, revision, transform, query, path](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision || revision != m_coWatchPresetRevision) return;
    QVariantList current;
    if (!error.isEmpty() || !decodeCoWatchPresets(data.toMap(), current)) {
      m_coWatchPresetMutationBusy = false;
      emit errorOccurred(QStringLiteral("Presets could not be safely updated. Try again later."));
      return;
    }
    auto document = data.toMap();
    auto custom = document.value(QStringLiteral("CustomPrefs")).toMap();
    const QVariantList updated = transform(current);
    custom.insert(QStringLiteral("presetsV1"), encodeCoWatchPresets(updated));
    document.insert(QStringLiteral("CustomPrefs"), custom);
    request("POST", path, query,
            QJsonDocument(QJsonObject::fromVariantMap(document)).toJson(QJsonDocument::Compact),
            [this, session, revision, updated](const QVariant&, const QString& writeError) {
      if (session != m_sessionRevision || revision != m_coWatchPresetRevision) return;
      m_coWatchPresetMutationBusy = false;
      if (!writeError.isEmpty()) {
        emit errorOccurred(QStringLiteral("Preset change could not be saved."));
        return;
      }
      m_coWatchPresets = updated;
      emit coWatchPresetsChanged();
    });
  });
}

void FamilyApiClient::saveCoWatchPreset(const QString& name)
{
  const QString safeName = name.trimmed().left(40);
  if (!watchingTogether() || safeName.isEmpty()) return;
  const QStringList participants = m_coWatchUserIds;
  const QString owner = m_homeFeedOwnerId;
  const bool groupDeck = m_combinedGroupDeckEnabled;
  mutateCoWatchPresets([safeName, participants, owner, groupDeck](const QVariantList& current) {
    QVariantList updated;
    for (const auto& value : current) {
      if (value.toMap().value(QStringLiteral("name")).toString().compare(safeName, Qt::CaseInsensitive) != 0)
        updated.append(value);
    }
    updated.append(QVariantMap{
      { QStringLiteral("id"), QUuid::createUuid().toString(QUuid::WithoutBraces) },
      { QStringLiteral("name"), safeName },
      { QStringLiteral("participantUserIds"), participants },
      { QStringLiteral("homeFeedOwnerUserId"), owner },
      { QStringLiteral("combinedGroupDeckEnabled"), groupDeck }
    });
    while (updated.size() > 20) updated.removeFirst();
    return updated;
  });
}

bool FamilyApiClient::activateCoWatchPreset(const QString& presetId)
{
  if (!signedIn()) return false;
  QVariantMap chosen;
  for (const auto& value : m_coWatchPresets) {
    if (value.toMap().value(QStringLiteral("id")).toString() == presetId) {
      chosen = value.toMap(); break;
    }
  }
  if (chosen.isEmpty()) return false;
  const QStringList requested = chosen.value(QStringLiteral("participantUserIds")).toStringList();
  QStringList selected;
  for (const auto& id : requested) {
    if (id != m_userId && hasSavedProfile(id)) selected.append(id);
  }
  selected.removeDuplicates();
  if (selected.isEmpty()) {
    emit errorOccurred(QStringLiteral("Sign in a visible preset participant first."));
    return false;
  }
  if (m_coWatchPlayback) m_coWatchPlayback->abandoned = true;
  m_coWatchUserIds = selected;
  const QString owner = chosen.value(QStringLiteral("homeFeedOwnerUserId")).toString();
  m_homeFeedOwnerId = owner == m_userId || selected.contains(owner) ? owner : m_userId;
  m_combinedGroupDeckEnabled = chosen.value(QStringLiteral("combinedGroupDeckEnabled"), true).toBool();
  m_settings.setValue(QStringLiteral("users/%1/combinedGroupDeck").arg(m_userId), m_combinedGroupDeckEnabled);
  saveCoWatchParty();
  refreshHome();
  if (selected.size() < requested.size())
    emit errorOccurred(QStringLiteral("Some preset profiles need to sign in again."));
  return true;
}

void FamilyApiClient::deleteCoWatchPreset(const QString& presetId)
{
  if (QUuid(presetId).isNull()) return;
  mutateCoWatchPresets([presetId](const QVariantList& current) {
    QVariantList updated;
    for (const auto& value : current) {
      if (value.toMap().value(QStringLiteral("id")).toString() != presetId)
        updated.append(value);
    }
    return updated;
  });
}

int FamilyApiClient::familyNightRequiredAge(const QString& rating) const
{
  const QString normalized = rating.trimmed().toUpper();
  if (normalized.isEmpty()) return -1;
  const QList<QPair<QString, int>> known{
    { QStringLiteral("TV-Y7"), 7 }, { QStringLiteral("TV-Y"), 0 },
    { QStringLiteral("TV-G"), 0 }, { QStringLiteral("TV-PG"), 10 },
    { QStringLiteral("TV-MA"), 17 }, { QStringLiteral("NC-17"), 18 },
    { QStringLiteral("PG-13"), 13 }, { QStringLiteral("PG"), 8 },
    { QStringLiteral("G"), 0 }, { QStringLiteral("R"), 17 }
  };
  for (const auto& pair : known) {
    if (normalized == pair.first || normalized.endsWith(QStringLiteral("-") + pair.first))
      return pair.second;
  }
  static const QRegularExpression numeric(QStringLiteral("(?:^|[^0-9])(\\d{1,2})(?:A|\\+)?$"));
  const auto match = numeric.match(normalized);
  return match.hasMatch() ? match.captured(1).toInt() : -1;
}

void FamilyApiClient::refreshFamilyNightCandidates()
{
  if (!signedIn()) return;
  const quint64 session = m_sessionRevision;
  const quint64 revision = ++m_familyNightRevision;
  m_familyNightCandidates.clear();
  m_familyNightLoading = true;
  emit familyNightChanged();
  struct LoadState {
    int pending = 0;
    bool anySuccess = false;
    QHash<QString, QVariantMap> merged;
  };
  auto load = std::make_shared<LoadState>();
  const auto profiles = coWatchProfiles();
  load->pending = profiles.size();
  auto finish = std::make_shared<std::function<void()>>();
  *finish = [this, load, session, revision] {
    if (session != m_sessionRevision || revision != m_familyNightRevision) return;
    if (--load->pending != 0) return;
    m_familyNightLoading = false;
    for (const auto& candidate : load->merged)
      m_familyNightCandidates.append(candidate);
    emit familyNightChanged();
    if (!load->anySuccess)
      emit errorOccurred(QStringLiteral("Family Night watchlists could not load."));
  };
  if (profiles.isEmpty()) { m_familyNightLoading = false; emit familyNightChanged(); return; }
  for (const auto& value : profiles) {
    const auto profile = value.toMap();
    const QString userId = profile.value(QStringLiteral("Id")).toString();
    const QString userName = profile.value(QStringLiteral("Name")).toString();
    const QString token = userId == m_userId ? m_token
      : m_settings.value(QStringLiteral("profiles/%1/token").arg(userId)).toString();
    if (userId.isEmpty() || token.isEmpty()) { (*finish)(); continue; }
    requestAs("GET", QStringLiteral("FamilyFlix/Watchlists/personal"), {}, {}, token, userId,
              [this, load, finish, session, revision, token, userId, userName]
              (const QVariant& data, const QString& error, int) {
      if (session != m_sessionRevision || revision != m_familyNightRevision) return;
      if (!error.isEmpty()) { (*finish)(); return; }
      load->anySuccess = true;
      QStringList ids;
      QHash<QString, QVariantMap> entriesById;
      for (const auto& value : data.toMap().value(QStringLiteral("entries")).toList()) {
        const auto entry = value.toMap();
        const QString kind = entry.value(QStringLiteral("itemType")).toString().toLower();
        const QString id = entry.value(QStringLiteral("itemId")).toString();
        if ((kind == QStringLiteral("movie") || kind == QStringLiteral("series")) && !id.isEmpty()) {
          if (!entriesById.contains(id)) ids.append(id);
          entriesById.insert(id, entry);
        }
      }
      for (int offset = 0; offset < ids.size(); offset += 40) {
        const QStringList chunk = ids.mid(offset, 40);
        ++load->pending;
        requestAs("GET", QStringLiteral("Users/%1/Items").arg(userId),
                  { { QStringLiteral("Ids"), chunk.join(QLatin1Char(',')) },
                    { QStringLiteral("EnableUserData"), true },
                    { QStringLiteral("Limit"), 40 } }, {}, token, userId,
                  [this, load, finish, session, revision, userName, userId, token, chunk, entriesById]
                  (const QVariant& response, const QString& itemError, int) {
          if (session != m_sessionRevision || revision != m_familyNightRevision) return;
          QSet<QString> resolved;
          const auto merge = [load, userName](QVariantMap candidate) {
            const QString id = candidate.value(QStringLiteral("Id")).toString();
            if (id.isEmpty()) return;
            const QString key = id.toLower();
            if (load->merged.contains(key)) candidate = load->merged.value(key);
            auto sources = candidate.value(QStringLiteral("SourceProfiles")).toStringList();
            if (!sources.contains(userName)) sources.append(userName);
            candidate.insert(QStringLiteral("SourceProfiles"), sources);
            load->merged.insert(key, candidate);
          };
          if (itemError.isEmpty()) {
            for (const auto& value : items(response)) {
              auto candidate = value.toMap();
              const QString id = candidate.value(QStringLiteral("Id")).toString();
              const QString kind = candidate.value(QStringLiteral("Type")).toString();
              if (id.isEmpty() || (kind != QStringLiteral("Movie") && kind != QStringLiteral("Series"))) continue;
              for (const auto& entryId : chunk) {
                if (!watchlistEntryMatchesItem(entriesById.value(entryId), candidate)) continue;
                resolved.insert(entryId);
                merge(candidate);
              }
            }
          }
          for (const auto& entryId : chunk) {
            if (resolved.contains(entryId)) continue;
            const auto entry = entriesById.value(entryId);
            const QString title = entry.value(QStringLiteral("title")).toString().trimmed();
            if (title.isEmpty()) continue;
            ++load->pending;
            requestAs("GET", QStringLiteral("Users/%1/Items").arg(userId),
                      { { QStringLiteral("SearchTerm"), title },
                        { QStringLiteral("Recursive"), true },
                        { QStringLiteral("IncludeItemTypes"),
                          entry.value(QStringLiteral("itemType")).toString().compare(
                            QStringLiteral("movie"), Qt::CaseInsensitive) == 0
                            ? QStringLiteral("Movie") : QStringLiteral("Series") },
                        { QStringLiteral("Fields"), QStringLiteral("ProviderIds,Genres,OfficialRating") },
                        { QStringLiteral("EnableUserData"), true },
                        { QStringLiteral("Limit"), 25 } }, {}, token, userId,
                      [this, load, finish, session, revision, entry, merge]
                      (const QVariant& searched, const QString& searchError, int) {
              if (session != m_sessionRevision || revision != m_familyNightRevision) return;
              if (searchError.isEmpty()) {
                for (const auto& value : items(searched)) {
                  const auto candidate = value.toMap();
                  if (!watchlistEntryMatchesItem(entry, candidate)) continue;
                  merge(candidate);
                  break;
                }
              }
              (*finish)();
            });
          }
          (*finish)();
        });
      }
      (*finish)();
    });
  }
}

void FamilyApiClient::resolveFirstUnwatchedEpisode(const QString& seriesId)
{
  if (!signedIn() || seriesId.isEmpty()) return;
  const quint64 session = m_sessionRevision;
  request("GET", QStringLiteral("Users/%1/Items").arg(m_userId),
          { { QStringLiteral("ParentId"), seriesId },
            { QStringLiteral("Recursive"), true },
            { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode") },
            { QStringLiteral("Filters"), QStringLiteral("IsUnplayed") },
            { QStringLiteral("IsMissing"), false },
            { QStringLiteral("SortBy"), QStringLiteral("SortName") },
            { QStringLiteral("SortOrder"), QStringLiteral("Ascending") },
            { QStringLiteral("EnableUserData"), true },
            { QStringLiteral("Limit"), 1 } }, {},
          [this, session, seriesId](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    const auto episodes = items(data);
    if (episodes.isEmpty()) {
      emit errorOccurred(QStringLiteral("No unwatched episode is available for this show."));
      return;
    }
    emit firstUnwatchedEpisodeReady(seriesId, episodes.first().toMap());
  });
}

void FamilyApiClient::resolvePlayableItem(const QString& itemId)
{
  if (!signedIn() || itemId.isEmpty()) return;
  const quint64 session = m_sessionRevision;
  request("GET", QStringLiteral("Users/%1/Items/%2").arg(m_userId, itemId), {}, {},
          [this, session, itemId](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("This pick is not available for your profile.")); return; }
    const auto item = data.toMap();
    if (item.value(QStringLiteral("Id")).toString() != itemId) return;
    emit playableItemReady(itemId, item);
  });
}

void FamilyApiClient::resolveNextEpisode(const QVariantMap& currentEpisode)
{
  if (!signedIn() || currentEpisode.value(QStringLiteral("Type")).toString() != QStringLiteral("Episode")) return;
  const QString seriesId = currentEpisode.value(QStringLiteral("SeriesId")).toString();
  if (seriesId.isEmpty()) { emit nextEpisodeReady({}); return; }
  const int currentSeason = currentEpisode.value(QStringLiteral("ParentIndexNumber")).toInt();
  const int currentNumber = currentEpisode.value(QStringLiteral("IndexNumberEnd"),
                              currentEpisode.value(QStringLiteral("IndexNumber"))).toInt();
  const quint64 session = m_sessionRevision;
  request("GET", QStringLiteral("Users/%1/Items").arg(m_userId),
          { { QStringLiteral("ParentId"), seriesId },
            { QStringLiteral("Recursive"), true },
            { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode") },
            { QStringLiteral("IsMissing"), false },
            { QStringLiteral("Filters"), QStringLiteral("IsUnplayed") },
            { QStringLiteral("EnableUserData"), true },
            { QStringLiteral("SortBy"), QStringLiteral("SortName") },
            { QStringLiteral("SortOrder"), QStringLiteral("Ascending") },
            { QStringLiteral("Limit"), 2000 } }, {},
          [this, session, seriesId, currentSeason, currentNumber](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision) return;
    if (!error.isEmpty()) { emit nextEpisodeReady({}); return; }
    QVariantMap next;
    int bestSeason = INT_MAX;
    int bestNumber = INT_MAX;
    for (const auto& value : items(data)) {
      const auto candidate = value.toMap();
      if (candidate.value(QStringLiteral("SeriesId")).toString() != seriesId
          || candidate.value(QStringLiteral("UserData")).toMap().value(QStringLiteral("Played")).toBool()) continue;
      const int season = candidate.value(QStringLiteral("ParentIndexNumber")).toInt();
      const int number = candidate.value(QStringLiteral("IndexNumber")).toInt();
      if (season < currentSeason || (season == currentSeason && number <= currentNumber)
          || season > bestSeason || (season == bestSeason && number >= bestNumber)) continue;
      next = candidate;
      bestSeason = season;
      bestNumber = number;
    }
    emit nextEpisodeReady(next);
  });
}

void FamilyApiClient::authenticateParticipant(const QString& userId, const QString& password)
{
  if (!signedIn() || userId.isEmpty() || userId == m_userId) return;
  QString name;
  for (const auto& value : m_publicUsers) {
    const auto profile = value.toMap();
    if (profile.value(QStringLiteral("Id")).toString() == userId)
      name = profile.value(QStringLiteral("Name")).toString();
  }
  if (name.isEmpty()) return;
  const quint64 session = m_sessionRevision;
  const QByteArray body = QJsonDocument(QJsonObject{
    { QStringLiteral("Username"), name }, { QStringLiteral("Pw"), password }
  }).toJson(QJsonDocument::Compact);
  request("POST", QStringLiteral("Users/AuthenticateByName"), {}, body,
          [this, session, userId](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision) return;
    const auto login = data.toMap();
    if (!error.isEmpty() || login.value(QStringLiteral("User")).toMap()
        .value(QStringLiteral("Id")).toString() != userId) {
      emit errorOccurred(QStringLiteral("That profile could not sign in."));
      return;
    }
    const QString token = login.value(QStringLiteral("AccessToken")).toString();
    if (token.isEmpty()) { emit errorOccurred(QStringLiteral("That profile could not sign in.")); return; }
    m_settings.setValue(QStringLiteral("profiles/%1/token").arg(userId), token);
    emit coWatchChanged();
    setCoWatchProfile(userId, true);
  });
}

void FamilyApiClient::signIn(const QString& userName, const QString& password)
{
  const quint64 attempt = ++m_profileAttemptRevision;
  const QByteArray body = QJsonDocument(QJsonObject{
    { QStringLiteral("Username"), userName }, { QStringLiteral("Pw"), password }
  }).toJson(QJsonDocument::Compact);
  request("POST", QStringLiteral("Users/AuthenticateByName"), {}, body,
          [this, attempt](const QVariant& data, const QString& error) {
    if (attempt != m_profileAttemptRevision) return;
    const auto login = data.toMap();
    const auto user = login.value(QStringLiteral("User")).toMap();
    const QString token = login.value(QStringLiteral("AccessToken")).toString();
    const QString id = user.value(QStringLiteral("Id")).toString();
    if (!error.isEmpty() || token.isEmpty() || id.isEmpty()) {
      emit errorOccurred(QStringLiteral("Could not sign in. Check the password and try again."));
      return;
    }
    activateSession(token, id, user.value(QStringLiteral("Name")).toString());
  });
}

bool FamilyApiClient::hasSavedProfile(const QString& userId) const
{
  if (userId.isEmpty()) return false;
  bool visible = false;
  for (const auto& user : m_publicUsers) {
    if (user.toMap().value(QStringLiteral("Id")).toString() == userId) {
      visible = true;
      break;
    }
  }
  return visible && !m_settings.value(QStringLiteral("profiles/%1/token").arg(userId)).toString().isEmpty();
}

void FamilyApiClient::useSavedProfile(const QString& userId)
{
  if (!hasSavedProfile(userId)) return;
  const quint64 attempt = ++m_profileAttemptRevision;
  const QString token = m_settings.value(QStringLiteral("profiles/%1/token").arg(userId)).toString();
  QNetworkRequest networkRequest(server.resolved(QUrl(QStringLiteral("Users/Me"))));
  const QString authorization = QStringLiteral(
    "MediaBrowser Client=\"Family Flix Windows\", Device=\"Windows\", "
    "DeviceId=\"%1\", Version=\"0.1\", Token=\"%2\"").arg(m_deviceId, token);
  networkRequest.setRawHeader("Authorization", authorization.toUtf8());
  networkRequest.setRawHeader("X-Emby-Authorization", authorization.toUtf8());
  networkRequest.setRawHeader("X-Emby-Token", token.toUtf8());
  QNetworkReply* reply = m_network.get(networkRequest);
  connect(reply, &QNetworkReply::finished, this, [this, reply, userId, token, attempt] {
    const auto parsed = QJsonDocument::fromJson(reply->readAll()).object().toVariantMap();
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    reply->deleteLater();
    if (attempt != m_profileAttemptRevision) return;
    if (status == 200 && parsed.value(QStringLiteral("Id")).toString() == userId) {
      activateSession(token, userId, parsed.value(QStringLiteral("Name")).toString());
      return;
    }
    if (status == 401 || status == 403)
      m_settings.remove(QStringLiteral("profiles/%1/token").arg(userId));
    emit errorOccurred(QStringLiteral("Please enter this profile's password to continue."));
  });
}

void FamilyApiClient::activateSession(const QString& token, const QString& userId,
                                      const QString& userName)
{
  if (m_coWatchPlayback) m_coWatchPlayback->abandoned = true;
  m_coWatchPlayback.reset();
  ++m_sessionRevision;
  ++m_profileSettingsRevision;
  ++m_libraryMenuPrefsRevision;
  m_profileSettingsReady = false;
  m_profileSettingsWriteActive = false;
  m_profileSettingsValues.clear();
  m_pendingProfileSettings.clear();
  m_libraryMenuPrefsReady = false;
  m_libraryMenuWriteActive = false;
  m_libraryMenuPrefsValues.clear();
  m_libraryMenuPending.clear();
  m_homeRowOrder.clear();
  m_hiddenHomeRows.clear();
  ++m_homeRevision;
  ++m_libraryBrowseRevision;
  ++m_itemRevision;
  ++m_seasonRevision;
  ++m_tvGuideRevision;
  ++m_mediaSegmentsRevision;
  ++m_seriesPlaybackPreferencesRevision;
  m_activeSeriesId.clear();
  m_activeSeriesIntroSkipMode = QStringLiteral("APP_DEFAULT");
  m_activeSeriesAutoplayMode = QStringLiteral("APP_DEFAULT");
  m_activeSeriesValues.clear();
  m_activeSeriesPreferencesReady = false;
  m_activeSeriesPreferencesWriteActive = false;
  ++m_coWatchPresetRevision;
  ++m_familyNightRevision;
  m_coWatchPresetMutationBusy = false;
  m_coWatchPresets.clear();
  m_familyNightCandidates.clear(); m_familyNightLoading = false;
  m_playingItemId.clear(); m_playSessionId.clear(); m_mediaSourceId.clear();
  m_playbackStartConfirmed = false; m_pendingStopMilliseconds = -1;
  m_queuedPlaybackItem.clear(); m_queuedPlaybackPositionMilliseconds = 0;
  m_queuedPlaybackStopMilliseconds = -1;
  m_libraries.clear(); m_continueItems.clear(); m_deckItems.clear(); m_groupDeckItems.clear(); m_recentDeckActivity.clear();
  m_libraryRows.clear(); m_selectedItem.clear(); m_selectedCast.clear(); m_selectedIssueSummary.clear();
  m_selectedLibrary.clear(); m_libraryItems.clear(); m_libraryHasMore = false; m_libraryLoading = false;
  m_seasons.clear(); m_episodes.clear(); m_seasonCast.clear(); m_playlists.clear(); m_playlistItems.clear();
  m_playlistLoading = false; ++m_playlistLoadRevision;
  m_selectedPlaylistId.clear(); m_tvCategories.clear(); m_tvChannels.clear(); m_tvPrograms.clear();
  m_mediaSegments.clear(); m_watchlistEntries.clear(); m_watchlistItems.clear();
  m_householdWatchlistEntries.clear(); m_householdWatchlistItems.clear();
  ++m_watchlistItemsRevision;
  ++m_householdWatchlistItemsRevision;
  m_watchlistRevision = 0; m_householdWatchlistRevision = 0;
  m_deckFallbackReady = m_recentDeckActivityReady = m_deckCorrectionStarted = false;
  m_token = token;
  m_userId = userId;
  m_userName = userName;
  loadCoWatchParty();
  loadKidsSettings();
  m_mediaQueuingEnabled = true;
  m_backdropEnabled = true;
  m_clockBehavior = QStringLiteral("ALWAYS");
  m_themeName = m_settings.value(QStringLiteral("users/%1/theme").arg(m_userId),
                                 QStringLiteral("Ocean")).toString();
  m_settings.setValue(QStringLiteral("token"), m_token);
  m_settings.setValue(QStringLiteral("userId"), m_userId);
  m_settings.setValue(QStringLiteral("userName"), m_userName);
  m_settings.setValue(QStringLiteral("profiles/%1/token").arg(m_userId), m_token);
  emit sessionChanged(); emit themeChanged(); emit profileAppearanceChanged(); emit nextUpModeChanged(); emit homeChanged(); emit libraryBrowseChanged(); emit selectedItemChanged(); emit selectedCastChanged();
  emit coWatchPresetsChanged();
  emit familyNightChanged();
  emit selectedIssueSummaryChanged(); emit watchlistChanged(); emit seriesChanged();
  emit playlistsChanged(); emit liveTvChanged(); emit mediaSegmentsChanged();
  emit seriesPlaybackPreferencesChanged();
  refreshProfileSettings();
  refreshLibraryMenuPreferences();
  refreshHome();
  refreshWatchlist();
  refreshHouseholdWatchlist();
  refreshPublicUsers();
}

void FamilyApiClient::signOut()
{
  if (m_coWatchPlayback) m_coWatchPlayback->abandoned = true;
  m_coWatchPlayback.reset();
  ++m_profileAttemptRevision;
  ++m_sessionRevision;
  ++m_profileSettingsRevision;
  ++m_libraryMenuPrefsRevision;
  m_profileSettingsReady = false;
  m_profileSettingsWriteActive = false;
  m_profileSettingsValues.clear();
  m_pendingProfileSettings.clear();
  m_libraryMenuPrefsReady = false;
  m_libraryMenuWriteActive = false;
  m_libraryMenuPrefsValues.clear();
  m_libraryMenuPending.clear();
  m_homeRowOrder.clear();
  m_hiddenHomeRows.clear();
  ++m_homeRevision;
  ++m_libraryBrowseRevision;
  ++m_itemRevision;
  ++m_seasonRevision;
  ++m_mediaSegmentsRevision;
  ++m_seriesPlaybackPreferencesRevision;
  m_activeSeriesId.clear();
  m_activeSeriesIntroSkipMode = QStringLiteral("APP_DEFAULT");
  m_activeSeriesAutoplayMode = QStringLiteral("APP_DEFAULT");
  m_activeSeriesValues.clear();
  m_activeSeriesPreferencesReady = false;
  m_activeSeriesPreferencesWriteActive = false;
  ++m_coWatchPresetRevision;
  ++m_familyNightRevision;
  m_coWatchPresetMutationBusy = false;
  m_coWatchPresets.clear();
  m_familyNightCandidates.clear(); m_familyNightLoading = false;
  m_settings.remove(QStringLiteral("profiles/%1/token").arg(m_userId));
  m_playingItemId.clear(); m_playSessionId.clear(); m_mediaSourceId.clear();
  m_playbackStartConfirmed = false; m_pendingStopMilliseconds = -1;
  m_queuedPlaybackItem.clear(); m_queuedPlaybackPositionMilliseconds = 0;
  m_queuedPlaybackStopMilliseconds = -1;
  m_token.clear(); m_userId.clear(); m_userName.clear();
  m_coWatchUserIds.clear(); m_homeFeedOwnerId.clear(); m_homeFeedUserId.clear(); m_homeFeedToken.clear();
  m_kidsEnabled = false; m_kidsHideSpoilers = true; m_kidsEpisodeLimit = 0; m_kidsBedtimeStart = -1;
  m_kidsPinSalt.clear(); m_kidsPinHash.clear();
  m_nextUpMode = QStringLiteral("Extended");
  m_mediaQueuingEnabled = true;
  m_backdropEnabled = true;
  m_clockBehavior = QStringLiteral("ALWAYS");
  m_themeName = QStringLiteral("Ocean");
  m_libraries.clear(); m_continueItems.clear(); m_deckItems.clear(); m_groupDeckItems.clear();
  m_recentDeckActivity.clear();
  m_deckFallbackReady = m_recentDeckActivityReady = m_deckCorrectionStarted = false;
  m_libraryRows.clear(); m_selectedItem.clear(); m_selectedCast.clear(); m_selectedIssueSummary.clear();
  m_selectedLibrary.clear(); m_libraryItems.clear(); m_libraryHasMore = false; m_libraryLoading = false;
  m_seasons.clear(); m_episodes.clear(); m_seasonCast.clear();
  m_playlists.clear(); m_playlistItems.clear(); m_selectedPlaylistId.clear();
  m_playlistLoading = false; ++m_playlistLoadRevision;
  m_tvCategories.clear(); m_tvChannels.clear(); m_tvPrograms.clear();
  m_mediaSegments.clear();
  ++m_tvGuideRevision;
  m_watchlistEntries.clear(); m_watchlistItems.clear(); m_watchlistRevision = 0;
  ++m_watchlistItemsRevision;
  m_householdWatchlistEntries.clear(); m_householdWatchlistItems.clear(); m_householdWatchlistRevision = 0;
  ++m_householdWatchlistItemsRevision;
  m_settings.remove(QStringLiteral("token"));
  m_settings.remove(QStringLiteral("userId"));
  m_settings.remove(QStringLiteral("userName"));
  emit sessionChanged();
  emit coWatchChanged();
  emit kidsSettingsChanged();
  emit nextUpModeChanged();
  emit profileAppearanceChanged();
  emit coWatchPresetsChanged();
  emit familyNightChanged();
  emit themeChanged();
  emit homeChanged();
  emit libraryBrowseChanged();
  emit selectedItemChanged();
  emit selectedCastChanged();
  emit selectedIssueSummaryChanged();
  emit mediaSegmentsChanged();
  emit seriesPlaybackPreferencesChanged();
  emit watchlistChanged();
  emit seriesChanged();
  emit playlistsChanged();
  emit liveTvChanged();
  refreshPublicUsers();
}

void FamilyApiClient::refreshHome()
{
  if (!signedIn()) return;
  const quint64 revision = m_sessionRevision;
  const quint64 homeRevision = ++m_homeRevision;
  m_groupDeckItems.clear();
  emit homeChanged();
  m_homeFeedUserId = m_userId;
  m_homeFeedToken = m_token;
  if (watchingTogether() && m_homeFeedOwnerId != m_userId && hasSavedProfile(m_homeFeedOwnerId)) {
    m_homeFeedUserId = m_homeFeedOwnerId;
    m_homeFeedToken = m_settings.value(QStringLiteral("profiles/%1/token").arg(m_homeFeedOwnerId)).toString();
  }
  const QString feedUserId = m_homeFeedUserId;
  const QString feedToken = m_homeFeedToken;
  refreshGroupDeck(revision, homeRevision);
  m_recentDeckActivity.clear();
  m_deckFallbackReady = m_recentDeckActivityReady = m_deckCorrectionStarted = false;
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
        if (plainLibraryId(value.toMap().value(QStringLiteral("Id")).toString()) == plainLibraryId(id)) {
          ordered.append(value);
          break;
        }
      }
    }
    for (const auto& value : m_libraries) {
      const QString id = value.toMap().value(QStringLiteral("Id")).toString();
      if (!order.contains(plainLibraryId(id))) ordered.append(value);
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
  requestAs("GET", QStringLiteral("Users/%1/Items/Resume").arg(feedUserId),
          { { QStringLiteral("Limit"), 15 }, { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode,Movie") } }, {},
          feedToken, feedUserId,
          [this, revision, homeRevision, feedUserId](const QVariant& data, const QString& error, int status) {
    if (revision != m_sessionRevision || homeRevision != m_homeRevision) return;
    if (status == 401 || status == 403) {
      if (feedUserId != m_userId) { setHomeFeedOwner(m_userId); return; }
    }
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_continueItems = items(data);
    emit homeChanged();
  });
  requestAs("GET", QStringLiteral("Shows/NextUp"),
          { { QStringLiteral("UserId"), feedUserId }, { QStringLiteral("Limit"), 30 },
            { QStringLiteral("EnableResumable"), false }, { QStringLiteral("EnableRewatching"), true } }, {},
          feedToken, feedUserId,
          [this, revision, homeRevision, feedUserId](const QVariant& data, const QString& error, int status) {
    if (revision != m_sessionRevision || homeRevision != m_homeRevision) return;
    if ((status == 401 || status == 403) && feedUserId != m_userId) {
      setHomeFeedOwner(m_userId); return;
    }
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_deckItems = untouchedDeck(items(data));
    emit homeChanged();
    m_deckFallbackReady = true;
    correctDeckFromRecent();
  });
  requestAs("GET", QStringLiteral("Users/%1/Items").arg(feedUserId),
          { { QStringLiteral("Recursive"), true },
            { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode") },
            { QStringLiteral("SortBy"), QStringLiteral("DatePlayed") },
            { QStringLiteral("SortOrder"), QStringLiteral("Descending") },
            { QStringLiteral("EnableUserData"), true },
            { QStringLiteral("EnableImages"), false },
            { QStringLiteral("EnableTotalRecordCount"), false },
            { QStringLiteral("Limit"), 60 } }, {}, feedToken, feedUserId,
          [this, revision, homeRevision, feedUserId](const QVariant& data, const QString& error, int status) {
    if (revision != m_sessionRevision || homeRevision != m_homeRevision) return;
    if ((status == 401 || status == 403) && feedUserId != m_userId) {
      setHomeFeedOwner(m_userId); return;
    }
    if (!error.isEmpty()) return; // Keep the safe untouched Next Up fallback.
    m_recentDeckActivity = items(data);
    m_recentDeckActivityReady = true;
    correctDeckFromRecent();
  });
}

void FamilyApiClient::refreshGroupDeck(quint64 session, quint64 homeRevision)
{
  const quint64 groupRevision = ++m_groupDeckRevision;
  m_groupDeckItems.clear();
  emit homeChanged();
  if (!signedIn() || !watchingTogether() || !m_combinedGroupDeckEnabled) return;
  const auto profiles = coWatchProfiles();
  if (profiles.size() < 2) return; // Wait for the visible profile directory.
  struct DeckLoad {
    int pending = 0;
    QList<QVariantList> lists;
    QStringList names;
  };
  const auto load = std::make_shared<DeckLoad>();
  load->pending = profiles.size();
  load->lists.resize(profiles.size());
  for (int index = 0; index < profiles.size(); ++index) {
    const auto profile = profiles[index].toMap();
    const QString userId = profile.value(QStringLiteral("Id")).toString();
    const QString token = userId == m_userId ? m_token
      : m_settings.value(QStringLiteral("profiles/%1/token").arg(userId)).toString();
    load->names.append(profile.value(QStringLiteral("Name")).toString());
    const auto complete = [this, load, session, homeRevision, groupRevision] {
      if (session != m_sessionRevision || homeRevision != m_homeRevision
          || groupRevision != m_groupDeckRevision) return;
      if (--load->pending != 0) return;
      QHash<QString, int> positions;
      QVariantList merged;
      int largest = 0;
      for (const auto& list : load->lists) largest = qMax(largest, int(list.size()));
      for (int row = 0; row < largest && merged.size() < 50; ++row) {
        for (int owner = 0; owner < load->lists.size(); ++owner) {
          if (row >= load->lists[owner].size()) continue;
          auto item = load->lists[owner][row].toMap();
          const QString series = deckSeriesId(item);
          const QString id = item.value(QStringLiteral("Id")).toString();
          const QString key = !series.isEmpty()
              && item.value(QStringLiteral("ParentIndexNumber")).isValid()
              && item.value(QStringLiteral("IndexNumber")).isValid()
            ? QStringLiteral("%1:%2:%3").arg(series)
                .arg(item.value(QStringLiteral("ParentIndexNumber")).toInt())
                .arg(item.value(QStringLiteral("IndexNumber")).toInt())
            : id;
          if (key.isEmpty()) continue;
          if (positions.contains(key)) {
            const int existing = positions.value(key);
            auto prior = merged[existing].toMap();
            auto names = prior.value(QStringLiteral("SourceProfiles")).toStringList();
            if (!names.contains(load->names[owner])) names.append(load->names[owner]);
            prior.insert(QStringLiteral("SourceProfiles"), names);
            merged[existing] = prior;
          } else if (merged.size() < 50) {
            item.insert(QStringLiteral("SourceProfiles"), QStringList{ load->names[owner] });
            positions.insert(key, merged.size());
            merged.append(item);
          }
        }
      }
      m_groupDeckItems = merged;
      emit homeChanged();
    };
    if (userId.isEmpty() || token.isEmpty()) { complete(); continue; }
    requestAs("GET", QStringLiteral("Shows/NextUp"),
              { { QStringLiteral("UserId"), userId },
                { QStringLiteral("Limit"), 60 },
                { QStringLiteral("EnableResumable"), false },
                { QStringLiteral("EnableRewatching"), true },
                { QStringLiteral("EnableUserData"), true },
                { QStringLiteral("EnableTotalRecordCount"), false } }, {}, token, userId,
              [this, load, index, complete, session, homeRevision, groupRevision]
              (const QVariant& response, const QString& error, int) {
      if (session != m_sessionRevision || homeRevision != m_homeRevision
          || groupRevision != m_groupDeckRevision) return;
      if (error.isEmpty()) {
        QSet<QString> seenSeries;
        for (const auto& value : items(response)) {
          const auto item = value.toMap();
          const QString series = deckSeriesId(item);
          if (!untouchedEpisode(item) || series.isEmpty() || seenSeries.contains(series)) continue;
          seenSeries.insert(series);
          load->lists[index].append(item);
          if (load->lists[index].size() == 30) break;
        }
      }
      complete();
    });
  }
}

void FamilyApiClient::openLibrary(const QVariantMap& library)
{
  if (!signedIn() || library.value(QStringLiteral("Id")).toString().isEmpty()) return;
  ++m_libraryBrowseRevision;
  m_selectedLibrary = library;
  m_libraryItems.clear();
  m_libraryHasMore = true;
  m_libraryLoading = false;
  emit libraryBrowseChanged();
  loadMoreLibrary();
}

void FamilyApiClient::loadMoreLibrary()
{
  if (!signedIn() || m_libraryLoading || !m_libraryHasMore) return;
  const QString parentId = m_selectedLibrary.value(QStringLiteral("Id")).toString();
  if (parentId.isEmpty()) return;
  QString types = QStringLiteral("Movie,Series,Video,BoxSet");
  const QString kind = m_selectedLibrary.value(QStringLiteral("CollectionType")).toString().toLower();
  if (kind == QStringLiteral("tvshows")) types = QStringLiteral("Series");
  else if (kind == QStringLiteral("movies")) types = QStringLiteral("Movie,BoxSet");
  const int offset = m_libraryItems.size();
  const quint64 session = m_sessionRevision;
  const quint64 revision = m_libraryBrowseRevision;
  m_libraryLoading = true;
  emit libraryBrowseChanged();
  request("GET", QStringLiteral("Users/%1/Items").arg(m_userId),
          { { QStringLiteral("ParentId"), parentId },
            { QStringLiteral("Recursive"), true },
            { QStringLiteral("IncludeItemTypes"), types },
            { QStringLiteral("SortBy"), QStringLiteral("SortName") },
            { QStringLiteral("SortOrder"), QStringLiteral("Ascending") },
            { QStringLiteral("StartIndex"), offset },
            { QStringLiteral("Limit"), 60 },
            { QStringLiteral("EnableUserData"), true } }, {},
          [this, session, revision](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision || revision != m_libraryBrowseRevision) return;
    m_libraryLoading = false;
    if (!error.isEmpty()) {
      emit errorOccurred(QStringLiteral("Library items could not load."));
      emit libraryBrowseChanged();
      return;
    }
    const QVariantList next = items(data);
    QSet<QString> known;
    for (const auto& value : m_libraryItems)
      known.insert(value.toMap().value(QStringLiteral("Id")).toString());
    for (const auto& value : next) {
      const QString id = value.toMap().value(QStringLiteral("Id")).toString();
      if (!id.isEmpty() && !known.contains(id)) { known.insert(id); m_libraryItems.append(value); }
    }
    const auto document = data.toMap();
    const int total = document.value(QStringLiteral("TotalRecordCount"), -1).toInt();
    m_libraryHasMore = total >= 0 ? m_libraryItems.size() < total : next.size() == 60;
    emit libraryBrowseChanged();
  });
}

void FamilyApiClient::refreshWatchlist()
{
  if (!signedIn()) return;
  const quint64 revision = m_sessionRevision;
  const quint64 itemsRevision = ++m_watchlistItemsRevision;
  request("GET", QStringLiteral("FamilyFlix/Watchlists/personal"), {}, {},
          [this, revision, itemsRevision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision || itemsRevision != m_watchlistItemsRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("Watchlist could not load.")); return; }
    const auto document = data.toMap();
    m_watchlistRevision = document.value(QStringLiteral("revision")).toLongLong();
    m_watchlistEntries = document.value(QStringLiteral("entries")).toList();
    m_watchlistItems.clear();
    emit watchlistChanged();
    QStringList ids;
    for (const auto& value : m_watchlistEntries) {
      const QString id = value.toMap().value(QStringLiteral("itemId")).toString();
      if (!id.isEmpty() && !ids.contains(id, Qt::CaseInsensitive)) ids.append(id);
      if (ids.size() == 100) break;
    }
    if (ids.isEmpty()) {
      m_watchlistItems.clear();
      emit watchlistChanged();
      return;
    }
    request("GET", QStringLiteral("Users/%1/Items").arg(m_userId),
            { { QStringLiteral("Ids"), ids.join(',') },
              { QStringLiteral("EnableUserData"), true },
              { QStringLiteral("EnableImages"), true },
              { QStringLiteral("Limit"), ids.size() } }, {},
            [this, revision, itemsRevision](const QVariant& metadata, const QString& metadataError) {
      if (revision != m_sessionRevision || itemsRevision != m_watchlistItemsRevision) return;
      if (!metadataError.isEmpty()) return;
      QHash<QString, QVariantMap> byId;
      for (const auto& value : items(metadata)) {
        const QVariantMap item = value.toMap();
        byId.insert(item.value(QStringLiteral("Id")).toString().toLower(), item);
      }
      QVariantList ordered;
      for (const auto& value : m_watchlistEntries) {
        const QString id = value.toMap().value(QStringLiteral("itemId")).toString().toLower();
        if (byId.contains(id)) ordered.append(byId.value(id));
      }
      m_watchlistItems = ordered;
      emit watchlistChanged();
    });
  });
}

void FamilyApiClient::refreshHouseholdWatchlist()
{
  if (!signedIn()) return;
  const quint64 revision = m_sessionRevision;
  const quint64 itemsRevision = ++m_householdWatchlistItemsRevision;
  request("GET", QStringLiteral("FamilyFlix/Watchlists/household"), {}, {},
          [this, revision, itemsRevision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision || itemsRevision != m_householdWatchlistItemsRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("Family watchlist could not load.")); return; }
    const auto document = data.toMap();
    m_householdWatchlistRevision = document.value(QStringLiteral("revision")).toLongLong();
    m_householdWatchlistEntries = document.value(QStringLiteral("entries")).toList();
    m_householdWatchlistItems.clear();
    emit watchlistChanged();
    QStringList ids;
    for (const auto& value : m_householdWatchlistEntries) {
      const QString id = value.toMap().value(QStringLiteral("itemId")).toString();
      if (!id.isEmpty() && !ids.contains(id, Qt::CaseInsensitive)) ids.append(id);
      if (ids.size() == 100) break;
    }
    if (ids.isEmpty()) {
      m_householdWatchlistItems.clear();
      emit watchlistChanged();
      return;
    }
    request("GET", QStringLiteral("Users/%1/Items").arg(m_userId),
            { { QStringLiteral("Ids"), ids.join(',') },
              { QStringLiteral("EnableUserData"), true },
              { QStringLiteral("EnableImages"), true },
              { QStringLiteral("Limit"), ids.size() } }, {},
            [this, revision, itemsRevision](const QVariant& metadata, const QString& metadataError) {
      if (revision != m_sessionRevision || itemsRevision != m_householdWatchlistItemsRevision) return;
      if (!metadataError.isEmpty()) return;
      QHash<QString, QVariantMap> byId;
      for (const auto& value : items(metadata)) {
        const QVariantMap item = value.toMap();
        byId.insert(item.value(QStringLiteral("Id")).toString().toLower(), item);
      }
      QVariantList ordered;
      for (const auto& value : m_householdWatchlistEntries) {
        const QString id = value.toMap().value(QStringLiteral("itemId")).toString().toLower();
        if (byId.contains(id)) ordered.append(byId.value(id));
      }
      m_householdWatchlistItems = ordered;
      emit watchlistChanged();
    });
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

void FamilyApiClient::setPlayed(const QVariantMap& item, bool played)
{
  if (!signedIn()) return;
  const QString itemId = item.value(QStringLiteral("Id")).toString();
  if (itemId.isEmpty()) return;
  const quint64 session = m_sessionRevision;
  request(played ? "POST" : "DELETE",
          QStringLiteral("Users/%1/PlayedItems/%2").arg(m_userId, itemId), {}, {},
          [this, session, itemId](const QVariant&, const QString& error) {
    if (session != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("Watch status did not save.")); return; }
    if (m_selectedItem.value(QStringLiteral("Id")).toString() == itemId) openItem(itemId);
    refreshHome();
    refreshWatchlist();
    refreshHouseholdWatchlist();
  });
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
  m_selectedCast.clear();
  m_selectedIssueSummary.clear();
  emit selectedItemChanged();
  emit selectedCastChanged();
  emit selectedIssueSummaryChanged();
  request("GET", QStringLiteral("FamilyFlix/Issues/Summaries"),
          { { QStringLiteral("ids"), itemId } }, {},
          [this, revision, itemRevision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision || itemRevision != m_itemRevision || !error.isEmpty()) return;
    const auto summaries = data.toMap().value(QStringLiteral("items")).toList();
    if (!summaries.isEmpty()) m_selectedIssueSummary = summaries.first().toMap();
    emit selectedIssueSummaryChanged();
  });
  request("GET", QStringLiteral("Users/%1/Items/%2").arg(m_userId, itemId), {}, {},
          [this, revision, itemRevision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision || itemRevision != m_itemRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_selectedItem = data.toMap();
    emit selectedItemChanged();
    const QString kind = m_selectedItem.value(QStringLiteral("Type")).toString();
    m_selectedCast = peopleOfType(m_selectedItem,
      kind == QStringLiteral("Episode") ? QStringLiteral("GuestStar") : QStringLiteral("Actor"));
    emit selectedCastChanged();
    if (kind == QStringLiteral("Episode") && m_selectedCast.isEmpty()) {
      const QString seasonId = m_selectedItem.value(QStringLiteral("SeasonId")).toString();
      const QString seriesId = m_selectedItem.value(QStringLiteral("SeriesId")).toString();
      const auto loadSeries = [this, revision, itemRevision, seriesId] {
        if (seriesId.isEmpty()) return;
        request("GET", QStringLiteral("Users/%1/Items/%2").arg(m_userId, seriesId), {}, {},
                [this, revision, itemRevision](const QVariant& series, const QString& seriesError) {
          if (revision != m_sessionRevision || itemRevision != m_itemRevision || !seriesError.isEmpty()) return;
          m_selectedCast = peopleOfType(series.toMap(), QStringLiteral("Actor"));
          emit selectedCastChanged();
        });
      };
      if (seasonId.isEmpty()) loadSeries();
      else request("GET", QStringLiteral("Users/%1/Items/%2").arg(m_userId, seasonId), {}, {},
                   [this, revision, itemRevision, loadSeries](const QVariant& season, const QString& seasonError) {
        if (revision != m_sessionRevision || itemRevision != m_itemRevision) return;
        if (seasonError.isEmpty()) m_selectedCast = peopleOfType(season.toMap(), QStringLiteral("Actor"));
        if (m_selectedCast.isEmpty()) loadSeries();
        else emit selectedCastChanged();
      });
    }
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
  const quint64 seasonRevision = ++m_seasonRevision;
  m_episodes.clear();
  m_seasonCast = peopleOfType(m_selectedItem, QStringLiteral("Actor"));
  emit seriesChanged();
  request("GET", QStringLiteral("Users/%1/Items/%2").arg(m_userId, seasonId), {}, {},
          [this, revision, seasonRevision](const QVariant& season, const QString& seasonError) {
    if (revision != m_sessionRevision || seasonRevision != m_seasonRevision) return;
    if (seasonError.isEmpty()) {
      const auto seasonal = peopleOfType(season.toMap(), QStringLiteral("Actor"));
      if (!seasonal.isEmpty()) m_seasonCast = seasonal;
      emit seriesChanged();
    }
  });
  request("GET", QStringLiteral("Users/%1/Items").arg(m_userId),
          { { QStringLiteral("ParentId"), seasonId },
            { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode") },
            { QStringLiteral("SortBy"), QStringLiteral("IndexNumber") },
            { QStringLiteral("SortOrder"), QStringLiteral("Ascending") },
            { QStringLiteral("Recursive"), true },
            { QStringLiteral("Limit"), 250 },
            { QStringLiteral("EnableUserData"), true } }, {},
          [this, revision, seasonRevision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision || seasonRevision != m_seasonRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(error); return; }
    m_episodes = items(data);
    emit seriesChanged();
  });
}

void FamilyApiClient::refreshPlaylists()
{
  if (!signedIn()) return;
  const quint64 revision = m_sessionRevision;
  request("GET", QStringLiteral("Users/%1/Items").arg(m_userId),
          { { QStringLiteral("Recursive"), true },
            { QStringLiteral("IncludeItemTypes"), QStringLiteral("Playlist") },
            { QStringLiteral("SortBy"), QStringLiteral("DateCreated") },
            { QStringLiteral("SortOrder"), QStringLiteral("Descending") },
            { QStringLiteral("Limit"), 500 } }, {},
          [this, revision](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("Playlists could not load.")); return; }
    m_playlists.clear();
    for (const auto& value : items(data)) {
      const auto playlist = value.toMap();
      if (playlist.value(QStringLiteral("MediaType")).toString().compare(
            QStringLiteral("Audio"), Qt::CaseInsensitive) != 0) m_playlists.append(value);
    }
    emit playlistsChanged();
  });
}

void FamilyApiClient::openPlaylist(const QString& playlistId)
{
  if (!signedIn() || playlistId.isEmpty()) return;
  m_selectedPlaylistId = playlistId;
  m_playlistItems.clear();
  m_playlistLoading = true;
  emit playlistsChanged();
  loadPlaylistPage(playlistId, 0, m_sessionRevision, ++m_playlistLoadRevision);
}

void FamilyApiClient::loadPlaylistPage(const QString& playlistId, int startIndex,
                                       quint64 session, quint64 loadRevision)
{
  constexpr int pageSize = 200;
  request("GET", QStringLiteral("Playlists/%1/Items").arg(playlistId),
          { { QStringLiteral("UserId"), m_userId }, { QStringLiteral("StartIndex"), startIndex },
            { QStringLiteral("Limit"), pageSize } }, {},
          [this, session, loadRevision, playlistId, startIndex, pageSize](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision || loadRevision != m_playlistLoadRevision
        || playlistId != m_selectedPlaylistId) return;
    if (!error.isEmpty()) {
      m_playlistLoading = false;
      emit playlistsChanged();
      emit errorOccurred(QStringLiteral("Playlist items could not load."));
      return;
    }
    const QVariantList page = items(data);
    m_playlistItems.append(page);
    const int total = data.toMap().value(QStringLiteral("TotalRecordCount"), -1).toInt();
    const bool more = !page.isEmpty() && (total >= 0 ? m_playlistItems.size() < total
                                                      : page.size() == pageSize)
                      && m_playlistItems.size() < 10000;
    if (!more) m_playlistLoading = false;
    emit playlistsChanged();
    if (more) loadPlaylistPage(playlistId, startIndex + page.size(), session, loadRevision);
  });
}

void FamilyApiClient::createPlaylist(const QString& name)
{
  if (!signedIn() || name.trimmed().isEmpty()) return;
  const quint64 revision = m_sessionRevision;
  const QVariantMap command{
    { QStringLiteral("Name"), name.trimmed() },
    { QStringLiteral("Ids"), QVariantList{} },
    { QStringLiteral("UserId"), m_userId },
    { QStringLiteral("MediaType"), QStringLiteral("Video") },
    { QStringLiteral("Users"), QVariantList{} },
    { QStringLiteral("IsPublic"), false }
  };
  requestWithStatus("POST", QStringLiteral("Playlists"), {},
    QJsonDocument(QJsonObject::fromVariantMap(command)).toJson(QJsonDocument::Compact),
    [this, revision](const QVariant&, const QString& error, int status) {
      if (revision != m_sessionRevision) return;
      if (!error.isEmpty() || status < 200 || status >= 300) {
        emit errorOccurred(QStringLiteral("Playlist could not be created."));
        return;
      }
      refreshPlaylists();
    });
}

void FamilyApiClient::createPlaylistAndAdd(const QString& name, const QVariantMap& item)
{
  if (!signedIn() || name.trimmed().isEmpty() || item.value(QStringLiteral("Id")).toString().isEmpty()) return;
  const quint64 revision = m_sessionRevision;
  const QVariantMap command{
    { QStringLiteral("Name"), name.trimmed() },
    { QStringLiteral("Ids"), QVariantList{} },
    { QStringLiteral("UserId"), m_userId },
    { QStringLiteral("MediaType"), QStringLiteral("Video") },
    { QStringLiteral("Users"), QVariantList{} },
    { QStringLiteral("IsPublic"), false }
  };
  requestWithStatus("POST", QStringLiteral("Playlists"), {},
    QJsonDocument(QJsonObject::fromVariantMap(command)).toJson(QJsonDocument::Compact),
    [this, revision, item](const QVariant& response, const QString& error, int status) {
      if (revision != m_sessionRevision) return;
      const QString playlistId = response.toMap().value(QStringLiteral("Id")).toString();
      if (!error.isEmpty() || status < 200 || status >= 300 || playlistId.isEmpty()) {
        emit errorOccurred(QStringLiteral("Playlist could not be created and filled."));
        return;
      }
      refreshPlaylists();
      addToPlaylist(playlistId, item);
    });
}

void FamilyApiClient::renamePlaylist(const QString& playlistId, const QString& name)
{
  if (!signedIn() || playlistId.isEmpty() || name.trimmed().isEmpty()) return;
  const quint64 revision = m_sessionRevision;
  const QVariantMap command{ { QStringLiteral("Name"), name.trimmed() } };
  requestWithStatus("POST", QStringLiteral("Playlists/%1").arg(playlistId), {},
    QJsonDocument(QJsonObject::fromVariantMap(command)).toJson(QJsonDocument::Compact),
    [this, revision](const QVariant&, const QString& error, int status) {
      if (revision != m_sessionRevision) return;
      if (!error.isEmpty() || status < 200 || status >= 300) {
        emit errorOccurred(QStringLiteral("Playlist could not be renamed."));
        return;
      }
      refreshPlaylists();
    });
}

void FamilyApiClient::addPlayableIdsToPlaylist(const QString& playlistId, const QStringList& ids)
{
  if (!signedIn() || playlistId.isEmpty() || ids.isEmpty()) return;
  const quint64 revision = m_sessionRevision;
  const QStringList batch = ids.mid(0, 100);
  requestWithStatus("POST", QStringLiteral("Playlists/%1/Items").arg(playlistId),
    { { QStringLiteral("Ids"), batch.join(QLatin1Char(',')) },
      { QStringLiteral("UserId"), m_userId } }, {},
    [this, revision, playlistId, ids](const QVariant&, const QString& error, int status) {
      if (revision != m_sessionRevision) return;
      if (!error.isEmpty() || status < 200 || status >= 300) {
        emit errorOccurred(QStringLiteral("Could not add item to playlist."));
        return;
      }
      if (ids.size() > 100) addPlayableIdsToPlaylist(playlistId, ids.mid(100));
      else if (playlistId == m_selectedPlaylistId) openPlaylist(playlistId);
    });
}

void FamilyApiClient::addToPlaylist(const QString& playlistId, const QVariantMap& item)
{
  if (!signedIn() || playlistId.isEmpty()) return;
  const QString id = item.value(QStringLiteral("Id")).toString();
  const QString type = item.value(QStringLiteral("Type")).toString();
  if (id.isEmpty()) return;
  if (type != QStringLiteral("Series")) {
    if (type == QStringLiteral("Movie") || type == QStringLiteral("Episode"))
      addPlayableIdsToPlaylist(playlistId, { id });
    return;
  }
  const quint64 revision = m_sessionRevision;
  request("GET", QStringLiteral("Users/%1/Items").arg(m_userId),
          { { QStringLiteral("ParentId"), id },
            { QStringLiteral("Recursive"), true },
            { QStringLiteral("IncludeItemTypes"), QStringLiteral("Episode") },
            { QStringLiteral("IsMissing"), false },
            { QStringLiteral("SortBy"), QStringLiteral("ParentIndexNumber,IndexNumber") },
            { QStringLiteral("SortOrder"), QStringLiteral("Ascending") },
            { QStringLiteral("Limit"), 10000 } }, {},
          [this, revision, playlistId](const QVariant& data, const QString& error) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("Show episodes could not load.")); return; }
    QStringList ids;
    for (const auto& value : items(data)) {
      const QString episodeId = value.toMap().value(QStringLiteral("Id")).toString();
      if (!episodeId.isEmpty()) ids.append(episodeId);
    }
    if (ids.isEmpty()) emit errorOccurred(QStringLiteral("This show has no playable episodes."));
    else addPlayableIdsToPlaylist(playlistId, ids);
  });
}

void FamilyApiClient::removePlaylistEntry(const QString& playlistId, const QString& playlistItemId)
{
  if (!signedIn() || playlistId.isEmpty() || playlistItemId.isEmpty()) return;
  const quint64 revision = m_sessionRevision;
  requestWithStatus("DELETE", QStringLiteral("Playlists/%1/Items").arg(playlistId),
                    { { QStringLiteral("EntryIds"), playlistItemId } }, {},
                    [this, revision, playlistId](const QVariant&, const QString& error, int status) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty() || status < 200 || status >= 300) {
      emit errorOccurred(QStringLiteral("Could not remove playlist entry."));
      return;
    }
    openPlaylist(playlistId);
  });
}

void FamilyApiClient::movePlaylistEntry(const QString& playlistId, const QString& playlistItemId, int newIndex)
{
  if (!signedIn() || playlistId.isEmpty() || playlistItemId.isEmpty() || newIndex < 0) return;
  const quint64 revision = m_sessionRevision;
  requestWithStatus("POST", QStringLiteral("Playlists/%1/Items/%2/Move/%3")
                    .arg(playlistId, playlistItemId, QString::number(newIndex)), {}, {},
                    [this, revision, playlistId](const QVariant&, const QString& error, int status) {
    if (revision != m_sessionRevision) return;
    if (!error.isEmpty() || status < 200 || status >= 300) {
      emit errorOccurred(QStringLiteral("Could not reorder playlist."));
      return;
    }
    openPlaylist(playlistId);
  });
}

void FamilyApiClient::refreshLiveTv()
{
  if (!signedIn()) return;
  const quint64 session = m_sessionRevision;
  request("GET", QStringLiteral("FamilyFlix/Iptv/Categories"), {}, {},
          [this, session](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision) return;
    QVariantList categories;
    if (error.isEmpty() && data.toMap().value(QStringLiteral("schema")).toInt() == 1) {
      for (const auto& value : data.toMap().value(QStringLiteral("categories")).toList()) {
        const auto category = value.toMap();
        if (category.value(QStringLiteral("enabled")).toBool()
            && category.value(QStringLiteral("band")).toInt() > 0) categories.append(value);
      }
    }
    if (categories.isEmpty()) {
      categories = {
        QVariantMap{ { QStringLiteral("name"), QStringLiteral("General Channels") }, { QStringLiteral("band"), 1 } },
        QVariantMap{ { QStringLiteral("name"), QStringLiteral("Kids") }, { QStringLiteral("band"), 2 } },
        QVariantMap{ { QStringLiteral("name"), QStringLiteral("News") }, { QStringLiteral("band"), 3 } },
        QVariantMap{ { QStringLiteral("name"), QStringLiteral("Movies") }, { QStringLiteral("band"), 4 } },
        QVariantMap{ { QStringLiteral("name"), QStringLiteral("Sports") }, { QStringLiteral("band"), 5 } }
      };
    }
    m_tvCategories = categories;
    m_tvCategories.append(QVariantMap{
      { QStringLiteral("name"), QStringLiteral("All Channels") }, { QStringLiteral("band"), 0 }
    });
    emit liveTvChanged();
  });
  request("GET", QStringLiteral("LiveTv/Channels"),
          { { QStringLiteral("AddCurrentProgram"), true },
            { QStringLiteral("SortBy"), QStringLiteral("SortName") },
            { QStringLiteral("SortOrder"), QStringLiteral("Ascending") },
            { QStringLiteral("Limit"), 10000 } }, {},
          [this, session](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("Live TV channels could not load.")); return; }
    m_tvChannels = items(data);
    emit liveTvChanged();
  });
}

QVariantList FamilyApiClient::tvChannelsForBand(int band) const
{
  if (band == 0) return m_tvChannels;
  QVariantList result;
  for (const auto& value : m_tvChannels) {
    if (channelBand(value.toMap()) == band) result.append(value);
  }
  return result;
}

QVariantList FamilyApiClient::tvProgramsForChannel(const QString& channelId) const
{
  QVariantList result;
  for (const auto& value : m_tvPrograms) {
    if (value.toMap().value(QStringLiteral("ChannelId")).toString() == channelId)
      result.append(value);
  }
  return result;
}

void FamilyApiClient::refreshTvGuide(int band, const QDateTime& startUtc)
{
  if (!signedIn() || !startUtc.isValid()) return;
  QStringList channelIds;
  for (const auto& value : tvChannelsForBand(band)) {
    const QString id = value.toMap().value(QStringLiteral("Id")).toString();
    if (!id.isEmpty()) channelIds.append(id);
  }
  if (channelIds.isEmpty()) { m_tvPrograms.clear(); emit liveTvChanged(); return; }
  const quint64 session = m_sessionRevision;
  const quint64 guide = ++m_tvGuideRevision;
  request("GET", QStringLiteral("LiveTv/Programs"),
          { { QStringLiteral("ChannelIds"), channelIds.join(QLatin1Char(',')) },
            { QStringLiteral("MinEndDate"), startUtc.toUTC().toString(Qt::ISODate) },
            { QStringLiteral("MaxStartDate"), startUtc.addSecs(6 * 3600).toUTC().toString(Qt::ISODate) },
            { QStringLiteral("SortBy"), QStringLiteral("StartDate") },
            { QStringLiteral("EnableImages"), false },
            { QStringLiteral("Limit"), 10000 } }, {},
          [this, session, guide](const QVariant& data, const QString& error) {
    if (session != m_sessionRevision || guide != m_tvGuideRevision) return;
    if (!error.isEmpty()) { emit errorOccurred(QStringLiteral("TV guide could not load.")); return; }
    m_tvPrograms = items(data);
    emit liveTvChanged();
  });
}

QString FamilyApiClient::imageUrl(const QString& itemId, const QString& kind, int maxWidth) const
{
  if (itemId.isEmpty()) return {};
  QUrl url = server.resolved(QUrl(QStringLiteral("Items/%1/Images/%2").arg(itemId, kind)));
  QUrlQuery query;
  query.addQueryItem(QStringLiteral("maxWidth"), QString::number(qBound(160, maxWidth, 2560)));
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
  if (itemId.isEmpty()) return;
  if (!m_playingItemId.isEmpty()) {
    // The previous item's Playing request may still be in flight. Start this
    // item only after its Stopped report has been handed to Jellyfin.
    if (itemId != m_playingItemId || m_pendingStopMilliseconds >= 0) {
      m_queuedPlaybackItem = item;
      m_queuedPlaybackPositionMilliseconds = positionMilliseconds;
      m_queuedPlaybackStopMilliseconds = -1;
    }
    return;
  }
  m_playingItemId = itemId;
  m_playSessionId = QUuid::createUuid().toString(QUuid::WithoutBraces);
  const auto sources = item.value(QStringLiteral("MediaSources")).toList();
  m_mediaSourceId = sources.isEmpty() ? QString() : sources.first().toMap().value(QStringLiteral("Id")).toString();
  auto party = std::make_shared<CoWatchPlaybackState>();
  party->playSessionId = m_playSessionId;
  party->itemId = itemId;
  party->mediaSourceId = m_mediaSourceId;
  for (const auto& userId : m_coWatchUserIds) {
    if (!hasSavedProfile(userId)) continue;
    const QString token = m_settings.value(QStringLiteral("profiles/%1/token").arg(userId)).toString();
    if (!token.isEmpty()) party->targets.append(QVariantMap{
      { QStringLiteral("userId"), userId }, { QStringLiteral("token"), token }
    });
  }
  m_coWatchPlayback = party;
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
          [this, revision, playSession, itemId, seriesId, party, report](const QVariant&, const QString& error) {
    if (revision != m_sessionRevision || playSession != m_playSessionId) return;
    if (!error.isEmpty()) {
      emit errorOccurred(QStringLiteral("Playback status could not sync with Jellyfin."));
      m_playingItemId.clear(); m_playSessionId.clear(); m_mediaSourceId.clear();
      m_playbackStartConfirmed = false; m_pendingStopMilliseconds = -1;
      const QVariantMap queued = m_queuedPlaybackItem;
      const qlonglong queuedPosition = m_queuedPlaybackPositionMilliseconds;
      const qlonglong queuedStop = m_queuedPlaybackStopMilliseconds;
      m_queuedPlaybackItem.clear(); m_queuedPlaybackStopMilliseconds = -1;
      if (!queued.isEmpty()) {
        reportPlaybackStart(queued, queuedPosition);
        if (queuedStop >= 0) reportPlaybackStopped(queuedStop);
      }
      return;
    }
    m_playbackStartConfirmed = true;
    if (!party->abandoned) {
      const QByteArray body = QJsonDocument(QJsonObject::fromVariantMap(report)).toJson(QJsonDocument::Compact);
      for (const auto& value : party->targets) {
        const auto target = value.toMap();
        const QString userId = target.value(QStringLiteral("userId")).toString();
        requestAs("POST", QStringLiteral("Sessions/Playing"), {}, body,
                  target.value(QStringLiteral("token")).toString(), userId,
                  [this, party, target, userId](const QVariant&, const QString& secondaryError, int) {
          if (party->abandoned || !secondaryError.isEmpty()) return;
          if (party->stopMilliseconds >= 0)
            sendCoWatchStop(party, target, party->stopMilliseconds);
          else party->startedUserIds.insert(userId);
        });
      }
    }
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
  const auto party = m_coWatchPlayback;
  if (!party || party->abandoned) return;
  const QByteArray body = QJsonDocument(QJsonObject::fromVariantMap(report)).toJson(QJsonDocument::Compact);
  for (const auto& value : party->targets) {
    const auto target = value.toMap();
    const QString userId = target.value(QStringLiteral("userId")).toString();
    if (!party->startedUserIds.contains(userId)) continue;
    requestAs("POST", QStringLiteral("Sessions/Playing/Progress"), {}, body,
              target.value(QStringLiteral("token")).toString(), userId,
              [](const QVariant&, const QString&, int) {});
  }
}

void FamilyApiClient::reportPlaybackStopped(qlonglong positionMilliseconds)
{
  if (m_playingItemId.isEmpty()) return;
  if (m_pendingStopMilliseconds >= 0) {
    if (!m_queuedPlaybackItem.isEmpty())
      m_queuedPlaybackStopMilliseconds = qMax<qlonglong>(0, positionMilliseconds);
    return;
  }
  m_pendingStopMilliseconds = qMax<qlonglong>(0, positionMilliseconds);
  if (m_playbackStartConfirmed) sendPlaybackStopped(m_pendingStopMilliseconds);
}

void FamilyApiClient::sendPlaybackStopped(qlonglong positionMilliseconds)
{
  if (m_playingItemId.isEmpty()) return;
  const auto party = m_coWatchPlayback;
  if (party && !party->abandoned) {
    party->stopMilliseconds = positionMilliseconds;
    for (const auto& value : party->targets) {
      const auto target = value.toMap();
      if (party->startedUserIds.contains(target.value(QStringLiteral("userId")).toString()))
        sendCoWatchStop(party, target, positionMilliseconds);
    }
    party->startedUserIds.clear();
  }
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
  m_coWatchPlayback.reset();
  m_playbackStartConfirmed = false; m_pendingStopMilliseconds = -1;
  const QVariantMap queued = m_queuedPlaybackItem;
  const qlonglong queuedPosition = m_queuedPlaybackPositionMilliseconds;
  const qlonglong queuedStop = m_queuedPlaybackStopMilliseconds;
  m_queuedPlaybackItem.clear(); m_queuedPlaybackStopMilliseconds = -1;
  if (!queued.isEmpty()) {
    reportPlaybackStart(queued, queuedPosition);
    if (queuedStop >= 0) reportPlaybackStopped(queuedStop);
  }
}

void FamilyApiClient::sendCoWatchStop(const std::shared_ptr<CoWatchPlaybackState>& state,
                                      const QVariantMap& target, qlonglong positionMilliseconds)
{
  if (!state || state->abandoned) return;
  const QVariantMap report{
    { QStringLiteral("ItemId"), state->itemId },
    { QStringLiteral("PositionTicks"), positionMilliseconds * 10000 },
    { QStringLiteral("PlaySessionId"), state->playSessionId },
    { QStringLiteral("MediaSourceId"), state->mediaSourceId },
    { QStringLiteral("Failed"), false }
  };
  requestAs("POST", QStringLiteral("Sessions/Playing/Stopped"), {},
            QJsonDocument(QJsonObject::fromVariantMap(report)).toJson(QJsonDocument::Compact),
            target.value(QStringLiteral("token")).toString(),
            target.value(QStringLiteral("userId")).toString(),
            [](const QVariant&, const QString&, int) {});
}
