package com.diplus.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Una puerta para mirar el equipo de lejos, sin ADB ni cable.
 *
 * El ADB por red muere en cada reinicio y en este aparato no hay forma de
 * dejarlo permanente: no tiene root y Android 9 no trae depuracion inalambrica.
 * Asi que si el equipo se apaga en una mina, se acabo el acceso hasta que
 * alguien vaya con un cable.
 *
 * Esto no depende del ADB. Vive dentro de la aplicacion, arranca con ella y por
 * Tailscale se alcanza desde cualquier parte.
 *
 * ─── Es una puerta, y se trata como tal ──────────────────────────────────────
 *
 * **Solo lee.** No cambia configuracion ni escribe en los puertos. Lo que se
 * puede hacer desde fuera es mirar como esta el equipo y pedir que busque una
 * version nueva. Cambiar cosas de lejos es otra decision, y merece pensarse
 * aparte.
 *
 * **Pide token.** Sin el token correcto no contesta nada. Y por debajo esta
 * Tailscale, que ya limita quien puede siquiera llamar a la puerta: son dos
 * cierres, no uno.
 *
 * **Escucha solo lo que hace falta.** El puerto se abre en todas las
 * interfaces porque la de Tailscale aparece y desaparece, pero sin token no
 * responde ni a la red local.
 */
public class CanalRemoto extends Service {

    private static final String TAG = "CanalRemoto";
    private static final String CANAL_AVISO = "diplus-canal";
    private static final int AVISO = 1747;

    public static final String EXTRA_PUERTO = "puerto";
    public static final String EXTRA_TOKEN = "token";

    private final AtomicBoolean vivo = new AtomicBoolean(false);
    private ServerSocket puerta;
    private Thread hilo;

    /** Lo ultimo que la aplicacion conto de si misma. Lo publica el lado TypeScript. */
    private static volatile String estado = "{\"estado\":\"la aplicación aún no ha publicado nada\"}";

    /** Ordenes pendientes de que la aplicacion las recoja. */
    private static volatile String ordenes = "";

    public static void publicar(String json) {
        if (json != null) estado = json;
    }

    public static String recogerOrdenes() {
        String o = ordenes;
        ordenes = "";
        return o;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        int puerto = intent != null ? intent.getIntExtra(EXTRA_PUERTO, 8787) : 8787;
        String token = intent != null ? intent.getStringExtra(EXTRA_TOKEN) : null;

        avisar(puerto);

        if (vivo.compareAndSet(false, true)) {
            hilo = new Thread(() -> servir(puerto, token == null ? "" : token));
            hilo.start();
        }

        /* Si el sistema lo mata por memoria, que lo vuelva a levantar con lo
           mismo: es justo cuando hace falta que siga en pie. */
        return START_REDELIVER_INTENT;
    }

