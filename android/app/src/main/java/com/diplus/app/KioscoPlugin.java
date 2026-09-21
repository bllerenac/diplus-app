package com.diplus.app;

import android.app.Activity;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Expone el control del modo kiosco a la capa React.
 *
 * La contraseña se valida en React (más fácil de cambiar). Este plugin solo
 * activa o desactiva el bloqueo y ofrece acciones de sistema (cerrar, reiniciar).
 */
@CapacitorPlugin(name = "Kiosco")
public class KioscoPlugin extends Plugin {

    /** Activa el bloqueo: atrás e inicio quedan sin efecto. */
    @PluginMethod
    public void bloquear(PluginCall call) {
        MainActivity.kioscoActivo = true;
        call.resolve();
    }

    /** Desactiva el bloqueo: el usuario puede navegar con normalidad. */
    @PluginMethod
    public void desbloquear(PluginCall call) {
        MainActivity.kioscoActivo = false;
        call.resolve();
    }

    /** Devuelve si el kiosco está activo en este momento. */
    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("activo", MainActivity.kioscoActivo);
        call.resolve(r);
    }

    /** Cierra la aplicación limpiamente. */
    @PluginMethod
    public void cerrar(PluginCall call) {
        MainActivity.kioscoActivo = false;
        getActivity().runOnUiThread(() -> {
            getActivity().finishAffinity();
            System.exit(0);
        });
        call.resolve();
    }

    /**
     * Reinicia la aplicación: la cierra y la vuelve a lanzar.
     * Útil tras cambios de configuración que necesitan recarga completa.
     */
    @PluginMethod
    public void reiniciar(PluginCall call) {
        Activity act = getActivity();
        Intent intent = act.getPackageManager()
                .getLaunchIntentForPackage(act.getPackageName());
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP
                          | Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(intent);
        }
        act.finishAffinity();
        call.resolve();
    }
}
