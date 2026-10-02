package com.diplus.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Log;
import android.util.SparseArray;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Bluetooth de baja energia: escanear anuncios y hablar GATT con un equipo.
 *
 * Una sola conexion a la vez y las operaciones GATT en fila: Android descarta
 * en silencio la segunda si llega antes de que termine la primera.
 */
@SuppressLint("MissingPermission")
@CapacitorPlugin(
    name = "Bluetooth",
    permissions = {
        @Permission(alias = BluetoothPlugin.UBICACION, strings = {
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = BluetoothPlugin.BLE, strings = {
            "android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT" }),
    }
)
public class BluetoothPlugin extends Plugin {

    static final String UBICACION = "ubicacion";
    static final String BLE = "ble";
    private static final String TAG = "Bluetooth";
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    /** Android rebaja a oportunista un escaneo de mas de 30 min: se reinicia antes. */
    private static final long REINICIO_MS = 25L * 60 * 1000;

    private final Handler hilo = new Handler(Looper.getMainLooper());
    private BluetoothAdapter adaptador;
    private BluetoothLeScanner escaner;
    private ScanCallback alEscanear;
    private final Map<String, Long> ultimoAviso = new HashMap<>();
    private int minMs = 200;
    private Runnable fin;
    /** Con la pantalla apagada Android pausa los escaneos sin filtro. */
    private List<ScanFilter> filtros;

    private BluetoothGatt gatt;
    private PluginCall llamadaConectar;
    private final ArrayDeque<Runnable> fila = new ArrayDeque<>();
    private PluginCall enCurso;
    private Runnable plazo;

    @Override
    public void load() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        adaptador = bm != null ? bm.getAdapter() : null;

        IntentFilter f = new IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        f.addAction(BluetoothDevice.ACTION_PAIRING_REQUEST);
        /* Por delante del dialogo del sistema, para poner el PIN sin que salga. */
        f.setPriority(IntentFilter.SYSTEM_HIGH_PRIORITY - 1);
        getContext().registerReceiver(alEmparejar, f);
    }

    /* ── Emparejamiento ────────────────────────────────────────────────────── */

    private PluginCall llamadaEmparejar;
    private String macEmparejando;
    private String pin;

    private static String tipo(BluetoothDevice d) {
        switch (d.getType()) {
            case BluetoothDevice.DEVICE_TYPE_CLASSIC: return "clasico";
            case BluetoothDevice.DEVICE_TYPE_LE: return "le";
            case BluetoothDevice.DEVICE_TYPE_DUAL: return "dual";
            default: return "desconocido";
        }
    }

    private final BroadcastReceiver alEmparejar = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            BluetoothDevice d = i.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            if (d == null) return;

            if (BluetoothDevice.ACTION_PAIRING_REQUEST.equals(i.getAction())) {
                if (pin != null && d.getAddress().equalsIgnoreCase(macEmparejando)) {
                    try {
                        d.setPin(pin.getBytes());
                        abortBroadcast();
                    } catch (Exception e) {
                        Log.w(TAG, "setPin: " + e.getMessage());
                    }
                }
                return;
            }

            int estado = i.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
            JSObject o = new JSObject();
            o.put("mac", d.getAddress());
            o.put("estado", estado == BluetoothDevice.BOND_BONDED ? "emparejado"
                    : estado == BluetoothDevice.BOND_BONDING ? "emparejando" : "no");
            notifyListeners("emparejamiento", o);

            if (llamadaEmparejar == null || !d.getAddress().equalsIgnoreCase(macEmparejando)) return;
            if (estado == BluetoothDevice.BOND_BONDING) return;
            PluginCall pc = llamadaEmparejar;
            llamadaEmparejar = null;
            pin = null;
            pc.setKeepAlive(false);
            if (estado == BluetoothDevice.BOND_BONDED) pc.resolve(o);
            else pc.reject("No se emparejó. ¿PIN equivocado o se canceló?");
        }
    };

    @PluginMethod
    public void emparejados(PluginCall call) {
        JSArray lista = new JSArray();
        if (adaptador != null && conPermiso()) {
            for (BluetoothDevice d : adaptador.getBondedDevices()) {
                JSObject o = new JSObject();
                o.put("mac", d.getAddress());
                o.put("nombre", d.getName());
                o.put("tipo", tipo(d));
                lista.put(o);
            }
        }
        JSObject r = new JSObject();
        r.put("equipos", lista);
        call.resolve(r);
    }

    @PluginMethod
    public void emparejar(PluginCall call) {
        String mac = call.getString("mac", "");
        if (adaptador == null || !adaptador.isEnabled()) {
            call.reject("El Bluetooth está apagado.");
            return;
        }
        if (!BluetoothAdapter.checkBluetoothAddress(mac)) {
            call.reject("Esa MAC no es válida: " + mac);
            return;
        }
        BluetoothDevice d = adaptador.getRemoteDevice(mac);
        if (d.getBondState() == BluetoothDevice.BOND_BONDED) {
            JSObject o = new JSObject();
            o.put("mac", mac);
            o.put("estado", "emparejado");
            call.resolve(o);
            return;
        }
        detenerEscaneo();
        String p = call.getString("pin", "");
        pin = p == null || p.isEmpty() ? null : p;
        macEmparejando = mac;
        call.setKeepAlive(true);
        llamadaEmparejar = call;
        if (!d.createBond()) {
            llamadaEmparejar = null;
            call.setKeepAlive(false);
            call.reject("Android no dejó empezar el emparejamiento.");
        }
    }

    @PluginMethod
    public void olvidar(PluginCall call) {
        try {
            BluetoothDevice d = adaptador.getRemoteDevice(call.getString("mac", ""));
            d.getClass().getMethod("removeBond").invoke(d);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo olvidar: " + e.getMessage());
        }
    }

    /* ── Serie (SPP), para equipos de Bluetooth clasico ────────────────────── */

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private BluetoothSocket enchufe;
    private OutputStream salida;

    @PluginMethod
    public void conectarSerie(PluginCall call) {
        String mac = call.getString("mac", "");
        if (adaptador == null || !adaptador.isEnabled()) {
            call.reject("El Bluetooth está apagado.");
            return;
        }
        cerrarSerie();
        detenerEscaneo();
        BluetoothDevice d = adaptador.getRemoteDevice(mac);
        new Thread(() -> {
            BluetoothSocket s;
            try {
                s = d.createRfcommSocketToServiceRecord(SPP);
                s.connect();
            } catch (Exception e) {
                call.reject("No conectó por serie: " + e.getMessage());
                return;
            }
            enchufe = s;
            try {
                salida = s.getOutputStream();
            } catch (Exception e) { /* se vera al escribir */ }
            call.resolve();
            leerSerie(s, mac);
        }).start();
    }

    private void leerSerie(BluetoothSocket s, String mac) {
        byte[] buf = new byte[1024];
        try (InputStream in = s.getInputStream()) {
            int n;
            while ((n = in.read(buf)) > 0) {
                byte[] trozo = new byte[n];
                System.arraycopy(buf, 0, trozo, 0, n);
                JSObject o = new JSObject();
                o.put("mac", mac);
                o.put("servicio", "spp");
                o.put("caracteristica", "spp");
                o.put("hex", hex(trozo));
                o.put("at", System.currentTimeMillis());
                notifyListeners("datos", o);
            }
        } catch (Exception e) {
            Log.w(TAG, "serie: " + e.getMessage());
        }
        if (enchufe == s) {
            enchufe = null;
            JSObject e = new JSObject();
            e.put("mac", mac);
            e.put("estado", "desconectado");
            e.put("codigo", 0);
            notifyListeners("conexion", e);
        }
    }

    @PluginMethod
    public void escribirSerie(PluginCall call) {
        OutputStream o = salida;
        if (enchufe == null || o == null) {
            call.reject("No hay conexión serie.");
            return;
        }
        try {
            o.write(deHex(call.getString("hex", "")));
            o.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo escribir: " + e.getMessage());
        }
    }

    @PluginMethod
    public void desconectarSerie(PluginCall call) {
        cerrarSerie();
        call.resolve();
    }

    private void cerrarSerie() {
        BluetoothSocket s = enchufe;
        enchufe = null;
        salida = null;
        if (s != null) {
            try {
                s.close();
            } catch (Exception e) { /* ya cerrado */ }
        }
    }

    private String aliasNecesario() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? BLE : UBICACION;
    }

    private boolean conPermiso() {
        return getPermissionState(aliasNecesario()) == PermissionState.GRANTED;
    }

    /* ── Estado y permisos ─────────────────────────────────────────────────── */

    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("soportado", adaptador != null);
        r.put("encendido", adaptador != null && adaptador.isEnabled());
        r.put("permiso", conPermiso());
        r.put("ubicacionActiva", ubicacionActiva());
        r.put("escaneando", alEscanear != null);
        r.put("conectado", gatt != null ? gatt.getDevice().getAddress() : null);
        call.resolve(r);
    }

    /** Hasta Android 11 el escaneo no devuelve nada con la ubicacion apagada. */
    private boolean ubicacionActiva() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return true;
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return lm.isLocationEnabled();
        return lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    @PluginMethod
    public void pedirPermisos(PluginCall call) {
        if (conPermiso()) {
            estado(call);
            return;
        }
        requestPermissionForAlias(aliasNecesario(), call, "trasPedirPermisos");
    }

    @PermissionCallback
    private void trasPedirPermisos(PluginCall call) {
        estado(call);
    }

    @PluginMethod
    @SuppressWarnings("deprecation")
    public void encender(PluginCall call) {
        if (adaptador == null) {
            call.reject("Este equipo no tiene Bluetooth.");
            return;
        }
        if (!adaptador.isEnabled() && !adaptador.enable()) {
            call.reject("Android no dejó encender el Bluetooth. Hay que encenderlo a mano.");
            return;
        }
        call.resolve();
    }

    /* ── Escaneo ───────────────────────────────────────────────────────────── */

    @PluginMethod
    public void escanear(PluginCall call) {
        if (adaptador == null || !adaptador.isEnabled()) {
            call.reject("El Bluetooth está apagado.");
            return;
        }
        if (!conPermiso()) {
            call.reject("Falta el permiso de Bluetooth.");
            return;
        }
        detenerEscaneo();
        minMs = Math.max(0, call.getInt("minMs", 200));
        final int segundos = call.getInt("segundos", 15);
        filtros = null;
        try {
            JSArray macs = call.getArray("macs");
            if (macs != null && macs.length() > 0) {
                filtros = new ArrayList<>();
                for (Object m : macs.toList()) {
                    filtros.add(new ScanFilter.Builder().setDeviceAddress(String.valueOf(m).toUpperCase()).build());
                }
            }
        } catch (Exception e) {
            call.reject("MAC mal escrita: " + e.getMessage());
            return;
        }

        escaner = adaptador.getBluetoothLeScanner();
        if (escaner == null) {
            call.reject("El escáner no está disponible todavía.");
            return;
        }
        alEscanear = new ScanCallback() {
            @Override
            public void onScanResult(int tipo, ScanResult r) {
                avisar(r);
            }

            @Override
            public void onBatchScanResults(List<ScanResult> lista) {
                for (ScanResult r : lista) avisar(r);
            }

            @Override
            public void onScanFailed(int codigo) {
                JSObject e = new JSObject();
                e.put("codigo", codigo);
                notifyListeners("escaneoFallido", e);
                alEscanear = null;
            }
        };
        arrancarEscaneo();

        fin = segundos > 0 ? this::detenerEscaneo : this::reiniciarEscaneo;
        hilo.postDelayed(fin, segundos > 0 ? segundos * 1000L : REINICIO_MS);
        call.resolve();
    }

    private void arrancarEscaneo() {
        ScanSettings ajustes = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();
        try {
            escaner.startScan(filtros, ajustes, alEscanear);
        } catch (Exception e) {
            Log.w(TAG, "startScan: " + e.getMessage());
        }
    }

    private void reiniciarEscaneo() {
        if (alEscanear == null || escaner == null) return;
        try {
            escaner.stopScan(alEscanear);
        } catch (Exception e) { /* ya parado */ }
        arrancarEscaneo();
        hilo.postDelayed(fin, REINICIO_MS);
    }

    @PluginMethod
    public void detener(PluginCall call) {
        detenerEscaneo();
        call.resolve();
    }

    private void detenerEscaneo() {
        if (fin != null) hilo.removeCallbacks(fin);
        fin = null;
        if (escaner != null && alEscanear != null) {
            try {
                escaner.stopScan(alEscanear);
            } catch (Exception e) { /* Bluetooth apagado */ }
        }
        boolean estaba = alEscanear != null;
        alEscanear = null;
        ultimoAviso.clear();
        if (estaba) notifyListeners("escaneoTerminado", new JSObject());
    }

    private void avisar(ScanResult r) {
        BluetoothDevice d = r.getDevice();
        String mac = d.getAddress();
        long ahora = System.currentTimeMillis();
        Long antes = ultimoAviso.get(mac);
        if (antes != null && ahora - antes < minMs) return;
        ultimoAviso.put(mac, ahora);

        JSObject o = new JSObject();
        o.put("mac", mac);
        o.put("rssi", r.getRssi());
        o.put("at", ahora);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) o.put("conectable", r.isConnectable());

        ScanRecord sr = r.getScanRecord();
        String nombre = sr != null ? sr.getDeviceName() : null;
        if (nombre == null) {
            try {
                nombre = d.getName();
            } catch (Exception e) { /* sin permiso de conexion */ }
        }
        o.put("nombre", nombre);

        if (sr != null) {
            o.put("crudo", hex(sr.getBytes()));
            o.put("tx", sr.getTxPowerLevel());

            JSObject fab = new JSObject();
            SparseArray<byte[]> m = sr.getManufacturerSpecificData();
            if (m != null) {
                for (int i = 0; i < m.size(); i++) {
                    fab.put(String.format("%04x", m.keyAt(i)), hex(m.valueAt(i)));
                }
            }
            o.put("fabricante", fab);

            JSArray uuids = new JSArray();
            if (sr.getServiceUuids() != null) {
                for (ParcelUuid u : sr.getServiceUuids()) uuids.put(u.toString());
            }
            o.put("servicios", uuids);

            JSObject datos = new JSObject();
            if (sr.getServiceData() != null) {
                for (Map.Entry<ParcelUuid, byte[]> e : sr.getServiceData().entrySet()) {
                    datos.put(e.getKey().toString(), hex(e.getValue()));
                }
            }
            o.put("datosServicio", datos);
        }
        notifyListeners("dispositivo", o);
    }

    /* ── Conexion GATT ─────────────────────────────────────────────────────── */

    @PluginMethod
    public void conectar(PluginCall call) {
        String mac = call.getString("mac", "");
        if (adaptador == null || !adaptador.isEnabled()) {
            call.reject("El Bluetooth está apagado.");
            return;
        }
        if (!BluetoothAdapter.checkBluetoothAddress(mac)) {
            call.reject("Esa MAC no es válida: " + mac);
            return;
        }
        cerrarGatt();
        detenerEscaneo();
        call.setKeepAlive(true);
        llamadaConectar = call;
        BluetoothDevice d = adaptador.getRemoteDevice(mac);
        hilo.post(() -> {
            gatt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    ? d.connectGatt(getContext(), false, alGatt, BluetoothDevice.TRANSPORT_LE)
                    : d.connectGatt(getContext(), false, alGatt);
        });
        hilo.postDelayed(() -> {
            if (llamadaConectar == call) {
                fallarConexion("No respondió en 15 s. ¿Está cerca y encendido?");
                cerrarGatt();
            }
        }, 15000);
    }

    @PluginMethod
    public void desconectar(PluginCall call) {
        cerrarGatt();
        call.resolve();
    }

    private void cerrarGatt() {
        if (gatt != null) {
            try {
                gatt.disconnect();
                gatt.close();
            } catch (Exception e) { /* ya cerrado */ }
        }
        gatt = null;
        fila.clear();
        if (enCurso != null) {
            enCurso.reject("Se cerró la conexión.");
            enCurso = null;
        }
        if (plazo != null) hilo.removeCallbacks(plazo);
    }

    private void fallarConexion(String motivo) {
        if (llamadaConectar == null) return;
        PluginCall c = llamadaConectar;
        llamadaConectar = null;
        c.setKeepAlive(false);
        c.reject(motivo);
    }

    private final BluetoothGattCallback alGatt = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int estado, int nuevo) {
            JSObject e = new JSObject();
            e.put("mac", g.getDevice().getAddress());
            e.put("codigo", estado);
            if (nuevo == BluetoothProfile.STATE_CONNECTED) {
                e.put("estado", "conectado");
                notifyListeners("conexion", e);
                hilo.post(g::discoverServices);
            } else if (nuevo == BluetoothProfile.STATE_DISCONNECTED) {
                e.put("estado", "desconectado");
                notifyListeners("conexion", e);
                fallarConexion("Se desconectó (código " + estado + ").");
                hilo.post(() -> {
                    if (gatt == g) cerrarGatt();
                });
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int estado) {
            if (llamadaConectar == null) return;
            PluginCall c = llamadaConectar;
            llamadaConectar = null;
            c.setKeepAlive(false);
            if (estado != BluetoothGatt.GATT_SUCCESS) {
                c.reject("No se pudieron leer sus servicios (código " + estado + ").");
                return;
            }
            JSObject r = new JSObject();
            r.put("mac", g.getDevice().getAddress());
            r.put("servicios", servicios(g));
            c.resolve(r);
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic ch, int estado) {
            JSObject r = new JSObject();
            r.put("hex", hex(ch.getValue()));
            terminar(estado, r);
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic ch, int estado) {
            terminar(estado, new JSObject());
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int estado) {
            terminar(estado, new JSObject());
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic ch) {
            JSObject o = new JSObject();
            o.put("mac", g.getDevice().getAddress());
            o.put("servicio", ch.getService().getUuid().toString());
            o.put("caracteristica", ch.getUuid().toString());
            o.put("hex", hex(ch.getValue()));
            o.put("at", System.currentTimeMillis());
            notifyListeners("datos", o);
        }
    };

    private JSArray servicios(BluetoothGatt g) {
        JSArray lista = new JSArray();
        for (BluetoothGattService s : g.getServices()) {
            JSObject so = new JSObject();
            so.put("uuid", s.getUuid().toString());
            JSArray cs = new JSArray();
            for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                JSObject co = new JSObject();
                co.put("uuid", c.getUuid().toString());
                int p = c.getProperties();
                JSArray pr = new JSArray();
                if ((p & BluetoothGattCharacteristic.PROPERTY_READ) != 0) pr.put("leer");
                if ((p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) pr.put("escribir");
                if ((p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) pr.put("escribirSinRespuesta");
                if ((p & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) pr.put("notificar");
                if ((p & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) pr.put("indicar");
                co.put("propiedades", pr);
                cs.put(co);
            }
            so.put("caracteristicas", cs);
            lista.put(so);
        }
        return lista;
    }

    /* ── Operaciones en fila ───────────────────────────────────────────────── */

    private BluetoothGattCharacteristic buscar(PluginCall call) {
        if (gatt == null) {
            call.reject("No hay ningún equipo conectado.");
            return null;
        }
        try {
            UUID s = UUID.fromString(call.getString("servicio", ""));
            UUID c = UUID.fromString(call.getString("caracteristica", ""));
            BluetoothGattService serv = gatt.getService(s);
            BluetoothGattCharacteristic ch = serv != null ? serv.getCharacteristic(c) : null;
            if (ch == null) call.reject("Ese equipo no tiene esa característica.");
            return ch;
        } catch (IllegalArgumentException e) {
            call.reject("UUID mal escrito.");
            return null;
        }
    }

    private void encolar(PluginCall call, Runnable op) {
        call.setKeepAlive(true);
        hilo.post(() -> {
            fila.add(() -> {
                enCurso = call;
                plazo = () -> terminar(-1, null);
                hilo.postDelayed(plazo, 5000);
                op.run();
            });
            if (enCurso == null) siguiente();
        });
    }

    private void siguiente() {
        Runnable op = fila.poll();
        if (op != null) op.run();
    }

    private void terminar(int estado, JSObject r) {
        hilo.post(() -> {
            if (plazo != null) hilo.removeCallbacks(plazo);
            PluginCall c = enCurso;
            enCurso = null;
            if (c != null) {
                c.setKeepAlive(false);
                if (estado == BluetoothGatt.GATT_SUCCESS) c.resolve(r);
                else if (estado == -1) c.reject("El equipo no contestó en 5 s.");
                else if (estado == -2) c.reject("Android rechazó la operación.");
                else c.reject("El equipo respondió con error " + estado + ".");
            }
            siguiente();
        });
    }

    @PluginMethod
    public void leer(PluginCall call) {
        BluetoothGattCharacteristic ch = buscar(call);
        if (ch == null) return;
        encolar(call, () -> {
            if (!gatt.readCharacteristic(ch)) terminar(-2, null);
        });
    }

    @PluginMethod
    @SuppressWarnings("deprecation")
    public void escribir(PluginCall call) {
        BluetoothGattCharacteristic ch = buscar(call);
        if (ch == null) return;
        byte[] valor = deHex(call.getString("hex", ""));
        boolean sinRespuesta = call.getBoolean("sinRespuesta", false);
        encolar(call, () -> {
            ch.setWriteType(sinRespuesta
                    ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            ch.setValue(valor);
            if (!gatt.writeCharacteristic(ch)) terminar(-2, null);
        });
    }

    @PluginMethod
    public void escuchar(PluginCall call) {
        notificaciones(call, true);
    }

    @PluginMethod
    public void dejarDeEscuchar(PluginCall call) {
        notificaciones(call, false);
    }

    @SuppressWarnings("deprecation")
    private void notificaciones(PluginCall call, boolean activar) {
        BluetoothGattCharacteristic ch = buscar(call);
        if (ch == null) return;
        boolean indica = (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0
                && (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) == 0;
        encolar(call, () -> {
            gatt.setCharacteristicNotification(ch, activar);
            BluetoothGattDescriptor d = ch.getDescriptor(CCCD);
            if (d == null) {
                terminar(BluetoothGatt.GATT_SUCCESS, new JSObject());
                return;
            }
            d.setValue(!activar ? BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
                    : indica ? BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                    : BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            if (!gatt.writeDescriptor(d)) terminar(-2, null);
        });
    }

    @Override
    protected void handleOnDestroy() {
        detenerEscaneo();
        cerrarGatt();
        cerrarSerie();
        try {
            getContext().unregisterReceiver(alEmparejar);
        } catch (Exception e) { /* no estaba */ }
    }

    /* ── Utilidades ────────────────────────────────────────────────────────── */

    static String hex(byte[] b) {
        if (b == null) return "";
        StringBuilder s = new StringBuilder(b.length * 2);
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    static byte[] deHex(String h) {
        String t = h.replaceAll("[^0-9a-fA-F]", "");
        byte[] b = new byte[t.length() / 2];
        for (int i = 0; i < b.length; i++) {
            b[i] = (byte) Integer.parseInt(t.substring(i * 2, i * 2 + 2), 16);
        }
        return b;
    }
}
