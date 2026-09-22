package com.diplus.app;

import android.Manifest;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import com.android.canbus.CanBusHelper;
import com.android.canbus.CanBusHelper.CanBusCallback;

/**
 * Los permisos se piden, no solo se declaran.
 *
 * Estaban en el manifiesto y ahi me quede, que es el error clasico: Android
 * exige pedirlos ademas en tiempo de ejecucion, y sin eso el LocationManager
 * falla y el receptor GNSS nunca llega a fijar. Se vio en un equipo: llegaban
 * sentencias NMEA sin parar pero todas vacias, cero satelites, y parecia una
 * antena sin cielo cuando era un permiso que nadie habia concedido.
 */
@CapacitorPlugin(
    name = "CanRs485",
    permissions = {
        @Permission(
            alias = CanRs485Plugin.UBICACION,
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            }
        )
    }
)
public class CanRs485Plugin extends Plugin {

    static final String UBICACION = "ubicacion";

    private static final String TAG = "CanRs485Plugin";
    private final AtomicBoolean isGpsListening = new AtomicBoolean(false);
    private final AtomicBoolean isCan1Listening = new AtomicBoolean(false);
    private final AtomicBoolean isCan2Listening = new AtomicBoolean(false);
    private final AtomicBoolean isRs485Listening = new AtomicBoolean(false);

    private Thread gpsThread;
    private Thread can1Thread;
    private Thread can2Thread;
    private Thread rs485Thread;
    private LocationManager locationManager;

    private final CanBusHelper canBusHelper0 = new CanBusHelper();
    private final CanBusHelper canBusHelper1 = new CanBusHelper();

    // CRC8 para Protocolo Eurosens DDS 485 (del repositorio edge-computer)
    public static int calculateEurosensCrc8(byte[] data, int length) {
        int crc = 0;
        for (int b = 0; b < length; b++) {
            int i = (data[b] ^ crc) & 0xff;
            crc = 0;
            if ((i & 0x01) != 0) crc ^= 0x5e;
            if ((i & 0x02) != 0) crc ^= 0xbc;
            if ((i & 0x04) != 0) crc ^= 0x61;
            if ((i & 0x08) != 0) crc ^= 0xc2;
            if ((i & 0x10) != 0) crc ^= 0x9d;
            if ((i & 0x20) != 0) crc ^= 0x23;
            if ((i & 0x40) != 0) crc ^= 0x46;
            if ((i & 0x80) != 0) crc ^= 0x8c;
        }
        return crc & 0xff;
    }

    // CRC16 para Protocolo Modbus RTU
    public static int calculateModbusCrc16(byte[] buf, int len) {
        int crc = 0xffff;
        for (int pos = 0; pos < len; pos++) {
            crc ^= (buf[pos] & 0xff);
            for (int i = 8; i != 0; i--) {
                if ((crc & 0x0001) != 0) {
                    crc >>= 1;
                    crc ^= 0xa001;
                } else {
                    crc >>= 1;
                }
            }
        }
        return crc & 0xffff;
    }

    private String resolverDevicePath(String path) {
        if (path == null || path.isEmpty()) return "/dev/ttyUSB0";
        File f = new File(path);
        if (f.exists()) return path;

        if (path.contains("ttyUSB")) {
            for (int i = 0; i <= 3; i++) {
                File candidate = new File("/dev/ttyUSB" + i);
                if (candidate.exists()) {
                    Log.i(TAG, "Puerto " + path + " no encontrado, usando puerto USB activo: " + candidate.getAbsolutePath());
                    return candidate.getAbsolutePath();
                }
            }
        }
        return path;
    }

    @PluginMethod
    public void setPortBaudrate(PluginCall call) {
        String devicePath = resolverDevicePath(call.getString("devicePath", "/dev/ttyUSB0"));
        int baudrate = call.getInt("baudrate", 9600);

        try {
            Process process = Runtime.getRuntime().exec(new String[] {
                "stty", "-F", devicePath, String.valueOf(baudrate), "raw", "-echo"
            });
            process.waitFor();
            JSObject ret = new JSObject();
            ret.put("status", "configured");
            ret.put("devicePath", devicePath);
            ret.put("baudrate", baudrate);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error configurando stty para " + devicePath, e);
            call.reject("Error stty: " + e.getMessage());
        }
    }

    @PluginMethod
    public void sendEurosensQuery(PluginCall call) {
        String devicePath = resolverDevicePath(call.getString("devicePath", "/dev/ttyUSB0"));
        int address = call.getInt("address", 1);
        int command = call.getInt("command", 6);

        try {
            File devFile = new File(devicePath);
            if (!devFile.exists()) {
                call.reject("Archivo de dispositivo no existe: " + devicePath);
                return;
            }

            byte[] head = new byte[] { (byte) 0x31, (byte) (address & 0xff), (byte) (command & 0xff) };
            int crc = calculateEurosensCrc8(head, 3);
            byte[] packet = new byte[] { head[0], head[1], head[2], (byte) crc };

            try (FileOutputStream fos = new FileOutputStream(devFile)) {
                fos.write(packet);
                fos.flush();
            }

            StringBuilder sb = new StringBuilder();
            for (byte b : packet) sb.append(String.format("%02X ", b));

            JSObject ret = new JSObject();
            ret.put("status", "sent");
            ret.put("hexSent", sb.toString().trim());
            ret.put("devicePath", devicePath);
            ret.put("address", address);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error enviando trama Eurosens a " + devicePath, e);
            call.reject("Error Eurosens: " + e.getMessage());
        }
    }

    @PluginMethod
    public void sendModbusQuery(PluginCall call) {
        String devicePath = resolverDevicePath(call.getString("devicePath", "/dev/ttyUSB0"));
        int address = call.getInt("address", 1);
        int functionCode = call.getInt("functionCode", 3);
        int startRegister = call.getInt("startRegister", 0);
        int registerCount = call.getInt("registerCount", 4);

        try {
            File devFile = new File(devicePath);
            if (!devFile.exists()) {
                call.reject("Archivo de dispositivo no existe: " + devicePath);
                return;
            }

            byte[] pdu = new byte[6];
            pdu[0] = (byte) (address & 0xff);
            pdu[1] = (byte) (functionCode & 0xff);
            pdu[2] = (byte) ((startRegister >> 8) & 0xff);
            pdu[3] = (byte) (startRegister & 0xff);
            pdu[4] = (byte) ((registerCount >> 8) & 0xff);
            pdu[5] = (byte) (registerCount & 0xff);

            int crc = calculateModbusCrc16(pdu, 6);
            byte[] packet = new byte[8];
            System.arraycopy(pdu, 0, packet, 0, 6);
            packet[6] = (byte) (crc & 0xff);        // CRC Low Byte
            packet[7] = (byte) ((crc >> 8) & 0xff); // CRC High Byte

            try (FileOutputStream fos = new FileOutputStream(devFile)) {
                fos.write(packet);
                fos.flush();
            }

            StringBuilder sb = new StringBuilder();
            for (byte b : packet) sb.append(String.format("%02X ", b));

            JSObject ret = new JSObject();
            ret.put("status", "sent");
            ret.put("hexSent", sb.toString().trim());
            ret.put("devicePath", devicePath);
            ret.put("address", address);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error enviando trama Modbus a " + devicePath, e);
            call.reject("Error Modbus: " + e.getMessage());
        }
    }

