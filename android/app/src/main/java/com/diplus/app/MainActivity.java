package com.diplus.app;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.IntentFilter;
import android.os.Build;
import android.os.PowerManager;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Actividad principal. Arranca en modo kiosco: oculta todas las barras del
 * sistema y no deja que nadie salga sin la contraseña. Si el usuario presiona
 * el botón de inicio, la app vuelve al frente en cuanto recupera el foco.
 */
public class MainActivity extends BridgeActivity {

    /** Mientras sea true, el botón de atrás y el de inicio no hacen nada. */
    static volatile boolean kioscoActivo = true;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CanRs485Plugin.class);
        registerPlugin(ActualizadorPlugin.class);
        registerPlugin(CanalPlugin.class);
        registerPlugin(MovimientoPlugin.class);
        registerPlugin(KioscoPlugin.class);
        registerPlugin(MqttPlugin.class);
        super.onCreate(savedInstanceState);

        // Mantener pantalla encendida siempre (tablet de campo)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().setBackgroundColor(android.graphics.Color.parseColor("#0d0e12"));
        }

        activarInmersivo();
        cargarBrillo();
        registerReceiver(receptorPantalla, new IntentFilter(Intent.ACTION_SCREEN_OFF));
    }

    @Override
    public void onDestroy() {
        try { unregisterReceiver(receptorPantalla); } catch (Exception e) { /* no estaba */ }
        super.onDestroy();
    }

    @Override
    public void onResume() {
        super.onResume();
        activarInmersivo();
        if (kioscoActivo) fijarPantalla();
    }

    /**
     * Fija la pantalla en esta app: el panel de arriba deja de bajar y los
     * botones de inicio y recientes dejan de sacar de aqui.
     *
     * El modo inmersivo solo **esconde** las barras. Deslizando desde el borde
     * vuelven, y desde ahi se despliega el panel de notificaciones entero, con
     * sus ajustes rapidos: el WiFi, el avion, todo. Lo unico que lo impide de
     * verdad es el modo de tarea fijada.
     *
     * La primera vez el sistema pide confirmacion, salvo que la aplicacion sea
     * propietaria del dispositivo. Si no se puede —permisos, version— se queda
     * como estaba, que ya es el inmersivo mas la vuelta al frente.
     */
    void fijarPantalla() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            boolean yaFijada = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    ? am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE
                    : am.isInLockTaskMode();
            blindar(true);
            if (!yaFijada) startLockTask();
        } catch (Exception e) {
            /* sin permisos no pasa nada: esto es una mejora sobre lo que ya hacia */
        }
    }

    /**
     * Vuelve a encender la pantalla si alguien la apaga.
     *
     * El boton de encendido no se puede interceptar: el sistema procesa esa
     * tecla antes de repartirla. Lo que si se puede es reaccionar, y aqui hace
     * falta, porque con la pantalla apagada **se deja de guardar**: todos los
     * relojes de lecturas y de envio son `setInterval` dentro del WebView, y
     * Chrome estrangula los temporizadores de una vista que no se ve —pasan a
     * una vez por minuto, y a los cinco minutos a menos—. La tablet seguiria
     * encendida y el histórico quedaria con un hueco.
     *
     * Mientras el kiosco este activo, un apagon de pantalla dura lo que tarda
     * este receptor en despertarla.
     */
    private final BroadcastReceiver receptorPantalla = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            if (!kioscoActivo) return;
            if (!Intent.ACTION_SCREEN_OFF.equals(i.getAction())) return;
            despertarPantalla();
        }
    };

    private void despertarPantalla() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;

            /* FULL_WAKE_LOCK esta obsoleto y es justo lo que hace falta: es lo
               unico que enciende la pantalla desde una app sin ser el sistema.
               Se suelta en seguida —lo que mantiene la pantalla despues es el
               FLAG_KEEP_SCREEN_ON de la ventana, que ya esta puesto. */
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock wl = pm.newWakeLock(
                    PowerManager.FULL_WAKE_LOCK
                            | PowerManager.ACQUIRE_CAUSES_WAKEUP
                            | PowerManager.ON_AFTER_RELEASE,
                    "diplus:despertar");
            wl.acquire(3000);
            wl.release();

            /* Y que la actividad se ponga delante del bloqueo, si lo hubiera.
               Con la app propietaria del dispositivo el bloqueo ya esta
               desactivado, pero sin serlo esto evita quedarse en la cerradura. */
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true);
                setTurnScreenOn(true);
            }
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                km.requestDismissKeyguard(this, null);
            }
        } catch (Exception e) {
            Log.w("MainActivity", "despertarPantalla: " + e.getMessage());
        }
    }

    /**
     * Cierra lo que la tarea fijada no cierra: el menu de apagado y el bloqueo.
     *
     * La tarea fijada impide salir de la app, pero **no** impide apagar el
     * equipo: una pulsacion larga del boton sigue sacando «Apagar / Reiniciar».
     * Y una corta apaga la pantalla, que es lo unico que ninguna aplicacion
     * puede evitar — el sistema procesa esa tecla antes de repartirla, asi que
     * no llega ni a `dispatchKeyEvent`.
     *
     * Con la app **propietaria del dispositivo** si se puede:
     *
     * - `setLockTaskFeatures(NONE)` quita el menu de apagado. En tarea fijada
     *   Android deja ese menu activo por omision; hay que apagarlo a mano.
     * - `setKeyguardDisabled(true)` quita la pantalla de bloqueo, asi que si
     *   alguien apaga la pantalla, al volver a pulsar entra directo y sin PIN.
     * - `setLockTaskPackages` evita el aviso de confirmacion al fijar.
     *
     * Sin nombrar propietaria no hace nada y la aplicacion sigue como hoy. Se
     * nombra una vez, con el equipo sin cuentas:
     *
     *   adb shell dpm set-device-owner com.diplus.app/.AdminReceptor
     */
    void blindar(boolean activo) {
        try {
            DevicePolicyManager dpm =
                    (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (dpm == null || !dpm.isDeviceOwnerApp(getPackageName())) return;

            ComponentName admin = new ComponentName(this, AdminReceptor.class);

            dpm.setLockTaskPackages(admin, activo ? new String[]{ getPackageName() } : new String[0]);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                dpm.setLockTaskFeatures(admin, activo
                        ? DevicePolicyManager.LOCK_TASK_FEATURE_NONE
                        : DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS
                          | DevicePolicyManager.LOCK_TASK_FEATURE_HOME
                          | DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD);
            }

            dpm.setKeyguardDisabled(admin, activo);
        } catch (Exception e) {
            /* Si el sistema no deja, se queda con la tarea fijada a secas. */
            Log.w("MainActivity", "blindar: " + e.getMessage());
        }
    }

    /** Si el blindaje completo esta disponible, para poder decirlo en el panel. */
    boolean esPropietaria() {
        try {
            DevicePolicyManager dpm =
                    (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            return dpm != null && dpm.isDeviceOwnerApp(getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    /** Suelta la pantalla. Sin esto no se puede ni cerrar la aplicacion. */
    void soltarPantalla() {
        try {
            blindar(false);
            stopLockTask();
        } catch (Exception e) {
            /* no estaba fijada */
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            activarInmersivo();
        } else if (kioscoActivo) {
            // Alguien intentó salir → volvemos al frente en cuanto podamos
            getWindow().getDecorView().postDelayed(this::volverAlFrente, 300);
        }
    }

    /** El botón de Inicio dispara esto antes de minimizar la app. */
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (kioscoActivo) {
            volverAlFrente();
        }
    }

    /** Bloquea el botón de Atrás cuando el kiosco está activo. */
    /* ── Los dos botones fisicos de la carcasa ────────────────────────────────
     *
     * El `soc:gpio_keys` de esta tablet da KEY_F1 y KEY_F2, y el keylayout del
     * sistema no los remapea, asi que llegan aqui como F1 y F2 y se pueden usar
     * para lo que haga falta. Se usan para el brillo: en una cabina, de noche
     * la pantalla deslumbra y a mediodia no se ve, y el conductor no deberia
     * tener que salir de la aplicacion —ni poder— para arreglarlo.
     *
     * Es el brillo **de esta ventana**, no el del sistema: cambiar el del
     * sistema pide WRITE_SETTINGS, que es un permiso especial que hay que
     * conceder a mano en cada equipo. Como la aplicacion ocupa la pantalla
     * entera, el efecto es el mismo.
     */
    private static final String PREFS = "diplus.pantalla";
    private static final String CLAVE_BRILLO = "brillo";
    private static final float PASO = 0.12f;

    private float brillo = -1f;

    private void cargarBrillo() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        brillo = p.getFloat(CLAVE_BRILLO, -1f);
        if (brillo >= 0f) aplicarBrillo(brillo, false);
    }

    private void aplicarBrillo(float v, boolean guardar) {
        brillo = Math.max(0.05f, Math.min(1f, v));
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = brillo;
        getWindow().setAttributes(lp);
        if (guardar) {
            getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit().putFloat(CLAVE_BRILLO, brillo).apply();
        }
    }

    /* Se intercepta en dispatchKeyEvent y no en onKeyDown: el WebView tiene
       el foco y se come las teclas antes de que lleguen a la actividad. Aqui
       pasan todas, antes de repartirlas a las vistas. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent evento) {
        int codigo = evento.getKeyCode();
        if (codigo == KeyEvent.KEYCODE_F1 || codigo == KeyEvent.KEYCODE_F2) {
            if (evento.getAction() == KeyEvent.ACTION_DOWN) {
                /* Sin valor guardado se parte de la mitad: el del sistema no se
                   puede leer sin permisos y adivinarlo daria un salto feo. */
                float actual = brillo >= 0f ? brillo : 0.5f;
                aplicarBrillo(codigo == KeyEvent.KEYCODE_F1 ? actual + PASO : actual - PASO, true);
            }
            return true;
        }
        return super.dispatchKeyEvent(evento);
    }

    @Override
    public void onBackPressed() {
        if (!kioscoActivo) {
            super.onBackPressed();
        }
        // Si kiosco activo: no hacer nada
    }

    /** Oculta barras de estado y navegación con modo inmersivo pegajoso. */
    private void activarInmersivo() {
        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }

    /** Relanza la actividad para volver al primer plano. */
    private void volverAlFrente() {
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                 | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
    }
}
