#!/system/bin/sh
echo "=== PRUEBA DE LECTURA COMPLETA MODBUS RTU EN VIVO (9600 BAUDIOS 8N1) ==="

for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  echo ">>> EVALUANDO PUERTO $dev A 9600 BAUDIOS <<<"
  stty -F $dev 9600 raw -echo 2>/dev/null

  # 1. Petición Activa Fn 03 (Flujómetro 4 Registros: 01 03 00 00 00 04 44 09)
  echo "1. Enviando Consulta Modbus Fn 03 (01 03 00 00 00 04 44 09)..."
  printf '\x01\x03\x00\x00\x00\x04\x44\x09' > $dev
  res3=$(timeout 1.5 cat $dev | xxd -p 2>/dev/null)

  if [ -n "$res3" ]; then
    echo "=========================================================="
    echo "🎉 🎉 ¡¡¡EXITO TOTAL!!! RESPUESTA RECIBIDA EN $dev: $res3"
    echo "=========================================================="
  else
    echo "Sin respuesta a Fn 03 en $dev."
  fi

  # 2. Escucha pasiva de ráfagas automáticas de 13 Bytes (3 segundos)
  echo "2. Escuchando ráfagas automáticas del emisor en $dev (3 segundos)..."
  pasivo=$(timeout 3 cat $dev | xxd -p 2>/dev/null)
  if [ -n "$pasivo" ]; then
    echo "=========================================================="
    echo "🎉 🎉 ¡¡¡RAFAGA AUTOMATICA RECIBIDA EN $dev!!!: $pasivo"
    echo "=========================================================="
  else
    echo "Sin ráfagas en $dev."
  fi
done
echo "=== FIN DE PRUEBA DE LECTURA ==="