    @PluginMethod
    public void sendRawBytes(PluginCall call) {
        String devicePath = resolverDevicePath(call.getString("devicePath", "/dev/ttyUSB0"));
        String hexString = call.getString("hexData", "0103000000044409");

        try {
            File devFile = new File(devicePath);
            if (!devFile.exists()) {
                call.reject("Archivo de dispositivo no existe: " + devicePath);
                return;
            }

            byte[] bytes = hexStringToByteArray(hexString);
            try (FileOutputStream fos = new FileOutputStream(devFile)) {
                fos.write(bytes);
                fos.flush();
            }

            JSObject ret = new JSObject();
            ret.put("status", "sent");
            ret.put("bytesSent", bytes.length);
            ret.put("devicePath", devicePath);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error enviando raw a " + devicePath, e);
            call.reject("Error enviando bytes: " + e.getMessage());
        }
    }

    private byte[] hexStringToByteArray(String s) {
        s = s.replaceAll("\\s+", "");
        int len = s.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(s.charAt(i), 16) << 4)
                                 + Character.digit(s.charAt(i+1), 16));
        }
        return data;
    }

    @PluginMethod
    public void solicitarPermisosUbicacion(PluginCall call) {
        if (getPermissionState(UBICACION) != PermissionState.GRANTED) {
            requestPermissionForAlias(UBICACION, call, "trasPedirUbicacion");
        } else {
            JSObject ret = new JSObject();
            ret.put("concedido", true);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void startGpsListener(PluginCall call) {
        /* Se pide el permiso dinámico para el GPS interno de Android (LocationManager),
           pero NUNCA bloqueamos la lectura del puerto serie /dev/ttyHSL2 (RTK externo). */
        if (getPermissionState(UBICACION) != PermissionState.GRANTED) {
            try {
                requestPermissionForAlias(UBICACION, call, "trasPedirUbicacion");
            } catch (Exception e) {
                Log.w(TAG, "No se pudo solicitar permiso de ubicacion: " + e.getMessage());
            }
        }
        arrancarGps(call);
    }

    @PermissionCallback
    private void trasPedirUbicacion(PluginCall call) {
        if (getPermissionState(UBICACION) == PermissionState.GRANTED) {
            activarLocationManager();
        } else {
            Log.w(TAG, "Sin permiso de ubicacion: el GPS interno no fijara posicion, usando solo RTK serie.");
        }
        if (call != null) {
            try {
                JSObject ret = new JSObject();
                ret.put("status", "started");
                ret.put("concedido", getPermissionState(UBICACION) == PermissionState.GRANTED);
                call.resolve(ret);
            } catch (Exception e) {
                /* Call may have already resolved in arrancarGps */
            }
        }
    }

    private void activarLocationManager() {
        if (locationManager != null) return;
        try {
            getActivity().runOnUiThread(() -> {
                try {
                    locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
                    if (locationManager == null) return;

                    LocationListener listener = new LocationListener() {
                        @Override
                        public void onLocationChanged(Location location) {
                            if (location == null) return;
                            JSObject data = new JSObject();
                            data.put("latitude", location.getLatitude());
                            data.put("longitude", location.getLongitude());
                            data.put("speed", location.getSpeed() * 3.6);
                            if (location.hasBearing()) data.put("bearing", location.getBearing());
                            if (location.hasAccuracy()) data.put("accuracy", location.getAccuracy());
                            data.put("altitude", location.getAltitude());
                            data.put("timestamp", System.currentTimeMillis());
                            notifyListeners("onGpsLocationFix", data);
                        }
                        @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
                        @Override public void onProviderEnabled(String provider) {}
                        @Override public void onProviderDisabled(String provider) {}
                    };

                    String[] providers = new String[] {
                        LocationManager.GPS_PROVIDER,
                        LocationManager.NETWORK_PROVIDER,
                        LocationManager.PASSIVE_PROVIDER
                    };

                    for (String provider : providers) {
                        try {
                            if (locationManager.isProviderEnabled(provider)) {
                                locationManager.requestLocationUpdates(provider, 1000, 0, listener);
                                Location last = locationManager.getLastKnownLocation(provider);
                                if (last != null) {
                                    listener.onLocationChanged(last);
                                }
                            }
                        } catch (SecurityException se) {
                            Log.w(TAG, "Sin permiso de ubicacion para " + provider + ": " + se.getMessage());
                        } catch (Exception e) {
                            Log.w(TAG, "No se pudo registrar " + provider + ": " + e.getMessage());
                        }
                    }
                    Log.i(TAG, "LocationManager activado con exito (GPS, Network, Passive).");
                } catch (Exception e) {
                    Log.e(TAG, "Error activando LocationManager: " + e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error invocando UI Thread para LocationManager", e);
        }
    }

    private void enviarDespertadorRtk(String devicePath) {
        try {
            File dev = new File(devicePath);
            if (!dev.exists()) return;
            try (FileOutputStream fos = new FileOutputStream(dev)) {
                // Secuencia oficial de inicio AT-RTK para despertar flujo NMEA (UM982 / F9P)
                byte[] wakeup = new byte[] {
                    0x55, (byte) 0xFA, (byte) 0xDD, 0x02, 0x01, 0x01, 0x02, (byte) 0xC3, 0x3C
                };
                fos.write(wakeup);
                fos.flush();
                fos.write("CONFIG COM1 921600\r\n".getBytes());
                fos.write("GPGGA COM1 1\r\n".getBytes());
                fos.write("GPRMC COM1 1\r\n".getBytes());
                fos.write("GPGSV COM1 1\r\n".getBytes());
                fos.write("SAVECONFIG\r\n".getBytes());
                fos.flush();
                Log.i(TAG, "Enviado paquete despertador NMEA a " + devicePath);
            }
        } catch (Exception e) {
            Log.w(TAG, "No se pudo enviar despertador RTK a " + devicePath + ": " + e.getMessage());
        }
    }

    private void arrancarGps(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL2");
        int baudrate = call.getInt("baudrate", 921600);

        activarLocationManager();

        if (!isGpsListening.get()) {
            isGpsListening.set(true);
            configureStty(devicePath, baudrate);
            enviarDespertadorRtk(devicePath);
            gpsThread = new Thread(() -> readTextStream(devicePath, "onGpsData", isGpsListening));
            gpsThread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("devicePath", devicePath);
        ret.put("baudrate", baudrate);
        try {
            call.resolve(ret);
        } catch (Exception e) {
            /* Ignores if already resolved */
        }
    }

    /**
     * Manda unas tramas y cuenta las que vuelven.
     *
     * **No es una prueba en bucle**, aunque se llamaba asi y durante un tiempo
     * se dio por buena. El cuarto parametro de `initialize` no es un modo bucle
     * sino `Test_Mode`, que solo vigila la secuencia de identificadores de lo
     * que entra; el manual del fabricante lo dice y esta libreria no ofrece
     * ningun bucle interno.
     *
     * Asi que un cero aqui **no prueba que el equipo este averiado**: prueba
     * que en el bus no hay nadie contestando, que es exactamente lo que pasa
     * con el caudalimetro desconectado. Para juzgar el equipo por dentro sirve
     * `diagnosticoCan`, que le pregunta al micro directamente.
     */
    /**
     * Le pregunta al micro del bus si esta vivo.
     *
     * `initialize` devuelve 0 aunque al otro lado no conteste nadie, asi que un
     * bus mudo y un micro muerto se ven igual. `getVersion` no: si vuelve con
     * una cadena, el micro esta ahi y habla, y lo que falle esta en el cable
     * del bus. Si no vuelve nada, el problema esta antes del conector y no hay
     * cableado que arreglar.
     *
     * Se prueban tambien las velocidades del enlace serie con `trySerialBaudrate`,
     * que **comprueba** en vez de imponer. Las que acepta el fabricante estan en
     * su manual; se recorren todas porque ir a ciegas fue justo lo que nos tuvo
     * dando vueltas.
     */
    @PluginMethod
    public void diagnosticoCan(PluginCall call) {
        JSObject ret = new JSObject();

        for (int iface = 0; iface <= 1; iface++) {
            CanBusHelper h = (iface == 0) ? canBusHelper0 : canBusHelper1;
            JSObject uno = new JSObject();

            try {
                String v = h.getVersion(iface);
                uno.put("version", v == null ? "" : v);
                uno.put("microVivo", v != null && !v.trim().isEmpty());
            } catch (Throwable e) {
                uno.put("version", "");
                uno.put("microVivo", false);
                uno.put("fallo", e.getClass().getSimpleName() + ": " + e.getMessage());
            }

            try {
                uno.put("rtc", h.getMcuRtcValue(iface));
            } catch (Throwable e) {
                uno.put("rtc", -1);
            }

            JSArray acepta = new JSArray();
            for (int b : new int[] { 4800, 9600, 19200, 38400, 57600, 100000,
                                     115200, 230400, 460800, 921600 }) {
                try {
                    if (h.trySerialBaudrate(iface, b, 8, 0, 1) == 0) acepta.put(b);
                } catch (Throwable e) {
                    /* Si el simbolo no esta, no hay nada que recorrer. */
                    break;
                }
            }
            uno.put("velocidadesQueAcepta", acepta);

            ret.put("can" + (iface + 1), uno);
        }

        call.resolve(ret);
    }

    @PluginMethod
    public void probarBucle(PluginCall call) {
        final int iface = call.getInt("interfaz", 0);
        final int bus = call.getInt("bitrate", 250000);
        final CanBusHelper h = (iface == 0) ? canBusHelper0 : canBusHelper1;
        final java.util.concurrent.atomic.AtomicInteger recibidas =
                new java.util.concurrent.atomic.AtomicInteger(0);

        new Thread(() -> {
            try {
                h.uninitialize(iface);
            } catch (Exception e) {
                /* Puede no estar abierto; da igual. */
            }

            int rb = h.setSerialBaudrate(iface, 115200, 8, 0, 1);
            int ri = h.initialize(iface, 115200, bus, true);
            Log.i(TAG, "BUCLE setSerialBaudrate=" + rb + " initialize=" + ri);

            if (ri != 0) {
                JSObject r = new JSObject();
                r.put("ok", false);
                r.put("detalle", "initialize devolvio " + ri);
                call.resolve(r);
                return;
            }

            new Thread(() -> h.readCan(iface, new CanBusCallback() {
                public void onSetError() { Log.w(TAG, "BUCLE onSetError"); }
                public void onSendError() { Log.w(TAG, "BUCLE onSendError"); }
                public void onIdError(int c) { Log.w(TAG, "BUCLE onIdError " + c); }
                public void onReceiveCanbusData(int FF, int RTR, int DLC, int ID, int[] DATA) {
                    recibidas.incrementAndGet();
                    Log.i(TAG, "BUCLE recibida ID=" + Integer.toHexString(ID) + " DLC=" + DLC);
                }
            })).start();

            try { Thread.sleep(1200); } catch (InterruptedException e) { /* nada */ }

            int enviadas = 0;
            for (int i = 0; i < 5; i++) {
                int rs = h.sendFrame(iface, 1, 0, 8, 0x18FEE000 + i,
                        new int[] { 1, 2, 3, 4, 5, 6, 7, i });
                Log.i(TAG, "BUCLE sendFrame = " + rs);
                if (rs >= 0) enviadas++;
                try { Thread.sleep(400); } catch (InterruptedException e) { /* nada */ }
            }

            try { Thread.sleep(2000); } catch (InterruptedException e) { /* nada */ }

            JSObject r = new JSObject();
            r.put("ok", recibidas.get() > 0);
            r.put("enviadas", enviadas);
            r.put("recibidas", recibidas.get());
            call.resolve(r);
        }).start();
    }

    @PluginMethod
    public void startCan1Listener(PluginCall call) {
        int serialBaudrate = call.getInt("serialBaudrate", 115200);
        int canBaudrate = call.getInt("baudrate", 250000);
        if (!isCan1Listening.get()) {
            isCan1Listening.set(true);
            can1Thread = new Thread(() -> startCanBusListening(0, canBusHelper0, "onCan1Data", isCan1Listening, serialBaudrate, canBaudrate));
            can1Thread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("interface", 0);
        ret.put("canBaudrate", canBaudrate);
        call.resolve(ret);
    }

    @PluginMethod
    public void startCan2Listener(PluginCall call) {
        int serialBaudrate = call.getInt("serialBaudrate", 115200);
        int canBaudrate = call.getInt("baudrate", 250000);
        if (!isCan2Listening.get()) {
            isCan2Listening.set(true);
            can2Thread = new Thread(() -> startCanBusListening(1, canBusHelper1, "onCan2Data", isCan2Listening, serialBaudrate, canBaudrate));
            can2Thread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("interface", 1);
        ret.put("canBaudrate", canBaudrate);
        call.resolve(ret);
    }

    private void startCanBusListening(int canInterface, CanBusHelper helper, String eventName, AtomicBoolean activeFlag, int serialBaudrate, int canBaudrate) {
        Log.i(TAG, "Iniciando CANBusHelper en Interfaz CAN" + (canInterface + 1) + " para " + eventName);
        
        /* Se anota lo que devuelven aunque salga bien. Cuando el bus esta mudo,
           saber si abrio o no es la diferencia entre buscar en el codigo o
           buscar en el cable, y sin esto no se distinguen. */
        int retBaud = helper.setSerialBaudrate(canInterface, serialBaudrate, 8, 0, 1);
        Log.i(TAG, "CAN" + (canInterface + 1) + " setSerialBaudrate(" + serialBaudrate + ") = " + retBaud);
        if (retBaud < 0) {
            Log.e(TAG, "setSerialBaudrate fallo en CAN" + (canInterface + 1) + ": " + retBaud);
        }
        
        int retInit = helper.initialize(canInterface, serialBaudrate, canBaudrate, false);
        Log.i(TAG, "CAN" + (canInterface + 1) + " initialize(serie=" + serialBaudrate
                + ", bus=" + canBaudrate + ") = " + retInit);
        if (retInit != 0) {
            /* Si esto falla el hilo muere y no se lee nada. Antes solo quedaba en
               el log del sistema y en la aplicacion no se notaba: la consola se
               quedaba vacia sin decir por que. */
            Log.e(TAG, "initialize fallo en CAN" + (canInterface + 1) + ": " + retInit);
            notificarProblema(eventName, "CAN" + (canInterface + 1),
                "No se pudo abrir el bus (codigo " + retInit + "). Revisa el cable y el bitrate.");
            activeFlag.set(false);
            return;
        }

        Log.i(TAG, "CAN" + (canInterface + 1) + " abierto; esperando tramas");

        helper.readCan(canInterface, new CanBusCallback() {
            @Override
            public void onSetError() {
                Log.w(TAG, "CAN" + (canInterface + 1) + " onSetError");
                notificarProblema(eventName, "CAN" + (canInterface + 1), "Error al configurar el bus");
            }

            @Override
            public void onSendError() {
                Log.w(TAG, "CAN" + (canInterface + 1) + " onSendError");
                notificarProblema(eventName, "CAN" + (canInterface + 1), "Error al transmitir");
            }

            @Override
            public void onIdError(int count) {
                Log.w(TAG, "CAN" + (canInterface + 1) + " onIdError count: " + count);
            }

            @Override
            public void onReceiveCanbusData(int FF, int RTR, int DLC, int ID, int[] DATA) {
                if (!activeFlag.get()) return;

                StringBuilder hexSb = new StringBuilder();
                StringBuilder asciiSb = new StringBuilder();
                if (DATA != null) {
                    for (int i = 0; i < DLC && i < DATA.length; i++) {
                        int b = DATA[i] & 0xff;
                        hexSb.append(String.format("%02X ", b));
                        if (b >= 32 && b <= 126) {
                            asciiSb.append((char) b);
                        } else {
                            asciiSb.append('.');
                        }
                    }
                }

                JSObject data = new JSObject();
                data.put("id", String.format("0x%X", ID));
                data.put("rawId", ID);
                data.put("dlc", DLC);
                data.put("ff", FF);
                data.put("rtr", RTR);
                data.put("raw", hexSb.toString().trim());
                data.put("ascii", asciiSb.toString());
                data.put("timestamp", System.currentTimeMillis());
                data.put("port", "CAN" + (canInterface + 1));

                notifyListeners(eventName, data);
            }
        });
    }

    @PluginMethod
    public void sendCanFrame(PluginCall call) {
        int canInterface = call.getInt("interface", 0);
        int id = call.getInt("id", 0x123);
        int ff = call.getInt("ff", 0);
        int rtr = call.getInt("rtr", 0);
        String hexData = call.getString("hexData", "");

        byte[] bytes = hexStringToByteArray(hexData);
        int dlc = bytes.length;
        int[] dataInts = new int[dlc];
        for (int i = 0; i < dlc; i++) {
            dataInts[i] = bytes[i] & 0xff;
        }

        CanBusHelper helper = (canInterface == 0) ? canBusHelper0 : canBusHelper1;
        int res = helper.sendFrame(canInterface, ff, rtr, dlc, id, dataInts);
        if (res > 0) {
            JSObject ret = new JSObject();
            ret.put("status", "sent");
            ret.put("bytesSent", res);
            call.resolve(ret);
        } else {
            call.reject("Error enviando trama CAN: " + res);
        }
    }

    /* ── Escucha por red, en un solo sentido ──────────────────────────────────
     *
     * Este equipo **recibe** por su boca de red y **no transmite**: medido, 20
     * de 20 tramas entrando y 0 de 20 saliendo. Con eso no se puede hablar por
     * TCP —que necesita respuesta en cada paso— ni resolver un ARP, ni dar el
     * ACK que exige el CAN. Pero para escuchar sobra.
     *
     * Asi que quien tiene los datos los empuja en UDP y aqui solo se recogen.
     * Sin conexion que establecer, sin nada que contestar. Las tramas entran
     * por el mismo sitio que las del cable serie, con el mismo formato, para
     * que el resto no se entere de por donde llegaron.
     */
    private DatagramSocket udpSocket;
    private Thread udpThread;
    private final AtomicBoolean udpEscuchando = new AtomicBoolean(false);

    @PluginMethod
    public void startRedListener(PluginCall call) {
        final int puerto = call.getInt("puerto", 9977);

        if (udpEscuchando.get()) {
            JSObject ya = new JSObject();
            ya.put("status", "already_running");
            ya.put("puerto", puerto);
            call.resolve(ya);
            return;
        }

        try {
            udpSocket = new DatagramSocket(null);
            udpSocket.setReuseAddress(true);
            /* Se acepta lo que venga a cualquiera de las direcciones del equipo,
               incluida la difusion: quien empuja no tiene por que saber cual es
               la nuestra, y de hecho no puede averiguarla sin que contestemos. */
            udpSocket.setBroadcast(true);
            udpSocket.bind(new java.net.InetSocketAddress(puerto));
        } catch (Exception e) {
            call.reject("No se pudo abrir el puerto " + puerto + ": " + e.getMessage());
            return;
        }

        udpEscuchando.set(true);
        udpThread = new Thread(() -> {
            byte[] buffer = new byte[4096];
            while (udpEscuchando.get()) {
                try {
                    DatagramPacket p = new DatagramPacket(buffer, buffer.length);
                    udpSocket.receive(p);

                    StringBuilder hex = new StringBuilder();
                    for (int i = 0; i < p.getLength(); i++) {
                        hex.append(String.format("%02X", buffer[i]));
                        if (i < p.getLength() - 1) hex.append(" ");
                    }

                    JSObject data = new JSObject();
                    data.put("raw", hex.toString());
                    data.put("bytes", p.getLength());
                    data.put("timestamp", System.currentTimeMillis());
                    data.put("port", "udp:" + puerto);
                    data.put("de", p.getAddress() == null ? "" : p.getAddress().getHostAddress());
                    notifyListeners("onRedData", data);
                } catch (Exception e) {
                    if (udpEscuchando.get()) {
                        Log.w(TAG, "Fallo escuchando en el puerto " + puerto + ": " + e.getMessage());
                    }
                }
            }
        });
        udpThread.start();

        Log.i(TAG, "Escuchando datos por red en el puerto UDP " + puerto);
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("puerto", puerto);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopRedListener(PluginCall call) {
        udpEscuchando.set(false);
        if (udpSocket != null) {
            udpSocket.close();
            udpSocket = null;
        }
        JSObject ret = new JSObject();
        ret.put("status", "stopped");
        call.resolve(ret);
    }

    @PluginMethod
    public void startRs485Listener(PluginCall call) {
        String devicePath = resolverDevicePath(call.getString("devicePath", "/dev/ttyHSL0"));
        int baudrate = call.getInt("baudrate", 9600);
        enableRs485HardwarePower(true);
        if (!isRs485Listening.get()) {
            isRs485Listening.set(true);
            configureStty(devicePath, baudrate);
            rs485Thread = new Thread(() -> readRawStream(devicePath, "onRs485Data", isRs485Listening));
            rs485Thread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("devicePath", devicePath);
        ret.put("rs485Power", "gpio40_HIGH");
        call.resolve(ret);
    }

    private void enableRs485HardwarePower(boolean enable) {
        try {
            String dirCmd = "echo out > /sys/class/gpio/gpio40/direction";
            String valCmd = "echo " + (enable ? "1" : "0") + " > /sys/class/gpio/gpio40/value";
            Runtime.getRuntime().exec(new String[]{"sh", "-c", dirCmd}).waitFor();
            Runtime.getRuntime().exec(new String[]{"sh", "-c", valCmd}).waitFor();
            Log.i(TAG, "Alimentacion Hardware RS485 (gpio40) -> " + (enable ? "ACTIVADA (1)" : "DESACTIVADA (0)"));
        } catch (Exception e) {
            Log.w(TAG, "No se pudo cambiar estado gpio40 para RS485: " + e.getMessage());
        }
    }

    private void configureStty(String devicePath, int baudrate) {
        try {
            Process p = Runtime.getRuntime().exec(new String[] {
                "stty", "-F", devicePath, String.valueOf(baudrate), "raw", "-echo"
            });
            p.waitFor();
            Log.i(TAG, "Configurado " + devicePath + " a " + baudrate + " baudios via stty");
        } catch (Exception e) {
            Log.w(TAG, "No se pudo ejecutar stty en " + devicePath + ": " + e.getMessage());
        }
    }

    /**
     * Lectura del puerto serie: **solo transporta bytes**.
     *
     * Antes aqui se reconocian protocolos a mano, con las direcciones metidas a
     * fuego: se buscaba literalmente una cabecera 0x3E para Eurosens y la
     * secuencia 01 03 08 para Modbus. Con eso, un equipo con otra direccion de
     * esclavo o con otro numero de registros no se reconocia, y para soportar un
     * aparato nuevo habia que recompilar el APK.
     *
     * Ahora Java no interpreta nada. Quien decide que significan los bytes es el
     * catalogo de protocolos del lado TypeScript, que el usuario puede ajustar
     * desde la propia aplicacion.
     *
     * Tampoco se trocea aqui: un puerto serie entrega bytes, no mensajes, y una
     * trama puede llegar partida en dos lecturas o pegada a la siguiente. El
     * troceado necesita saber de que protocolo se trata, asi que va arriba.
     */
    private void readRawStream(String devicePath, String eventName, AtomicBoolean activeFlag) {
        Log.i(TAG, "Leyendo " + devicePath + " para " + eventName);
        File devFile = new File(devicePath);

        if (!devFile.exists()) {
            notificarProblema(eventName, devicePath, "El dispositivo no existe: " + devicePath);
            activeFlag.set(false);
            return;
        }

        byte[] buffer = new byte[1024];
        try (FileInputStream fis = new FileInputStream(devFile)) {
            while (activeFlag.get()) {
                int leidos = fis.read(buffer);

                /* -1 es fin de flujo: el puerto se cerro o se desenchufo el
                   adaptador. Sin esto el bucle giraba en vacio quemando CPU. */
                if (leidos < 0) {
                    notificarProblema(eventName, devicePath, "El puerto se cerro");
                    break;
                }
                if (leidos == 0) continue;

                StringBuilder hexSb = new StringBuilder(leidos * 3);
                for (int i = 0; i < leidos; i++) {
                    hexSb.append(String.format("%02X", buffer[i]));
                    if (i < leidos - 1) hexSb.append(" ");
                }

                JSObject data = new JSObject();
                data.put("raw", hexSb.toString());
                data.put("bytes", leidos);
                data.put("timestamp", System.currentTimeMillis());
                data.put("port", devicePath);
                notifyListeners(eventName, data);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error leyendo " + devicePath, e);
            notificarProblema(eventName, devicePath, e.getMessage());
        } finally {
            activeFlag.set(false);
        }
    }

    /** Un fallo del puerto tiene que llegar a la pantalla, no quedarse en el log. */
    /**
     * Los puertos serie del equipo, con su papel, resueltos en caliente.
     *
     * El numero de `ttyUSB` **no es fijo**: depende del orden en que el kernel
     * enumere los dos conversores del latiguillo, y puede cambiar de un arranque
     * a otro. Por eso el SDK del fabricante no escribe el nombre a fuego, sino
     * que busca el nodo por su posicion en el bus USB:
     *
     * Lista los puertos serie visibles en la tablet, tanto los del
     * procesador como los que aparecen por USB.
     *
     * Ademas comprueba si el archivo en `/dev` existe de verdad, para que
     * la pantalla de configuracion pueda marcar en gris los que estan
     * desconectados en vez de dejar que el usuario los elija y luego falle.
     */
    @PluginMethod
    public void listarPuertos(PluginCall call) {
        JSArray lista = new JSArray();

        /*
         * En Android los adaptadores USB-serie se cuelgan de /sys/class/tty/ttyUSB*
         * y enlazan al arbol de dispositivos USB.
         */
        File claseTty = new File("/sys/class/tty");
        File[] enlaces =
                claseTty.listFiles(
                        (dir, nombre) -> nombre.startsWith("ttyUSB"));

        boolean vioTtyUsb0 = false;
        if (enlaces != null) {
            java.util.Arrays.sort(enlaces);
            for (File enlace : enlaces) {
                String ruta = "/dev/" + enlace.getName();
                if (enlace.getName().equals("ttyUSB0")) vioTtyUsb0 = true;
                String destino;
                try {
                    destino = enlace.getCanonicalPath();
                } catch (Exception e) {
                    destino = "";
                }

                String papel;
                if (destino.contains("1-1.2")) papel = "RS485";
                else if (destino.contains("1-1.3")) papel = "COM2 (RS232)";
                else papel = "USB serie";

                lista.put(puerto(ruta, papel, ramaDe(destino), new File(ruta).exists()));
            }
        }

        if (!vioTtyUsb0) {
            lista.put(puerto("/dev/ttyUSB0", "RS485 (Bornera P4)", "USB interno (1-1.2)", new File("/dev/ttyUSB0").exists()));
        }

        /* Los del procesador, que si son fijos. */
        lista.put(puerto("/dev/ttyHSL0", "COM1 (RS232)", "SoC", new File("/dev/ttyHSL0").exists()));
        lista.put(puerto("/dev/ttyHSL1", "Reservado", "SoC", new File("/dev/ttyHSL1").exists()));
        lista.put(puerto("/dev/ttyHSL2", "GPS", "SoC", new File("/dev/ttyHSL2").exists()));
        lista.put(puerto("/dev/ttyHSL3", "Reservado", "SoC", new File("/dev/ttyHSL3").exists()));

        JSObject ret = new JSObject();
        ret.put("puertos", lista);
        call.resolve(ret);
    }

    private JSObject puerto(String ruta, String papel, String rama, boolean existe) {
        JSObject o = new JSObject();
        o.put("ruta", ruta);
        o.put("papel", papel);
        o.put("rama", rama);
        o.put("existe", existe);
        return o;
    }

    /** La rama del bus, para poder enseñar de donde sale cada puerto. */
    private String ramaDe(String destino) {
        java.util.regex.Matcher m =
                java.util.regex.Pattern.compile("(1-1\\.[0-9]+)").matcher(destino);
        return m.find() ? m.group(1) : "";
    }

    /**
     * Busca en que puerto y a que velocidad esta hablando un aparato.
     *
     * Es lo que hacia la version anterior de la aplicacion y se habia perdido:
     * cuando no se sabe donde esta conectado algo, ir probando a mano es una
     * tarde entera.
     *
     * ─── Que se cuenta como «encontrado» ─────────────────────────────────────
     *
     * Contar bytes no vale. A la velocidad equivocada tambien llegan bytes: son
     * la misma senal mal muestreada, basura que parece datos. La primera version
     * de esto daba por bueno el GPS a 115200 cuando en realidad va a 921600.
     *
     * Asi que se comprueba que lo leido **cuadra**, y para eso estan las sumas
     * de verificacion, que solo salen bien si los bits se leyeron a la velocidad
     * correcta:
     *
     *   NMEA    $GNGGA,...*4A   XOR de todo lo que hay entre $ y *
     *   UBX     B5 62 ...       Fletcher-8 sobre clase, id, longitud y datos
     *   Modbus  ... CRC16       polinomio 0xA001, byte bajo primero
     *
     * Y se prueban **todas** las velocidades de cada puerto, no solo hasta la
     * primera que da senales de vida: la buena es la que mas tramas validas saca,
     * no la primera que hace ruido.
     */
    @PluginMethod
    public void scanPorts(PluginCall call) {
        final int msPorPrueba = Math.max(200, call.getInt("dwellMs", 700));

        final List<String> puertos = new ArrayList<>();
        final List<Integer> baudios = new ArrayList<>();

        try {
            JSArray pedidos = call.getArray("ports");
            if (pedidos != null) for (Object o : pedidos.toList()) puertos.add(String.valueOf(o));

            JSArray velocidades = call.getArray("baudrates");
            if (velocidades != null) {
                for (Object o : velocidades.toList()) baudios.add((int) Double.parseDouble(String.valueOf(o)));
            }
        } catch (Exception e) {
            /* Con una lista mal formada se sigue con la de por defecto. */
        }

        if (puertos.isEmpty()) {
            /* Segun el SDK del fabricante: ttyHSL0 es COM1 (RS232), ttyHSL2 es
               el GPS, y el RS485 y el COM2 son dispositivos USB —ttyUSB0 y
               ttyUSB1 en este equipo—. El RS485 va primero porque es el que
               se busca casi siempre. */
            puertos.add("/dev/ttyUSB0");
            puertos.add("/dev/ttyUSB1");
            puertos.add("/dev/ttyHSL0");
            puertos.add("/dev/ttyHSL1");
            puertos.add("/dev/ttyHSL2");
            puertos.add("/dev/ttyHSL3");
        }
        if (baudios.isEmpty()) {
            for (int b : new int[] { 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600 }) {
                baudios.add(b);
            }
        }

        /* Los hilos activos, fuera. Luego se vuelven a levantar desde arriba. */
        isRs485Listening.set(false);
        isGpsListening.set(false);

        new Thread(() -> {
            JSArray hallazgos = new JSArray();

            for (String puerto : puertos) {
                File dev = new File(puerto);
                if (!dev.exists()) continue;

                int mejorBaud = 0, mejorPuntos = 0, mejorBytes = 0;
                String mejorTipo = null, mejorMuestra = null;

                for (int baud : baudios) {
                    JSObject aviso = new JSObject();
                    aviso.put("port", puerto);
                    aviso.put("baudrate", baud);
                    notifyListeners("onScanProgress", aviso);

                    byte[] leido = escucharUnRato(dev, baud, msPorPrueba);
                    if (leido == null || leido.length == 0) continue;

                    Valoracion v = valorar(leido);
                    if (v.puntos > mejorPuntos) {
                        mejorPuntos = v.puntos;
                        mejorBaud = baud;
                        mejorTipo = v.tipo;
                        mejorBytes = leido.length;
                        mejorMuestra = v.muestra;
                    }
                }

                /* Sin ninguna trama que cuadre no se propone nada: es preferible
                   decir que no se encontro a mandar al usuario a configurar una
                   velocidad inventada. */
                if (mejorPuntos <= 0) continue;

                JSObject h = new JSObject();
                h.put("port", puerto);
                h.put("baudrate", mejorBaud);
                h.put("bytes", mejorBytes);
                h.put("kind", mejorTipo);
                h.put("score", mejorPuntos);
                h.put("sample", mejorMuestra);
                hallazgos.put(h);
                Log.i(TAG, "[SCAN] " + puerto + " a " + mejorBaud + ": " + mejorTipo
                        + " (" + mejorPuntos + " tramas validas)");
            }

            JSObject ret = new JSObject();
            ret.put("found", hallazgos);
            ret.put("scannedPorts", puertos.size());
            call.resolve(ret);
        }).start();
    }

   /**
         * Cuantas tramas tienen que cuadrar para dar la velocidad por buena.
         *
         * Con una sola no basta: una suma de verificacion puede salir bien por
         * azar. Dos ya es practicamente imposible, y a la velocidad correcta en
         * tres cuartos de segundo llegan muchas mas.
         */
        private static final int MINIMO_TRAMAS = 2;
    
        /** Lo que se saco de una escucha: que parecia ser y como de seguro. */
    private static class Valoracion {
        int puntos = 0;
        String tipo = null;
        String muestra = null;
    }

    /**
     * Decide si lo leido es de verdad, y de que.
     *
     * La puntuacion es el numero de tramas cuya suma de verificacion cuadra. A
     * la velocidad equivocada eso da cero casi siempre: que un XOR o un CRC
     * salgan bien por casualidad sobre datos mal muestreados es muy improbable,
     * y que salgan bien varias veces, practicamente imposible.
     */
    private Valoracion valorar(byte[] d) {
        Valoracion v = new Valoracion();

        int nmea = contarNmea(d);
        if (nmea >= MINIMO_TRAMAS) {
            v.puntos = nmea;
            v.tipo = "nmea";
            v.muestra = primeraLinea(d);
            return v;
        }

        int ubx = contarUbx(d);
        if (ubx >= MINIMO_TRAMAS) {
            v.puntos = ubx;
            v.tipo = "ubx";
            v.muestra = enHex(d, 16);
            return v;
        }

        int modbus = contarModbus(d);
        if (modbus >= MINIMO_TRAMAS) {
            v.puntos = modbus;
            v.tipo = "modbus";
            v.muestra = enHex(d, 16);
            return v;
        }

        /* Sin sumas que comprobar, queda mirar si al menos parece texto. Un
           protocolo de texto legible a la velocidad correcta da casi todo
           imprimible; mal muestreado, no. */
        int imprimibles = 0;
        for (byte b : d) {
            int x = b & 0xff;
            if ((x >= 32 && x <= 126) || x == 10 || x == 13) imprimibles++;
        }
        if (d.length >= 20 && imprimibles * 100 / d.length >= 90) {
            v.puntos = 1;
            v.tipo = "texto";
            v.muestra = primeraLinea(d);
        }
        return v;
    }

    /** Sentencias NMEA con su XOR correcto entre `$` y `*`. */
    private int contarNmea(byte[] d) {
        int validas = 0;
        for (int i = 0; i < d.length; i++) {
            if (d[i] != '$') continue;

            int xor = 0, j = i + 1;
            while (j < d.length && d[j] != '*' && d[j] != '\n' && j - i < 90) {
                xor ^= (d[j] & 0xff);
                j++;
            }
            if (j + 2 >= d.length || d[j] != '*') continue;

            int esperado = valorHex(d[j + 1]) * 16 + valorHex(d[j + 2]);
            if (esperado >= 0 && esperado == xor) validas++;
        }
        return validas;
    }

    /** Mensajes UBX con su Fletcher-8 correcto. */
    private int contarUbx(byte[] d) {
        int validas = 0;
        for (int i = 0; i + 8 <= d.length; i++) {
            if ((d[i] & 0xff) != 0xb5 || (d[i + 1] & 0xff) != 0x62) continue;

            int largo = (d[i + 4] & 0xff) | ((d[i + 5] & 0xff) << 8);
            int fin = i + 6 + largo;
            if (largo < 0 || largo > 1024 || fin + 1 >= d.length) continue;

            int a = 0, b = 0;
            for (int k = i + 2; k < fin; k++) {
                a = (a + (d[k] & 0xff)) & 0xff;
                b = (b + a) & 0xff;
            }
            if (a == (d[fin] & 0xff) && b == (d[fin + 1] & 0xff)) validas++;
        }
        return validas;
    }

    /**
     * Tramas Modbus RTU: cabecera con sentido **y** CRC correcto.
     *
     * Con solo el CRC no basta. Son 16 bits, o sea un acierto por azar cada
     * 65.000 intentos, y probar todas las longitudes en todas las posiciones son
     * decenas de miles de intentos: sobre ruido salen dos o tres «tramas
     * validas» que no lo son. Se comprobo con la senal real del GPS leida a
     * 460800 —que es basura— y daba dos.
     *
     * Asi que solo se prueban las formas que Modbus admite de verdad, con su
     * largo exacto, y ademas el esclavo tiene que estar en rango y la funcion
     * ser una de las que existen. Eso deja el azar en algo por millon.
     */
    private int contarModbus(byte[] d) {
        int validas = 0;
        for (int i = 0; i + 5 <= d.length; i++) {
            int sa = d[i] & 0xff;
            int fn = d[i + 1] & 0xff;
            if (sa < 1 || sa > 247) continue;

            int largo = largoModbus(d, i, fn);
            if (largo < 5 || i + largo > d.length) continue;
            if (!crcCuadra(d, i, largo)) continue;

            validas++;
            i += largo - 1;
        }
        return validas;
    }

    /** El largo que tendria la trama que empieza en `i`, o 0 si la funcion no existe. */
    private int largoModbus(byte[] d, int i, int fn) {
        /* Excepcion: esclavo, funcion con el bit alto puesto, codigo, CRC. */
        if ((fn & 0x80) != 0) {
            int base = fn & 0x7f;
            return (base >= 1 && base <= 16) ? 5 : 0;
        }

        switch (fn) {
            case 1:
            case 2:
            case 3:
            case 4: {
                /* Respuesta de lectura: el tercer byte dice cuantos datos vienen.
                   Una peticion de lectura son 8 bytes fijos; se aceptan las dos. */
                int n = d[i + 2] & 0xff;
                if (n > 0 && n <= 250 && i + 5 + n <= d.length && crcCuadra(d, i, 5 + n)) return 5 + n;
                return 8;
            }
            case 5:
            case 6:
                /* Escribir uno solo: peticion y respuesta son iguales, 8 bytes. */
                return 8;
            case 15:
            case 16: {
                /* Escribir varios: la peticion lleva datos, la respuesta no. */
                int m = i + 6 < d.length ? (d[i + 6] & 0xff) : 0;
                if (m > 0 && m <= 246 && i + 9 + m <= d.length && crcCuadra(d, i, 9 + m)) return 9 + m;
                return 8;
            }
            default:
                return 0;
        }
    }

    private boolean crcCuadra(byte[] d, int desde, int largo) {
        int crc = 0xffff;
        for (int k = desde; k < desde + largo - 2; k++) {
            crc ^= (d[k] & 0xff);
            for (int n = 0; n < 8; n++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xa001 : crc >> 1;
        }
        /* El CRC viaja con el byte bajo primero. */
        return crc == ((d[desde + largo - 2] & 0xff) | ((d[desde + largo - 1] & 0xff) << 8));
    }

    private int valorHex(byte b) {
        int c = b & 0xff;
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        return -1;
    }

    private String primeraLinea(byte[] d) {
        StringBuilder sb = new StringBuilder();
        for (byte b : d) {
            int x = b & 0xff;
            if (x == 10 || x == 13) {
                if (sb.length() > 5) break;
                continue;
            }
            if (x >= 32 && x <= 126) sb.append((char) x);
            if (sb.length() >= 60) break;
        }
        return sb.toString();
    }

    private String enHex(byte[] d, int cuantos) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(cuantos, d.length); i++) {
            sb.append(String.format("%02X", d[i]));
            if (i < Math.min(cuantos, d.length) - 1) sb.append(' ');
        }
        return sb.toString();
    }

    /** Escucha un puerto un momento y devuelve lo que llego, tal cual. */
    private byte[] escucharUnRato(File dev, int baudrate, int ms) {
        configureStty(dev.getAbsolutePath(), baudrate);

        java.io.ByteArrayOutputStream acumulado = new java.io.ByteArrayOutputStream();
        long hasta = System.currentTimeMillis() + ms;
        byte[] buffer = new byte[1024];

        try (FileInputStream fis = new FileInputStream(dev)) {
            while (System.currentTimeMillis() < hasta && acumulado.size() < 16384) {
                if (fis.available() <= 0) {
                    try {
                        Thread.sleep(25);
                    } catch (InterruptedException ie) {
                        break;
                    }
                    continue;
                }
                int n = fis.read(buffer);
                if (n <= 0) break;
                acumulado.write(buffer, 0, n);
            }
        } catch (Exception e) {
            Log.w(TAG, "[SCAN] no se pudo leer " + dev + ": " + e.getMessage());
            return null;
        }
        return acumulado.toByteArray();
    }




    private void notificarProblema(String eventName, String devicePath, String mensaje) {
        JSObject err = new JSObject();
        err.put("port", devicePath);
        err.put("source", eventName);
        err.put("message", mensaje == null ? "error desconocido" : mensaje);
        err.put("timestamp", System.currentTimeMillis());
        notifyListeners("onPortError", err);
    }

    private void readTextStream(String devicePath, String eventName, AtomicBoolean activeFlag) {
        Log.i(TAG, "Iniciando lectura NMEA en " + devicePath);
        File devFile = new File(devicePath);
        if (!devFile.exists()) return;

        byte[] buffer = new byte[512];
        StringBuilder sb = new StringBuilder();
        try (FileInputStream fis = new FileInputStream(devFile)) {
            while (activeFlag.get()) {
                int bytesRead = fis.read(buffer);
                if (bytesRead > 0) {
                    for (int i = 0; i < bytesRead; i++) {
                        char c = (char) buffer[i];
                        if (c == '\n' || c == '\r') {
                            if (sb.length() > 0) {
                                String line = sb.toString().trim();
                                sb.setLength(0);
                                if (!line.isEmpty()) {
                                    JSObject data = parseNmeaLine(line);
                                    data.put("port", devicePath);
                                    notifyListeners(eventName, data);
                                }
                            }
                        } else {
                            sb.append(c);
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error leyendo NMEA de " + devicePath, e);
        }
    }

    private JSObject parseNmeaLine(String line) {
        JSObject data = new JSObject();
        data.put("raw", line);
        data.put("timestamp", System.currentTimeMillis());

        if (line == null || !line.startsWith("$")) {
            return data;
        }

        try {
            String[] parts = line.split(",", -1);
            if (parts.length < 2) return data;

            String type = parts[0].toUpperCase();

            // Parse $GNGGA / $GPGGA (Global Positioning System Fix Data & RTK Status)
            if (type.endsWith("GGA") && parts.length >= 10) {
                data.put("isGga", true);
                data.put("utcTime", parts[1]);

                double lat = parseNmeaCoord(parts[2], parts[3]);
                double lon = parseNmeaCoord(parts[4], parts[5]);
                data.put("latitude", lat);
                data.put("longitude", lon);

                int quality = 0;
                try {
                    if (!parts[6].isEmpty()) quality = Integer.parseInt(parts[6]);
                } catch (Exception ignored) {}

                data.put("rtkQuality", quality);
                data.put("rtkStatus", getRtkQualityName(quality));
                data.put("isRtkFixed", quality == 4);
                data.put("isRtkFloat", quality == 5);
                data.put("hasFix", quality > 0);

                int sats = 0;
                try {
                    if (!parts[7].isEmpty()) sats = Integer.parseInt(parts[7]);
                } catch (Exception ignored) {}
                data.put("satellites", sats);

                double hdop = 99.9;
                try {
                    if (!parts[8].isEmpty()) hdop = Double.parseDouble(parts[8]);
                } catch (Exception ignored) {}
                data.put("hdop", hdop);

                double alt = 0.0;
                try {
                    if (!parts[9].isEmpty()) alt = Double.parseDouble(parts[9]);
                } catch (Exception ignored) {}
                data.put("altitude", alt);
            }
            // Parse $GNRMC / $GPRMC (Recommended Minimum Navigation Information)
            else if (type.endsWith("RMC") && parts.length >= 9) {
                data.put("isRmc", true);
                String status = parts[2];
                boolean valid = "A".equalsIgnoreCase(status);
                data.put("isValid", valid);

                if (valid && parts.length >= 9) {
                    double lat = parseNmeaCoord(parts[3], parts[4]);
                    double lon = parseNmeaCoord(parts[5], parts[6]);
                    data.put("latitude", lat);
                    data.put("longitude", lon);

                    double speedKnots = 0.0;
                    try {
                        if (!parts[7].isEmpty()) speedKnots = Double.parseDouble(parts[7]);
                    } catch (Exception ignored) {}
                    data.put("speedKnots", speedKnots);
                    data.put("speedKmH", speedKnots * 1.852);

                    double heading = 0.0;
                    try {
                        if (!parts[8].isEmpty()) heading = Double.parseDouble(parts[8]);
                    } catch (Exception ignored) {}
                    data.put("heading", heading);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error parseando sentencia NMEA: " + line, e);
        }

        return data;
    }

    private double parseNmeaCoord(String raw, String dir) {
        if (raw == null || raw.isEmpty()) return 0.0;
        try {
            double val = Double.parseDouble(raw);
            int deg = (int) (val / 100);
            double min = val - (deg * 100);
            double decimal = deg + (min / 60.0);
            if ("S".equalsIgnoreCase(dir) || "W".equalsIgnoreCase(dir)) {
                decimal = -decimal;
            }
            return decimal;
        } catch (Exception e) {
            return 0.0;
        }
    }

    private String getRtkQualityName(int quality) {
        switch (quality) {
            case 1: return "GPS Standalone (~2.5m)";
            case 2: return "DGPS (~0.5m)";
            case 4: return "RTK FIXED (~1-2 cm)";
            case 5: return "RTK FLOAT (~10-20 cm)";
            case 6: return "Estimated / Dead Reckoning";
            default: return "No Fix / Buscando";
        }
    }

    @PluginMethod
    public void setGpioPin(PluginCall call) {
        String gpioName = call.getString("gpioName", "gpio137");
        int value = call.getInt("value", 1);
        String direction = call.getString("direction", "out");

        try {
            String dirCmd = "echo " + direction + " > /sys/class/gpio/" + gpioName + "/direction";
            String valCmd = "echo " + value + " > /sys/class/gpio/" + gpioName + "/value";

            Process pDir = Runtime.getRuntime().exec(new String[]{"sh", "-c", dirCmd});
            pDir.waitFor();

            Process pVal = Runtime.getRuntime().exec(new String[]{"sh", "-c", valCmd});
            pVal.waitFor();

            JSObject ret = new JSObject();
            ret.put("status", "success");
            ret.put("gpioName", gpioName);
            ret.put("direction", direction);
            ret.put("value", value);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error configurando GPIO " + gpioName, e);
            call.reject("Error GPIO: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readGpioPin(PluginCall call) {
        String gpioName = call.getString("gpioName", "gpio44");
        String direction = call.getString("direction", "in");

        try {
            String dirCmd = "echo " + direction + " > /sys/class/gpio/" + gpioName + "/direction";
            Process pDir = Runtime.getRuntime().exec(new String[]{"sh", "-c", dirCmd});
            pDir.waitFor();

            File file = new File("/sys/class/gpio/" + gpioName + "/value");
            int val = 0;
            if (file.exists()) {
                try (FileInputStream fis = new FileInputStream(file)) {
                    byte[] b = new byte[8];
                    int r = fis.read(b);
                    if (r > 0) {
                        String s = new String(b, 0, r).trim();
                        val = Integer.parseInt(s);
                    }
                }
            }

            JSObject ret = new JSObject();
            ret.put("gpioName", gpioName);
            ret.put("value", val);
            ret.put("isHigh", val == 1);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error leyendo GPIO " + gpioName, e);
            call.reject("Error leyendo GPIO: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readAllGpios(PluginCall call) {
        String[] gpioNames = new String[]{"gpio44", "gpio45", "gpio138", "gpio36", "gpio137", "gpio66", "gpio90", "gpio96"};
        JSObject list = new JSObject();
        for (String name : gpioNames) {
            File file = new File("/sys/class/gpio/" + name + "/value");
            int val = -1;
            if (file.exists()) {
                try (FileInputStream fis = new FileInputStream(file)) {
                    byte[] b = new byte[8];
                    int r = fis.read(b);
                    if (r > 0) {
                        val = Integer.parseInt(new String(b, 0, r).trim());
                    }
                } catch (Exception ignored) {}
            }
            list.put(name, val);
        }
        JSObject ret = new JSObject();
        ret.put("gpios", list);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        isGpsListening.set(false);
        isCan1Listening.set(false);
        isCan2Listening.set(false);
        isRs485Listening.set(false);
        enableRs485HardwarePower(false);
        try {
            canBusHelper0.uninitialize(0);
        } catch (Exception e) {
            Log.e(TAG, "Error uninitializing CAN0", e);
        }
        try {
            canBusHelper1.uninitialize(1);
        } catch (Exception e) {
            Log.e(TAG, "Error uninitializing CAN1", e);
        }
        super.handleOnDestroy();
    }
}
