package app.delyra.feature.auth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** El WebView de Turnstile solo sigue la redirección de Cloudflare a la misma página. */
class TurnstileRedirectTest {
    private val prod = "https://delyra.app"

    @Test
    fun `sigue la redirección de turnstile_html a turnstile en el mismo origen`() {
        assertTrue(isTurnstileRedirect(prod, "https://delyra.app/mobile/turnstile?theme=light&lang=es&action=login", true))
        assertTrue(isTurnstileRedirect("http://localhost:5173", "http://localhost:5173/mobile/turnstile", true))
    }

    @Test
    fun `no sigue navegaciones que no son redirecciones`() {
        assertFalse(isTurnstileRedirect(prod, "https://delyra.app/mobile/turnstile", false))
    }

    @Test
    fun `no sigue redirecciones a otro origen ni a otra página`() {
        assertFalse(isTurnstileRedirect(prod, "https://evil.example/mobile/turnstile", true))
        assertFalse(isTurnstileRedirect(prod, "http://delyra.app/mobile/turnstile", true))
        assertFalse(isTurnstileRedirect(prod, "https://delyra.app.evil.example/mobile/turnstile", true))
        assertFalse(isTurnstileRedirect(prod, "https://delyra.app/login", true))
        assertFalse(isTurnstileRedirect(prod, "https://delyra.app/mobile/turnstile/../../login", true))
        assertFalse(isTurnstileRedirect(prod, "no es una url", true))
    }
}
