package com.diplus.app;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Arranca y para el servicio en primer plano y le pasa su latido al JS. */
@CapacitorPlugin(name = "SegundoPlano")
public class SegundoPlanoPlugin extends Plugin {

    @Override
    public void load() {
        ServicioSegundoPlano.alLatir = () -> {
            JSObject o = new JSObject();
            o.put("at", System.currentTimeMillis());
            notifyListeners("latido", o);
        };
    }

    @PluginMethod
    public void arrancar(PluginCall call) {
        Intent i = new Intent(getContext(), ServicioSegundoPlano.class);
        i.putExtra(ServicioSegundoPlano.EXTRA_TEXTO, call.getString("texto", "Leyendo y enviando"));
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i);
            else getContext().startService(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo arrancar el servicio: " + e.getMessage());
        }
    }

    @PluginMethod
    public void detener(PluginCall call) {
        getContext().stopService(new Intent(getContext(), ServicioSegundoPlano.class));
        call.resolve();
    }

    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("activo", ServicioSegundoPlano.activo);
        call.resolve(r);
    }

    @Override
    protected void handleOnDestroy() {
        ServicioSegundoPlano.alLatir = null;
    }
}
