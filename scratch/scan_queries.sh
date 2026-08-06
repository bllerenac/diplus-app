#!/system/bin/sh
echo "=== ESCANER DE CONSULTAS RS485 / MODBUS RTU ==="
for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  for baud in 9600 19200 38400 115200; do
    stty -F $dev $baud raw -echo 2>/dev/null
    for id in 1 2 3 4 5; do
      # Enviar consulta Modbus RTU a esclavo $id
      if [ $id -eq 1 ]; then printf '\x01\x03\x00\x00\x00\x02\xC4\x0B' > $dev; fi
      if [ $id -eq 2 ]; then printf '\x02\x03\x00\x00\x00\x02\xC4\x38' > $dev; fi
      if [ $id -eq 3 ]; then printf '\x03\x03\x00\x00\x00\x02\xC5\xE9' > $dev; fi
      res=$(timeout 0.8 cat $dev | xxd -p 2>/dev/null)
      if [ -n "$res" ]; then
        echo ">>> ¡¡RESPUESTA ENCONTRADA EN $dev A $baud BAUDIOS (ESCLAVO $id)!! <<<"
        echo "DATOS HEX: $res"
      fi
    done
  done
done
echo "=== FIN DE ESCANEO DE CONSULTAS ==="
