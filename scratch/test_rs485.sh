#!/system/bin/sh
echo "=== PRUEBA DE EMISION Y RESPUESTA RS485 / MODBUS ==="
for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  echo "--- Probando puerto $dev (9600 baudios) ---"
  stty -F $dev 9600 raw -echo 2>/dev/null
  # Enviar consulta Modbus RTU 01 03 00 00 00 02 C4 0B
  printf '\x01\x03\x00\x00\x00\x02\xC4\x0B' > $dev
  res=$(timeout 2 cat $dev | xxd -p 2>/dev/null)
  if [ -n "$res" ]; then
    echo "¡¡RESPUESTA RECIBIDA EN $dev!!: $res"
  else
    echo "Sin respuesta en $dev (9600 baudios)"
  fi

  echo "--- Probando puerto $dev (115200 baudios) ---"
  stty -F $dev 115200 raw -echo 2>/dev/null
  printf '\x01\x03\x00\x00\x00\x02\xC4\x0B' > $dev
  res=$(timeout 2 cat $dev | xxd -p 2>/dev/null)
  if [ -n "$res" ]; then
    echo "¡¡RESPUESTA RECIBIDA EN $dev!!: $res"
  else
    echo "Sin respuesta en $dev (115200 baudios)"
  fi
done
echo "=== FIN DE LA PRUEBA ==="
