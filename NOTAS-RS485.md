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
