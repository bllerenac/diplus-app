# El RS485 no lee: qué se descartó y qué queda

Estado al 2 de septiembre de 2026. Ni una sola trama ha entrado por RS485 en
este equipo. Esto es el registro de lo comprobado, para no repetirlo.

## Montaje de la prueba

Un adaptador **USB-RS485C (chip CH340, COM5)** en el PC, con `A` y `B` a la
bornera de la tablet. Emite `herramientas/emisor-rs485.ps1`, que manda una línea
de JSON cada 0,4 s a 9600 8N1. Se enviaron más de 3000 tramas.

## Descartado, con la prueba que lo descarta

| Hipótesis | Cómo se descartó |
|---|---|
| Puerto equivocado | Los 6 puertos serie, a 9600, 19200 y 115200. Cero bytes en todos |
| Polaridad A/B invertida | Probadas las dos posiciones |
| El adaptador necesita RTS o DTR | Las 4 combinaciones de RTS/DTR |
| Falta alimentar el transceptor | `gpio40` forzado a 1 y comprobado en `/sys` |
| Un sentido roto | Falla igual PC → tablet que tablet → PC |
| El receptor despierta al transmitir | Escribir y leer después: nada |
| Un GPIO selecciona RS232 o RS485 | El manual de GPIO del fabricante: los ocho pines (44, 45, 138, 36 entradas; 137, 66, 90, 96 salidas) son de uso general del cliente. No hay selector |
| El latiguillo sin alimentación | Sus dos CH340 internos están enumerados con driver cargado, así que tiene corriente |
| Fallo en nuestro código | El código original que sí funcionaba llamaba exactamente igual: `startRs485Listener({ devicePath: '/dev/ttyHSL0', baudrate: 9600 })`, mismo `gpio40`, y su interfaz no tocaba ningún otro GPIO |
| El emisor no emite | 3105 tramas escritas, CH340 en `OK` sin código de error, y la luz de transmisión del adaptador parpadea |

También está verificado lo que sí funciona: el **mecanismo de lectura** —con el
mismo código se leen 4351 bytes del GPS en `ttyHSL2`— y la **decodificación**,
con 46 pruebas en verde sobre tramas reales capturadas del emisor.

## Qué falta por probar, y es todo hardware

1. **Otro adaptador USB-RS485.** Es la única pieza de la cadena que no se ha
   podido verificar por ningún medio. Que su luz parpadee prueba que el chip USB
   recibe del PC, no que el transceptor RS485 saque señal al par.
2. **120 Ω entre A y B** en el borne de la tablet. Con dos nodos y sin
   polarización la línea flota en reposo, y el receptor puede no llegar a
   reconocer un bit de arranque. Eso da silencio, no basura, que es el síntoma.
3. **Medir con multímetro** entre los tornillos A y B del adaptador mientras
   emite. Un transmisor vivo no se queda en 0,000 V fijo.

## El puerto: dos fuentes que no coinciden

Sin resolver, y por eso el puerto se elige ahora **desde un selector** en
Configuración en vez de estar escrito a fuego.

- El **SDK de la AT-10A** dice que el RS485 es un conversor USB en la rama
  `1-1.2` del bus —hoy `ttyUSB0`— y que `ttyHSL0` es COM1, RS232:

  ```java
  ComA.setPort(serial0);  // COM1  = /dev/ttyHSL0
  ComB.setPort(serial1);  // COM2  = 1-1.3
  ComC.setPort(serial2);  // RS485 = 1-1.2
  ```

- El **código original de esta unidad**, escrito cuando leía, usaba `ttyHSL0` y
  lo etiquetaba `(P4 RS485)` y `(P4 / COM1)`.

La AT-10L no es la AT-10A, así que el mapeo puede diferir de verdad. Cuando
entre la primera trama, el puerto por el que entre zanja la discusión: hay que
dejarlo escrito aquí y poner ese como valor por defecto en `nuevaFuente`.

## Para retomarlo

