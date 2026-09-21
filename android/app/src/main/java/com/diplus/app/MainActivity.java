package com.diplus.app;

import android.content.Intent;
import android.os.Bundle;
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
    }

    @Override
    public void onResume() {
        super.onResume();
        activarInmersivo();
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
