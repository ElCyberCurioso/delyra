package app.delyra.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/** Dónde se guardan las cookies persistentes (cifradas); en los tests, en memoria. */
interface CookieStorage {
    fun load(): String?
    fun save(value: String?)
}

/** Cifrado de la serialización (Keystore en la app; identidad en los tests). */
interface CookieCipher {
    fun seal(plain: String): String
    fun open(sealed: String): String?
}

/**
 * Almacén de cookies de la app. La API solo usa una (`__Secure-sid`, F1-04), pero se guardan todas
 * las persistentes que mande para no depender de su nombre.
 *
 * Diferencias con un navegador, a propósito:
 * - En `debug` (`allowInsecureLocalhost`), una cookie `Secure` también viaja a `http://localhost`
 *   (el `pnpm dev` local; los navegadores tratan `localhost` como contexto seguro y OkHttp no).
 * - No hay cookies de terceros: la app solo habla con el origen de Delyra.
 */
class SessionCookieJar(
    private val storage: CookieStorage,
    private val cipher: CookieCipher,
    private val allowInsecureLocalhost: Boolean,
    private val clock: () -> Long = System::currentTimeMillis,
) : CookieJar {
    private val lock = Any()
    private var cookies: MutableList<Cookie>? = null

    private fun all(): MutableList<Cookie> {
        cookies?.let { return it }
        val restored = storage.load()?.let(cipher::open)?.let { decode(it) } ?: mutableListOf()
        cookies = restored
        return restored
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        synchronized(lock) {
            val list = all()
            val now = clock()
            for (cookie in cookies) {
                list.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
                if (cookie.expiresAt > now) list.add(cookie)
            }
            persist(list)
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(lock) {
        val list = all()
        val now = clock()
        if (list.removeAll { it.expiresAt <= now }) persist(list)
        list.filter { matches(it, url) }
    }

    /** ¿Hay cookie de sesión? Sin ella no se pregunta a la API al abrir (se va directo al login). */
    fun hasSession(): Boolean = synchronized(lock) {
        val now = clock()
        all().any { it.name == SESSION_COOKIE && it.expiresAt > now }
    }

    fun clear() = synchronized(lock) {
        cookies = mutableListOf()
        storage.save(null)
    }

    private fun matches(cookie: Cookie, url: HttpUrl): Boolean {
        val localhost = url.host == "localhost" || url.host == "127.0.0.1"
        if (cookie.secure && !url.isHttps && !(allowInsecureLocalhost && localhost)) return false
        val domainOk = if (cookie.hostOnly) {
            url.host == cookie.domain
        } else {
            url.host == cookie.domain || url.host.endsWith(".${cookie.domain}")
        }
        if (!domainOk) return false
        val path = url.encodedPath
        return path == cookie.path || path.startsWith(cookie.path.trimEnd('/') + "/") || cookie.path == "/"
    }

    private fun persist(list: List<Cookie>) {
        val persistent = list.filter { it.persistent }
        storage.save(if (persistent.isEmpty()) null else cipher.seal(encode(persistent)))
    }

    @Serializable
    private data class Stored(
        val name: String,
        val value: String,
        val expiresAt: Long,
        val domain: String,
        val path: String,
        val secure: Boolean,
        val httpOnly: Boolean,
        val hostOnly: Boolean,
    )

    private fun encode(list: List<Cookie>): String = json.encodeToString(
        list.map { Stored(it.name, it.value, it.expiresAt, it.domain, it.path, it.secure, it.httpOnly, it.hostOnly) },
    )

    private fun decode(value: String): MutableList<Cookie>? = runCatching {
        json.decodeFromString<List<Stored>>(value).map { s ->
            Cookie.Builder()
                .name(s.name)
                .value(s.value)
                .expiresAt(s.expiresAt)
                .path(s.path)
                .apply {
                    if (s.hostOnly) hostOnlyDomain(s.domain) else domain(s.domain)
                    if (s.secure) secure()
                    if (s.httpOnly) httpOnly()
                }
                .build()
        }.toMutableList()
    }.getOrNull()

    companion object {
        const val SESSION_COOKIE = "__Secure-sid"
        private val json = Json { ignoreUnknownKeys = true }
    }
}
