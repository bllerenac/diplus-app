# De dónde sale el rumbo del mapa, y qué le falta

Nota del 6 de septiembre de 2026. Pendiente de hacer; queda escrito para no
volver a averiguarlo.

## Cómo está hoy

El rumbo sale **solo del GPS**. La unidad inercial no interviene.

- Con el RTK: `course` de la sentencia NMEA — `nucleo/gps.ts:118`.
- Con el GPS interno de respaldo: `bearing` de Android — `nucleo/gps.ts:138`.
- Se aplica en `paginas/Navegacion.tsx:358`, `girar(p.rumbo)`.

**La flecha no rota nunca**: apunta siempre hacia arriba de la pantalla. Lo que
gira es el mapa por debajo (`--giro` sobre el lienzo) y los nombres de las
geocercas se desgiran (`--desgiro`) para no quedar del revés. Es lo que hace
que se sienta como un navegador y no como un plano.

Los dos valores son **rumbo sobre el terreno**: la dirección entre dos
posiciones seguidas. Hacia dónde **se mueve** el camión, no hacia dónde
**mira**.

## Lo que falla

**Parado, el rumbo no significa nada.** Sin movimiento no hay dos posiciones
que comparar: el receptor devuelve cero o el último valor, con ruido. El mapa
puede girar solo con el camión detenido. Y hoy no hay ningún umbral: `girar()`
se llama con cada posición, vaya a 40 km/h o esté parado en la cola de la pala.

**Marcha atrás sale al revés.** El rumbo apunta a donde va, así que retrocediendo
el mapa se da la vuelta aunque el camión siga mirando al mismo sitio.

## Qué hacer

1. **Umbral de velocidad con histéresis.** Por debajo de ~1,5 m/s el mapa se
   queda como estaba; vuelve a girar por encima de ~2,5. Dos números y no uno:
   con uno solo, un camión oscilando alrededor del umbral engancha y suelta el
   giro sin parar. Se lleva la mayor parte del problema.
2. **Suavizado y tope de grados por segundo.** El rumbo del receptor da
   tirones; que el mapa persiga el valor en vez de saltar a él.

Los dos umbrales, configurables desde Posición: se ajustan en el camión, no
aquí.

## Qué no hacer, y por qué

**La brújula, no**, aunque el hardware esté (MMC3680KJ, ver abajo). Dentro de
la cabina de un volquete hay acero, motor y alternador: miente, y miente
distinto según dónde estés y qué esté haciendo la máquina, que es la peor forma
de mentir porque parece un dato bueno. Calibrarla pide hacer ochos, y nadie va
a hacer ochos con un camión de cien toneladas.

Y hay una razón de fondo: la brújula dice hacia dónde mira **la tablet**, que
está en un soporte que alguien mueve de un codazo. El GPS dice hacia dónde se
mueve **el camión**, que es lo que el mapa tiene que seguir.

## Para después, si el parado sigue molestando

Llevar el rumbo con el **giróscopo** mientras está parado. Es viable: ya se sabe
cómo está montado el equipo —el eje de avance y el techo salen del montaje, ver
`paginas/montaje.tsx`—, así que se sabe qué componente del giróscopo es el giro
del camión sobre sí mismo. La deriva en un par de minutos parado son unos pocos
grados y se corrige sola en cuanto arranca.

Se deja para después porque es otra cosa que puede salir con el signo cambiado
y solo se nota casi parado. Si con el umbral y el suavizado el parado ya no
molesta, no hace falta.

**La marcha atrás no tiene solución desde el GPS**: no hay forma de distinguir
«voy marcha atrás» de «me di la vuelta». Con el umbral casi no se nota, porque
retroceder a la descarga se hace despacio.

## Los sensores que tiene el equipo

De `adb shell dumpsys sensorservice`. Físicos hay cuatro; el resto son
combinaciones que calcula Android a partir de ellos.

| Físico | Pieza | Hasta |
|---|---|---|
| Acelerómetro | InvenSense MPU6500 | 200 Hz |
| Giróscopo | InvenSense MPU6500 | 250 Hz |
| Magnetómetro | MEMSIC MMC3680KJ | 50 Hz |
| Luz y proximidad | Sensortek stk3x1x | — |

**No hay barómetro** y **no hay sensor de temperatura ambiente**.

Calculados por Android sobre esos cuatro: gravedad, aceleración lineal (sin
gravedad), vector de rotación, vector de rotación de juego (sin brújula),
vector de rotación geomagnético, orientación, detector de inclinación,
detector y contador de pasos, podómetro, detección de movimiento
significativo, y los clasificadores de movimiento de Qualcomm (AMD, RMD, CMC,
gestos, facing).

De todos ellos hoy solo se usan el acelerómetro y el giróscopo, en
`nucleo/movimiento.ts`. Dos que podrían servir sin tocar la brújula:

- **Aceleración lineal** (`linear_acceleration`): la aceleración ya con la
  gravedad quitada, hecha por el sistema. Hoy se le resta a mano usando la
  referencia calibrada; es equivalente y funciona, pero si algún día molesta
  calibrar, esto lo evita.
- **Gravedad** (`gravity`): el vector gravedad filtrado. Daría la inclinación
  más limpia que el acelerómetro en crudo, que en vía mala lleva encima todas
  las sacudidas.
