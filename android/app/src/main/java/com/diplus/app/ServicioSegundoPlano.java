package com.diplus.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Mantiene la aplicacion trabajando con la pantalla apagada.
 *
 * En primer plano para que Android no la mate, con el procesador y el WiFi
 * despiertos, y con un latido por segundo hacia el JS: los temporizadores del
 * WebView se frenan con la vista oculta, los eventos nativos no.
 */
public class ServicioSegundoPlano extends Service {

    static final String EXTRA_TEXTO = "texto";
    private static final String CANAL = "diplus-segundo-plano";
    private static final int AVISO = 1748;
    private static final long LATIDO_MS = 1000;

    /** Quien recibe el latido; lo pone el plugin. */
    static volatile Runnable alLatir;
    static volatile boolean activo = false;

    private final Handler hilo = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock cpu;
    private WifiManager.WifiLock wifi;

    private final Runnable latido = new Runnable() {
        @Override
        public void run() {
            Runnable r = alLatir;
            if (r != null) r.run();
            hilo.postDelayed(this, LATIDO_MS);
        }
    };

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String texto = intent != null ? intent.getStringExtra(EXTRA_TEXTO) : null;
        avisar(texto != null ? texto : "Leyendo y enviando");

        if (cpu == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "diplus:segundo-plano");
            cpu.setReferenceCounted(false);
            cpu.acquire();
        }
        if (wifi == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "diplus:segundo-plano");
                wifi.setReferenceCounted(false);
                wifi.acquire();
            }
        }
        hilo.removeCallbacks(latido);
        hilo.post(latido);
        activo = true;
        /* Si Android lo mata por memoria, que lo vuelva a levantar. */
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        activo = false;
        hilo.removeCallbacks(latido);
        if (cpu != null && cpu.isHeld()) cpu.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        cpu = null;
        wifi = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void avisar(String texto) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel c = new NotificationChannel(
                    CANAL, "Trabajo en segundo plano", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Sigue leyendo sensores y enviando con la pantalla apagada.");
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }

        PendingIntent abrir = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CANAL)
                : new Notification.Builder(this);

        Notification n = b
                .setContentTitle("DiPlus")
                .setContentText(texto)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(abrir)
                .setOngoing(true)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(AVISO, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } else {
            startForeground(AVISO, n);
        }
    }
}
