package com.android.canbus;

/**
 * Enlace Java con la libreria nativa del bus CAN del fabricante.
 *
 * ─── Por que existe este fichero ──────────────────────────────────────────────
 *
 * El proyecto no compilaba: `import com.android.canbus.CanBusHelper` no
 * resolvia porque la libreria del fabricante nunca estuvo en el repositorio.
 * `app/build.gradle` declara `implementation fileTree(dir: 'libs')`, pero esa
 * carpeta `libs/` no existe. El APK que si funcionaba llevaba las clases
 * dentro, y de ahi salieron.
 *
 * La parte nativa —`libCanBusLib.so`, que es la que de verdad habla con el
 * micro— se saco del APK instalado en el equipo y esta en `jniLibs/`, para
 * arm64-v8a y armeabi-v7a. Aqui solo esta la declaracion Java que JNI necesita
 * para encontrar cada funcion por su nombre.
 *
 * ─── Sobre las firmas ─────────────────────────────────────────────────────────
 *
 * Los 19 simbolos `Java_com_android_canbus_CanBusHelper_*` del `.so` estan sin
 * sufijo de tipos, o sea que ninguno esta sobrecargado y JNI los resuelve por
 * el nombre corto. Pero **los tipos los fija esta declaracion**: si aqui se
 * pone un tipo que no es el que espera el codigo nativo, no falla al compilar
 * —falla al llamarlo, y de una forma fea.
 *
 * Por eso solo se declaran los metodos cuya firma esta **comprobada por el uso
 * que ya hacia de ellos la version anterior de la aplicacion**, que funcionaba
 * contra este mismo `.so`. Los demas existen en la libreria y estan anotados
 * abajo, pero declararlos a ojo seria dar por segura una firma que nadie ha
 * verificado.
 */
public class CanBusHelper {

    static {
        System.loadLibrary("CanBusLib");
    }

    /** Lo que la libreria devuelve por cada trama del bus. */
    public interface CanBusCallback {
        /**
         * @param FF   0 identificador estandar de 11 bits, 1 extendido de 29 (J1939)
         * @param RTR  1 si es una trama de peticion, sin datos
         * @param DLC  cuantos bytes traen datos
         * @param ID   el identificador completo
         * @param DATA los bytes, uno por entero
         */
        void onReceiveCanbusData(int FF, int RTR, int DLC, int ID, int[] DATA);

        void onSetError();

        void onSendError();

        void onIdError(int count);
    }

    /** Progreso de una actualizacion de firmware del micro. */
    public interface UpdateReturnCallback {
        void onUpdateReturn(int state);
    }

    /**
     * Velocidad del enlace serie con el micro que hace de puente al bus.
     *
     * Ojo: no es el bitrate del CAN. Son dos cosas distintas y confundirlas deja
     * el bus mudo sin dar ningun error.
     *
     * @param canInterface 0 para el primer bus, 1 para el segundo
     */
    public native int setSerialBaudrate(int canInterface, int baudrate, int dataBits, int parity, int stopBits);

    /**
     * Abre el bus.
     *
     * @param canBaudrate el bitrate del CAN, ese si: 250000 para J1939
     * @return 0 si salio bien; cualquier otra cosa es que no se pudo abrir
     */
    public native int initialize(int canInterface, int serialBaudrate, int canBaudrate, boolean loopback);

    /** Cierra el bus. Conviene llamarlo al salir para no dejar el puerto tomado. */
    public native int uninitialize(int canInterface);

    /** Se queda escuchando y llama al callback por cada trama. */
    public native void readCan(int canInterface, CanBusCallback callback);

    /** Manda una trama al bus. */
    public native int sendFrame(int canInterface, int ff, int rtr, int dlc, int id, int[] data);

    /* ── Lo demas que trae la libreria ─────────────────────────────────────────
     *
     * Estos simbolos estan en el `.so` pero no los usaba la version anterior,
     * asi que su firma no esta comprobada y no se declaran a ojo:
     *
     *   clearFlag            closeCanbusIdFilter   closeSendLogFile
     *   getAdcValue          getGpioValue          getMcuRtcValue
     *   getVersion           openSendLogFile       setGpioValue
     *   setListIdFilter      setMaskIdFilter       setMcuRtcValue
     *   trySerialBaudrate    updateFirmware
     *
     * Para usar cualquiera de ellos hace falta la firma real del fabricante.
     * Añadirlo aqui adivinando compila igual y revienta al llamarlo.
     *
     * Los GPIO, por cierto, ya se leen y se escriben por sysfs en
     * `CanRs485Plugin`, sin pasar por esta libreria.
     */
}
