package com.diplus.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Actualizar la aplicacion sin Google Play y sin cable.
 *
 * Se le da una direccion, se baja el APK que haya ahi y se instala.
 *
 * ─── Modos de instalacion ────────────────────────────────────────────────────
 *
 * 1. PackageInstaller session (Android 8+): muestra un pequeño dialogo del
 *    sistema con un solo boton. No abre el instalador completo. Es lo mejor
 *    que se puede hacer sin ser device owner.
 *
 * 2. Fallback (ACTION_INSTALL_PACKAGE): el instalador completo de siempre,
 *    por si el modo session falla por alguna razon del fabricante.
 *
 * ─── Por que no es 100% silencioso ──────────────────────────────────────────
 *
 * En Android 9 la instalacion silenciosa total requiere ser «device owner».
 * Para eso el equipo no puede tener ninguna cuenta registrada. Si en algun
 * momento se quita la cuenta y se configura el device owner con ADB, bastara
 * con cambiar instalacionSilenciosa() para que devuelva true y este plugin
 * se encargara del resto sin tocar nada mas.
 */
@CapacitorPlugin(name = "Actualizador")
public class ActualizadorPlugin extends Plugin {

    private static final String TAG = "Actualizador";
    private static final String ACCION_RESULTADO = "com.diplus.app.INSTALL_RESULT";

    /** Un APK de 5 MB por una red de mina no tiene por que ser rapido. */
    private static final int ESPERA_MS = 30000;

    /** Drive y compañia rebotan la peticion varias veces antes de dar el archivo. */
    private static final int MAX_SALTOS = 6;

    /** Ni un APK de esta aplicacion se acerca, y evita llenar el disco por un error. */
    private static final long MAX_BYTES = 200L * 1024 * 1024;

    /** Referencia al call activo de instalar, para resolverlo cuando llegue el resultado. */
    private PluginCall callInstalar = null;

    /** Receptor del resultado de la instalacion via PackageInstaller session. */
    private BroadcastReceiver receptorResultado = null;

    @PluginMethod
    public void version(PluginCall call) {
        JSObject r = new JSObject();
        try {
            PackageInfo p = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            r.put("versionName", p.versionName);
            r.put("versionCode", codigoDe(p));
            r.put("packageName", p.packageName);
        } catch (Exception e) {
            call.reject("No se pudo leer la version instalada: " + e.getMessage());
            return;
        }
        r.put("puedeInstalar", puedeInstalar());
        call.resolve(r);
    }

    /**
     * Baja el archivo y dice que es, sin instalar nada todavia.
     *
     * Se separa a proposito de instalar: primero se enseña que version trae y
     * que pesa, y despues se decide. Bajar 5 MB y encontrarse instalando algo
     * sin haberlo visto no es forma.
     */
    @PluginMethod
    public void descargar(PluginCall call) {
        final String direccion = call.getString("url", "");
        if (direccion == null || direccion.trim().isEmpty()) {
            call.reject("Falta la dirección del APK.");
            return;
        }

        new Thread(() -> {
            File destino = new File(getContext().getCacheDir(), "actualizacion.apk");
            try {
                bajar(direccion.trim(), destino);
            } catch (Exception e) {
                Log.w(TAG, "descarga: " + e.getMessage());
                borrar(destino);
                call.reject(e.getMessage());
                return;
            }

            PackageManager pm = getContext().getPackageManager();
            PackageInfo nuevo = pm.getPackageArchiveInfo(destino.getAbsolutePath(), 0);

            if (nuevo == null) {
                borrar(destino);
                call.reject("Lo que hay en esa dirección no es un APK. "
                        + "Si el archivo está en Google Drive, hace falta el enlace de descarga directa, "
                        + "no el de compartir.");
                return;
            }

            /* Instalar otro paquete distinto seria una sorpresa desagradable: no
               actualizaria esta aplicacion, instalaria otra al lado. */
            if (!getContext().getPackageName().equals(nuevo.packageName)) {
                borrar(destino);
                call.reject("Ese APK es de otra aplicación (" + nuevo.packageName + "), no de DiPlus.");
                return;
            }

            JSObject r = new JSObject();
            r.put("ruta", destino.getAbsolutePath());
            r.put("versionName", nuevo.versionName);
            r.put("versionCode", codigoDe(nuevo));
            r.put("bytes", destino.length());
            call.resolve(r);
        }).start();
    }

