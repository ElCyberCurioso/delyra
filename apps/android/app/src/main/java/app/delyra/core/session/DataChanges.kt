package app.delyra.core.session

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * Avisos entre pantallas de que algo cambió en la API (un evento guardado en el editor, una
 * tarjeta editada en su pantalla, un cambio de otra persona en un tablero compartido): quien pinta
 * esos datos los vuelve a pedir.
 */
class DataChanges {
    private val _calendar = MutableStateFlow(0)
    private val _boards = MutableStateFlow(0)
    private val _remoteBoard = MutableSharedFlow<String>(extraBufferCapacity = 16)

    /** Eventos, calendarios o tareas con fecha (la capa «Tareas» del calendario). */
    val calendar: StateFlow<Int> = _calendar
    val boards: StateFlow<Int> = _boards

    /** Otra persona cambió algo en este tablero (canal en vivo, F7-05): id del tablero. */
    val remoteBoard: SharedFlow<String> = _remoteBoard

    fun calendarChanged() = _calendar.update { it + 1 }

    /** Un cambio en tarjetas también puede mover la capa de tareas del calendario. */
    fun boardsChanged() {
        _boards.update { it + 1 }
        _calendar.update { it + 1 }
    }

    /** Lo avisa el canal en vivo: la tarjeta abierta, la lista de tableros y el calendario se refrescan. */
    fun remoteBoardChanged(boardId: String) {
        _remoteBoard.tryEmit(boardId)
        boardsChanged()
    }
}
