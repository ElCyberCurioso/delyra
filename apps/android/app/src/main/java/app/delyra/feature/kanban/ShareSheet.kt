package app.delyra.feature.kanban

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.delyra.R
import app.delyra.core.i18n.serverText
import app.delyra.core.model.BoardInvitation
import app.delyra.core.model.BoardMember
import app.delyra.core.network.ApiError
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.EmailField
import app.delyra.core.ui.ErrorText
import app.delyra.feature.calendar.appLocale
import app.delyra.feature.calendar.parseInstant
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Límites de `BOARD_SHARING_LIMITS` (packages/shared/src/schemas/kanban.ts). */
private const val MAX_MEMBERS = 20
private const val INVITATION_DAYS = 14

/**
 * Compartir un tablero (F7-04), como `share-dialog.tsx`: el dueño invita por email, cambia
 * permisos, quita a gente y anula invitaciones; el resto ve quién tiene acceso y puede salir.
 */
@Composable
fun ShareSheet(vm: BoardViewModel, onDismiss: () -> Unit) {
    val board = vm.detail?.board ?: return
    val isOwner = board.isOwner
    // Abierta del todo (la lista de personas va debajo del formulario) y por encima del teclado.
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 16.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(if (isOwner) R.string.share_title_owner else R.string.share_title_member),
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                if (isOwner) {
                    stringResource(R.string.share_intro_owner)
                } else {
                    stringResource(
                        if (board.canWrite) R.string.share_intro_editor else R.string.share_intro_reader,
                        board.ownerName ?: stringResource(R.string.invitation_someone),
                    )
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (isOwner) InviteForm(vm)
            val members = vm.members
            when {
                members == null && vm.membersError != null -> {
                    ErrorText(vm.membersError)
                    OutlinedButton(onClick = vm::loadMembers) { Text(stringResource(R.string.action_retry)) }
                }
                members == null -> Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                else -> {
                    SectionTitle(stringResource(R.string.share_with_access))
                    members.members.forEach { MemberRow(vm, it, isOwner) }
                    if (isOwner && members.invitations.isNotEmpty()) {
                        SectionTitle(stringResource(R.string.members_pending))
                        members.invitations.forEach { InvitationRow(vm, it) }
                    }
                    if (!isOwner) LeaveButton(vm)
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp).semantics { heading() })
}

@Composable
private fun InviteForm(vm: BoardViewModel) {
    var email by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("editor") }
    var invited by remember { mutableStateOf(false) }
    // Invitación creada (en esta apertura de la hoja): se vacía el formulario y se dice qué pasa ahora.
    val invitedBefore = remember { vm.invitedCount }
    LaunchedEffect(vm.invitedCount) {
        if (vm.invitedCount > invitedBefore) {
            email = ""
            invited = true
        }
    }
    val error = vm.inviteError
    val fieldError = (error as? ApiError.Validation)?.fields?.get("email")?.let { serverText(it) }
    Surface(shape = MaterialTheme.shapes.medium, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            EmailField(
                email,
                { email = it; invited = false; vm.inviteError = null },
                Modifier.fillMaxWidth(),
                error = fieldError,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.share_permission), style = MaterialTheme.typography.labelLarge)
                RoleMenu(role, label = null) { role = it }
                Box(Modifier.weight(1f))
                Button(onClick = { vm.invite(email, role) }, enabled = email.contains('@') && !vm.sharing) {
                    Icon(Icons.Outlined.PersonAdd, null, Modifier.size(18.dp))
                    Text(stringResource(R.string.members_send), Modifier.padding(start = 8.dp))
                }
            }
            if (error != null && fieldError == null) ErrorText(error)
            if (invited) Text(stringResource(R.string.share_invited), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            Text(
                stringResource(R.string.share_limits, MAX_MEMBERS, INVITATION_DAYS),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun MemberRow(vm: BoardViewModel, member: BoardMember, isOwner: Boolean) {
    var confirmRemove by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(
                member.name + if (member.you) stringResource(R.string.share_you) else "",
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            member.email?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (isOwner && member.role != "owner") {
            RoleMenu(member.role, label = stringResource(R.string.share_permission_of, member.name), enabled = !vm.sharing) {
                if (it != member.role) vm.setRole(member.userId, it)
            }
            IconButton(onClick = { confirmRemove = true }, enabled = !vm.sharing) {
                Icon(Icons.Outlined.Close, stringResource(R.string.share_remove, member.name))
            }
        } else {
            Text(roleLabel(member.role), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (confirmRemove) {
        ConfirmDialog(
            title = stringResource(R.string.members_remove),
            text = stringResource(R.string.share_confirm_remove, member.name),
            confirmLabel = stringResource(R.string.members_remove),
            destructive = true,
            onConfirm = { vm.removeMember(member.userId) },
            onDismiss = { confirmRemove = false },
        )
    }
}

@Composable
private fun InvitationRow(vm: BoardViewModel, invitation: BoardInvitation) {
    val locale = appLocale()
    val expires = runCatching {
        parseInstant(invitation.expiresAt).atZone(vm.zone).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
    }.getOrDefault(invitation.expiresAt)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(invitation.email, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                stringResource(R.string.share_expires, roleLabel(invitation.role), expires),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        TextButton(onClick = { vm.revokeInvitation(invitation.id) }, enabled = !vm.sharing) {
            Text(stringResource(R.string.share_revoke))
        }
    }
}

@Composable
private fun LeaveButton(vm: BoardViewModel) {
    var confirm by remember { mutableStateOf(false) }
    HorizontalDivider()
    OutlinedButton(onClick = { confirm = true }, enabled = !vm.sharing) {
        Icon(Icons.AutoMirrored.Outlined.Logout, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error)
        Text(stringResource(R.string.members_leave), Modifier.padding(start = 8.dp), color = MaterialTheme.colorScheme.error)
    }
    if (confirm) {
        ConfirmDialog(
            title = stringResource(R.string.members_leave),
            text = stringResource(R.string.members_leave_body),
            confirmLabel = stringResource(R.string.members_leave),
            destructive = true,
            onConfirm = vm::leave,
            onDismiss = { confirm = false },
        )
    }
}

/** Selector de permiso (puede editar / solo lectura). [label] es el nombre accesible. */
@Composable
private fun RoleMenu(role: String, label: String?, enabled: Boolean = true, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }, enabled = enabled, modifier = if (label != null) Modifier.semantics { contentDescription = label } else Modifier) {
            Text(roleLabel(role))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            listOf("editor", "reader").forEach { option ->
                DropdownMenuItem(text = { Text(roleLabel(option)) }, onClick = { open = false; onPick(option) })
            }
        }
    }
}
