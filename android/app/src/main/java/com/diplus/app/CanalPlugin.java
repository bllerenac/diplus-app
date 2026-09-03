package com.diplus.app;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * El puente entre la aplicacion y el canal remoto.
 *
 * El servicio de Java abre el puerto y contesta, pero no sabe nada de sensores
 * ni de configuracion: eso vive arriba, en TypeScript. Asi que la aplicacion le
 * va dejando un resumen de como esta, y el servicio lo sirve tal cual. Al reves
 * igual: lo que se pide de fuera queda en una cola que la aplicacion recoge.
 */
@CapacitorPlugin(name = "Canal")
public class CanalPlugin extends Plugin {

    @PluginMethod
    public void arrancar(PluginCall call) {
        Intent i = new Intent(getContext(), CanalRemoto.class);
        i.putExtra(CanalRemoto.EXTRA_PUERTO, call.getInt("puerto", 8787));
        i.putExtra(CanalRemoto.EXTRA_TOKEN, call.getString("token", ""));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(i);
        } else {
            getContext().startService(i);
        }

        JSObject r = new JSObject();
        r.put("puerto", call.getInt("puerto", 8787));
        call.resolve(r);
    }

    @PluginMethod
    public void parar(PluginCall call) {
        getContext().stopService(new Intent(getContext(), CanalRemoto.class));
        call.resolve();
    }

    /** La aplicacion cuenta como esta; el servicio lo sirve. */
    @PluginMethod
    public void publicar(PluginCall call) {
        CanalRemoto.publicar(call.getString("estado", "{}"));
        call.resolve();
    }

    /** Lo que se pidio de fuera desde la ultima vez. Se vacia al recogerlo. */
    @PluginMethod
    public void ordenes(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ordenes", CanalRemoto.recogerOrdenes());
        call.resolve(r);
    }
}