```powershell
# Emitir (deja el adaptador en COM5, o cambia el puerto)
.\herramientas\emisor-rs485.ps1 -Puerto COM5 -Modo todo

# Ver la pantalla del equipo
E:\Claude\herramientas\scrcpy-win64-v3.1\scrcpy.exe -s 192.168.18.121:5555 --stay-awake
```

En la app: Configuración → Fuentes → + RS485, elegir el puerto en el selector, y
mirar el Monitor, que enseña los bytes en crudo aunque el protocolo esté mal
elegido.

---

# Segunda ronda: contra un HelperBox, 4 de septiembre de 2026

Se repitió todo con **otro emisor**, un HelperBox por red, para quitar de en
medio el adaptador USB-RS485 del PC —que era la pieza que nunca se había podido
verificar y la número uno de la lista de arriba—.

## Lo que quedó probado de la tablet

| Qué | Cómo |
|---|---|
| El camino de lectura funciona | Las tramas NMEA del GPS entran limpias por `ttyHSL2` a 921600 con el mismo `stty` + `cat` |
| El puerto es el correcto | El demo del fabricante abre el RS485 como `serial2 = 1-1.2`, que en esta unidad es `/dev/ttyUSB0`. Comprobado por `readlink` del `sysfs` |
| El puerto queda bien configurado | `stty -a`: 9600, `cs8`, `-parenb`, `-cstopb`, `cread`, `clocal` |
| **El UART transmite de verdad** | 12000 bytes a 9600 tardan **12 579 ms**. Lo esperado son 12 500. El chip está relojando bits, no tragándoselos en un buffer |
| No había nadie robando el puerto | La aplicación estaba parada (`ps` sin `com.diplus.app`) durante las escuchas |
| El `gpio40` no es el culpable | Escuchado con 0 y con 1. Silencio en los dos |

Y aun así: **cero bytes** en los seis puertos, a 9600, 19200 y 115200, con
escuchas de hasta 20 s seguidos.

## Lo que apareció del lado del HelperBox

Dos cosas que no cuadran con lo que se creía:

**No existe ningún `/dev/ttyUSB` en el HelperBox.** Se le preguntó al propio
equipo creando salidas contra `ttyUSB0` a `ttyUSB3`; las cuatro contestan
`No such file or directory`. Sus únicos puertos son `ttyS1`, `ttyS2` y `ttyS5`.
En `lsusb` solo hay un hub Terminus y un `a8a5:2255` sin descripción: un
adaptador enchufado al que **no se le ha enganchado driver**, que es justo lo
que se pierde en cada reinicio.

**La salida RS485 del HelperBox nunca ha emitido.** La salida «Sistema RTK» de
`ttyS2`, creada el 1 de septiembre, lleva `emitidas: 0` porque su disparo es
«en cuanto llega del bus» y sin caudalímetro no llega nada. O sea que no hay
ninguna prueba de que ese camino haya funcionado alguna vez.

## La hipótesis que queda, y está escrita en el propio README

El README del HelperBox avisa de esto en §7, antes de que pasara:

> Si la placa exige controlar el sentido por **RTS**, este módulo se queda
> corto: `stty` + `fs.writeSync` no manejan la conmutación.

Un transceptor half-duplex que espera que alguien le suba la pata de dirección
y no la ve **nunca saca nada al par**, y el que escribe no se entera: la
escritura le sale bien, sin error, exactamente lo que se observa.

## Lo que hay que mirar, y necesita shell en el HelperBox

```sh
dmesg | grep -iE 'usb|ch34|pl2303|ftdi|cp210'   # por que no hay ttyUSB
lsusb -t                                         # donde cuelga el a8a5:2255
ls /sys/bus/usb-serial/drivers/                  # que drivers hay cargados
cat /dev/ttyS2                                   # con la tablet emitiendo
```

Y engancharlo a mano, si es lo que parece:

```sh
modprobe ch341
echo "a8a5 2255" > /sys/bus/usb-serial/drivers/ch341-uart/new_id
```

