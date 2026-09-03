package com.diplus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Levanta la aplicacion cuando arranca el equipo.
 *
 * Sin esto, un corte de energia deja el equipo encendido y la aplicacion
 * cerrada: deja de leer sensores, deja de registrar y deja de posicionar, y en
 * un camion en la mina nadie va a tocar el icono. Se descubre cuando alguien
 * mira la pantalla, que puede ser dias despues.
 *
 * En Android 9 se puede abrir una pantalla desde el arranque. Las restricciones
 * para hacerlo desde segundo plano llegaron en Android 10, asi que esto vale
 * para este equipo pero habria que revisarlo si alguna vez se actualiza.
 */
public class ArranqueReceptor extends BroadcastReceiver {

    private static final String TAG = "Arranque";

    @Override
    public void onReceive(Context contexto, Intent intent) {
        String accion = intent == null ? "" : String.valueOf(intent.getAction());

        /* Se atienden los dos: el arranque normal y el de los equipos que
           cifran el almacenamiento, que emiten el suyo antes de desbloquear. */
        if (!Intent.ACTION_BOOT_COMPLETED.equals(accion)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(accion)
                && !"android.intent.action.LOCKED_BOOT_COMPLETED".equals(accion)) {
            return;
        }

        try {
            Intent abrir = new Intent(contexto, MainActivity.class);
            abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            contexto.startActivity(abrir);
            Log.i(TAG, "Aplicacion levantada tras el arranque (" + accion + ")");
        } catch (Exception e) {
            Log.e(TAG, "No se pudo levantar la aplicacion al arrancar", e);
        }
    }
}
