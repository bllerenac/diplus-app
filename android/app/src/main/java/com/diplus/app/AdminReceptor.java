package com.diplus.app;

import android.app.admin.DeviceAdminReceiver;

/**
 * Receptor de administrador, necesario para ser propietaria del dispositivo.
 *
 * No hace nada por si solo: existe para que el sistema tenga a quien nombrar.
 * Con la app como propietaria se puede quitar el menu de apagado y la pantalla
 * de bloqueo, que es lo unico que impide de verdad que alguien apague la tablet
 * a mitad de un turno.
 *
 * Se nombra una sola vez, con el equipo sin cuentas configuradas:
 *
 *   adb shell dpm set-device-owner com.diplus.app/.AdminReceptor
 *
 * Si ya tiene una cuenta de Google, Android lo rechaza y hace falta un
 * restablecimiento de fabrica antes. Sin nombrar, la aplicacion funciona igual:
 * se queda con la tarea fijada, que es lo que hay hoy.
 */
public class AdminReceptor extends DeviceAdminReceiver {
}
