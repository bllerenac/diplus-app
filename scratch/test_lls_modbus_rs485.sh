#!/system/bin/sh
echo "=== COMPROBACION COMPLETA RS485 (LLS Y MODBUS) EN TODOS LOS PUERTOS ==="

for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  for baud in 19200 9600 115200; do
    stty -F $dev $baud raw -echo 2>/dev/null

    # 1. Enviar consulta LLS Omnicomm ID 0 y 1
    printf '\x31\x00\x06\x6C' > $dev
    res1=$(timeout 0.6 cat $dev | xxd -p 2>/dev/null)
    if [ -n "$res1" ]; then echo ">>> ¡¡RESPUESTA LLS DETECTADA EN $dev A $baud BAUDIOS (ID 0)!!: $res1"; fi

    printf '\x31\x01\x06\xEF' > $dev
    res2=$(timeout 0.6 cat $dev | xxd -p 2>/dev/null)
    if [ -n "$res2" ]; then echo ">>> ¡¡RESPUESTA LLS DETECTADA EN $dev A $baud BAUDIOS (ID 1)!!: $res2"; fi

    # 2. Enviar consulta Modbus RTU ID 1 y 2
    printf '\x01\x03\x00\x00\x00\x02\xC4\x0B' > $dev
    res3=$(timeout 0.6 cat $dev | xxd -p 2>/dev/null)
    if [ -n "$res3" ]; then echo ">>> ¡¡RESPUESTA MODBUS DETECTADA EN $dev A $baud BAUDIOS (ID 1)!!: $res3"; fi

    printf '\x02\x03\x00\x00\x00\x02\xC4\x38' > $dev
    res4=$(timeout 0.6 cat $dev | xxd -p 2>/dev/null)
    if [ -n "$res4" ]; then echo ">>> ¡¡RESPUESTA MODBUS DETECTADA EN $dev A $baud BAUDIOS (ID 2)!!: $res4"; fi
  done
done

echo "=== FIN DE COMPROBACION ==="