    /**
     * Como descargar, pero acepta cualquier APK sin importar a que paquete pertenece.
     *
     * Se usa para bajar Tailscale y otras aplicaciones de soporte que no son DiPlus.
     * No comprueba el packageName: solo verifica que lo descargado sea un APK valido.
     */
    @PluginMethod
    public void descargarCualquier(PluginCall call) {
        final String direccion = call.getString("url", "");
        if (direccion == null || direccion.trim().isEmpty()) {
            call.reject("Falta la dirección del APK.");
            return;
        }

        new Thread(() -> {
            File destino = new File(getContext().getCacheDir(), "tailscale.apk");
            try {
                bajar(direccion.trim(), destino);
            } catch (Exception e) {
                Log.w(TAG, "descarga tailscale: " + e.getMessage());
                borrar(destino);
                call.reject(e.getMessage());
                return;
            }

            PackageManager pm = getContext().getPackageManager();
            PackageInfo nuevo = pm.getPackageArchiveInfo(destino.getAbsolutePath(), 0);

            if (nuevo == null) {
                borrar(destino);
                call.reject("Lo que hay en esa dirección no es un APK válido.");
                return;
            }

            JSObject r = new JSObject();
            r.put("ruta", destino.getAbsolutePath());
            r.put("versionName", nuevo.versionName != null ? nuevo.versionName : "");
            r.put("versionCode", codigoDe(nuevo));
            r.put("bytes", destino.length());
            call.resolve(r);
        }).start();
    }

    /**
     * Instala el APK ya descargado.
     *
     * Primero intenta via PackageInstaller session (solo un boton del sistema).
     * Si falla, cae al instalador completo de siempre.
     */
    @PluginMethod
    public void instalar(PluginCall call) {
        String ruta = call.getString("ruta", "");
        File f = new File(ruta == null ? "" : ruta);
        if (!f.exists()) {
            call.reject("El archivo ya no está. Vuelve a buscar la actualización.");
            return;
        }

        if (!puedeInstalar()) {
            call.reject("Android no deja instalar desde esta aplicación todavía. "
                    + "En la pantalla que sale ahora hay que darle permiso, y volver a intentarlo.");
            abrirPermiso();
            return;
        }

        /* Intentar la instalacion via session: el usuario solo ve un dialogo
           compacto del sistema, no el instalador completo. */
        try {
            instalarViaSession(f, call);
        } catch (Exception e) {
            Log.w(TAG, "session falló, usando instalador clásico: " + e.getMessage());
            instalarViaIntent(f, call);
        }
    }

    /* ── Instalacion via PackageInstaller session ──────────────────────────── */

    /**
     * El camino moderno: escribe el APK en una sesion del PackageInstaller y
     * pide que lo instale. Android muestra un dialogo compacto en vez del
     * instalador completo, y si en algun momento el equipo se convierte en
     * device owner, esto pasa a ser silencioso sin cambiar nada mas.
     */
    private void instalarViaSession(File apk, PluginCall call) throws Exception {
        PackageInstaller pi = getContext().getPackageManager().getPackageInstaller();

        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(getContext().getPackageName());

        int sessionId = pi.createSession(params);
        PackageInstaller.Session session = pi.openSession(sessionId);

        /* Copiar el APK dentro de la sesion. */
        try (InputStream in = new FileInputStream(apk);
             OutputStream out = session.openWrite("package", 0, apk.length())) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            session.fsync(out);
        }

        /* Registrar el receptor antes de hacer commit, para no perderse el resultado. */
        registrarReceptor(call);

        Intent intent = new Intent(ACCION_RESULTADO);
        intent.setPackage(getContext().getPackageName());
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pi2 = PendingIntent.getBroadcast(getContext(), sessionId, intent, flags);

        session.commit(pi2.getIntentSender());
        session.close();