---

# Tercera ronda: con root en el HelperBox, 4 de septiembre de 2026

Con acceso a las dos cajas a la vez, el problema queda acotado del todo.

## Las dos partes están sanas, y está medido

La prueba que zanja cada lado es la del **reloj**: 12000 bytes a 9600 baudios
tienen que tardar 12,5 s. Si el puerto se los traga en un buffer y vuelve al
instante, el UART no está relojando nada.

| Equipo | Puerto | Medido |
|---|---|---|
| Tablet | `ttyUSB0` | **12 579 ms** |
| HelperBox | `ttyS1` | **12 501 ms** |
| HelperBox | `ttyS2` | **11 989 ms** |
| HelperBox | `ttyS5` | **12 496 ms** |

Los cuatro relojean a la velocidad exacta. Los dos UART sacan bits de verdad.

## El puerto es el correcto, y está bien montado

- `serial2` en el device-tree es `uart@05000800`, o sea **UART2 = `/dev/ttyS2`**,
  que es donde el cable está puesto. Los `uart0/1/2/5` están en `okay`, el 3 y
  el 4 en `disabled`, que es justo por qué los nodos son `ttyS0,1,2,5`.
- El mux está hecho: `pin 207 (PG15)` y `pin 208 (PG16)` con `function uart2`.
- En la tablet, el demo del fabricante abre el RS485 como `serial2 = 1-1.2`,
  que por `sysfs` es `/dev/ttyUSB0`. Es el que usamos.

## Lo que se descartó por el camino

**No hay ningún USB-serie en el HelperBox.** El `a8a5:2255` que aparece en
`lsusb` está enganchado a **`usbhid`**, con tres interfaces: es un HID, no un
adaptador. El driver `ch341-uart` está cargado y sin usar. Así que el
`ttyUSB2` que se buscaba no existe ni puede existir.

**El software anterior tampoco leía RS485.** En `/root` están
`canbus-scania`, `canbus-volvo` y `retirado-dfm-2026-09-02`, y los tres son
solo CAN: ni una referencia a un puerto serie. Este enlace **nunca ha
funcionado**; no es que se haya roto.

**El `gpio209` no era la respuesta.** Aparece en `/sys/kernel/debug/gpio` como
`gpio-209 (sysfs) out lo`, y PG17 es el pin justo al lado de PG15/PG16 — tenía
toda la pinta del control de sentido del transceptor. Se probó a 1 y a 0, en
las dos direcciones. Nada. Se dejó como estaba, en 0.

**Tampoco hay eco.** Ninguno de los dos oye lo que él mismo emite, cosa que en
half-duplex algunos transceptores sí hacen. No prueba nada por sí solo, pero
acompaña.

## La barrida final

HelperBox emitiendo por `ttyS1`, `ttyS2` y `ttyS5` a la vez, quince rondas,
alternando el `gpio209` entre 0 y 1. Tablet escuchando sus **cinco** puertos a
la vez durante 35 s:

```
ttyUSB0: 0    ttyUSB1: 0    ttyHSL0: 0    ttyHSL1: 0    ttyHSL3: 0
```

Y en el sentido contrario, tablet emitiendo 15 s y HelperBox capturando sus
tres puertos: 0 bytes en los tres.

## Lo que queda, y ya no es software

Con los dos UART relojando bien y cero bytes en los dos sentidos, lo que falla
está **entre los dos borneros**. Por orden de probabilidad:

1. **Falta la masa común.** Es lo que mejor explica el silencio absoluto: sin
   referencia, los dos receptores pueden quedarse fuera del rango de modo
   común y no responder a nada. Da silencio, no basura — el síntoma exacto.
2. **El UART2 del HelperBox sale en TTL, sin transceptor.** Si esos PG15/PG16
   van a un header a 3,3 V y no a un chip RS485, conectarlos a un par
   diferencial no puede funcionar de ninguna manera. **Esto no se puede
   comprobar por software: hay que mirar la placa.**
