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
     * El cuarto parametro **no es un modo bucle**, aunque se llamaba asi aqui y
     * eso nos costo una prueba entera dada por buena. El manual del fabricante
     * dice que es `Test_Mode`: cuando va a `true`, la libreria comprueba que los
     * identificadores de las tramas que **entran** vayan en secuencia y avisa
     * por `onIdError` si no. No devuelve nada al equipo ni desconecta el bus.
     *
     * O sea que con esto no se puede probar el bus sin tener algo enfrente que
     * emita: esta API no ofrece ningun bucle interno.
     *
     * @param canBaudrate el bitrate del CAN, ese si: 250000 para J1939
     * @return 0 si salio bien; cualquier otra cosa es que no se pudo abrir
     */
    public native int initialize(int canInterface, int serialBaudrate, int canBaudrate, boolean modoPrueba);

    /** Cierra el bus. Conviene llamarlo al salir para no dejar el puerto tomado. */
    public native int uninitialize(int canInterface);

    /**
     * Se queda escuchando y llama al callback por cada trama.
     *
     * Devuelve `int`, no `void`. Estaba declarado `void` y eso **no funciona**:
     * el JNI empareja por nombre y por firma, y `()V` no es `()I`, asi que la
     * llamada no encontraba el simbolo. Se descubrio sacando la firma real del
     * `canbus_api.aar` del fabricante con `javap`, que es la unica forma de
     * saberla: adivinarla compila igual y falla al llamar.
     */
    public native int readCan(int canInterface, CanBusCallback callback);

    /** Manda una trama al bus. */
    public native int sendFrame(int canInterface, int ff, int rtr, int dlc, int id, int[] data);

    /* ── El resto de la libreria, con la firma del fabricante ──────────────────
     *
     * Ya no se adivinan: salen de `javap` sobre el `canbus_api.aar` que viene
     * en el SDK. Las que importan para saber si el micro esta vivo son las dos
     * primeras.
     */

    /**
     * La version del firmware del micro que hace de puente al bus.
     *
     * Es la pregunta mas util que se le puede hacer al aparato: si contesta,
     * el micro esta vivo y hablando con la tablet, y lo que falle esta en el
     * cable del bus. Si no contesta, lo que falla esta antes, entre la tablet
     * y el micro, y no hay cableado de CAN que arreglar.
     */
    public native String getVersion(int canInterface);

    /**
     * Prueba una velocidad del enlace serie con el micro.
     *
     * `setSerialBaudrate` la impone y devuelve 0 aunque al otro lado no haya
     * nadie escuchando; esta la **comprueba**. Sirve para encontrar a que
     * velocidad habla el micro sin ir a ciegas.
     */
    public native int trySerialBaudrate(int canInterface, int baudrate, int dataBits, int parity, int stopBits);

    /** Los GPIO del propio micro, que no son los del SoC. */
    public native int getGpioValue(int canInterface, int pin);
    public native int setGpioValue(int canInterface, int pin, int value);

    /** Entrada analogica del micro. */
    public native float getAdcValue(int canInterface, int canal, float escala);

    /** El reloj del micro. Otra forma de ver si responde. */
    public native long getMcuRtcValue(int canInterface);

    public native int clearFlag(int canInterface);
    public native int closeCanbusIdFilter(int canInterface, int filtro);
    public native int setMaskIdFilter(int canInterface, int n, int[] ids, int[] mascaras);
    public native int setListIdFilter(int canInterface, int n, int[] ids, int[] mascaras);
    public native int openSendLogFile(int canInterface);
    public native int closeSendLogFile(int canInterface);
    public native int updateFirmware(int canInterface, int modo, UpdateReturnCallback cb, String ruta);
}
