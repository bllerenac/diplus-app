package com.diplus.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
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
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Actualizar la aplicacion sin Google Play y sin cable.
 *
 * Se le da una direccion, se baja el APK que haya ahi y se abre el instalador
 * de Android. El equipo puede estar donde sea: no hace falta llegar a el, es el
 * el que sale a buscar la version.
 *
 * ─── Lo que este plugin NO hace ──────────────────────────────────────────────
 *
 * Instalar sin que nadie toque nada. En Android 9 eso solo puede hacerlo una
 * aplicacion que sea «device owner», y para poner una hace falta que el equipo
 * no tenga ninguna cuenta registrada. Aqui hay una de Google, asi que el ultimo
 * paso —pulsar «Instalar»— lo da una persona delante de la maquina.
 *
 * ─── Por que se comprueba tanto lo que se baja ───────────────────────────────
 *
 * Porque la direccion la escribe el usuario y lo mas facil del mundo es pegar
 * la que no es. Un enlace de Google Drive para compartir devuelve una pagina
 * web, no el archivo, y sin comprobarlo el equipo intentaria instalar un HTML y
 * diria «error» sin explicar nada. Se mira que sea un APK de verdad, que sea de
 * esta aplicacion, y que version trae; con eso el aviso puede decir que pasa.
 */
@CapacitorPlugin(name = "Actualizador")
public class ActualizadorPlugin extends Plugin {

    private static final String TAG = "Actualizador";

    /** Un APK de 5 MB por una red de mina no tiene por que ser rapido. */
    private static final int ESPERA_MS = 30000;

    /** Drive y compañia rebotan la peticion varias veces antes de dar el archivo. */
    private static final int MAX_SALTOS = 6;

    /** Ni un APK de esta aplicacion se acerca, y evita llenar el disco por un error. */
    private static final long MAX_BYTES = 200L * 1024 * 1024;

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
     * Abre el instalador de Android con el archivo ya bajado.
     *
     * El APK vive en la carpeta privada de la aplicacion, asi que se pasa por
     * el FileProvider: desde Android 7 no se puede entregar un `file://` a otra
     * aplicacion, y el instalador es otra aplicacion.
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

    /* ── Lo de dentro ─────────────────────────────────────────────────────── */

    /**
     * Se siguen los rebotes a mano.
     *
     * HttpURLConnection sigue los suyos, pero **no cuando cambia de http a
     * https o al reves**, y ahi es justo donde acaban las descargas de Drive.
     * Sin esto la respuesta seria un 302 vacio y pareceria un archivo corrupto.
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