    @Override
    public void onDestroy() {
        vivo.set(false);
        try {
            if (puerta != null) puerta.close();
        } catch (Exception ignorado) {
            /* Se esta cerrando de todos modos. */
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ── El servidor ───────────────────────────────────────────────────────── */

    private void servir(int puerto, String token) {
        try {
            puerta = new ServerSocket();
            puerta.setReuseAddress(true);
            puerta.bind(new InetSocketAddress(puerto));
            Log.i(TAG, "Canal escuchando en el puerto " + puerto);
        } catch (Exception e) {
            Log.e(TAG, "No se pudo abrir el puerto " + puerto, e);
            vivo.set(false);
            return;
        }

        while (vivo.get()) {
            try (Socket s = puerta.accept()) {
                s.setSoTimeout(15000);
                atender(s, token);
            } catch (Exception e) {
                if (vivo.get()) Log.w(TAG, "conexión fallida: " + e.getMessage());
            }
        }
    }

    private void atender(Socket s, String token) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
        String primera = in.readLine();
        if (primera == null) return;

        String[] trozos = primera.split(" ");
        String ruta = trozos.length > 1 ? trozos[1] : "/";

        /* La cabecera se lee entera aunque no se use: si no, el cliente ve la
           respuesta antes de terminar de enviar y algunos lo toman por error. */
        String linea;
        while ((linea = in.readLine()) != null && !linea.isEmpty()) {
            /* Se descarta. */
        }

        String consulta = ruta.contains("?") ? ruta.substring(ruta.indexOf('?') + 1) : "";
        String camino = ruta.contains("?") ? ruta.substring(0, ruta.indexOf('?')) : ruta;

        if (!token.isEmpty() && !token.equals(parametro(consulta, "t"))) {
            /* Sin decir por que: a quien no tiene el token no se le explica nada. */
            responder(s, 401, "{\"error\":\"no autorizado\"}");
            return;
        }

        switch (camino) {
            case "/estado":
                responder(s, 200, estado);
                break;

            case "/puertos":
                responder(s, 200, puertos());
                break;

            case "/leer":
                responder(s, 200, leer(
                        parametro(consulta, "puerto"),
                        entero(parametro(consulta, "baudios"), 9600),
                        entero(parametro(consulta, "ms"), 3000)));
                break;

            case "/actualizar":
                ordenes = "actualizar";
                responder(s, 200, "{\"ok\":\"la aplicación buscará una versión nueva\"}");
                break;

            case "/":
                responder(s, 200, "{\"soy\":\"DiPlus\",\"rutas\":"
                        + "[\"/estado\",\"/puertos\",\"/leer\",\"/actualizar\"]}");
                break;

            default:
                responder(s, 404, "{\"error\":\"no existe\"}");
        }
    }

    /* ── Lo que se puede consultar ─────────────────────────────────────────── */

    /**
     * Los puertos serie que hay ahora, con su papel.
     *
     * Se resuelven por la rama del bus USB y no por su nombre, porque el numero
     * de ttyUSB cambia entre arranques. Es lo mismo que hace el SDK del
     * fabricante.
     */
    private String puertos() {
        StringBuilder sb = new StringBuilder("{\"puertos\":[");
        boolean primero = true;

        File[] usb = new File("/sys/class/tty").listFiles((d, n) -> n.startsWith("ttyUSB"));
        if (usb != null) {
            java.util.Arrays.sort(usb);
            for (File e : usb) {
                String destino;
                try {
                    destino = e.getCanonicalPath();
                } catch (Exception ex) {
                    destino = "";
                }
                String papel = destino.contains("1-1.2") ? "RS485"
                        : destino.contains("1-1.3") ? "COM2 (RS232)" : "USB serie";
                if (!primero) sb.append(',');
                sb.append(uno("/dev/" + e.getName(), papel));
                primero = false;
            }
        }

        for (String[] p : new String[][] {
                { "/dev/ttyHSL0", "COM1 (RS232)" },
                { "/dev/ttyHSL1", "Reservado" },
                { "/dev/ttyHSL2", "GPS" },
                { "/dev/ttyHSL3", "Reservado" } }) {
            if (!primero) sb.append(',');
            sb.append(uno(p[0], p[1]));
            primero = false;
        }
        return sb.append("]}").toString();
    }

    private String uno(String ruta, String papel) {
        return "{\"ruta\":\"" + ruta + "\",\"papel\":\"" + papel + "\","
                + "\"existe\":" + new File(ruta).exists() + "}";
    }

    /**
     * Escucha un puerto un momento y devuelve lo que llego, en hexadecimal.
     *
     * Es lo que mas falta hace de lejos: sin esto, para saber si por el cable
     * entra algo hay que ir hasta el equipo.
     */
    private String leer(String ruta, int baudios, int ms) {
        if (ruta == null || !ruta.startsWith("/dev/tty")) {
            return "{\"error\":\"puerto no válido\"}";
        }
        File dev = new File(ruta);
        if (!dev.exists()) return "{\"error\":\"ese puerto no existe\"}";

        try {
            Runtime.getRuntime()
                    .exec(new String[] { "stty", "-F", ruta, String.valueOf(baudios), "raw", "-echo" })
                    .waitFor();
        } catch (Exception e) {
            /* Se intenta leer con lo que haya configurado. */
        }

        java.io.ByteArrayOutputStream junto = new java.io.ByteArrayOutputStream();
        long hasta = System.currentTimeMillis() + Math.min(15000, Math.max(200, ms));
        byte[] buffer = new byte[4096];

        try (FileInputStream fis = new FileInputStream(dev)) {
            while (System.currentTimeMillis() < hasta && junto.size() < 8192) {
                if (fis.available() <= 0) {
                    Thread.sleep(30);
                    continue;
                }
                int n = fis.read(buffer);
                if (n <= 0) break;
                junto.write(buffer, 0, n);
            }
        } catch (Exception e) {
            return "{\"error\":\"" + escapar(e.getMessage()) + "\"}";
        }

        byte[] datos = junto.toByteArray();
        StringBuilder hex = new StringBuilder();
        StringBuilder texto = new StringBuilder();
        for (byte b : datos) {
            hex.append(String.format("%02X", b));
            int c = b & 0xff;
            texto.append(c >= 32 && c <= 126 ? (char) c : '.');
        }

        return "{\"puerto\":\"" + ruta + "\",\"baudios\":" + baudios
                + ",\"bytes\":" + datos.length
                + ",\"hex\":\"" + hex + "\",\"texto\":\"" + escapar(texto.toString()) + "\"}";
    }

    /* ── Cosas de servicio ─────────────────────────────────────────────────── */

    /**
     * El aviso permanente.
     *
     * Android mata los servicios en segundo plano cuando necesita memoria, y
     * este tiene que seguir en pie precisamente cuando el equipo va justo. Para
     * eso hay que declararlo en primer plano, y eso obliga a la notificacion:
     * es el trato que pone el sistema, y ademas es honesto que se vea que la
     * puerta esta abierta.
     */
    private void avisar(int puerto) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel c = new NotificationChannel(
                    CANAL_AVISO, "Acceso remoto", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Deja mirar el equipo de lejos por la red privada.");
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }

        PendingIntent abrir = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        /* La notificacion **tiene** que llevar su canal desde Android 8, y un
           icono propio de la aplicacion.

           Sin el canal, el sistema la rechaza y no falla solo el servicio: mata
           la aplicacion entera con «Bad notification for startForeground», y la
           excepcion llega por el hilo principal, asi que no hay try que valga.
           Se comprobo en el equipo: la app se caia al encender el canal. */
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CANAL_AVISO)
                : new Notification.Builder(this);

        Notification n = b
                .setContentTitle("DiPlus · acceso remoto")
                .setContentText("Escuchando en el puerto " + puerto)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(abrir)
                .setOngoing(true)
                .build();

        startForeground(AVISO, n);
    }

    private void responder(Socket s, int codigo, String cuerpo) throws Exception {
        byte[] b = cuerpo.getBytes(StandardCharsets.UTF_8);
        OutputStream out = s.getOutputStream();
        out.write(("HTTP/1.1 " + codigo + " \r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + b.length + "\r\n"
                + "Connection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    private String parametro(String consulta, String nombre) {
        for (String par : consulta.split("&")) {
            int i = par.indexOf('=');
            if (i > 0 && par.substring(0, i).equals(nombre)) {
                try {
                    return java.net.URLDecoder.decode(par.substring(i + 1), "UTF-8");
                } catch (Exception e) {
                    return par.substring(i + 1);
                }
            }
        }
        return null;
    }

    private int entero(String s, int porDefecto) {
        try {
            return Integer.parseInt(s);
        } catch (Exception e) {
            return porDefecto;
        }
    }

    private String escapar(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", " ").replace("\r", " ");
    }
}