        Log.i(TAG, "sesion " + sessionId + " enviada al sistema");
        /* El resultado llega en el receptor; no resolvemos el call aquí. */
    }

    /**
     * Registra el BroadcastReceiver que recibe el resultado de la sesion.
     * Solo hay uno activo a la vez.
     */
    private void registrarReceptor(PluginCall call) {
        /* Si había uno anterior, lo quitamos. */
        if (receptorResultado != null) {
            try { getContext().unregisterReceiver(receptorResultado); } catch (Exception ignored) {}
        }
        callInstalar = call;

        receptorResultado = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                try { ctx.unregisterReceiver(this); } catch (Exception ignored) {}
                receptorResultado = null;

                int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS,
                        PackageInstaller.STATUS_FAILURE);
                String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);

                if (status == PackageInstaller.STATUS_SUCCESS) {
                    Log.i(TAG, "instalacion completada");
                    if (callInstalar != null) callInstalar.resolve();
                } else if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    /* El sistema necesita confirmacion del usuario: lanzamos la intent
                       que viene dentro del extra, que abre el dialogo compacto. */
                    Intent confirmacion = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirmacion != null) {
                        confirmacion.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        ctx.startActivity(confirmacion);
                        /* El call se resolverá cuando el usuario acepte y llegue
                           STATUS_SUCCESS, o rechace y llegue STATUS_FAILURE. */
                    }
                } else {
                    String error = "Instalación rechazada (código " + status + ")"
                            + (msg != null ? ": " + msg : "");
                    Log.w(TAG, error);
                    if (callInstalar != null) callInstalar.reject(error);
                }
                callInstalar = null;
            }
        };

        IntentFilter filtro = new IntentFilter(ACCION_RESULTADO);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receptorResultado, filtro, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(receptorResultado, filtro);
        }
    }

    /* ── Fallback: instalador clasico ─────────────────────────────────────── */

    private void instalarViaIntent(File f, PluginCall call) {
        try {
            Uri uri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo abrir el instalador: " + e.getMessage());
        }
    }

    /* ── Descarga ──────────────────────────────────────────────────────────── */

    /**
     * Se siguen los rebotes a mano.
     *
     * HttpURLConnection sigue los suyos, pero no cuando cambia de http a
     * https o al reves, y ahi es justo donde acaban las descargas de Drive.
     */
    private void bajar(String direccion, File destino) throws Exception {
        HttpURLConnection c = null;
        String actual = direccion;

        for (int salto = 0; salto <= MAX_SALTOS; salto++) {
            URL u = new URL(actual);
            c = (HttpURLConnection) u.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(ESPERA_MS);
            c.setReadTimeout(ESPERA_MS);
            c.setRequestProperty("User-Agent", "DiPlus/actualizador");
            c.connect();

            int codigo = c.getResponseCode();
            if (codigo >= 300 && codigo < 400) {
                String siguiente = c.getHeaderField("Location");
                c.disconnect();
                if (siguiente == null) throw new Exception("El servidor rebotó la petición sin decir a dónde.");
                actual = new URL(new URL(actual), siguiente).toString();
                continue;
            }

            if (codigo == 404) throw new Exception("No hay nada en esa dirección (404).");
            if (codigo == 403) throw new Exception("Esa dirección existe pero no deja descargar (403). "
                    + "Si está en Drive, el archivo tiene que estar compartido con «cualquier persona con el enlace».");
            if (codigo != 200) throw new Exception("El servidor respondió " + codigo + ".");
            break;
        }

        long total = c.getContentLength();
        if (total > MAX_BYTES) throw new Exception("El archivo pesa demasiado para ser un APK de DiPlus.");

        try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(destino)) {
            byte[] buffer = new byte[16384];
            long leidos = 0;
            int n;

            while ((n = in.read(buffer)) > 0) {
                out.write(buffer, 0, n);
                leidos += n;
                if (leidos > MAX_BYTES) throw new Exception("El archivo no deja de crecer; no es un APK.");

                JSObject aviso = new JSObject();
                aviso.put("bytes", leidos);
                aviso.put("total", total);
                notifyListeners("onDescarga", aviso);
            }

            if (leidos == 0) throw new Exception("La descarga vino vacía.");
        } finally {
            c.disconnect();
        }
    }

    /* ── Utilidades ────────────────────────────────────────────────────────── */

    /** Desde Android 8 cada aplicacion pide permiso por separado para instalar. */
    private boolean puedeInstalar() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void abrirPermiso() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            Log.w(TAG, "no se pudo abrir el permiso: " + e.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private long codigoDe(PackageInfo p) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? p.getLongVersionCode() : p.versionCode;
    }

    private void borrar(File f) {
        if (f.exists() && !f.delete()) Log.w(TAG, "no se pudo borrar " + f);
    }
}
