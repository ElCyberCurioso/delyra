package app.delyra.core.session

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * Avisos entre pantallas de que algo cambió en la API (un evento guardado en el editor, una
 * tarjeta editada en su pantalla): quien pinta esos datos los vuelve a pedir.
 */
class DataChanges {
    private val _calendar = MutableStateFlow(0)
    private val _boards = MutableStateFlow(0)

    /** Eventos, calendarios o tareas con fecha (la capa «Tareas» del calendario). */
    val calendar: StateFlow<Int> = _calendar
    val boards: StateFlow<Int> = _boards

    fun calendarChanged() = _calendar.update { it + 1 }

    /** Un cambio en tarjetas también puede mover la capa de tareas del calendario. */
    fun boardsChanged() {
        _boards.update { it + 1 }
        _calendar.update { it + 1 }
    }
}
