/**
 * Control del modo kiosco desde la capa React.
 *
 * Envuelve el plugin nativo KioscoPlugin (Android) con una interfaz limpia.
 * En el navegador (dev) todas las llamadas son no-ops silenciosos.
 */
import { registerPlugin } from '@capacitor/core';

interface KioscoPlugin {
  bloquear(): Promise<void>;
  desbloquear(): Promise<void>;
  estado(): Promise<{ activo: boolean }>;
  cerrar(): Promise<void>;
  reiniciar(): Promise<void>;
}

const _plugin = registerPlugin<KioscoPlugin>('Kiosco', {
  web: {
    bloquear:    async () => {},
    desbloquear: async () => {},
    estado:      async () => ({ activo: false }),
    cerrar:      async () => {},
    reiniciar:   async () => {},
  },
});

/** Activa el bloqueo de botones de navegación del sistema. */
export const bloquear    = () => _plugin.bloquear();

/** Desactiva el bloqueo (el usuario puede salir/minimizar). */
export const desbloquear = () => _plugin.desbloquear();

/** Devuelve si el kiosco está activo ahora mismo. */
export const estadoKiosco = () => _plugin.estado();

/** Cierra la app completamente. */
export const cerrarApp   = () => _plugin.cerrar();

/** Reinicia la app desde cero. */
export const reiniciarApp = () => _plugin.reiniciar();

/** Contraseña maestra para desbloquear el kiosco. */
export const CLAVE_KIOSCO = 'gunjop123';
