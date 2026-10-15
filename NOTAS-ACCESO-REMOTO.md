# Acceso remoto a la tablet: Tailscale + RustDesk

Para entrar a una tablet en campo sin ir hasta la mina. Tailscale da la red
privada; RustDesk da la pantalla. El orden importa: primero Tailscale, porque
RustDesk se conecta por la IP que Tailscale entrega.

Los dos APK ya quedan en `Download` solos, sin apretar nada: el app los baja al
arrancar desde `https://miskimayo.wapsi.io/apks/`.

## 0. Salir del kiosco

Nada de esto se puede hacer con el kiosco puesto: tapa los botones del sistema,
no deja abrir Ajustes de Android y se come los avisos y las ventanas flotantes.

Ajustes → Kiosco → clave `gunjop123` → Desbloquear.

Al terminar, se vuelve a activar desde la misma pestaña.

## 1. Tailscale

1. Abrir `Download` → `tailscale.apk` → instalar.
2. Entrar con la cuenta de la red de Miskimayo y conectar. Debe aparecer una
   dirección `100.x.x.x`: esa es la que se usa después.
3. **Que arranque solo**: Ajustes de Android → Redes e internet → VPN → el
   engranaje de Tailscale → activar **VPN siempre activa**.
4. **Dejar "Bloquear conexiones sin VPN" APAGADO.** Si se prende y Tailscale se
   cae, la tablet pierde todo: MQTT, el API de históricos y las
   actualizaciones. Se queda muda hasta que alguien vaya a tocarla.
5. En la consola de Tailscale (admin), con el equipo ya conectado:
   - Renombrarlo con el patrón `miskimayo-tablet-sh-03`.
   - **Quitarle la caducidad de la llave** (*Disable key expiry*). Si no, a los
     ~6 meses el equipo se cae de la red y se pierde el acceso remoto justo
     cuando se necesita.

## 2. RustDesk

Se usa por **IP directa** sobre Tailscale, no por el ID de 9 dígitos. El
servidor público de RustDesk no se usa.

1. Abrir `Download` → `rustdesk.apk` → instalar.
2. Abrirlo. Va a quedar girando en *"Connecting to the RustDesk network"* para
   siempre: **es normal y no estorba**. Ese mensaje habla del servidor público,
   que no usamos.
3. Ajustes de RustDesk → Seguridad:
   - Activar **acceso por IP directa** (*Enable direct IP access*). Escucha en
     el puerto **21118**.
   - Poner una **contraseña permanente**.
4. Iniciar el servicio y aceptar el permiso de captura de pantalla que pide
   Android. Hay que aceptarlo con el kiosco abajo, o no se ve el diálogo.
5. Ajustes de RustDesk → activar **iniciar al encender**.
6. Ajustes de Android → Batería → quitarle la optimización de batería a
   RustDesk. En Android 9, sin eso el servicio se muere solo.

### Esconder el logo flotante

La ventana flotante es un interruptor de sí/no, así que no se puede apagar sin
perder el servicio. Lo que sí se puede es dejarla invisible: Ajustes de
RustDesk → Ventana flotante → subir la **transparencia al máximo**. Queda
operativa pero no se ve.

## 3. Conectarse desde la PC

En el RustDesk de la PC, en lugar del ID se escribe la IP de Tailscale:

```
100.65.230.122
```

Si no toma, con el puerto: `100.65.230.122:21118`. La PC también tiene que
estar en la misma red de Tailscale.

## Cuando no entra

| Síntoma | Causa |
|---|---|
| *"the target device is offline or does not exist"* | Se está usando el ID en vez de la IP de Tailscale |
| Pide ID y no acepta la IP | Falta activar el acceso por IP directa en la tablet |
| Responde al ping pero RustDesk no | El servicio se murió: optimización de batería o no se aceptó la captura de pantalla |
| El equipo desapareció de Tailscale | Caducó la llave (paso 1.5) |
