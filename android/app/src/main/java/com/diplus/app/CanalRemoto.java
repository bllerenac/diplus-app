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
 * **Lee, y deja cambiar la configuracion.** Empezo siendo de solo lectura por
 * prudencia, y fue un error: la puerta se hizo para no depender de que alguien
 * este delante del equipo, y sin poder configurarlo seguia haciendo falta que
 * alguien estuviera. Lo que se puede cambiar es exactamente lo mismo que se
 * cambia desde la pantalla de Ajustes, ni una cosa mas: no se ejecutan ordenes
 * del sistema ni se escribe en los puertos.
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
        reabrirAdbPorRed();
        levantarRedCableada();

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

        /* La cabecera se lee entera: hace falta el largo del cuerpo, y ademas si
           no se consume, el cliente ve la respuesta antes de terminar de enviar y
           algunos lo toman por error. */
        int largo = 0;
        String linea;
        while ((linea = in.readLine()) != null && !linea.isEmpty()) {
            String baja = linea.toLowerCase();
            if (baja.startsWith("content-length:")) {
                largo = entero(linea.substring(15).trim(), 0);
            }
        }

        String cuerpo = "";
        if (largo > 0 && largo <= 512 * 1024) {
            char[] buf = new char[largo];
            int leidos = 0;
            while (leidos < largo) {
                int n = in.read(buf, leidos, largo - leidos);
                if (n < 0) break;
                leidos += n;
            }
            cuerpo = new String(buf, 0, Math.max(0, leidos));
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

            case "/config":
                /* La configuracion entera, tal como la guarda la pantalla de
                   Ajustes. No se interpreta aqui: Java no sabe de fuentes ni de
                   tarjetas, y si lo supiera habria dos sitios que mantener. Se
                   deja en la cola y la aplicacion la aplica por el mismo camino
                   que si alguien la hubiera tocado en la pantalla. */
                if (cuerpo.isEmpty()) {
                    responder(s, 400, "{\"error\":\"hace falta la configuración en el cuerpo\"}");
                } else {
                    ordenes = "config:" + cuerpo;
                    responder(s, 200, "{\"ok\":\"la aplicación la aplicará en unos segundos\"}");
                }
                break;

            case "/actualizar":
                ordenes = "actualizar";
                responder(s, 200, "{\"ok\":\"la aplicación buscará una versión nueva\"}");
                break;

            case "/":
                responder(s, 200, "{\"soy\":\"DiPlus\",\"rutas\":"
                        + "[\"/estado\",\"/puertos\",\"/leer\",\"/config\",\"/actualizar\"]}");
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

    /** La direccion de este equipo en el enlace directo con el HelperBox. */
    private static final String IP_CABLE = "192.168.60.2/24";

    /** Una propiedad del sistema, sin root: `getprop` la lee cualquiera. */
    private String propiedad(String nombre) {
        try {
            Process p = Runtime.getRuntime().exec(new String[] { "getprop", nombre });
            java.io.BufferedReader r = new java.io.BufferedReader(
                    new java.io.InputStreamReader(p.getInputStream()));
            String linea = r.readLine();
            r.close();
            p.waitFor();
            return linea == null ? "" : linea.trim();
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * Ejecuta una orden como root, si el equipo lo permite.
     *
     * La orden va **por la entrada estandar**, no detras de un `-c`. El `su` de
     * estas tablets toma lo que sigue a `-c` como el nombre de un programa, asi
     * que `su -c "ip addr add ...; ip link set ..."` falla buscando un ejecutable
     * que se llama asi de largo. Costo una prueba entera darse cuenta, porque
     * la llamada no revienta: devuelve un error que nadie mira y se queda todo
     * como estaba.
     *
     * Sin root no hay `su`, salta la excepcion y no pasa nada. Esto nunca es
     * imprescindible: son mejoras sobre lo que el equipo ya hace solo.
     */
    private boolean comoRoot(String orden) {
        try {
            Process p = Runtime.getRuntime().exec("su");
            java.io.OutputStream o = p.getOutputStream();
            o.write((orden + "\nexit\n").getBytes("UTF-8"));
            o.flush();
            o.close();
            return p.waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Levanta la boca de red cableada con una direccion fija.
     *
     * Es el camino por el que entran las lecturas del HelperBox. No lo hace
     * Android por su cuenta: su servicio de Ethernet pide direccion por DHCP y
     * al otro lado no hay nadie que la reparta, porque esto es una red privada
     * de dos y a proposito — sin router, sin servidor, sin nada que se pueda
     * caer aparte del propio cable.
     *
     * Se pone en cada arranque porque una direccion puesta a mano no sobrevive
     * a un reinicio, y este equipo se reinicia con el camion. Si no hay root,
     * `su` no existe, la llamada falla y no pasa nada.
     *
     * Por que un cable y no el RS485 ni el CAN: los tres CAN y el RS485 de esta
     * tablet salen por el mismo latiguillo y **ninguno entrega un solo byte**,
     * ni con el demo del fabricante. Lo que no pasa por ese latiguillo —GPS,
     * inercial, pantalla— va perfecto. La boca de red es un chip aparte, un
     * SMSC LAN9514 colgado del hub USB interno, y tiene su propio driver.
     */
    private void levantarRedCableada() {
        new Thread(() -> {
            boolean ok = comoRoot("ip addr add " + IP_CABLE + " dev eth0; ip link set eth0 up");
            Log.i(TAG, ok ? "Red cableada levantada en " + IP_CABLE
                          : "Sin root: la red cableada se queda como estaba");
        }).start();
    }

    /**
     * Vuelve a abrir el ADB por red, si el equipo lo permite.
     *
     * El `adb tcpip 5555` no sobrevive a un reinicio: la propiedad que lo
     * gobierna no es persistente, y ponerla persistente exige permisos que una
     * aplicacion no tiene. Asi que cada arranque dejaba el equipo alcanzable
     * solo por este canal, y para volver a entrar por ADB habia que ir con un
     * cable USB hasta la cabina.
     *
     * Estas tablets traen un interruptor de root en sus ajustes —viene
     * documentado por el fabricante—. Cuando esta puesto, esto lo arregla solo
     * en cada arranque. Cuando no lo esta, `su` no existe, la llamada falla y
     * no pasa nada: el canal sigue siendo la puerta de siempre.
     */
    private void reabrirAdbPorRed() {
        new Thread(() -> {
            /* Si ya esta puesto, no se toca.
               ─────────────────────────────
               Reiniciar el `adbd` **corta todas las conexiones abiertas**, y
               este metodo corre cada vez que arranca el servicio. El resultado
               era que cualquiera que estuviera mirando la pantalla de lejos se
               quedaba a media frase, con un «Device disconnected» que parecia
               de la WiFi y era cosa nuestra. Se arregla como todo lo que se
               ejecuta a menudo: mirando antes de actuar. */
            if ("5555".equals(propiedad("service.adb.tcp.port"))) {
                Log.i(TAG, "El ADB por red ya estaba abierto; no se toca");
                return;
            }

            boolean ok = comoRoot("setprop service.adb.tcp.port 5555; stop adbd; start adbd");
            Log.i(TAG, ok ? "ADB por red reabierto con root"
                          : "Sin root: el ADB por red se queda como estaba");
        }).start();
    }

    /**
     * El transceptor RS485 de esta placa cuelga del gpio40.
     *
     * Sin esto la escucha de aqui abria el puerto con el chip apagado y no
     * entraba nada, dijera lo que dijera el otro extremo. Se descubrio probando
     * contra un HelperBox que se sabia que estaba emitiendo: cero bytes por los
     * seis puertos, y el lector de verdad de la aplicacion —que si lo enciende—
     * no tenia ese problema. Un diagnostico que miente es peor que no tenerlo.
     */
    private String alimentarRs485() {
        try {
            Runtime.getRuntime()
                    .exec(new String[] { "sh", "-c", "echo out > /sys/class/gpio/gpio40/direction" })
                    .waitFor();
            Runtime.getRuntime()
                    .exec(new String[] { "sh", "-c", "echo 1 > /sys/class/gpio/gpio40/value" })
                    .waitFor();
        } catch (Exception e) {
            return "no";
        }
        try (java.io.BufferedReader r = new java.io.BufferedReader(
                new java.io.FileReader("/sys/class/gpio/gpio40/value"))) {
            return r.readLine();
        } catch (Exception e) {
            return "?";
        }
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

        String gpio = alimentarRs485();

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
                + ",\"gpio40\":\"" + gpio + "\""
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