3. **A y B cruzadas, o los 120 Ω.** Menos probable, porque cruzarlas suele dar
   basura antes que silencio, pero es de lo más barato de descartar.

Lo que hay que medir, con el HelperBox emitiendo (la salida «PRUEBA ttyS2»
queda activa a propósito, una línea por segundo a 9600):

- Continuidad de masa entre los dos borneros.
- Tensión entre A y B en cada extremo. En reposo un par RS485 vivo no se queda
  en 0,000 V clavado.
- 120 Ω entre A y B, y ~60 Ω si están puestas las dos terminaciones.

---

# Lo que faltaba no era un cable: era preguntar

**4 de septiembre de 2026.** Un caudalimetro Modbus o un Eurosens son
**esclavos**: no dicen ni una palabra hasta que alguien les pregunta. La
version anterior de esta aplicacion interrogaba —tenia `sendEurosensQuery` y
`sendModbusQuery` y los llamaba en bucle— y por eso leia. Al reescribir el
nucleo, el plugin de Java **conservo** los tres metodos de envio, pero
`hardware.ts` dejo de llamarlos: la aplicacion se quedo escuchando un cable en
el que nadie iba a hablar.

Y un esclavo callado se ve **exactamente igual** que un cable roto. Por eso
todas las rondas anteriores acabaron apuntando al cobre.

## El arreglo

Un protocolo puede ahora declarar su trama de peticion:

```ts
pregunta?(cfg: Record<string, any>): Uint8Array | null;
```

`modbus-rtu` arma `esclavo · funcion · registro(2) · cantidad(2) · CRC(lo,hi)`,
y `eurosens-dds` arma `0x31 · direccion · orden · CRC8`. `hardware.ts` monta un
reloj por fuente que la suelta cada `preguntar_cada_ms`. Con 0 no pregunta, que
es lo que hace falta cuando al otro lado hay alguien emitiendo solo, como el
puente del HelperBox.

El formulario de Configuracion sale solo: los campos son declarativos.

## Probado, no supuesto

Las tramas de peticion van contra **vectores publicados** del estandar Modbus,
no contra lo que salga de nuestro codigo:

```
esclavo 1,  funcion 3, registro 0,   cantidad 10  →  01 03 00 00 00 0A C5 CD
esclavo 17, funcion 3, registro 107, cantidad 3   →  11 03 00 6B 00 03 76 87
```

Y la de Eurosens contra el CRC8 del equipo que si leia: `31 01 06 6C`.

La vuelta completa se probo contra un **esclavo Modbus de verdad** —
`herramientas/esclavo-modbus.py`, corriendo en un HelperBox — atado por un par
de pseudo-terminales:

```
maestro pregunta:  01 03 00 00 00 02 C4 0B
esclavo responde:  01 03 04 04C4 C354 EBF1     CRC correcto
                   caudal=1220  totalizador=50004
```

Esos bytes de respuesta estan clavados en la prueba `entiende la respuesta que
dio un esclavo de verdad`, atados en el mismo bloque que la pregunta: si algun
dia dejan de hablar el mismo idioma, salta.

En el equipo, con la fuente puesta en `modbus-rtu` y `preguntar_cada_ms: 1000`,
el registro del sistema enseña la peticion saliendo cada segundo:

```
12:31:27.636  To native (Capacitor plugin): pluginId: CanRs485, methodName: sendRawBytes
12:31:28.635  To native (Capacitor plugin): pluginId: CanRs485, methodName: sendRawBytes
12:31:29.637  ...
```

## Lo que sigue pendiente

El enlace fisico con el HelperBox sigue mudo: con el esclavo escuchando en su
`ttyS2` y la tablet preguntando cada segundo, no llega ni un byte. Eso es
aparte, y lo de las rondas anteriores sigue valiendo. Pero ya no hace falta ese
cable para saber que la aplicacion pregunta y entiende lo que le contesten.
