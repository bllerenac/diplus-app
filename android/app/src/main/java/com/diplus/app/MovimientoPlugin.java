package com.diplus.app;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * La unidad inercial que el equipo ya lleva dentro.
 *
 * Este aparato trae un MPU6500 de seis ejes y un magnetometro, y hasta ahora no
 * se usaban. A diferencia del CAN o del RS485, esto no depende de ningun cable
 * ni de que el camion hable ningun protocolo: esta dentro y funciona siempre.
 *
 * Aqui solo se entregan los ejes en crudo. Que significa cada uno —si esto es
 * una frenada, un bache o el motor al ralenti— se decide arriba, donde el
 * usuario puede calibrarlo: el mismo aparato montado de otra forma da otros
 * numeros, y eso no se puede fijar en el codigo.
 */
@CapacitorPlugin(name = "Movimiento")
public class MovimientoPlugin extends Plugin {

    private static final String TAG = "Movimiento";

    private SensorManager gestor;
    private SensorEventListener oyente;

    /* Se guardan los ultimos de cada uno porque llegan por separado y se
       publican juntos: comparar una aceleracion con un giro de hace medio
       segundo no dice nada. */
    private final float[] acel = new float[3];
    private final float[] giro = new float[3];
    private long ultimoEnvio = 0;

    @PluginMethod
    public void arrancar(PluginCall call) {
        final int cadaMs = Math.max(20, call.getInt("cadaMs", 100));

        if (oyente != null) {
            call.resolve();
            return;
        }

        gestor = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (gestor == null) {
            call.reject("este equipo no expone sensores");
            return;
        }

        Sensor a = gestor.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        Sensor g = gestor.getDefaultSensor(Sensor.TYPE_GYROSCOPE);

        if (a == null) {
            call.reject("este equipo no tiene acelerómetro");
            return;
        }

        oyente = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent e) {
                if (e.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
                    System.arraycopy(e.values, 0, acel, 0, 3);
                } else if (e.sensor.getType() == Sensor.TYPE_GYROSCOPE) {
                    System.arraycopy(e.values, 0, giro, 0, 3);
                }

                /* El sensor entrega a 200 Hz y eso ahogaria la aplicacion. Se
                   publica al ritmo que se pida, con el ultimo valor de cada eje. */
                long ahora = System.currentTimeMillis();
                if (ahora - ultimoEnvio < cadaMs) return;
                ultimoEnvio = ahora;

                JSObject d = new JSObject();
                d.put("ax", acel[0]);
                d.put("ay", acel[1]);
                d.put("az", acel[2]);
                d.put("gx", giro[0]);
                d.put("gy", giro[1]);
                d.put("gz", giro[2]);
                d.put("at", ahora);
                notifyListeners("onMovimiento", d);
            }

            @Override
            public void onAccuracyChanged(Sensor s, int precision) {
                /* No se usa: la precision que declara el fabricante no cambia
                   nada de lo que se calcula arriba. */
            }
        };

        /* SENSOR_DELAY_GAME son unos 20 ms, suficiente para ver una frenada y
           para que la vibracion tenga sentido; SENSOR_DELAY_UI se pierde los
           golpes cortos, que son justo los que interesan. */
        gestor.registerListener(oyente, a, SensorManager.SENSOR_DELAY_GAME);
        if (g != null) gestor.registerListener(oyente, g, SensorManager.SENSOR_DELAY_GAME);

        Log.i(TAG, "IMU en marcha, publicando cada " + cadaMs + " ms");
        call.resolve();
    }

    @PluginMethod
    public void parar(PluginCall call) {
        if (gestor != null && oyente != null) gestor.unregisterListener(oyente);
        oyente = null;
        call.resolve();
    }

    /** Que trae este equipo, para no ofrecer en la pantalla lo que no existe. */
    @PluginMethod
    public void queHay(PluginCall call) {
        SensorManager m = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        JSObject r = new JSObject();

        if (m == null) {
            r.put("acelerometro", false);
            call.resolve(r);
            return;
        }

        Sensor a = m.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        r.put("acelerometro", a != null);
        r.put("nombre", a != null ? a.getName() : "");
        r.put("maxHz", a != null ? Math.round(1000000f / Math.max(1, a.getMinDelay())) : 0);
        r.put("giroscopo", m.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null);
        r.put("brujula", m.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) != null);
        r.put("barometro", m.getDefaultSensor(Sensor.TYPE_PRESSURE) != null);
        call.resolve(r);
    }
}
