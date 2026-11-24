package app.delyra.core.network

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionCookieJarTest {
    private class MemoryStorage : CookieStorage {
        var value: String? = null
        override fun load() = value
        override fun save(value: String?) {
            this.value = value
        }
    }

    /** «Cifrado» reversible para comprobar que lo guardado no es el texto plano. */
    private object Reverse : CookieCipher {
        override fun seal(plain: String) = plain.reversed()
        override fun open(sealed: String) = sealed.reversed()
    }

    private val production = "https://delyra.app/api/auth/login".toHttpUrl()
    private val work = "https://work.delyra.app/api/boards".toHttpUrl()
    private val now = 1_800_000_000_000L

    private fun session(domain: String? = "delyra.app", secure: Boolean = true, maxAgeMs: Long = 3_600_000) =
        Cookie.Builder().name(SessionCookieJar.SESSION_COOKIE).value("token").path("/").expiresAt(now + maxAgeMs).apply {
            if (domain != null) domain(domain) else hostOnlyDomain("localhost")
            if (secure) secure()
            httpOnly()
        }.build()

    @Test
    fun `la cookie de sesion vale en los dos dominios y sobrevive a reiniciar`() {
        val storage = MemoryStorage()
        val jar = SessionCookieJar(storage, Reverse, allowInsecureLocalhost = false) { now }
        jar.saveFromResponse(production, listOf(session()))
        assertEquals(1, jar.loadForRequest(work).size)
        assertTrue(storage.value!!.isNotEmpty())
        assertFalse("se guarda cifrada", storage.value!!.contains("\"token\""))

        val restored = SessionCookieJar(storage, Reverse, allowInsecureLocalhost = false) { now }
        assertTrue(restored.hasSession())
        assertEquals("token", restored.loadForRequest(production).single().value)
    }

    @Test
    fun `no viaja a otro dominio ni por http en produccion`() {
        val jar = SessionCookieJar(MemoryStorage(), Reverse, allowInsecureLocalhost = false) { now }
        jar.saveFromResponse(production, listOf(session()))
        assertTrue(jar.loadForRequest("https://delyra.app.evil.com/".toHttpUrl()).isEmpty())
        assertTrue(jar.loadForRequest("http://delyra.app/".toHttpUrl()).isEmpty())
    }

    @Test
    fun `en debug la cookie Secure viaja a localhost por http`() {
        val local = "http://localhost:5173/api/auth/me".toHttpUrl()
        val strict = SessionCookieJar(MemoryStorage(), Reverse, allowInsecureLocalhost = false) { now }
        strict.saveFromResponse(local, listOf(session(domain = null)))
        assertTrue(strict.loadForRequest(local).isEmpty())

        val debug = SessionCookieJar(MemoryStorage(), Reverse, allowInsecureLocalhost = true) { now }
        debug.saveFromResponse(local, listOf(session(domain = null)))
        assertEquals(1, debug.loadForRequest(local).size)
    }

    @Test
    fun `una cookie caducada borra la sesion (logout del servidor)`() {
        val storage = MemoryStorage()
        val jar = SessionCookieJar(storage, Reverse, allowInsecureLocalhost = false) { now }
        jar.saveFromResponse(production, listOf(session()))
        jar.saveFromResponse(production, listOf(session(maxAgeMs = -1_000)))
        assertFalse(jar.hasSession())
        assertEquals(null, storage.value)
    }

    @Test
    fun `datos corruptos equivalen a no tener sesion`() {
        val storage = MemoryStorage().apply { value = "basura" }
        val jar = SessionCookieJar(storage, Reverse, allowInsecureLocalhost = false) { now }
        assertFalse(jar.hasSession())
    }
}
