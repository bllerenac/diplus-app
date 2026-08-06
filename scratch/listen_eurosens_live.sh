#!/system/bin/sh
echo "=== CONSULTA MODBUS RTU DE 10 REGISTROS (EUROSENS MODBUS) ==="

for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  for baud in 19200 9600 115200; do
    echo "--- Probando $dev a $baud baudios (Consulta Modbus 10 Registros) ---"
    stty -F $dev $baud raw -echo 2>/dev/null

    # Modbus RTU Leer 10 Registros (0x000A) para Esclavos 1, 2, 3, 4
    # Esclavo 1: 01 03 00 00 00 0A C5 CD
    # Esclavo 2: 02 03 00 00 00 0A C5 FE
    # Esclavo 3: 03 03 00 00 00 0A C4 2F

    for id in 1 2 3 4; do
      if [ $id -eq 1 ]; then printf '\x01\x03\x00\x00\x00\x0A\xC5\xCD' > $dev; fi
      if [ $id -eq 2 ]; then printf '\x02\x03\x00\x00\x00\x0A\xC5\xFE' > $dev; fi
      if [ $id -eq 3 ]; then printf '\x03\x03\x00\x00\x00\x0A\xC4\x2F' > $dev; fi
      if [ $id -eq 4 ]; then printf '\x04\x03\x00\x00\x00\x0A\xC5\x99' > $dev; fi

      data=$(timeout 0.8 cat $dev | xxd -p 2>/dev/null)
      if [ -n "$data" ]; then
        echo ">>> ¡¡EXITO TOTAL!! RESPUESTA DE 10 REGISTROS EN $dev (ESCLAVO $id A $baud BAUDIOS) <<<"
        echo "DATOS MODBUS RECIBIDOS (HEX): $data"
      fi
    done
  done
done
echo "=== FIN DE CONSULTA ==="
