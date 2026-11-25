package app.delyra.navigation

import app.delyra.feature.auth.AuthViewModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Enlaces de los correos que abre la app (F8-10). */
class AppLinksTest {
    private val token = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4"

    @Test
    fun `invitación y recuperación de delyra punto app`() {
        assertEquals(AppLinks.Kind.Invitation, AppLinks.kind("https://delyra.app/registro#token=$token"))
        assertEquals(AppLinks.Kind.PasswordReset, AppLinks.kind("https://delyra.app/restablecer#token=$token"))
    }

    @Test
    fun `nada de otros dominios, esquemas o rutas`() {
        assertNull(AppLinks.kind("http://delyra.app/registro#token=$token"))
        assertNull(AppLinks.kind("https://delyra.app.evil.com/registro#token=$token"))
        assertNull(AppLinks.kind("https://work.delyra.app/registro"))
        assertNull(AppLinks.kind("https://delyra.app/registro/otra"))
        assertNull(AppLinks.kind("https://delyra.app/"))
        assertNull(AppLinks.kind("no es un enlace"))
        assertNull(AppLinks.kind(null))
    }

    @Test
    fun `el token sale del fragmento del enlace`() {
        assertEquals(token, AuthViewModel.extractToken("https://delyra.app/registro#token=$token"))
        assertEquals(token, AuthViewModel.extractToken("https://delyra.app/restablecer#token=$token"))
    }
}
