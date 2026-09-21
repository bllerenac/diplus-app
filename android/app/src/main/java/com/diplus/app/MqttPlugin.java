package com.diplus.app;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

/**
 * Canal MQTT nativo.
 *
 * El WebView no puede abrir sockets TCP directamente, asi que la conexion al
 * broker vive aqui, en Java. La capa React le dice que topic publicar y con
 * que payload; el plugin mantiene la conexion viva y reconecta si cae.
 *
 * Se usa QoS 1 (al menos una vez) en vez de 0 (dispara y olvida) para que un
 * corte de red no tire datos. El broker los encola hasta que se pueda entregar.
 */
@CapacitorPlugin(name = "Mqtt")
public class MqttPlugin extends Plugin {

    private static final String TAG = "MqttPlugin";
    private static final int QOS = 1;
    private static final int ESPERA_CONEXION_MS = 10000;
    private static final int KEEPALIVE_SEG = 60;

    private MqttClient cliente = null;
    private String estadoActual = "desconectado";
    private String errorActual = null;

    /** Conecta al broker con las credenciales dadas. */
    @PluginMethod
    public void conectar(PluginCall call) {
        final String broker  = call.getString("broker", "");
        final int    puerto  = call.getInt("puerto", 1883);
        final String usuario = call.getString("usuario", "");
        final String clave   = call.getString("clave", "");
        final String clientId = call.getString("clientId", "diplus-" + android.os.Build.SERIAL);

        if (broker == null || broker.trim().isEmpty()) {
            call.reject("Falta la dirección del broker.");
            return;
        }

        new Thread(() -> {
            try {
                desconectarInterno();

                String uri = "tcp://" + broker.trim() + ":" + puerto;
                cliente = new MqttClient(uri, clientId, new MemoryPersistence());

                MqttConnectOptions opts = new MqttConnectOptions();
                opts.setCleanSession(true);
                opts.setConnectionTimeout(ESPERA_CONEXION_MS / 1000);
                opts.setKeepAliveInterval(KEEPALIVE_SEG);
                opts.setAutomaticReconnect(true);

                if (usuario != null && !usuario.isEmpty()) {
                    opts.setUserName(usuario);
                }
                if (clave != null && !clave.isEmpty()) {
                    opts.setPassword(clave.toCharArray());
                }

                cliente.setCallback(new MqttCallback() {
                    @Override
                    public void connectionLost(Throwable cause) {
                        estadoActual = "desconectado";
                        errorActual = cause != null ? cause.getMessage() : "conexión perdida";
                        Log.w(TAG, "conexión perdida: " + errorActual);
                        JSObject ev = new JSObject();
                        ev.put("error", errorActual);
                        notifyListeners("onDesconectado", ev);
                    }

                    @Override
                    public void messageArrived(String topic, MqttMessage message) {
                        /* No se suscribe a nada, solo publica. */
                    }

                    @Override
                    public void deliveryComplete(IMqttDeliveryToken token) {
                        /* Confirmación QoS 1 — no hace falta hacer nada aquí. */
                    }
                });

                cliente.connect(opts);
                estadoActual = "conectado";
                errorActual = null;
                Log.i(TAG, "conectado a " + uri);

                JSObject ev = new JSObject();
                ev.put("broker", uri);
                notifyListeners("onConectado", ev);

                call.resolve();
            } catch (MqttException e) {
                estadoActual = "error";
                errorActual = e.getMessage();
                Log.w(TAG, "no se pudo conectar: " + errorActual);
                call.reject("No se pudo conectar al broker: " + errorActual);
            }
        }).start();
    }

    /** Desconecta limpiamente. */
    @PluginMethod
    public void desconectar(PluginCall call) {
        new Thread(() -> {
            desconectarInterno();
            call.resolve();
        }).start();
    }

    /**
     * Publica un mensaje en el topic indicado.
     *
     * Si el cliente no está conectado, intenta reconectar antes de publicar.
     * Con QoS 1 el broker confirma la entrega.
     */
    @PluginMethod
    public void publicar(PluginCall call) {
        final String topic   = call.getString("topic", "");
        final String payload = call.getString("payload", "");

        if (topic == null || topic.trim().isEmpty()) {
            call.reject("Falta el topic.");
            return;
        }

        new Thread(() -> {
            try {
                if (cliente == null || !cliente.isConnected()) {
                    call.reject("No hay conexión MQTT activa. Llama a conectar() primero.");
                    return;
                }

                MqttMessage msg = new MqttMessage(
                    payload != null ? payload.getBytes() : new byte[0]
                );
                msg.setQos(QOS);
                msg.setRetained(false);

                cliente.publish(topic.trim(), msg);

                JSObject r = new JSObject();
                r.put("topic", topic);
                r.put("bytes", payload != null ? payload.length() : 0);
                call.resolve(r);
            } catch (MqttException e) {
                estadoActual = "error";
                errorActual = e.getMessage();
                Log.w(TAG, "error al publicar: " + errorActual);
                call.reject("Error al publicar: " + errorActual);
            }
        }).start();
    }

    /** Estado actual de la conexión. */
    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("estado", estadoActual);
        r.put("conectado", cliente != null && cliente.isConnected());
        if (errorActual != null) r.put("error", errorActual);
        call.resolve(r);
    }

    /* ── Internos ──────────────────────────────────────────────────────────── */

    private void desconectarInterno() {
        if (cliente == null) return;
        try {
            if (cliente.isConnected()) cliente.disconnect();
            cliente.close();
        } catch (MqttException e) {
            Log.w(TAG, "error al desconectar: " + e.getMessage());
        } finally {
            cliente = null;
            estadoActual = "desconectado";
            errorActual = null;
        }
    }
}
