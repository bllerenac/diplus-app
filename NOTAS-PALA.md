# Modo pala: beacons, calibración y dibujo

Lo que hace falta para que una pala hidráulica enseñe en la tablet qué está
haciendo: si está girando, si sube la pluma, y a qué ángulo.

## Lo que ya funciona

| | Dónde |
|---|---|
| Lectura de los beacons | `src/nucleo/ksensor.ts` |
| Ángulos y estados | `src/nucleo/pala.ts` |
| Asignar beacons y calibrar | `src/paginas/PalaBeacons.tsx` |
| Pantalla principal de pala | `src/paginas/PalaVista.tsx` |
| El dibujo | `src/paginas/PalaDibujo.tsx` |

Se enciende en **Ajustes → Pala → Pantalla principal de pala**.

## Los beacons

Son **KKM K4**. Hay que configurarlos con la app KBeacon:

- **Adv Type: KSensor**, en un slot propio
- **Sensor Axis: Yes**
- Intervalo 500 ms

Con eso emiten los tres ejes del acelerómetro en los **datos de servicio
`0xFEAA`**, 13 bytes:

```
21 00 | 0b 0c | 77 1e | 80 ff | b9 00 | 17 03 | c3
tipo  | mV    | °C    |  X    |  Y    |  Z    | tx
      | 3083  | /256  | enteros de 16 bits, little-endian
```

**Se leen escaneando, nunca conectándose.** Si te conectas, el beacon corta a
los pocos segundos con el código 19 porque exige contraseña; y una conexión no
aguantaría una pluma moviéndose. El escaneo por anuncio además sobrevive a la
pantalla apagada gracias al `ScanFilter`.

### Dónde va cada uno

| Sitio | Dónde exactamente |
|---|---|
| **Tornamesa** | Bastidor de la superestructura, cerca de la cabina. Es la referencia: mide cómo está parada la máquina |
| **Pluma** | En el alma, **cerca de la base**, cara que mira a la cabina |
| **Brazo** | Parte alta, cerca de su pivote, mirando a la cabina |

**No tienen que mirar al mismo lado.** La calibración de dos posturas saca el
plano de giro de cada beacon por separado, así que se montan donde mejor
agarren. Lo único innegociable es que queden firmes: si uno se corre después
de calibrar, el ángulo miente y nadie se entera.

## La calibración

Cinco posturas, definidas en `POSTURAS` dentro de `pala.ts`. Entre una y otra
la máquina tiene que quedar **quieta**: un acelerómetro en movimiento mide la
sacudida además de la gravedad.

Con dos posturas por pieza queda definido el plano en que se mueve. No hace
falta decir cuántos grados son: lo que se mide es cuánto se movió.

## El dibujo: lo que hace falta

El dibujo tiene que venir **partido en piezas** o no se puede animar.

| Grupo | Qué lleva |
|---|---|
| `cuerpo` | Orugas, tornamesa, cabina, contrapeso: todo lo que no se mueve |
| `pluma` | Solo la pluma, con sus cilindros |
| `brazo` | Solo el brazo |
| `cucharon` | Solo el cucharón |

Y además:

1. **Un solo `viewBox`**, con todas las piezas dibujadas en su sitio, como si
   la máquina estuviera quieta. El giro lo aplica la aplicación.
2. **Los dos pasadores marcados**: dónde pivota la pluma contra la casa y
   dónde el brazo contra la pluma. Con un `id="pivote-pluma"` basta.
3. **De perfil.** Si mira a la derecha en vez de a la izquierda, no importa,
   pero hay que saberlo.

Hacen falta **dos versiones**, carga frontal y retroexcavadora: el cucharón de
la frontal empuja hacia afuera y el de la retro tira hacia la máquina.

Una **vista superior** sirve para el giro de la tornamesa, pero es secundaria:
con dos rectángulos de oruga y la casa encima alcanza.

### Lo que no sirve

- **Nada de WebGL.** El WebView 78 de estas tablets cuelga la GPU con él y el
  proceso queda zombi hasta reiniciar. Pasó dos veces.
- **Nada de fotos del modelo 3D.** La textura viene de un escaneo y a tamaño
  de pantalla se ve sucia.
- **Capas de imagen giradas con CSS.** El driver Adreno pinta costuras blancas
  al componerlas. Si hubiera que usar mapas de bits, van en un solo `canvas`.

## Medidas del Komatsu PC4000-11

De catálogo, para que las proporciones sean las de la máquina.

| | Carga frontal | Retroexcavadora |
|---|---|---|
| Pluma | 7.150 mm | 9.750 mm |
| Brazo | 4.900 mm | 4.500 mm |
| Cucharón | 22 m³ | 22 m³ |
| Alcance máximo | 15.100 mm | 16.650 mm |
| Altura de corte | 17.400 mm | — |
| Profundidad | 2.900 mm | 8.000 mm |

Tren de rodaje, igual en las dos: **8.842 mm** de oruga total, **6.700 mm**
apoyados, **930 mm** de despeje, zapata de 1.200 o 1.500 mm. Alto total unos
8.500 mm y peso en orden de trabajo entre 393 y 409 t.

La `E` del PC4000-11E es la de accionamiento eléctrico.

**Ojo:** el modelo 3D de `campo/pala-articulada.glb` es un **PC8000**, otra
máquina. Sirvió para sacar nombres de piezas y proporciones generales, no como
retrato fiel.

## Lo que falta

- El dibujo en SVG, partido como dice arriba.
- El giro de la tornamesa se acumula del giroscopio, así que **deriva con las
  horas**: vale para ver que está girando, no para saber hacia dónde mira. Un
  acelerómetro no puede medir giro sobre el eje vertical.
- Conteo de ciclos: con los tres beacons calibrados se puede calcular dónde
  está el cucharón, pero las reglas de ciclo están sin escribir.
