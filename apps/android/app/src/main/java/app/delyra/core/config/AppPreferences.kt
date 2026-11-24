package app.delyra.core.config

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "delyra")

/** Preferencias locales de la app (no son datos de la cuenta, que viven en la API). */
class AppPreferences(context: Context) {
    private val store = context.applicationContext.dataStore

    private object Keys {
        val environment = stringPreferencesKey("environment")
        val cookies = stringPreferencesKey("cookies")
        val calendarView = stringPreferencesKey("calendar_view")
        val showHolidays = booleanPreferencesKey("show_holidays")
        val showTasks = booleanPreferencesKey("show_tasks")
    }

    suspend fun environment(): Environment = Environment.parse(store.data.first()[Keys.environment])

    suspend fun setEnvironment(environment: Environment) {
        store.edit { it[Keys.environment] = environment.name }
    }

    /** Cookies cifradas con el Keystore (base64); ver [app.delyra.core.network.SessionCookieJar]. */
    suspend fun encryptedCookies(): String? = store.data.first()[Keys.cookies]

    suspend fun setEncryptedCookies(value: String?) {
        store.edit { if (value == null) it.remove(Keys.cookies) else it[Keys.cookies] = value }
    }

    val calendarView: Flow<String?> = store.data.map { it[Keys.calendarView] }

    suspend fun setCalendarView(value: String) {
        store.edit { it[Keys.calendarView] = value }
    }

    val layers: Flow<Pair<Boolean, Boolean>> =
        store.data.map { (it[Keys.showHolidays] ?: true) to (it[Keys.showTasks] ?: true) }

    suspend fun setLayers(holidays: Boolean, tasks: Boolean) {
        store.edit {
            it[Keys.showHolidays] = holidays
            it[Keys.showTasks] = tasks
        }
    }
}
